import "server-only";

import { env, envInt, envList } from "@/lib/env";
import { paceAllows, recordCall } from "@/lib/usage";

export type WebResult = {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  provider: string;
};

export type WebSearchOptions = {
  query: string;
  maxResults?: number;
  /** Recency: day | week | month */
  recency?: "day" | "week" | "month";
  /** Restrict to these sites (passed natively where supported, else as site: operators). */
  domains?: string[];
  /** Skip the budget pacing check (manual "search now"). */
  ignorePace?: boolean;
};

type SearchArgs = { query: string; maxResults: number; recency: "day" | "week" | "month"; domains: string[] };

/** "foo" + [a.com, b.com] -> "foo (site:a.com OR site:b.com)" for Google-style engines. */
export function withSiteOperators(query: string, domains: string[]): string {
  if (!domains.length) return query;
  return `${query} (${domains.slice(0, 8).map((d) => `site:${d}`).join(" OR ")})`;
}

type SearchProvider = {
  id: string;
  label: string;
  configured: () => boolean;
  monthlyLimit: () => number;
  signupUrl: string;
  search: (o: SearchArgs) => Promise<WebResult[]>;
};

const TIMEOUT = 20_000;

async function getJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const PROVIDERS: Record<string, SearchProvider> = {
  tavily: {
    id: "tavily",
    label: "Tavily",
    configured: () => !!env("TAVILY_API_KEY"),
    monthlyLimit: () => envInt("TAVILY_MONTHLY_LIMIT", 900),
    signupUrl: "https://app.tavily.com",
    async search({ query, maxResults, recency, domains }) {
      const data = (await getJson("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env("TAVILY_API_KEY")}` },
        body: JSON.stringify({
          query,
          max_results: maxResults,
          search_depth: "basic",
          time_range: recency,
          ...(domains.length ? { include_domains: domains } : {}),
        }),
      })) as { results?: { title: string; url: string; content?: string; published_date?: string }[] };
      return (data.results ?? []).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.content ?? "",
        publishedAt: r.published_date,
        provider: "tavily",
      }));
    },
  },
  serper: {
    id: "serper",
    label: "Serper (Google)",
    configured: () => !!env("SERPER_API_KEY"),
    monthlyLimit: () => envInt("SERPER_MONTHLY_LIMIT", 200),
    signupUrl: "https://serper.dev",
    async search({ query, maxResults, recency, domains }) {
      const tbs = { day: "qdr:d", week: "qdr:w", month: "qdr:m" }[recency];
      const data = (await getJson("https://google.serper.dev/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-KEY": env("SERPER_API_KEY")! },
        body: JSON.stringify({ q: withSiteOperators(query, domains), num: maxResults, tbs }),
      })) as { organic?: { title: string; link: string; snippet?: string; date?: string }[] };
      return (data.organic ?? []).map((r) => ({
        title: r.title,
        url: r.link,
        snippet: r.snippet ?? "",
        publishedAt: r.date,
        provider: "serper",
      }));
    },
  },
  brave: {
    id: "brave",
    label: "Brave Search",
    configured: () => !!env("BRAVE_API_KEY"),
    monthlyLimit: () => envInt("BRAVE_MONTHLY_LIMIT", 900),
    signupUrl: "https://api-dashboard.search.brave.com",
    async search({ query, maxResults, recency, domains }) {
      const freshness = { day: "pd", week: "pw", month: "pm" }[recency];
      const u = new URL("https://api.search.brave.com/res/v1/web/search");
      u.searchParams.set("q", withSiteOperators(query, domains));
      u.searchParams.set("count", String(Math.min(maxResults, 20)));
      u.searchParams.set("freshness", freshness);
      const data = (await getJson(u.toString(), {
        headers: { Accept: "application/json", "X-Subscription-Token": env("BRAVE_API_KEY")! },
      })) as { web?: { results?: { title: string; url: string; description?: string; age?: string }[] } };
      return (data.web?.results ?? []).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: (r.description ?? "").replace(/<[^>]+>/g, ""),
        publishedAt: r.age,
        provider: "brave",
      }));
    },
  },
  exa: {
    id: "exa",
    label: "Exa",
    configured: () => !!env("EXA_API_KEY"),
    monthlyLimit: () => envInt("EXA_MONTHLY_LIMIT", 500),
    signupUrl: "https://dashboard.exa.ai",
    async search({ query, maxResults, recency, domains }) {
      const days = { day: 1, week: 7, month: 30 }[recency];
      const data = (await getJson("https://api.exa.ai/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": env("EXA_API_KEY")! },
        body: JSON.stringify({
          query,
          numResults: maxResults,
          ...(domains.length ? { includeDomains: domains } : {}),
          startPublishedDate: new Date(Date.now() - days * 86_400_000).toISOString(),
          contents: { text: { maxCharacters: 600 } },
        }),
      })) as { results?: { title?: string; url: string; text?: string; publishedDate?: string }[] };
      return (data.results ?? []).map((r) => ({
        title: r.title ?? r.url,
        url: r.url,
        snippet: r.text ?? "",
        publishedAt: r.publishedDate,
        provider: "exa",
      }));
    },
  },
  searxng: {
    id: "searxng",
    label: "SearXNG (self-hosted, unlimited)",
    configured: () => !!env("SEARXNG_URL"),
    monthlyLimit: () => envInt("SEARXNG_MONTHLY_LIMIT", 100_000),
    signupUrl: "https://docs.searxng.org",
    async search({ query, maxResults, recency, domains }) {
      const u = new URL(`${env("SEARXNG_URL")!.replace(/\/$/, "")}/search`);
      u.searchParams.set("q", withSiteOperators(query, domains));
      u.searchParams.set("format", "json");
      u.searchParams.set("time_range", recency === "day" ? "day" : recency === "week" ? "week" : "month");
      const data = (await getJson(u.toString(), { headers: { Accept: "application/json" } })) as {
        results?: { title: string; url: string; content?: string; publishedDate?: string }[];
      };
      return (data.results ?? []).slice(0, maxResults).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.content ?? "",
        publishedAt: r.publishedDate ?? undefined,
        provider: "searxng",
      }));
    },
  },
};

export function searchProviderOrder(): SearchProvider[] {
  return envList("SEARCH_PROVIDER_ORDER", ["tavily", "serper", "brave", "exa", "searxng"])
    .map((id) => PROVIDERS[id.toLowerCase()])
    .filter(Boolean);
}

export function searchProviderSummary() {
  return searchProviderOrder().map((p) => ({
    id: p.id,
    label: p.label,
    configured: p.configured(),
    monthlyLimit: p.monthlyLimit(),
    signupUrl: p.signupUrl,
  }));
}

/**
 * Runs the query against the first configured provider that is within its
 * free-tier budget, falling through on errors.
 */
export async function webSearch(opts: WebSearchOptions): Promise<{ results: WebResult[]; provider?: string; errors: string[] }> {
  const errors: string[] = [];
  const args: SearchArgs = {
    query: opts.query,
    maxResults: opts.maxResults ?? 10,
    recency: opts.recency ?? "week",
    domains: opts.domains ?? [],
  };
  for (const p of searchProviderOrder()) {
    if (!p.configured()) continue;
    const limit = p.monthlyLimit();
    const budgetOk = opts.ignorePace ? true : await paceAllows(`search:${p.id}`, limit, "month");
    if (!budgetOk) {
      errors.push(`${p.id}: paced (free-tier budget)`);
      continue;
    }
    try {
      const results = await p.search(args);
      await recordCall(`search:${p.id}`, "month");
      return { results, provider: p.id, errors };
    } catch (e) {
      errors.push(`${p.id}: ${(e as Error).message}`);
    }
  }
  return { results: [], errors };
}

/** Fetches a page as clean text via Jina Reader (free; an optional key raises limits). */
export async function readPage(url: string, maxChars = 12_000): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25_000);
    const headers: Record<string, string> = { Accept: "text/plain", "X-Return-Format": "text" };
    const key = env("JINA_API_KEY");
    if (key) headers.Authorization = `Bearer ${key}`;
    const res = await fetch(`https://r.jina.ai/${url}`, { headers, signal: ctrl.signal, cache: "no-store" });
    clearTimeout(timer);
    if (!res.ok) return null;
    const text = await res.text();
    return text.slice(0, maxChars);
  } catch {
    return null;
  }
}
