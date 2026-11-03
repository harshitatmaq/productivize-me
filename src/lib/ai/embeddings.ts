/**
 * Free embedding providers for semantic job matching. Every provider returns
 * 384-dimension vectors, but vectors from different models live in different
 * spaces, so each vector is stored with its model id and only compared with
 * vectors from the same model.
 *
 * Order (EMBEDDINGS_PROVIDER_ORDER): gemini → jina → supabase (Edge Function, gte-small).
 */

export const EMBED_DIMS = 384;

export type EmbedResult = { model: string; vectors: number[][] };

type Provider = {
  id: string;
  model: string;
  configured: () => boolean;
  embed: (texts: string[]) => Promise<number[][]>;
};

const read = (k: string) => {
  const v = process.env[k];
  return v && v.trim() ? v.trim() : undefined;
};

async function postJson(url: string, body: unknown, headers: Record<string, string>, timeoutMs = 30_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

const providers: Record<string, Provider> = {
  gemini: {
    id: "gemini",
    model: "gemini-embedding-001@384",
    configured: () => !!read("GEMINI_API_KEY"),
    async embed(texts) {
      const out: number[][] = [];
      // batchEmbedContents accepts up to 100 requests
      for (let i = 0; i < texts.length; i += 100) {
        const chunk = texts.slice(i, i + 100);
        const data = (await postJson(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents`,
          {
            requests: chunk.map((text) => ({
              model: "models/gemini-embedding-001",
              content: { parts: [{ text }] },
              taskType: "SEMANTIC_SIMILARITY",
              outputDimensionality: EMBED_DIMS,
            })),
          },
          { "x-goog-api-key": read("GEMINI_API_KEY")! },
        )) as { embeddings?: { values: number[] }[] };
        out.push(...(data.embeddings ?? []).map((e) => normalize(e.values)));
      }
      return out;
    },
  },
  jina: {
    id: "jina",
    model: "jina-embeddings-v3@384",
    configured: () => !!read("JINA_API_KEY"),
    async embed(texts) {
      const data = (await postJson(
        "https://api.jina.ai/v1/embeddings",
        { model: "jina-embeddings-v3", task: "text-matching", dimensions: EMBED_DIMS, input: texts },
        { Authorization: `Bearer ${read("JINA_API_KEY")}` },
      )) as { data?: { embedding: number[] }[] };
      return (data.data ?? []).map((d) => normalize(d.embedding));
    },
  },
  supabase: {
    id: "supabase",
    model: "gte-small",
    configured: () => read("EMBED_FUNCTION_ENABLED") === "true" && !!read("NEXT_PUBLIC_SUPABASE_URL") && !!read("CRON_SECRET"),
    async embed(texts) {
      const data = (await postJson(
        `${read("NEXT_PUBLIC_SUPABASE_URL")}/functions/v1/embed`,
        { input: texts },
        { "x-embed-secret": read("CRON_SECRET")! },
        60_000,
      )) as { embeddings?: number[][] };
      return (data.embeddings ?? []).map(normalize);
    },
  },
};

export function embeddingProviders(): Provider[] {
  return (read("EMBEDDINGS_PROVIDER_ORDER") ?? "gemini,jina,supabase")
    .split(",")
    .map((s) => providers[s.trim().toLowerCase()])
    .filter((p): p is Provider => !!p && p.configured());
}

export function embeddingsConfigured() {
  return embeddingProviders().length > 0;
}

/**
 * Embeds texts with the first working provider. Pass `model` to insist on a
 * specific model (so new vectors are comparable with stored ones).
 */
export async function embed(texts: string[], model?: string): Promise<EmbedResult | null> {
  if (!texts.length) return null;
  for (const p of embeddingProviders()) {
    if (model && p.model !== model) continue;
    try {
      const vectors = await p.embed(texts.map((t) => t.slice(0, 6000)));
      if (vectors.length === texts.length && vectors.every((v) => v.length === EMBED_DIMS)) {
        return { model: p.model, vectors };
      }
    } catch (e) {
      console.warn(`[embed] ${p.id} failed: ${(e as Error).message}`);
    }
  }
  return null;
}

export function normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function centroid(vectors: number[][]): number[] | null {
  if (!vectors.length) return null;
  const out = new Array(vectors[0].length).fill(0);
  for (const v of vectors) for (let i = 0; i < out.length; i++) out[i] += v[i] / vectors.length;
  return normalize(out);
}

/** pgvector returns vectors as "[0.1,0.2,…]" strings over PostgREST. */
export function parseVector(v: unknown): number[] | null {
  if (Array.isArray(v)) return v as number[];
  if (typeof v === "string" && v.startsWith("[")) {
    try {
      return JSON.parse(v) as number[];
    } catch {
      return null;
    }
  }
  return null;
}

export function toPgVector(v: number[]): string {
  return `[${v.map((x) => Number(x.toFixed(6))).join(",")}]`;
}

/** Text that represents a job for embedding. */
export function jobEmbeddingText(j: { title: string; company?: string | null; location?: string | null; description?: string | null }) {
  return `${j.title}${j.company ? ` at ${j.company}` : ""}${j.location ? ` (${j.location})` : ""}\n${(j.description ?? "").slice(0, 2500)}`;
}
