/**
 * Free-tier LLM providers, all spoken to through the OpenAI-compatible
 * `/chat/completions` API. Order (best → most reliable fallback) comes from
 * LLM_PROVIDER_ORDER; MAQ AI is kept last because it is slow but always up.
 *
 * Each provider accepts a comma-separated model list (e.g. GROQ_MODELS). Free
 * tiers rate-limit per model, so the chain tries every model of a provider
 * before moving on to the next provider. Model line-ups change often: run
 * `npm run ai:check` to see which configured models your keys can really use.
 *
 * Tasks can also get their own chain ("lanes", see lanes() below and
 * .env.example), e.g. fast models for quick replies and stronger ones for writing.
 */

export type ProviderDef = {
  id: string;
  label: string;
  baseUrl: string | undefined;
  apiKey: string | undefined;
  models: string[];
  timeoutMs: number;
  supportsJsonMode: boolean;
  headers?: Record<string, string>;
  signupUrl: string;
  /** Environment variable holding this provider's model list (for ai:check suggestions). */
  modelsEnv: string;
  /**
   * Largest request (prompt + max output, in estimated tokens) worth sending.
   * Groq's free tier allows ~8K tokens per minute per model, so a bigger
   * request can never succeed there and is skipped. 0 = no limit.
   */
  maxRequestTokens: number;
};

const read = (name: string) => {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
};
const list = (name: string, fallback: string) =>
  (read(name) ?? fallback)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

// Cerebras now needs a payment method, so it's tried late (only if you add a key).
export const DEFAULT_PROVIDER_ORDER = ["groq", "gemini", "cloudflare", "nvidia", "openrouter", "mistral", "cerebras", "maq"];

export function providerDefs(): Record<string, ProviderDef> {
  return {
    groq: {
      id: "groq",
      label: "Groq",
      baseUrl: read("GROQ_BASE_URL") ?? "https://api.groq.com/openai/v1",
      apiKey: read("GROQ_API_KEY"),
      models: list("GROQ_MODELS", "openai/gpt-oss-120b,openai/gpt-oss-20b,qwen/qwen3.8-27b"),
      timeoutMs: 45_000,
      supportsJsonMode: true,
      signupUrl: "https://console.groq.com/keys",
      modelsEnv: "GROQ_MODELS",
      maxRequestTokens: Number(read("GROQ_MAX_REQUEST_TOKENS") ?? 7500),
    },
    cerebras: {
      id: "cerebras",
      label: "Cerebras",
      baseUrl: read("CEREBRAS_BASE_URL") ?? "https://api.cerebras.ai/v1",
      apiKey: read("CEREBRAS_API_KEY"),
      models: list("CEREBRAS_MODELS", "gpt-oss-120b"),
      timeoutMs: 45_000,
      supportsJsonMode: true,
      signupUrl: "https://cloud.cerebras.ai",
      modelsEnv: "CEREBRAS_MODELS",
      maxRequestTokens: Number(read("CEREBRAS_MAX_REQUEST_TOKENS") ?? 0),
    },
    gemini: {
      id: "gemini",
      label: "Google Gemini",
      baseUrl: read("GEMINI_BASE_URL") ?? "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: read("GEMINI_API_KEY"),
      models: list("GEMINI_MODELS", "gemini-2.5-flash,gemini-3.8-flash,gemini-2.5-flash-lite"),
      timeoutMs: 60_000,
      supportsJsonMode: true,
      signupUrl: "https://aistudio.google.com/apikey",
      modelsEnv: "GEMINI_MODELS",
      maxRequestTokens: Number(read("GEMINI_MAX_REQUEST_TOKENS") ?? 0),
    },
    cloudflare: {
      id: "cloudflare",
      label: "Cloudflare Workers AI",
      baseUrl: read("CLOUDFLARE_BASE_URL") ?? (read("CLOUDFLARE_ACCOUNT_ID") ? `https://api.cloudflare.com/client/v4/accounts/${read("CLOUDFLARE_ACCOUNT_ID")}/ai/v1` : undefined),
      apiKey: read("CLOUDFLARE_API_KEY") ?? read("CLOUDFLARE_API_TOKEN"),
      models: list("CLOUDFLARE_MODELS", "@cf/google/gemma-4-26b-a4b-it"),
      timeoutMs: 60_000,
      supportsJsonMode: true,
      signupUrl: "https://dash.cloudflare.com/profile/api-tokens",
      modelsEnv: "CLOUDFLARE_MODELS",
      maxRequestTokens: Number(read("CLOUDFLARE_MAX_REQUEST_TOKENS") ?? 0),
    },
    nvidia: {
      id: "nvidia",
      label: "NVIDIA (trial)",
      baseUrl: read("NVIDIA_BASE_URL") ?? "https://integrate.api.nvidia.com/v1",
      apiKey: read("NVIDIA_API_KEY"),
      models: list("NVIDIA_MODELS", "nvidia/nemotron-3-ultra-550b-a55b"),
      timeoutMs: 60_000,
      supportsJsonMode: true,
      signupUrl: "https://build.nvidia.com",
      modelsEnv: "NVIDIA_MODELS",
      maxRequestTokens: Number(read("NVIDIA_MAX_REQUEST_TOKENS") ?? 0),
    },
    openrouter: {
      id: "openrouter",
      label: "OpenRouter (free models)",
      baseUrl: read("OPENROUTER_BASE_URL") ?? "https://openrouter.ai/api/v1",
      apiKey: read("OPENROUTER_API_KEY"),
      models: list(
        "OPENROUTER_MODELS",
        "nvidia/nemotron-3-ultra-550b-a55b:free,google/gemma-4-26b-a4b-it:free,openai/gpt-oss-120b:free",
      ),
      timeoutMs: 60_000,
      supportsJsonMode: false,
      headers: {
        "HTTP-Referer": read("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000",
        "X-Title": "Productivize Me",
      },
      signupUrl: "https://openrouter.ai/keys",
      modelsEnv: "OPENROUTER_MODELS",
      maxRequestTokens: Number(read("OPENROUTER_MAX_REQUEST_TOKENS") ?? 0),
    },
    mistral: {
      id: "mistral",
      label: "Mistral",
      baseUrl: read("MISTRAL_BASE_URL") ?? "https://api.mistral.ai/v1",
      apiKey: read("MISTRAL_API_KEY"),
      models: list("MISTRAL_MODELS", "mistral-small-latest"),
      timeoutMs: 60_000,
      supportsJsonMode: true,
      signupUrl: "https://console.mistral.ai/api-keys",
      modelsEnv: "MISTRAL_MODELS",
      maxRequestTokens: Number(read("MISTRAL_MAX_REQUEST_TOKENS") ?? 0),
    },
    maq: {
      id: "maq",
      label: "MAQ AI (slow, always-on fallback)",
      baseUrl: read("MAQ_AI_BASE_URL")?.replace(/\/$/, ""),
      apiKey: read("MAQ_AI_API_KEY"),
      models: list("MAQ_AI_MODELS", read("MAQ_AI_MODEL") ?? ""),
      timeoutMs: Number(read("MAQ_AI_TIMEOUT_MS") ?? 180_000),
      supportsJsonMode: read("MAQ_AI_JSON_MODE") === "true",
      signupUrl: "",
      modelsEnv: "MAQ_AI_MODELS",
      maxRequestTokens: Number(read("MAQ_AI_MAX_REQUEST_TOKENS") ?? 0),
    },
  };
}

export function isConfigured(p: ProviderDef): boolean {
  return Boolean(p.baseUrl && p.apiKey && p.models.length > 0);
}

export function orderedProviders(): ProviderDef[] {
  const defs = providerDefs();
  const order = (read("LLM_PROVIDER_ORDER") ?? DEFAULT_PROVIDER_ORDER.join(","))
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((id, i, arr) => id in defs && arr.indexOf(id) === i);
  return order.map((id) => defs[id]);
}

export type Step = { provider: ProviderDef; model: string };

/**
 * Built-in lanes (free tiers only). Entries are preferences: "groq:openai/gpt-oss-20b"
 * is used only if that model is in GROQ_MODELS, and a bare "groq" adds the rest of
 * Groq's models. Providers missing from LLM_PROVIDER_ORDER are left out. Override
 * any lane with LLM_LANE_<NAME>, or turn them all off with LLM_LANES=off.
 */
const LANES: Record<string, string> = {
  // Short structured replies; speed matters.
  quick: "groq:openai/gpt-oss-20b,groq:openai/gpt-oss-120b,groq,gemini:gemini-2.5-flash-lite,gemini,cloudflare,openrouter,nvidia,mistral,cerebras,maq",
  // Plan my day: time arithmetic and instruction following.
  plan: "groq:openai/gpt-oss-120b,groq,gemini:gemini-2.5-flash,gemini,nvidia,cloudflare,openrouter,mistral,cerebras,maq",
  // High-volume job scoring and interest scoring: spend the free per-minute budgets first.
  scoring: "groq:openai/gpt-oss-120b,groq,cloudflare,openrouter,gemini:gemini-2.5-flash-lite,gemini,nvidia,mistral,cerebras,maq",
  // Writing, long documents and careful reasoning: strongest models first.
  writing: "gemini:gemini-3.8-flash,gemini:gemini-2.5-flash,gemini,nvidia,groq:openai/gpt-oss-120b,groq,openrouter,mistral,cloudflare,cerebras,maq",
  // Board assistant: reliable tool calling.
  tools: "gemini:gemini-2.5-flash,gemini,mistral,groq:openai/gpt-oss-120b,groq,nvidia,openrouter,cerebras,maq",
};
const PURPOSE_LANES: Record<string, string> = {
  "plan-day": "plan",
  "preferences-learn": "quick",
  "job-query": "quick",
  "job-import": "quick",
  "job-scoring": "scoring",
  "memory-suggest": "scoring",
  "memory-relevance": "scoring",
  onboarding: "writing",
  "profile-synthesis": "writing",
  "search-plan": "writing",
  "job-analysis": "writing",
  "application-pack": "writing",
  resume: "writing",
  portfolio: "writing",
  "learning-suggest": "writing",
  flashcards: "writing",
  "learning-recap": "writing",
  "memory-learn": "writing",
  "dashboard-assistant": "tools",
};

/** "groq:openai/gpt-oss-120b" or just "maq" (all of its models). Splits at the first colon. */
function parseSteps(spec: string, defs: Record<string, ProviderDef>, builtIn = false): Step[] {
  return spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      const i = entry.indexOf(":");
      const id = (i < 0 ? entry : entry.slice(0, i)).toLowerCase();
      const p = defs[id];
      if (!p) return [];
      if (i < 0) return p.models.map((model) => ({ provider: p, model }));
      const model = entry.slice(i + 1);
      return builtIn && !p.models.includes(model) ? [] : [{ provider: p, model }];
    });
}

/** "plan-day:plan,job-scoring:scoring" → { "plan-day": "plan", … } */
function pairs(name: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const item of (read(name) ?? "").split(",")) {
    const i = item.indexOf(":");
    if (i > 0) out.set(item.slice(0, i).trim(), item.slice(i + 1).trim());
  }
  return out;
}

/**
 * The ordered provider/model steps for a task: its lane (built-in, or from the
 * environment), or the global chain (LLM_PROVIDER_ORDER × each provider's models)
 * for tasks without one. Environment overrides:
 *   LLM_PURPOSE_LANES=job-scoring:scoring,plan-day:plan
 *   LLM_LANE_SCORING=groq:openai/gpt-oss-120b,gemini:gemini-2.5-flash-lite,maq
 *   LLM_PURPOSE_FIRST=job-query:groq:openai/gpt-oss-20b   (one step moved to the front)
 * Steps whose provider has no key are dropped later.
 */
export function stepsFor(purpose?: string): Step[] {
  const defs = providerDefs();
  const global = () => orderedProviders().flatMap((p) => p.models.map((model) => ({ provider: p, model })));
  const lanesOn = read("LLM_LANES")?.toLowerCase() !== "off";
  const lane = purpose ? (pairs("LLM_PURPOSE_LANES").get(purpose) ?? (lanesOn ? PURPOSE_LANES[purpose] : undefined)) : undefined;
  const envSpec = lane ? read(`LLM_LANE_${lane.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`) : undefined;
  let steps: Step[];
  if (envSpec) steps = parseSteps(envSpec, defs);
  else if (lane && lanesOn && LANES[lane]) {
    const allowed = new Set(orderedProviders().map((p) => p.id));
    steps = parseSteps(LANES[lane], defs, true).filter((s) => allowed.has(s.provider.id));
  } else steps = global();
  if (!steps.length) steps = global();
  const first = purpose ? pairs("LLM_PURPOSE_FIRST").get(purpose) : undefined;
  if (first) steps = [...parseSteps(first, defs), ...steps];
  const seen = new Set<string>();
  return steps.filter((s) => {
    const k = `${s.provider.id}:${s.model}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Providers that must never receive personal data (resume, habits, beliefs,
 * tasks, shared chat), e.g. free tiers that train on prompts:
 *   LLM_NO_PERSONAL_DATA=gemini
 * Only tasks that handle public text (a job page, a search phrase) may still use them.
 */
export function noPersonalData(): Set<string> {
  return new Set(
    (read("LLM_NO_PERSONAL_DATA") ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}
