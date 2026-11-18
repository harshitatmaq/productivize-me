/**
 * Job board helpers (pure): what to apply to today, and grouping roles by company.
 */
type BoardJob = { id: string; company: string | null; score: number | null; status: string; posted_at?: string | null; created_at: string; closed_at?: string | null };

const ageHours = (j: BoardJob, now: number) => (now - Date.parse(j.posted_at ?? j.created_at)) / 3_600_000;

/**
 * Apply today: strong, still-open matches posted in the last 3 days, freshest first
 * among equals — the first 24-48 hours are when an application is most likely to be seen.
 */
export function applyToday<T extends BoardJob>(jobs: T[], now: number, opts: { max?: number; minScore?: number; maxAgeHours?: number } = {}): T[] {
  const minScore = opts.minScore ?? 70;
  const maxAge = opts.maxAgeHours ?? 72;
  return jobs
    .filter((j) => (j.status === "new" || j.status === "saved") && !j.closed_at && (j.score ?? 0) >= minScore && ageHours(j, now) <= maxAge)
    .map((j) => ({ j, rank: (j.score ?? 0) + Math.max(0, 10 - ageHours(j, now) / 4.8) }))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, opts.max ?? 5)
    .map((x) => x.j);
}

export const companyKey = (company: string | null | undefined) =>
  (company ?? "")
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|limited|pvt|private|technologies|technology|labs|software|solutions|corp|corporation|co)\b\.?/g, "")
    .replace(/[^a-z0-9]/g, "");

/**
 * One card per company (the best-ranked role, in the list's order), with a count of the
 * other roles there. Companies in `expanded` show all their roles.
 */
export function groupByCompany<T extends BoardJob>(jobs: T[], expanded: Set<string>): { shown: T[]; more: Map<string, number> } {
  const seen = new Set<string>();
  const more = new Map<string, number>();
  const shown: T[] = [];
  for (const j of jobs) {
    const k = companyKey(j.company);
    if (!k || expanded.has(k) || !seen.has(k)) {
      if (k) seen.add(k);
      shown.push(j);
    } else more.set(k, (more.get(k) ?? 0) + 1);
  }
  return { shown, more };
}
