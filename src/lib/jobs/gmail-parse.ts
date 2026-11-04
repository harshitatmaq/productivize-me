import { decodeEntities, stripHtml } from "./normalize";
import type { RawJob } from "./types";

/** Senders whose emails are job alerts (vs. replies about applications). */
const ALERT_SENDERS = /(jobalerts?-noreply@linkedin\.com|jobs-listings@linkedin\.com|linkedin\.com|naukri\.com|indeed\.com|glassdoor\.|instahyre\.com|foundit\.in|iimjobs\.com|hirist\.|wellfound\.com|cutshort\.io|monster)/i;

export function classifyEmail(from: string, subject: string): "alert" | "reply" | "other" {
  if (ALERT_SENDERS.test(from) && /job|alert|recommend|match|opening|hiring|role/i.test(subject + from)) return "alert";
  if (/application|applied|interview|assessment|unfortunately|next steps|offer|thank you for (applying|your interest)/i.test(subject)) return "reply";
  return "other";
}

type Link = { url: string; text: string };

function anchors(html: string): Link[] {
  const out: Link[] = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    out.push({ url: decodeEntities(m[1]).trim(), text: stripHtml(m[2], 300).replace(/\s+/g, " ").trim() });
  }
  return out;
}

const GENERIC = /^(view( job)?|apply( now)?|see (all|more)( jobs)?|show more|unsubscribe|manage|settings|learn more|view all|more jobs|search|jobs|here|click here)$/i;

/** Turns a tracking link into the canonical job URL, or null if it isn't a single job posting. */
export function canonicalJobUrl(raw: string): { url: string; site: string } | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "");
  const li = u.pathname.match(/\/(?:comm\/)?jobs\/view\/(?:[^/]*-)?(\d{6,})/);
  if (host.endsWith("linkedin.com") && li) return { url: `https://www.linkedin.com/jobs/view/${li[1]}`, site: "linkedin" };
  if (host.endsWith("naukri.com") && /\/job-listings-/.test(u.pathname)) return { url: `https://www.naukri.com${u.pathname}`, site: "naukri" };
  const jk = u.searchParams.get("jk") ?? u.searchParams.get("vjk");
  if (host.includes("indeed.") && jk) return { url: `https://${host}/viewjob?jk=${jk}`, site: "indeed" };
  if (host.includes("glassdoor.") && /job-listing/.test(u.pathname)) return { url: `https://${host}${u.pathname}`, site: "glassdoor" };
  if (host.endsWith("instahyre.com") && /\/job-/.test(u.pathname)) return { url: `https://www.instahyre.com${u.pathname}`, site: "instahyre" };
  if (host.endsWith("foundit.in") && /\/job\//.test(u.pathname)) return { url: `https://www.foundit.in${u.pathname}`, site: "foundit" };
  if (host.endsWith("wellfound.com") && /\/jobs\/\d+/.test(u.pathname)) return { url: `https://wellfound.com${u.pathname}`, site: "wellfound" };
  if (/greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|workable\.com|smartrecruiters\.com/.test(host)) {
    return { url: `${u.protocol}//${u.host}${u.pathname}`, site: "ats" };
  }
  return null;
}

/**
 * Extracts job postings from a job-alert email (LinkedIn, Naukri, Indeed …).
 * Titles come from the link text; company and location are filled in later
 * by the scoring step, which reads the posting.
 */
export function extractJobsFromEmail(html: string, receivedAt?: Date | null): RawJob[] {
  const byUrl = new Map<string, RawJob>();
  for (const a of anchors(html)) {
    const job = canonicalJobUrl(a.url);
    if (!job) continue;
    const prev = byUrl.get(job.url);
    const text = a.text && !GENERIC.test(a.text) && a.text.length > 2 ? a.text : "";
    // Alert emails often link the same job several times (title, logo, "apply"); keep the most descriptive text.
    if (prev) {
      if (text && (prev.title === "Job from alert email" || text.length > prev.title.length) && text.length < 140) prev.title = text;
      continue;
    }
    byUrl.set(job.url, {
      source: `email:${job.site}`,
      url: job.url,
      title: text && text.length < 140 ? text : "Job from alert email",
      company: null,
      posted_at: receivedAt ? receivedAt.toISOString() : null,
      needs_extraction: true,
    });
  }
  return [...byUrl.values()].slice(0, 60);
}
