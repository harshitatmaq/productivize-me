/**
 * Interests + career memory: pure helpers shared by the server (search, scoring,
 * the memory refresh) and tests. No I/O here.
 *
 * Two numbers per interest:
 *  - strength (0-100): how much this really is your interest, from evidence;
 *  - job_relevance (0-100): how much it helps with the jobs you target.
 * Scout searches for an interest at relevance ≥ 70, counts it as a small bonus at
 * 40-69 when a job mentions it, and ignores it below 40 — unless you override with
 * "Use for jobs" (always) or "Never use for jobs" (never).
 */
import type { JobProfile, RawJob, SearchPlan } from "@/lib/jobs/types";

export type InterestKind = "career" | "learning" | "hobby";
export type InterestRow = {
  id: string;
  name: string;
  kind: InterestKind;
  status: "active" | "suggested" | "not_interested";
  job_use: "auto" | "always" | "never";
  job_relevance: number | null;
  strength: number;
};

export const SEARCH_AT = 70;
export const BONUS_AT = 40;

export type JobUse = "search" | "bonus" | "off";

/** How Scout uses an interest for jobs. Suggestions (unconfirmed) are never used. */
export function jobUse(i: Pick<InterestRow, "status" | "job_use" | "job_relevance">): JobUse {
  if (i.status !== "active" || i.job_use === "never") return "off";
  if (i.job_use === "always") return "search";
  const r = i.job_relevance ?? 0;
  return r >= SEARCH_AT ? "search" : r >= BONUS_AT ? "bonus" : "off";
}

export function stageFor(strength: number): "curious" | "learning" | "using" | "strong" {
  return strength >= 80 ? "strong" : strength >= 55 ? "using" : strength >= 30 ? "learning" : "curious";
}

export type Evidence = { type: string; id?: string; label: string; at?: string; minutes?: number };

/** Strength from evidence: how often, how much time, how recently (and whether you said so yourself). */
export function computeStrength(evidence: Evidence[], opts: { manual?: boolean; inProfile?: boolean; now?: number } = {}): number {
  const now = opts.now ?? Date.now();
  const count = evidence.length;
  const minutes = evidence.reduce((s, e) => s + (e.minutes ?? 0), 0);
  const last = Math.max(0, ...evidence.map((e) => (e.at ? Date.parse(e.at) : 0)));
  const days = last ? (now - last) / 86_400_000 : Infinity;
  let s = Math.min(55, count * 7) + Math.min(25, minutes / 20);
  if (days <= 14) s += 15;
  else if (days <= 45) s += 7;
  if (opts.inProfile) s = Math.max(s, 60);
  if (opts.manual) s = Math.max(s, 25);
  return Math.max(0, Math.min(100, Math.round(s)));
}

const STOP = new Set(["and", "the", "for", "with", "of", "in", "to", "a", "an", "on", "my", "learning", "learn", "basics", "intro"]);

/** Words that identify an interest ("Microsoft Fabric" → fabric; "Power BI" → power bi). */
export function interestTerms(name: string): string[] {
  const n = name.toLowerCase().trim();
  const words = n.split(/[^a-z0-9+#.]+/).filter((w) => w.length > 1 && !STOP.has(w));
  const terms = new Set<string>([n]);
  // Drop a leading vendor word: "microsoft fabric" → "fabric", "google cloud" stays (2 words, generic second).
  if (words.length === 2 && ["microsoft", "azure", "aws", "apache", "google"].includes(words[0]) && words[1].length > 3) terms.add(words[1]);
  return [...terms];
}

function hasTerm(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, "i").test(text);
}

export function mentions(text: string, name: string): boolean {
  const t = text.toLowerCase();
  return interestTerms(name).some((term) => hasTerm(t, term));
}

/** Plan additions: interests used for search become keywords; "not interested" become exclusions. */
export function applyInterestsToPlan(plan: SearchPlan, interests: InterestRow[], opts: { keywords?: boolean } = { keywords: true }): SearchPlan {
  const add = opts.keywords ? interests.filter((i) => jobUse(i) === "search").map((i) => i.name) : [];
  const exclude = interests.filter((i) => i.status === "not_interested").map((i) => i.name);
  const uniq = (xs: string[]) => [...new Map(xs.filter(Boolean).map((x) => [x.toLowerCase(), x])).values()];
  return {
    ...plan,
    keywords: uniq([...(plan.keywords ?? []), ...add]).slice(0, 30),
    exclude: uniq([...(plan.exclude ?? []), ...exclude]).slice(0, 30),
  };
}

/** Extra context for the scoring prompt. */
export function interestContext(interests: InterestRow[]): string | undefined {
  const search = interests.filter((i) => jobUse(i) === "search").map((i) => i.name);
  const bonus = interests.filter((i) => jobUse(i) === "bonus").map((i) => i.name);
  const no = interests.filter((i) => i.status === "not_interested").map((i) => i.name);
  const lines = [
    search.length ? `Strong interests that matter for their target roles (reward roles that use them): ${search.join(", ")}` : "",
    bonus.length ? `Side interests (a small plus only if the role explicitly involves them): ${bonus.join(", ")}` : "",
    no.length ? `NOT interested in (penalise roles centred on these): ${no.join(", ")}` : "",
  ].filter(Boolean);
  return lines.length ? lines.join("\n") : undefined;
}

export type InterestMatch = { id: string; name: string; relevance: number };

/** Which of your (job-relevant) interests a job mentions, best first. */
export function matchInterests(job: Pick<RawJob, "title" | "description" | "tags">, interests: InterestRow[]): InterestMatch[] {
  const text = `${job.title}\n${(job.description ?? "").slice(0, 6000)}\n${(job.tags ?? []).join(" ")}`;
  return interests
    .filter((i) => jobUse(i) !== "off" && mentions(text, i.name))
    .map((i) => ({ id: i.id, name: i.name, relevance: i.job_use === "always" ? Math.max(i.job_relevance ?? 0, SEARCH_AT) : (i.job_relevance ?? 0) }))
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 6);
}

/** Small score nudge: +3 per bonus-band interest a job mentions (max +6); search-band ones are already in the prompt. */
export function interestBonus(matches: InterestMatch[]): number {
  return Math.min(6, matches.filter((m) => m.relevance >= BONUS_AT && m.relevance < SEARCH_AT).length * 3);
}

/** Offline estimate of job relevance when no AI provider answers. */
export function heuristicRelevance(i: Pick<InterestRow, "name" | "kind">, profile: JobProfile): { relevance: number; reason: string } {
  const hay = [...(profile.skills ?? []), ...(profile.tools ?? []), ...(profile.include_keywords ?? []), ...(profile.domains ?? [])].join(" | ");
  const titles = (profile.target_titles ?? []).join(" | ");
  if (mentions(hay, i.name)) return { relevance: 82, reason: "Listed in your skills/tools for your target roles." };
  if (mentions(titles, i.name)) return { relevance: 78, reason: "Part of the job titles you target." };
  if (i.kind === "hobby") return { relevance: 10, reason: "A hobby with no clear link to your target roles." };
  if (i.kind === "career") return { relevance: 55, reason: "A career skill, but not one your target roles usually ask for." };
  return { relevance: 35, reason: "No clear link to your target roles yet." };
}

/** Basis for re-scoring relevance only when target roles change. */
export function relevanceBasis(profile: JobProfile): string {
  return [...(profile.target_titles ?? []), "|", ...(profile.skills ?? []).slice(0, 15)].join(",").toLowerCase().slice(0, 500);
}
