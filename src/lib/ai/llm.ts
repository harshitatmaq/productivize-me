import { extractJson } from "./json";
import { isConfigured, orderedProviders, type ProviderDef } from "./providers";

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
};

export type Attempt = { provider: string; model: string; ok: boolean; ms: number; error?: string };

export type ChatResult = { text: string; provider: string; model: string; attempts: Attempt[] };

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

/** provider:model -> epoch ms until which it is skipped (after a 429/5xx). */
const cooldowns = new Map<string, number>();

type FetchLike = typeof fetch;
let fetchImpl: FetchLike = (...args) => fetch(...args);
let usageRecorder: ((provider: string) => void) | null = null;

/** Test hook. */
export function __setFetch(f: FetchLike | null) {
  fetchImpl = f ?? ((...args) => fetch(...args));
  cooldowns.clear();
}

/** Lets server code count calls per provider without a hard dependency here. */
export function setUsageRecorder(fn: ((provider: string) => void) | null) {
  usageRecorder = fn;
}

function parseRetryAfter(h: string | null): number | undefined {
  if (!h) return undefined;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.min(secs * 1000, 120_000);
  const at = Date.parse(h);
  return Number.isFinite(at) ? Math.min(Math.max(at - Date.now(), 0), 120_000) : undefined;
}

async function callProvider(
  p: ProviderDef,
  model: string,
  opts: ChatOptions,
  timeoutMs: number,
): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.4,
    max_tokens: opts.maxTokens ?? 2048,
  };
  if (/gpt-oss/i.test(model)) body.reasoning_effort = "low";
  const wantJsonMode = opts.json && p.supportsJsonMode;
  if (wantJsonMode) body.response_format = { type: "json_object" };

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
    choices?: { message?: { content?: string | null } }[];
    error?: { message?: string };
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content || !content.trim()) {
    throw new ProviderError(data.error?.message ?? "empty response");
  }
  return content;
}

/**
 * Sends the chat to the first provider/model that answers, falling back down
 * the configured chain on rate limits, outages, timeouts or bad output.
 */
export async function chat(opts: ChatOptions, validate?: (text: string) => void): Promise<ChatResult> {
  const attempts: Attempt[] = [];
  const deadline = Date.now() + (opts.deadlineMs ?? 240_000);
  const providers = orderedProviders().filter(
    (p) => isConfigured(p) && (!opts.only || opts.only.includes(p.id)),
  );

  if (providers.length === 0) {
    throw new LlmChainError(
      "No LLM provider is configured. Add at least one API key (e.g. GROQ_API_KEY) to the environment.",
      attempts,
    );
  }

  for (const p of providers) {
    for (const model of p.models) {
      const key = `${p.id}:${model}`;
      const until = cooldowns.get(key) ?? 0;
      if (until > Date.now()) {
        attempts.push({ provider: p.id, model, ok: false, ms: 0, error: "cooling down after rate limit" });
        continue;
      }
      const remaining = deadline - Date.now();
      if (remaining < 3_000) {
        throw new LlmChainError("LLM chain ran out of time", attempts);
      }
      const started = Date.now();
      try {
        const text = await callProvider(p, model, opts, Math.min(p.timeoutMs, remaining));
        validate?.(text);
        attempts.push({ provider: p.id, model, ok: true, ms: Date.now() - started });
        usageRecorder?.(p.id);
        return { text, provider: p.id, model, attempts };
      } catch (e) {
        const err = e as ProviderError;
        attempts.push({ provider: p.id, model, ok: false, ms: Date.now() - started, error: err.message });
        if (err.status === 429) {
          cooldowns.set(key, Date.now() + (err.retryAfterMs ?? 60_000));
        } else if (err.status && err.status >= 500) {
          cooldowns.set(key, Date.now() + 20_000);
        } else if (err.status === 401 || err.status === 403) {
          // Bad key: no point trying the other models of this provider.
          cooldowns.set(key, Date.now() + 10 * 60_000);
          break;
        }
        if (opts.purpose) {
          console.warn(`[llm:${opts.purpose}] ${p.id}/${model} failed: ${err.message}`);
        }
      }
    }
  }

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
