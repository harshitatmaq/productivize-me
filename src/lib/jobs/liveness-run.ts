import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fitGate, judge, type Requirements } from "./fit-rules";
import { cleanPosting } from "./integrity";
import { checkPlan, closedReason, isStale, linkedinJobId, parseLinkedinJob, type LinkedinDetails } from "./liveness";
import type { JobProfile } from "./types";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const onWorker = () => process.env.SCOUT_WORKER === "1";

type Verdict = { closed: boolean; reason?: string; unknown?: boolean; note?: string; applyUrl?: string; details?: LinkedinDetails };

export { linkedinApplyUrl } from "./liveness";

/** Checks one posting. Unknown (blocked, rate-limited, timeouts) is retried in a few hours. */
export async function checkPosting(url: string): Promise<Verdict> {
  const plan = checkPlan(url);
  if (!plan) return { closed: false, unknown: true, note: "Can't check this kind of link" };
  // LinkedIn blocks cloud servers; only the Scout worker (your PC / VM) can read its public pages.
  if (plan.kind === "linkedin" && !onWorker()) return { closed: false, unknown: true, note: "LinkedIn is checked by the Scout worker" };
  try {
    const res = await fetch(plan.url, {
      headers: { "User-Agent": UA, Accept: plan.kind === "page" || plan.kind === "linkedin" ? "text/html,*/*" : "application/json", "Accept-Language": "en" },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404 || res.status === 410) return { closed: true, reason: plan.kind === "page" ? "Posting removed" : "Closed on the company's job board" };
    if (!res.ok) return { closed: false, unknown: true, note: `The site answered ${res.status}` };
    if (plan.kind === "greenhouse" || plan.kind === "lever") return { closed: false };
    if (plan.kind === "ashby") {
      const body = (await res.json()) as { jobs?: { id?: string }[] };
      const listed = (body.jobs ?? []).some((j) => j.id === plan.jobId);
      return listed ? { closed: false } : { closed: true, reason: "No longer on the company's job board" };
    }
    const html = (await res.text()).slice(0, 400_000);
    if (plan.kind === "linkedin" && /authwall|sign in to view|join linkedin to see/i.test(html) && !/top-card|description__text/i.test(html)) {
      return { closed: false, unknown: true, note: "LinkedIn asked to sign in" };
    }
    const reason = closedReason(html.replace(/<[^>]+>/g, " "));
    if (reason) return { closed: true, reason };
    if (plan.kind !== "linkedin") return { closed: false };
    const details = parseLinkedinJob(html);
    return { closed: false, applyUrl: details.applyUrl, details };
  } catch {
    return { closed: false, unknown: true, note: "Timed out" };
  }
}

/**
 * Full LinkedIn job details (description, seniority, apply link) from its public page.
 * Worker only: LinkedIn blocks cloud servers. Returns null when blocked or rate-limited.
 */
export async function fetchLinkedinDetails(url: string): Promise<LinkedinDetails | "rate-limited" | null> {
  const id = linkedinJobId(url);
  if (!id || !onWorker()) return null;
  try {
    const res = await fetch(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`, {
      headers: { "User-Agent": UA, Accept: "text/html,*/*", "Accept-Language": "en" },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 429) return "rate-limited";
    if (!res.ok) return null;
    return parseLinkedinJob((await res.text()).slice(0, 400_000));
  } catch {
    return null;
  }
}

export type SweepResult = { checked: number; closed: number; stale: number; unfit: number; unverified: number };

/**
 * Keeps the board fresh and honest:
 * 1. archives "new" jobs that break your fit rules (too many years, too senior, wrong country);
 * 2. archives very old "new" jobs (LinkedIn listings sooner);
 * 3. checks postings not checked recently. Closed "new" jobs are archived; closed saved
 *    jobs stay, marked closed. A check that couldn't read the page is retried in ~3 hours.
 */
export async function sweepJobs(admin: SupabaseClient, userId: string, opts: { limit: number; recheckHours: number; maxAgeDays?: number }): Promise<SweepResult> {
  const now = Date.now();
  const out: SweepResult = { checked: 0, closed: 0, stale: 0, unfit: 0, unverified: 0 };
  const maxAge = opts.maxAgeDays ?? (Number(process.env.JOBS_MAX_AGE_DAYS) || 30);

  // 1. Fit rules on jobs found before the rules existed (or before your profile changed).
  const { data: jp } = await admin.from("job_profiles").select("profile").eq("user_id", userId).maybeSingle();
  const profile = (jp?.profile ?? {}) as JobProfile;
  const { data: ungated, error: gateErr } = await admin
    .from("jobs")
    .select("id, title, description, location, remote")
    .eq("user_id", userId)
    .eq("status", "new")
    .is("requirements", null)
    .limit(300);
  if (!gateErr) {
    for (const j of ungated ?? []) {
      const gate = fitGate({ source: "", url: "", title: j.title as string, description: j.description as string | null, location: j.location as string | null, remote: j.remote as boolean | null }, profile);
      const block = gate.verdict === "block";
      await admin
        .from("jobs")
        .update({ requirements: gate.requirements, ...(block ? { status: "archived", closed_reason: `Doesn't fit: ${gate.reasons[0]}` } : {}) })
        .eq("id", j.id);
      if (block) out.unfit++;
    }
  }

  // 1b. Jobs already read: re-judge their stored requirements (cheap), so a profile
  //     change (e.g. setting your years of experience) cleans the board too.
  if (!gateErr) {
    const { data: gated } = await admin.from("jobs").select("id, requirements").eq("user_id", userId).eq("status", "new").not("requirements", "is", null).limit(2000);
    const unfit = (gated ?? []).filter((j) => judge(j.requirements as Requirements, profile).verdict === "block");
    for (const j of unfit) {
      await admin.from("jobs").update({ status: "archived", closed_reason: `Doesn't fit: ${judge(j.requirements as Requirements, profile).reasons[0]}` }).eq("id", j.id);
    }
    out.unfit += unfit.length;
  }

  // 2. Old listings. LinkedIn ones expire sooner (they can't be checked without the worker).
  const { data: fresh } = await admin.from("jobs").select("id, url, posted_at, created_at").eq("user_id", userId).eq("status", "new").is("closed_at", null).limit(2000);
  const stale = (fresh ?? [])
    .filter((j) => isStale(j as { posted_at: string | null; created_at: string }, now, /linkedin\.com/i.test(j.url as string) ? Math.min(maxAge, 21) : maxAge))
    .map((j) => j.id as string);
  for (let i = 0; i < stale.length; i += 200) {
    await admin.from("jobs").update({ status: "archived", closed_reason: `Older than ${maxAge} days` }).in("id", stale.slice(i, i + 200));
  }
  out.stale = stale.length;

  // 3. Posting checks.
  const before = new Date(now - opts.recheckHours * 3_600_000).toISOString();
  const retryAfter = new Date(now - 3 * 3_600_000).toISOString();
  const base = () =>
    admin
      .from("jobs")
      .select("id, url, apply_url, status, title, description, location, remote")
      .eq("user_id", userId)
      .in("status", ["new", "saved"])
      .is("closed_at", null)
      .or(`checked_at.is.null,checked_at.lt.${before}`);
  const first = await base()
    .or(`check_failed_at.is.null,check_failed_at.lt.${retryAfter}`)
    .order("checked_at", { ascending: true, nullsFirst: true })
    .limit(opts.limit);
  const hasRetryColumns = !first.error;
  // Database without part 7 of the 0005 migration yet: fall back to the plain query.
  const due = hasRetryColumns ? first.data : (await base().order("checked_at", { ascending: true, nullsFirst: true }).limit(opts.limit)).data;

  type Due = { id: string; url: string; apply_url: string | null; status: string; title: string; description: string | null; location: string | null; remote: boolean | null };
  const queue = [...(due ?? [])] as Due[];
  // LinkedIn rows usually arrive without a description; the worker's check reads the
  // full page, so save it and judge the job again (e.g. "3+ years" hidden in the text).
  const backfill = (job: Due, verdict: Verdict): Record<string, unknown> => {
    const d = verdict.details;
    if (!d?.description || (job.description ?? "").length >= 600 || d.description.length <= (job.description ?? "").length) return {};
    const description = cleanPosting(d.description).text;
    const gate = fitGate({ source: "", url: job.url, title: job.title, description, location: job.location, remote: job.remote, board_level: d.level ?? null }, profile);
    const patch: Record<string, unknown> = { description: description.slice(0, 6000), requirements: gate.requirements };
    if (gate.verdict === "block" && job.status === "new") {
      patch.status = "archived";
      patch.closed_reason = `Doesn't fit: ${gate.reasons[0]}`;
      out.unfit++;
    }
    return patch;
  };
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      let verdict = await checkPosting(job.url);
      if (!verdict.closed && job.apply_url && job.apply_url !== job.url) {
        const second = await checkPosting(job.apply_url);
        if (second.closed) verdict = second;
        else if (verdict.unknown && !second.unknown) verdict = second; // the company's page answered
      }
      const stamp = new Date().toISOString();
      if (verdict.closed) {
        await admin
          .from("jobs")
          .update({ checked_at: stamp, closed_at: stamp, closed_reason: verdict.reason ?? "Closed", ...(job.status === "new" ? { status: "archived" } : {}) })
          .eq("id", job.id);
        out.closed++;
      } else if (verdict.unknown) {
        // Couldn't read it: try again in a few hours instead of counting it as checked.
        if (hasRetryColumns) await admin.from("jobs").update({ check_failed_at: stamp, check_note: verdict.note ?? null }).eq("id", job.id);
        else await admin.from("jobs").update({ checked_at: stamp }).eq("id", job.id);
        out.unverified++;
      } else {
        await admin
          .from("jobs")
          .update({
            checked_at: stamp,
            ...(hasRetryColumns ? { check_failed_at: null, check_note: null } : {}),
            ...(verdict.applyUrl && !job.apply_url ? { apply_url: verdict.applyUrl } : {}),
            ...(hasRetryColumns ? backfill(job, verdict) : {}),
          })
          .eq("id", job.id);
      }
      out.checked++;
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return out;
}
