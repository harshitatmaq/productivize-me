import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { checkPlan, closedReason, isStale } from "./liveness";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

type Verdict = { closed: boolean; reason?: string; unknown?: boolean };

/** Checks one posting. Unknown (blocked, rate-limited, timeouts) is retried another day. */
export async function checkPosting(url: string): Promise<Verdict> {
  const plan = checkPlan(url);
  if (!plan) return { closed: false, unknown: true };
  try {
    const res = await fetch(plan.url, {
      headers: { "User-Agent": UA, Accept: plan.kind === "page" || plan.kind === "linkedin" ? "text/html,*/*" : "application/json" },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404 || res.status === 410) return { closed: true, reason: plan.kind === "page" ? "Posting removed" : "Closed on the company's job board" };
    if (!res.ok) return { closed: false, unknown: true };
    if (plan.kind === "greenhouse" || plan.kind === "lever") return { closed: false };
    if (plan.kind === "ashby") {
      const body = (await res.json()) as { jobs?: { id?: string }[] };
      const listed = (body.jobs ?? []).some((j) => j.id === plan.jobId);
      return listed ? { closed: false } : { closed: true, reason: "No longer on the company's job board" };
    }
    const text = (await res.text()).slice(0, 400_000);
    const reason = closedReason(text.replace(/<[^>]+>/g, " "));
    return reason ? { closed: true, reason } : { closed: false };
  } catch {
    return { closed: false, unknown: true };
  }
}

export type SweepResult = { checked: number; closed: number; stale: number };

/**
 * Keeps the board fresh: archives very old "new" jobs, then checks postings that
 * haven't been checked recently. Closed "new" jobs are archived off the board;
 * closed saved jobs stay (marked closed) so you can see what happened.
 */
export async function sweepJobs(admin: SupabaseClient, userId: string, opts: { limit: number; recheckHours: number; maxAgeDays?: number }): Promise<SweepResult> {
  const now = Date.now();
  const out: SweepResult = { checked: 0, closed: 0, stale: 0 };
  const maxAge = opts.maxAgeDays ?? (Number(process.env.JOBS_MAX_AGE_DAYS) || 30);

  const { data: fresh } = await admin.from("jobs").select("id, posted_at, created_at").eq("user_id", userId).eq("status", "new").is("closed_at", null).limit(2000);
  const stale = (fresh ?? []).filter((j) => isStale(j as { posted_at: string | null; created_at: string }, now, maxAge)).map((j) => j.id as string);
  for (let i = 0; i < stale.length; i += 200) {
    await admin.from("jobs").update({ status: "archived", closed_reason: `Older than ${maxAge} days` }).in("id", stale.slice(i, i + 200));
  }
  out.stale = stale.length;

  const before = new Date(now - opts.recheckHours * 3_600_000).toISOString();
  const { data: due } = await admin
    .from("jobs")
    .select("id, url, apply_url, status")
    .eq("user_id", userId)
    .in("status", ["new", "saved"])
    .is("closed_at", null)
    .or(`checked_at.is.null,checked_at.lt.${before}`)
    .order("checked_at", { ascending: true, nullsFirst: true })
    .limit(opts.limit);

  const queue = [...(due ?? [])] as { id: string; url: string; apply_url: string | null; status: string }[];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      let verdict = await checkPosting(job.url);
      if (!verdict.closed && job.apply_url && job.apply_url !== job.url) {
        const second = await checkPosting(job.apply_url);
        if (second.closed) verdict = second;
      }
      const stamp = new Date().toISOString();
      if (verdict.closed) {
        await admin
          .from("jobs")
          .update({ checked_at: stamp, closed_at: stamp, closed_reason: verdict.reason ?? "Closed", ...(job.status === "new" ? { status: "archived" } : {}) })
          .eq("id", job.id);
        out.closed++;
      } else {
        await admin.from("jobs").update({ checked_at: stamp }).eq("id", job.id);
      }
      out.checked++;
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return out;
}
