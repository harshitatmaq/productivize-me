/**
 * Job freshness: is a posting still accepting applications?
 * Pure helpers (the network part lives in liveness-run.ts).
 *
 * Signals, most reliable first:
 * - Greenhouse / Lever: their public job APIs return 404 once a job is closed.
 * - Ashby: the public job board stops listing the job.
 * - LinkedIn: the public (logged-out) job page says "No longer accepting applications".
 * - Anything else: the page is gone (404/410) or says the job is closed/expired.
 */
import { parseGreenhouseUrl } from "./apply";
import { stripHtml } from "./normalize";

const CLOSED_TEXT: [RegExp, string][] = [
  [/no longer accepting applications/i, "No longer accepting applications"],
  [/(position|role|vacancy|job) (has been|is) filled/i, "Position filled"],
  [/(this|the) (job|position|role|posting|vacancy|opening)( posting)? (is|has been) (no longer (available|open|active)|closed|filled|expired|removed|taken down)/i, "Posting closed"],
  [/(job|posting|position|vacancy|listing) (has )?expired/i, "Posting expired"],
  [/applications (are |have )?(now )?closed|no longer (taking|receiving) applications|applications? (is|are) no longer being accepted/i, "Applications closed"],
  [/(job|posting|page) (not found|no longer exists|could not be found)|the job you('re| are) looking for (is no longer|doesn't exist|does not exist|has been removed)/i, "Posting removed"],
  [/(this )?requisition (is )?(no longer|closed|cancelled)/i, "Requisition closed"],
];

/** The reason a page says the job is closed, if it does. */
export function closedReason(text: string): string | null {
  const t = text.slice(0, 200_000);
  for (const [re, reason] of CLOSED_TEXT) if (re.test(t)) return reason;
  return null;
}

export type CheckPlan =
  | { kind: "greenhouse"; url: string }
  | { kind: "lever"; url: string }
  | { kind: "ashby"; url: string; jobId: string }
  | { kind: "linkedin"; url: string }
  | { kind: "page"; url: string };

/** How to check a posting URL. */
export function checkPlan(url: string): CheckPlan | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const gh = parseGreenhouseUrl(url);
  if (gh) return { kind: "greenhouse", url: `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(gh.board)}/jobs/${gh.id}` };
  if (/(^|\.)lever\.co$/.test(u.hostname)) {
    const m = u.pathname.match(/^\/([^/]+)\/([0-9a-f-]{36})/i);
    if (m) return { kind: "lever", url: `https://api.lever.co/v0/postings/${encodeURIComponent(m[1])}/${m[2]}` };
  }
  if (u.hostname === "jobs.ashbyhq.com") {
    const m = u.pathname.match(/^\/([^/]+)\/([0-9a-f-]{36})/i);
    if (m) return { kind: "ashby", url: `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(m[1])}`, jobId: m[2] };
  }
  if (/(^|\.)linkedin\.com$/.test(u.hostname)) {
    const id = linkedinJobId(url);
    if (id) return { kind: "linkedin", url: `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}` };
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  return { kind: "page", url };
}

export function linkedinJobId(url: string): string | null {
  const m = url.match(/linkedin\.com\/(?:[a-z]{2}\/|comm\/)?jobs\/view\/(?:[^/?#]*?-)?(\d{6,})/i) ?? url.match(/[?&](?:currentJobId|jobId)=(\d{6,})/i);
  return m ? m[1] : null;
}

/** "new" jobs older than this leave the board even if the posting still looks open. */
export function isStale(job: { posted_at: string | null; created_at: string }, now: number, maxAgeDays = 30): boolean {
  const ref = Date.parse(job.posted_at ?? job.created_at);
  return Number.isFinite(ref) && now - ref > maxAgeDays * 86_400_000;
}

/** Local weekday (0 = Sunday) and hour in a time zone. */
export function localDayHour(now: Date, tz: string): { weekday: number; hour: number; date: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, weekday: "short", hour: "numeric", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")),
    hour: Number(get("hour")) % 24,
    date: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

/** Weekend deep search: Saturday or Sunday, from 9 AM local (once per day). */
export function isDeepSearchTime(now: Date, tz: string): boolean {
  const { weekday, hour } = localDayHour(now, tz);
  return (weekday === 0 || weekday === 6) && hour >= 9;
}

/** The company's own application link inside a LinkedIn guest job page ("Apply on company website"). */
export function linkedinApplyUrl(html: string): string | undefined {
  const m = html.match(/<code[^>]*id="applyUrl"[^>]*>\s*<!--\s*"([^"]+)"\s*-->/i);
  if (!m) return undefined;
  const raw = m[1].replace(/&amp;/g, "&");
  try {
    const u = new URL(raw);
    const inner = u.searchParams.get("url");
    const target = inner ? decodeURIComponent(inner) : raw;
    return /linkedin\.com/i.test(new URL(target).hostname) ? undefined : target;
  } catch {
    return undefined;
  }
}

export type LinkedinDetails = { description?: string; level?: string; employmentType?: string; applyUrl?: string };

/** Description, "Seniority level", "Employment type" and apply link from a LinkedIn guest job page. */
export function parseLinkedinJob(html: string): LinkedinDetails {
  const out: LinkedinDetails = {};
  const start = html.search(/class="[^"]*show-more-less-html__markup/i);
  if (start >= 0) {
    const from = html.indexOf(">", start) + 1;
    const rest = html.slice(from);
    const end = rest.search(/class="[^"]*show-more-less-html__button|class="[^"]*description__job-criteria-list|<\/section>/i);
    const text = stripHtml((end > 0 ? rest.slice(0, end) : rest.slice(0, 40_000)).replace(/<button[\s\S]*$/i, ""), 8000);
    if (text.length > 40) out.description = text;
  }
  const criteria = [...html.matchAll(/job-criteria-subheader[^>]*>\s*([^<]+?)\s*<\/h3>\s*<span[^>]*>\s*([^<]+?)\s*<\/span>/gi)];
  for (const [, label, value] of criteria) {
    if (/seniority/i.test(label) && !/not applicable/i.test(value)) out.level = value.trim();
    if (/employment type/i.test(label)) out.employmentType = value.trim();
  }
  const apply = linkedinApplyUrl(html);
  if (apply) out.applyUrl = apply;
  return out;
}
