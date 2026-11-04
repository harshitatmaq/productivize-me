import "server-only";

import { chatJson } from "@/lib/ai/llm";
import { candidateBrief } from "./profile";
import type { JobProfile, RemotePreference, SearchPlan, WebQuery } from "./types";

export type ParsedQuery = SearchPlan & { companies: string[]; posted_within_days: number | null; summary: string };

const arr = (v: unknown, max = 10) =>
  (Array.isArray(v) ? v : typeof v === "string" ? [v] : []).map((x) => String(x).trim()).filter(Boolean).slice(0, max);

/** Heuristic parse used when no LLM answers: "<role> in <place>", "remote". */
export function fallbackParse(query: string, profile: JobProfile): ParsedQuery {
  const q = query.trim();
  const remote = /\bremote\b/i.test(q);
  const m = q.match(/^(.*?)\s+(?:in|at|near|around)\s+([A-Za-z .,-]+)$/i);
  const role = (m ? m[1] : q).replace(/\b(remote|jobs?|roles?|openings?)\b/gi, "").replace(/\s+/g, " ").trim();
  const loc = m ? m[2].trim() : null;
  const india = !!loc && /india|bengaluru|bangalore|pune|hyderabad|mumbai|delhi|gurgaon|gurugram|noida|chennai|kolkata|ahmedabad/i.test(loc);
  return {
    titles: [role || profile.target_titles?.[0] || q].filter(Boolean),
    keywords: (profile.skills ?? []).slice(0, 6),
    locations: loc ? [loc] : remote ? ["Remote"] : (profile.locations ?? []).slice(0, 2),
    countries: india ? ["in"] : (profile.countries ?? ["in"]).slice(0, 2),
    remote: remote ? "remote" : (profile.remote ?? "any"),
    exclude: profile.exclude_keywords ?? [],
    web_queries: [{ q }, { q: `${role} ${loc ?? (remote ? "remote" : "")}`.trim(), domains: india ? "india" : "ats" }],
    companies: [],
    posted_within_days: null,
    summary: q,
  };
}

/** Turns "Fabric data engineer roles at product startups in Bengaluru, hybrid" into a structured search plan. */
export async function parseJobQuery(query: string, profile: JobProfile): Promise<ParsedQuery> {
  const fallback = fallbackParse(query, profile);
  try {
    const { data } = await chatJson<ParsedQuery>(
      {
        messages: [
          {
            role: "system",
            content: `Convert a job-search request into a structured search. Use the candidate's profile only to fill gaps the request leaves open
(e.g. country), never to override what they asked for. Return ONLY JSON:
{"titles":[3-6 job titles incl. common synonyms],"keywords":[skills/tech to match],"locations":[cities or "Remote"],"countries":[ISO alpha-2 lowercase],
"remote":"remote"|"hybrid"|"onsite"|"any","exclude":[title words to exclude],"companies":[named companies, if any],
"posted_within_days":number|null,"web_queries":[4-6 {"q":"short query for single postings","domains":"india"|"ats"|"global"|"startups"|"remote"}],
"summary":"one short line describing the search"}`,
          },
          { role: "user", content: `REQUEST: ${query}\n\nCANDIDATE (context only):\n${candidateBrief(profile) || "(no profile yet)"}` },
        ],
        temperature: 0.2,
        maxTokens: 1000,
        purpose: "job-query",
        deadlineMs: 45_000,
      },
      (v) => {
        const o = v as Record<string, unknown>;
        const titles = arr(o.titles, 8);
        if (!titles.length) throw new Error("no titles");
        const remote = ["remote", "hybrid", "onsite", "any"].includes(String(o.remote)) ? (o.remote as RemotePreference) : fallback.remote;
        const wq = Array.isArray(o.web_queries)
          ? (o.web_queries as Record<string, unknown>[])
              .map((w) => (typeof w === "string" ? { q: w } : { q: String(w.q ?? ""), domains: w.domains as WebQuery["domains"] }))
              .filter((w) => w.q.trim())
          : [];
        return {
          titles,
          keywords: arr(o.keywords, 15),
          locations: arr(o.locations, 6),
          countries: arr(o.countries, 4).map((c) => c.toLowerCase().slice(0, 2)),
          remote,
          exclude: arr(o.exclude, 10),
          companies: arr(o.companies, 10),
          posted_within_days: Number.isFinite(Number(o.posted_within_days)) && o.posted_within_days !== null ? Number(o.posted_within_days) : null,
          web_queries: (wq.length ? wq : fallback.web_queries).slice(0, 8),
          summary: String(o.summary ?? query).slice(0, 200),
        };
      },
    );
    return data;
  } catch {
    return fallback;
  }
}
