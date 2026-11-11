import "server-only";

import { chatJson } from "@/lib/ai/llm";
import { candidateBrief } from "./profile";
import type { JobProfile, RawJob, ScoredJob } from "./types";

type LlmScore = {
  i: number;
  is_job_posting?: boolean;
  score: number;
  verdict?: string;
  reasons?: string[];
  concerns?: string[];
  seniority?: string;
  title?: string;
  company?: string;
  location?: string;
  remote?: boolean;
};

const SYSTEM = `You are a meticulous senior technical recruiter. For each job, judge how well it fits the candidate.
Scoring rubric (be strict and calibrated):
 90-100 near-perfect: title, seniority, core skills and location/remote all match
 75-89  strong: clear fit with minor gaps
 60-74  decent: worth a look, some notable gaps
 40-59  stretch: big gaps in seniority, skills or location
 0-39   poor fit or violates a deal-breaker / location / work-authorization constraint
Also extract clean fields from messy search results, and mark is_job_posting=false for anything that is not a single
open job posting (list pages, articles, closed roles, courses).
Return ONLY JSON: {"results":[{"i":0,"is_job_posting":true,"score":0-100,"verdict":"strong|good|stretch|poor",
"reasons":["max 3 short specific reasons it fits"],"concerns":["max 2 short gaps/risks"],"seniority":"junior|mid|senior|lead|...",
"title":"clean title","company":"company","location":"location","remote":true|false}]}`;

function heuristic(job: RawJob, rel: number): ScoredJob {
  return {
    ...job,
    score: Math.round(rel * 85),
    verdict: rel > 0.7 ? "good" : rel > 0.45 ? "stretch" : "poor",
    reasons: ["Keyword match (AI scoring was unavailable for this run)"],
    concerns: [],
  };
}

/** Scores jobs with the LLM chain in small batches; falls back to keyword relevance if every provider fails. */
export async function scoreJobs(
  profile: JobProfile,
  jobs: { job: RawJob; rel: number }[],
  log: (m: string) => void,
  batchSize = 5,
  preferences?: string,
): Promise<{ scored: ScoredJob[]; dropped: number; providers: string[] }> {
  const brief = candidateBrief(profile);
  const scored: ScoredJob[] = [];
  const providers = new Set<string>();
  let dropped = 0;

  for (let start = 0; start < jobs.length; start += batchSize) {
    const batch = jobs.slice(start, start + batchSize);
    const listing = batch
      .map(({ job }, i) =>
        JSON.stringify({
          i,
          title: job.title,
          company: job.company ?? undefined,
          location: job.location ?? undefined,
          remote: job.remote ?? undefined,
          salary: job.salary ?? undefined,
          type: job.employment_type ?? undefined,
          posted: job.posted_at?.slice(0, 10),
          source: job.source,
          url: job.needs_extraction ? job.url : undefined,
          text: (job.description ?? "").replace(/\s+/g, " ").slice(0, 1300),
        }),
      )
      .join("\n");

    try {
      const { data, provider } = await chatJson<LlmScore[]>(
        {
          messages: [
            { role: "system", content: SYSTEM },
            {
              role: "user",
              content: `CANDIDATE\n${brief}${
                preferences ? `\n\nLEARNED PREFERENCES (from the candidate's 👍/👎 — weigh these)\n${preferences}` : ""
              }\n\nJOBS (one JSON per line)\n${listing}`,
            },
          ],
          temperature: 0.1,
          maxTokens: 1900,
          purpose: "job-scoring",
          deadlineMs: 120_000,
        },
        (v) => {
          const arr = Array.isArray(v) ? v : (v as { results?: unknown }).results;
          if (!Array.isArray(arr)) throw new Error("no results array");
          return arr as LlmScore[];
        },
      );
      providers.add(provider);
      const byIndex = new Map(data.map((r) => [Number(r.i), r]));
      batch.forEach(({ job, rel }, i) => {
        const r = byIndex.get(i);
        if (!r) {
          scored.push(heuristic(job, rel));
          return;
        }
        if (r.is_job_posting === false) {
          dropped++;
          return;
        }
        const score = Math.max(0, Math.min(100, Math.round(Number(r.score) || 0)));
        scored.push({
          ...job,
          title: (job.needs_extraction || job.source === "hn") && r.title ? r.title : job.title,
          company: job.company || r.company || null,
          location: job.location || r.location || null,
          remote: job.remote ?? (typeof r.remote === "boolean" ? r.remote : null),
          score,
          verdict: r.verdict ?? (score >= 75 ? "strong" : score >= 60 ? "good" : score >= 40 ? "stretch" : "poor"),
          reasons: (r.reasons ?? []).slice(0, 3).map(String),
          concerns: (r.concerns ?? []).slice(0, 2).map(String),
          seniority: r.seniority ?? null,
        });
      });
    } catch (e) {
      log(`scoring batch failed, using keyword fallback: ${(e as Error).message.slice(0, 200)}`);
      batch.forEach(({ job, rel }) => scored.push(heuristic(job, rel)));
    }
  }

  return { scored, dropped, providers: [...providers] };
}
