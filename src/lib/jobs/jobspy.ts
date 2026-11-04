import "server-only";

import { spawn } from "node:child_process";
import path from "node:path";
import { formatSalary, stripHtml } from "./normalize";
import type { RawJob } from "./types";

/** Sites the worker may scrape with JobSpy, from JOBSPY_SITES (e.g. "indeed,naukri,glassdoor" or "linkedin,indeed,naukri"). */
export function jobspySites(): string[] {
  return (process.env.JOBSPY_SITES ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => ["linkedin", "indeed", "glassdoor", "naukri"].includes(s));
}

export type JobspyRequest = {
  site: string;
  search_term: string;
  location?: string;
  is_remote?: boolean;
  results_wanted?: number;
  hours_old?: number;
  country_indeed?: string;
};

type JobspyRecord = {
  id?: string;
  site?: string;
  job_url?: string;
  job_url_direct?: string | null;
  title?: string;
  company?: string | null;
  location?: string | null;
  date_posted?: string | null;
  job_type?: string | null;
  interval?: string | null;
  min_amount?: number | null;
  max_amount?: number | null;
  currency?: string | null;
  is_remote?: boolean | null;
  description?: string | null;
  company_logo?: string | null;
  company_url_direct?: string | null;
  skills?: string | null;
  experience_range?: string | null;
};

/** Runs worker/jobspy_fetch.py (Python) and returns the raw records. */
export function runJobspy(req: JobspyRequest, timeoutMs = 150_000): Promise<JobspyRecord[]> {
  const python = process.env.JOBSPY_PYTHON || (process.platform === "win32" ? "py" : "python3");
  const script = path.join(process.cwd(), "worker", "jobspy_fetch.py");
  return new Promise((resolve, reject) => {
    const child = spawn(/* turbopackIgnore: true */ python, ["-I", script], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`jobspy ${req.site} timed out`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`can't start ${python}: ${e.message} — install Python + worker/requirements.txt`));
    });
    child.on("close", () => {
      clearTimeout(timer);
      const line = out.trim().split("\n").pop() ?? "";
      try {
        const parsed = JSON.parse(line) as JobspyRecord[] | { error: string };
        if (!Array.isArray(parsed)) return reject(new Error(parsed.error));
        // JobSpy logs blocks/rate limits to stderr and returns nothing — surface that as an error.
        const blocked = err.split("\n").find((l) => l.startsWith("ERROR"));
        if (!parsed.length && blocked) return reject(new Error(`${req.site}: ${blocked.replace(/^ERROR:[^:]*:/, "").slice(0, 200)}`));
        resolve(parsed);
      } catch {
        reject(new Error(`jobspy ${req.site}: unreadable output ${(err || out).slice(0, 200)}`));
      }
    });
    child.stdin.end(JSON.stringify(req));
  });
}

const COUNTRY: Record<string, string> = { in: "india", us: "usa", gb: "uk", uk: "uk", ca: "canada", au: "australia", de: "germany", sg: "singapore", ae: "united arab emirates", nl: "netherlands", ie: "ireland" };

export function countryForIndeed(code: string | undefined): string {
  return COUNTRY[(code ?? "in").toLowerCase()] ?? "india";
}

export function mapJobspyRecord(r: JobspyRecord, site: string): RawJob | null {
  if (!r.job_url || !r.title) return null;
  const period = r.interval ? r.interval.replace(/ly$/, "") : null;
  return {
    source: `jobspy:${site}`,
    external_id: r.id ?? undefined,
    url: r.job_url,
    apply_url: r.job_url_direct ?? null,
    title: r.title,
    company: r.company ?? null,
    company_logo: r.company_logo ?? null,
    location: r.location ?? null,
    remote: r.is_remote ?? null,
    employment_type: r.job_type ?? null,
    salary: formatSalary(r.min_amount, r.max_amount, r.currency, period),
    description: stripHtml(
      [r.description, r.skills ? `Skills: ${r.skills}` : "", r.experience_range ? `Experience: ${r.experience_range}` : ""]
        .filter(Boolean)
        .join("\n"),
      6000,
    ),
    posted_at: r.date_posted ? new Date(r.date_posted).toISOString() : null,
  };
}
