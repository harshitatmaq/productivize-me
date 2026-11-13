import { extractJson } from "./json";
import { isConfigured, noPersonalData, orderedProviders, stepsFor, type ProviderDef } from "./providers";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ChatOptions = {
  messages: ChatMessage[];
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  /** Short label used in logs, e.g. "job-scoring". */
  purpose?: string;
  /** Restrict to these provider ids (still in configured order). */
  only?: string[];
  /** Overall deadline for the whole chain. */
  deadlineMs?: number;
  /** OpenAI-style function tools (every provider in the chain is OpenAI-compatible). */
  tools?: unknown[];
  toolChoice?: "auto" | "none" | "required";
};

export type ToolCall = { function?: { name?: string; arguments?: string } };

export type Attempt = { provider: string; model: string; ok: boolean; ms: number; error?: string };

export type ChatResult = {
  text: string;
  provider: string;
  model: string;
  attempts: Attempt[];
  /** Present when `tools` were offered and the model called one. */
  toolCalls?: ToolCall[];
  finishReason?: string;
};

export class LlmChainError extends Error {
  attempts: Attempt[];
  constructor(message: string, attempts: Attempt[]) {
    super(message);
    this.name = "LlmChainError";
    this.attempts = attempts;
  }
}

class ProviderError extends Error {
  status?: number;
  retryAfterMs?: number;
  constructor(message: string, status?: number, retryAfterMs?: number) {
    super(message);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/** provider:model -> epoch ms until which it is skipped (after a 429/5xx, a daily limit or a retired model). */
const cooldowns = new Map<string, number>();
/** Models that no longer exist, logged once per process. */
const retired = new Set<string>();

/** Tasks that only handle public text; everything else may contain personal data. */
const PUBLIC_PURPOSES = new Set(["job-import", "job-query"]);

const MIN = 60_000;
const nextUtcMidnight = (now = Date.now()) => {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) + 30_000;
};

/** What a failure means for this provider/model: how long to skip it. */
export function classifyFailure(status: number | undefined, message: string, retryAfterMs?: number, now = Date.now()): { until: number; kind: "minute" | "daily" | "retired" | "outage" | "auth" | "other" } {
  const msg = message.toLowerCase();
  if (status === 404 || ((status === 400 || status === 422) && /model[_ ]not[_ ]found|model .*(not found|does not exist|not exist|not available|decommission|deprecat|no longer|unsupported)|unknown model|invalid model|no such model/.test(msg))) {
    return { until: now + 6 * 60 * MIN, kind: "retired" };
  }
  if (status === 429) {
    const daily = /per day|per-day|daily|\brpd\b|\btpd\b|requests per day|tokens per day|quota exceeded|free-models-per-day/.test(msg) || (retryAfterMs ?? 0) > 10 * MIN;
    if (daily) return { until: Math.max(now + (retryAfterMs ?? 0), nextUtcMidnight(now)), kind: "daily" };
    return { until: now + (retryAfterMs ?? MIN), kind: "minute" };
  }
  if (status === 401 || status === 403) return { until: now + 10 * MIN, kind: "auth" };
  if (status && status >= 500) return { until: now + 20_000, kind: "outage" };
  return { until: 0, kind: "other" };
}

/** Rough token count (≈3.5 characters per token) of a request including its output budget. */
export function estimateTokens(opts: Pick<ChatOptions, "messages" | "maxTokens" | "tools">): number {
  const chars = opts.messages.reduce((n, m) => n + m.content.length, 0) + (opts.tools?.length ? JSON.stringify(opts.tools).length : 0);
  return Math.ceil(chars / 3.5) + (opts.maxTokens ?? 2048);
}

type FetchLike = typeof fetch;
let fetchImpl: FetchLike = (...args) => fetch(...args);
let usageRecorder: ((provider: string) => void) | null = null;

/** Test hook. */
export function __setFetch(f: FetchLike | null) {
  fetchImpl = f ?? ((...args) => fetch(...args));
  cooldowns.clear();
  retired.clear();
}

type CallRecord = { purpose?: string; provider?: string; model?: string; ok: boolean; ms: number; fallbacks: number; error?: string };
let callRecorder: ((r: CallRecord) => void | Promise<void>) | null = null;

/** Test hook: capture activity-log rows instead of writing them to the database. */
export function __setCallRecorder(fn: ((r: CallRecord) => void | Promise<void>) | null) {
  callRecorder = fn;
}

/** One row in the AI activity log (no prompt content). Best-effort: never throws. */
async function record(r: CallRecord) {
  try {
    if (callRecorder) return await callRecorder(r);
    if (process.env.VITEST || typeof window !== "undefined") return;
    const { recordAiCall } = await import("./record");
    await recordAiCall(r);
  } catch {
    // logging must never break an AI request
  }
}

/** Lets server code count calls per provider without a hard dependency here. */
export function setUsageRecorder(fn: ((provider: string) => void) | null) {
  usageRecorder = fn;
}

function parseRetryAfter(h: string | null): number | undefined {
  if (!h) return undefined;
  const secs = Number(h);
  // Daily limits can ask for hours; cap at a day.
  if (Number.isFinite(secs)) return Math.min(secs * 1000, 26 * 60 * MIN);
  const at = Date.parse(h);
  return Number.isFinite(at) ? Math.min(Math.max(at - Date.now(), 0), 26 * 60 * MIN) : undefined;
}

async function callProvider(
  p: ProviderDef,
  model: string,
  opts: ChatOptions,
  timeoutMs: number,
): Promise<{ content: string; toolCalls?: ToolCall[]; finishReason?: string }> {
  const body: Record<string, unknown> = {
    model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.4,
    max_tokens: opts.maxTokens ?? 2048,
  };
  if (/gpt-oss/i.test(model)) body.reasoning_effort = "low";
  const wantJsonMode = opts.json && p.supportsJsonMode;
  if (wantJsonMode) body.response_format = { type: "json_object" };
  if (opts.tools?.length) {
    body.tools = opts.tools;
    body.tool_choice = opts.toolChoice ?? "auto";
  }

  const doFetch = async (payload: Record<string, unknown>) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetchImpl(`${p.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${p.apiKey}`,
          ...(p.headers ?? {}),
        },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
    } catch (e) {
      const msg = (e as Error).name === "AbortError" ? `timeout after ${timeoutMs}ms` : (e as Error).message;
      throw new ProviderError(msg);
    } finally {
      clearTimeout(timer);
    }
  };

  let res = await doFetch(body);
  // Some models reject JSON mode; retry once without it (we parse JSON ourselves anyway).
  if (res.status === 400 && wantJsonMode) {
    const text = await res.text();
    if (/response_format|json/i.test(text)) {
      delete body.response_format;
      res = await doFetch(body);
    } else {
      throw new ProviderError(`400: ${text.slice(0, 300)}`, 400);
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ProviderError(
      `${res.status}: ${text.slice(0, 300)}`,
      res.status,
      parseRetryAfter(res.headers.get("retry-after")),
    );
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] }; finish_reason?: string }[];
    error?: { message?: string };
  };
  const choice = data.choices?.[0];
  const content = choice?.message?.content ?? "";
  const toolCalls = choice?.message?.tool_calls?.length ? choice.message.tool_calls : undefined;
  if (!content.trim() && !toolCalls) {
    throw new ProviderError(data.error?.message ?? "empty response");
  }
  return { content, toolCalls, finishReason: choice?.finish_reason };
}

/**
 * Sends the chat to the first provider/model that answers, falling back down
 * the configured chain on rate limits, outages, timeouts or bad output.
 */
export async function chat(opts: ChatOptions, validate?: (text: string) => void): Promise<ChatResult> {
  const attempts: Attempt[] = [];
  const deadline = Date.now() + (opts.deadlineMs ?? 240_000);
  const blocked = opts.purpose && PUBLIC_PURPOSES.has(opts.purpose) ? new Set<string>() : noPersonalData();
  const steps = stepsFor(opts.purpose).filter(
    (s) => isConfigured(s.provider) && (!opts.only || opts.only.includes(s.provider.id)) && !blocked.has(s.provider.id),
  );

  if (steps.length === 0) {
    throw new LlmChainError(
      "No LLM provider is configured. Add at least one API key (e.g. GROQ_API_KEY) to the environment.",
      attempts,
    );
  }

  const size = estimateTokens(opts);
  const chainStarted = Date.now();
  let failedCalls = 0;
  let lastError: string | undefined;
  const badKey = new Set<string>();
  for (const { provider: p, model } of steps) {
    const key = `${p.id}:${model}`;
    if (badKey.has(p.id)) continue;
    const until = cooldowns.get(key) ?? 0;
    if (until > Date.now()) {
      attempts.push({ provider: p.id, model, ok: false, ms: 0, error: retired.has(key) ? "model not available" : "cooling down after rate limit" });
      continue;
    }
    if (p.maxRequestTokens > 0 && size > p.maxRequestTokens) {
      attempts.push({ provider: p.id, model, ok: false, ms: 0, error: `request too large for this provider (~${size} tokens)` });
      continue;
    }
    const remaining = deadline - Date.now();
    if (remaining < 3_000) {
      throw new LlmChainError("LLM chain ran out of time", attempts);
    }
    const started = Date.now();
    try {
      const out = await callProvider(p, model, opts, Math.min(p.timeoutMs, remaining));
      let text = out.content;
      try {
        validate?.(text);
      } catch (invalid) {
        // One repair attempt on the same model before moving on: show it its reply and the parse error.
        if (!opts.json || opts.tools?.length || deadline - Date.now() < 5_000) throw invalid;
        const repaired = await callProvider(
          p,
          model,
          {
            ...opts,
            messages: [
              ...opts.messages,
              { role: "assistant", content: text.slice(0, 8000) },
              { role: "user", content: `That reply wasn't valid (${(invalid as Error).message.slice(0, 200)}). Reply again with ONLY the corrected JSON, nothing else.` },
            ],
          },
          Math.min(p.timeoutMs, deadline - Date.now()),
        );
        text = repaired.content;
        validate?.(text);
      }
      attempts.push({ provider: p.id, model, ok: true, ms: Date.now() - started });
      usageRecorder?.(p.id);
      await record({ purpose: opts.purpose, provider: p.id, model, ok: true, ms: Date.now() - chainStarted, fallbacks: failedCalls, error: lastError });
      return { text, provider: p.id, model, attempts, toolCalls: out.toolCalls, finishReason: out.finishReason };
    } catch (e) {
      const err = e as ProviderError;
      attempts.push({ provider: p.id, model, ok: false, ms: Date.now() - started, error: err.message });
      failedCalls++;
      lastError = `${p.id}/${model}: ${err.message}`;
      const verdict = classifyFailure(err.status, err.message ?? "", err.retryAfterMs);
      if (verdict.until) cooldowns.set(key, verdict.until);
      if (verdict.kind === "auth") badKey.add(p.id); // bad key: no point trying this provider's other models
      if (verdict.kind === "retired" && !retired.has(key)) {
        retired.add(key);
        console.error(`[llm] ${key} is not available (retired or wrong id) — skipping it. Run \`npm run ai:check\` and update ${p.modelsEnv}.`);
      } else if (opts.purpose) {
        console.warn(`[llm:${opts.purpose}] ${p.id}/${model} failed${verdict.kind === "daily" ? " (daily limit — skipped until it resets)" : ""}: ${err.message}`);
      }
    }
  }

  await record({ purpose: opts.purpose, ok: false, ms: Date.now() - chainStarted, fallbacks: failedCalls, error: lastError ?? attempts.at(-1)?.error });
  throw new LlmChainError(
    `All LLM providers failed: ${attempts.map((a) => `${a.provider}/${a.model}: ${a.error}`).join(" | ")}`,
    attempts,
  );
}

/** Like `chat`, but parses (and optionally validates) a JSON reply. Invalid JSON moves on to the next model. */
export async function chatJson<T>(
  opts: Omit<ChatOptions, "json">,
  check?: (value: unknown) => T,
): Promise<{ data: T; provider: string; model: string; attempts: Attempt[] }> {
  let parsed: T | undefined;
  const result = await chat({ ...opts, json: true }, (text) => {
    const value = extractJson(text);
    parsed = check ? check(value) : (value as T);
  });
  return { data: parsed as T, provider: result.provider, model: result.model, attempts: result.attempts };
}

export function configuredProviderSummary() {
  return orderedProviders().map((p) => ({
    id: p.id,
    label: p.label,
    configured: isConfigured(p),
    models: p.models,
    signupUrl: p.signupUrl,
  }));
}
