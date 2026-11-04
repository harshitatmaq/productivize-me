import "server-only";

import type { WatchCompany } from "./types";

/** Slug guesses for an ATS board: "Acme Labs" → acmelabs, acme-labs, acme. */
export function slugCandidates(name: string): string[] {
  const clean = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(inc|llc|ltd|limited|pvt|private|technologies|technology|labs?|software|corp|corporation|co|the)\b\.?/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return [...new Set([words.join(""), words.join("-"), words[0], name.toLowerCase().replace(/[^a-z0-9]/g, "")])].filter((s) => s.length >= 2);
}

async function ok(url: string, check: (body: unknown) => boolean): Promise<boolean> {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8_000), cache: "no-store" });
    if (!res.ok) return false;
    return check(await res.json());
  } catch {
    return false;
  }
}

/** Finds a public Greenhouse / Lever / Ashby board for a company name, if one exists. */
export async function discoverBoard(name: string): Promise<WatchCompany | null> {
  for (const slug of slugCandidates(name).slice(0, 3)) {
    const [gh, lever, ashby] = await Promise.all([
      ok(`https://boards-api.greenhouse.io/v1/boards/${slug}`, (b) => !!(b as { name?: string }).name),
      ok(`https://api.lever.co/v0/postings/${slug}?mode=json&limit=1`, (b) => Array.isArray(b)),
      ok(`https://api.ashbyhq.com/posting-api/job-board/${slug}`, (b) => Array.isArray((b as { jobs?: unknown }).jobs)),
    ]);
    if (gh) return { ats: "greenhouse", slug, name, auto: true };
    if (ashby) return { ats: "ashby", slug, name, auto: true };
    if (lever) return { ats: "lever", slug, name, auto: true };
  }
  return null;
}

export type DiscoveryLog = Record<string, { at: string; found: WatchCompany | null }>;

/**
 * Probes dream companies that haven't been checked (misses are retried after 30 days).
 * Returns the updated log and any newly found boards.
 */
export async function discoverBoards(
  companies: string[],
  log: DiscoveryLog,
  watch: WatchCompany[],
  limit = 8,
): Promise<{ log: DiscoveryLog; found: WatchCompany[] }> {
  const now = Date.now();
  const watched = new Set(watch.map((w) => (w.name ?? w.slug).toLowerCase()));
  const todo = companies
    .filter((c) => c.trim() && !watched.has(c.toLowerCase()))
    .filter((c) => {
      const prev = log[c.toLowerCase()];
      return !prev || (!prev.found && now - Date.parse(prev.at) > 30 * 86_400_000);
    })
    .slice(0, limit);
  const next: DiscoveryLog = { ...log };
  const found: WatchCompany[] = [];
  const results = await Promise.all(todo.map(async (c) => ({ c, board: await discoverBoard(c) })));
  for (const { c, board } of results) {
    next[c.toLowerCase()] = { at: new Date().toISOString(), found: board };
    if (board) found.push(board);
  }
  return { log: next, found };
}
