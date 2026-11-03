import { createHash } from "node:crypto";
import type { JobProfile, RawJob, SearchPlan, WatchCompany } from "./types";

const TRACKING_PARAMS = /^(utm_|ref|refid|trk|trackingid|src|source|gh_src|lever-source|fbclid|gclid|mc_|campaign)/i;

export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
    }
    // LinkedIn job URLs carry the id in the path; everything else in the query is noise.
    if (u.hostname.endsWith("linkedin.com") && /\/jobs\/view\//.test(u.pathname)) u.search = "";
    let s = u.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return raw.trim();
  }
}

export function hash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 32);
}

export function slugify(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(inc|llc|ltd|limited|pvt|private|corp|corporation|gmbh|co)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function dedupeKey(job: Pick<RawJob, "title" | "company" | "url">): string {
  const company = slugify(job.company);
  const title = slugify(job.title.replace(/\(.*?\)|\[.*?\]/g, ""));
  if (!company) return `url:${hash(normalizeUrl(job.url))}`;
  return `${company}|${title}`;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

export function stripHtml(html: string | null | undefined, max = 4000): string {
  if (!html) return "";
  // Greenhouse double-encodes its HTML, so decode before and after removing tags.
  const text = decodeEntities(decodeEntities(html))
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(text)
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, max);
}

export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Listing/aggregate pages ("1,203 Data Engineer jobs in Pune") are not single postings. */
export function looksLikeListingPage(title: string, url: string): boolean {
  if (/\b\d[\d,.]*\+?\s+(?:[^|]{0,60}?\s)?(jobs|openings|vacancies|positions)\b/i.test(title)) return true;
  if (/\b(jobs|vacancies)\s+in\s+[a-z\s,]+\|\s*(naukri|indeed|linkedin|glassdoor)/i.test(title) && !/\bat\b/i.test(title))
    return true;
  const u = url.toLowerCase();
  if (/linkedin\.com\/jobs\/(search|collections)|linkedin\.com\/jobs\/[a-z-]+-jobs/.test(u)) return true;
  if (/indeed\.[a-z.]+\/(q-|jobs\?|m\/jobs)/.test(u)) return true;
  if (/naukri\.com\/[a-z0-9-]+-jobs(-in-[a-z-]+)?(\?|$)/.test(u)) return true;
  if (/glassdoor\.[a-z.]+\/job\/[a-z-]+-jobs-/.test(u)) return true;
  return false;
}

const SENIORITY_WORDS = /\b(senior|sr|junior|jr|lead|principal|staff|head|intern|associate|mid|ii|iii|iv)\b/g;

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(SENIORITY_WORDS, " ")
    .split(/[^a-z0-9+#.]+/)
    .filter((t) => t.length > 1 && !["and", "the", "for", "of", "in", "at", "with", "to", "a"].includes(t));
}

function hasWord(text: string, word: string): boolean {
  const w = word.toLowerCase().trim();
  if (!w) return false;
  const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, "i").test(text);
}

/**
 * Cheap keyword relevance (0-1) used to pick which new jobs are worth sending
 * to the LLM for real scoring.
 */
export function relevance(job: RawJob, plan: SearchPlan, profile: JobProfile): number {
  const title = job.title.toLowerCase();
  const text = `${title} ${(job.description ?? "").slice(0, 3000).toLowerCase()} ${(job.tags ?? []).join(" ").toLowerCase()}`;

  const excludes = [...(plan.exclude ?? []), ...(profile.exclude_keywords ?? [])];
  if (excludes.some((x) => hasWord(title, x))) return 0;
  const avoid = (profile.avoid_companies ?? []).map(slugify).filter(Boolean);
  if (job.company && avoid.includes(slugify(job.company))) return 0;

  let titleScore = 0;
  const titleTokens = new Set(tokens(job.title));
  for (const target of plan.titles) {
    const t = tokens(target);
    if (t.length === 0) continue;
    const hit = t.filter((x) => titleTokens.has(x)).length / t.length;
    titleScore = Math.max(titleScore, hit);
  }

  const skills = [...new Set([...(plan.keywords ?? []), ...(profile.skills ?? []).slice(0, 15)])];
  const skillHits = skills.filter((s) => hasWord(text, s)).length;
  const skillScore = skills.length ? Math.min(1, skillHits / Math.min(6, skills.length)) : 0;

  let locScore = 0;
  const loc = `${job.location ?? ""}`.toLowerCase();
  const wantsRemote = plan.remote === "remote" || plan.remote === "any" || plan.remote === "hybrid";
  if (job.remote && wantsRemote) locScore = 1;
  else if (plan.locations.some((l) => l && loc.includes(l.toLowerCase().split(",")[0]))) locScore = 1;
  else if (!loc) locScore = 0.5;

  let score = titleScore * 0.55 + skillScore * 0.3 + locScore * 0.15;
  if (job.posted_at) {
    const ageDays = (Date.now() - Date.parse(job.posted_at)) / 86_400_000;
    if (ageDays > 45) score *= 0.6;
  }
  return Math.round(score * 1000) / 1000;
}

export function parseWatchCompany(input: string): WatchCompany | null {
  const s = input.trim();
  const patterns: [RegExp, WatchCompany["ats"]][] = [
    [/(?:job-)?boards(?:-api)?\.greenhouse\.io\/(?:v1\/boards\/)?([a-z0-9_-]+)/i, "greenhouse"],
    [/jobs\.lever\.co\/([a-z0-9_-]+)/i, "lever"],
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

export function formatSalary(min?: number | null, max?: number | null, currency?: string | null, period?: string | null) {
  if (!min && !max) return null;
  const fmt = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
  const cur = currency ? `${currency} ` : "";
  const range = min && max && min !== max ? `${fmt(min)}–${fmt(max)}` : fmt((min || max)!);
  return `${cur}${range}${period ? ` / ${period.toLowerCase()}` : ""}`;
}
