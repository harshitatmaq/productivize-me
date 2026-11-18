/**
 * Company job boards from URLs (pure, no Node imports, so the browser can use it too).
 * "https://boards.greenhouse.io/acme/jobs/123" → { ats: "greenhouse", slug: "acme" }.
 */
import type { WatchCompany } from "./types";

export function parseWatchCompany(input: string | null | undefined): WatchCompany | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  const wd = s.match(/([a-z0-9-]+\.wd\d+\.myworkdayjobs\.com)\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/i);
  if (wd) return { ats: "workday", slug: `${wd[1].toLowerCase()}/${wd[2]}`, name: wd[1].split(".")[0] };
  const patterns: [RegExp, WatchCompany["ats"]][] = [
    [/(?:job-)?boards(?:-api)?\.greenhouse\.io\/(?:v1\/boards\/)?(?!embed\b)([a-z0-9_-]+)/i, "greenhouse"],
    [/greenhouse\.io\/embed\/job_app\?(?:[^#]*&)?for=([a-z0-9_-]+)/i, "greenhouse"],
    [/jobs\.(?:eu\.)?lever\.co\/([a-z0-9_-]+)/i, "lever"],
    [/jobs\.ashbyhq\.com\/([a-z0-9_.-]+)/i, "ashby"],
    [/apply\.workable\.com\/([a-z0-9_-]+)/i, "workable"],
    [/(?:jobs|careers)\.smartrecruiters\.com\/([a-z0-9_-]+)/i, "smartrecruiters"],
  ];
  for (const [re, ats] of patterns) {
    const m = s.match(re);
    if (m) return { ats, slug: m[1], name: m[1] };
  }
  const short = s.match(/^(greenhouse|lever|ashby|workable|smartrecruiters)\s*[:/]\s*([a-z0-9_.-]+)$/i);
  if (short) return { ats: short[1].toLowerCase() as WatchCompany["ats"], slug: short[2], name: short[2] };
  return null;
}

/** The company board behind a job (its apply link first), named after the job's company. */
export function boardForJob(job: { url: string; apply_url?: string | null; company?: string | null }): WatchCompany | null {
  const board = parseWatchCompany(job.apply_url) ?? parseWatchCompany(job.url);
  return board ? { ...board, name: job.company?.trim() || board.name } : null;
}

/** Is this board already in the watched list? */
export function isWatched(board: WatchCompany, watched: WatchCompany[] | null | undefined): boolean {
  return (watched ?? []).some((w) => w.ats === board.ats && w.slug.toLowerCase() === board.slug.toLowerCase());
}
