/**
 * Free-tier LLM providers, all spoken to through the OpenAI-compatible
 * `/chat/completions` API. Order (best → most reliable fallback) comes from
 * LLM_PROVIDER_ORDER; MAQ AI is kept last because it is slow but always up.
 *
 * Each provider accepts a comma-separated model list (e.g. GROQ_MODELS). Free
 * tiers rate-limit per model, so the chain tries every model of a provider
 * before moving on to the next provider.
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

export const DEFAULT_PROVIDER_ORDER = ["groq", "cerebras", "gemini", "openrouter", "mistral", "maq"];

export function providerDefs(): Record<string, ProviderDef> {
  return {
    groq: {
      id: "groq",
      label: "Groq",
      baseUrl: read("GROQ_BASE_URL") ?? "https://api.groq.com/openai/v1",
      apiKey: read("GROQ_API_KEY"),
      models: list("GROQ_MODELS", "llama-3.3-70b-versatile,openai/gpt-oss-120b,meta-llama/llama-4-scout-17b-16e-instruct"),
      timeoutMs: 45_000,
      supportsJsonMode: true,
      signupUrl: "https://console.groq.com/keys",
    },
    cerebras: {
      id: "cerebras",
      label: "Cerebras",
      baseUrl: read("CEREBRAS_BASE_URL") ?? "https://api.cerebras.ai/v1",
      apiKey: read("CEREBRAS_API_KEY"),
      models: list("CEREBRAS_MODELS", "gpt-oss-120b,qwen-3-235b-a22b-instruct-2507,llama3.1-8b"),
      timeoutMs: 45_000,
      supportsJsonMode: true,
      signupUrl: "https://cloud.cerebras.ai",
    },
    gemini: {
      id: "gemini",
      label: "Google Gemini",
      baseUrl: read("GEMINI_BASE_URL") ?? "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: read("GEMINI_API_KEY"),
      models: list("GEMINI_MODELS", "gemini-2.5-flash,gemini-2.5-flash-lite"),
      timeoutMs: 60_000,
      supportsJsonMode: true,
      signupUrl: "https://aistudio.google.com/apikey",
    },
    openrouter: {
      id: "openrouter",
      label: "OpenRouter (free models)",
      baseUrl: read("OPENROUTER_BASE_URL") ?? "https://openrouter.ai/api/v1",
      apiKey: read("OPENROUTER_API_KEY"),
      models: list(
        "OPENROUTER_MODELS",
        "openai/gpt-oss-120b:free,meta-llama/llama-3.3-70b-instruct:free,deepseek/deepseek-chat-v3.1:free",
      ),
      timeoutMs: 60_000,
      supportsJsonMode: false,
      headers: {
        "HTTP-Referer": read("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000",
        "X-Title": "Productivize Me",
      },
      signupUrl: "https://openrouter.ai/keys",
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
