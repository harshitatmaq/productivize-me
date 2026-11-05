/**
 * Scout worker — runs the hourly job search and queued searches outside Vercel.
 *
 *   npm run worker          # long-running (Oracle VM via Docker, or your Windows PC)
 *   npm run worker -- --once  # one pass, then exit (handy for testing)
 *
 * Configuration: the same .env.local as the app (Supabase URL + secret key, AI and
 * search keys) plus the worker-only settings in worker/.env.example.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

process.env.SCOUT_WORKER = "1";

import type { Profile } from "@/lib/cron/tick";
import { discoverBoards, type DiscoveryLog } from "@/lib/jobs/discover";
import { INDIA_FOCUS_COMPANIES } from "@/lib/jobs/company-seed";
import { gmailAccounts } from "@/lib/jobs/gmail";
import { jobspySites } from "@/lib/jobs/jobspy";
import { runJobSearch } from "@/lib/jobs/pipeline";
import { LIVE_SOURCE_IDS } from "@/lib/jobs/sources";
import type { SearchPlan, WatchCompany } from "@/lib/jobs/types";
import { supabaseAdmin } from "@/lib/supabase/admin";

const NAME = (process.env.WORKER_NAME || os.hostname()).slice(0, 60);
const ONCE = process.argv.includes("--once");
const TICK_MINUTES = Math.max(1, Number(process.env.WORKER_TICK_MINUTES ?? 5));
const JOB_TYPES = ["job_search", "live_search"];
const VERSION = (() => {
  try {
    return (JSON.parse(readFileSync("package.json", "utf8")) as { version?: string }).version ?? "dev";
  } catch {
    return "dev";
  }
})();

let stopping = false;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), `[${NAME}]`, ...a);

function capabilities() {
  return ["search", ...(jobspySites().length ? ["jobspy"] : []), ...(gmailAccounts().size ? ["gmail"] : [])];
}

async function heartbeat() {
  const { error } = await supabaseAdmin()
    .from("worker_heartbeats")
    .upsert({
      name: NAME,
      capabilities: capabilities(),
      last_seen: new Date().toISOString(),
      info: {
        version: VERSION,
        platform: `${process.platform} ${os.release()}`,
        node: process.version,
        jobspy_sites: jobspySites(),
        gmail_accounts: [...gmailAccounts().keys()],
        tick_minutes: TICK_MINUTES,
      },
    });
  if (error) log("heartbeat failed:", error.message, "(did you run supabase/migrations/0003_scout_worker.sql?)");
}

async function usersToSearch(): Promise<Profile[]> {
  const admin = supabaseAdmin();
  const [{ data: profiles, error: e1 }, { data: ready, error: e2 }] = await Promise.all([
    admin.from("profiles").select("*"),
    admin.from("job_profiles").select("user_id, status"),
  ]);
  if (e1 || e2) {
    log("couldn't load users:", (e1 ?? e2)!.message);
    return [];
  }
  const status = new Map((ready ?? []).map((r) => [r.user_id as string, r.status as string]));
  const out: Profile[] = [];
  for (const p of (profiles ?? []) as Profile[]) {
    const s = status.get(p.id);
    if (s !== "ready") {
      if (ONCE) log(`${p.email}: skipped — Scout profile is ${s ?? "not started"} (finish Jobs → Set up Scout)`);
    } else if (!p.job_search_enabled) {
      if (ONCE) log(`${p.email}: skipped — hourly job search is off (Settings → Job search)`);
    } else out.push(p);
  }
  if (!out.length && ONCE) log("no one to search for yet");
  return out;
}

async function profileFor(userId: string): Promise<Profile | null> {
  const { data } = await supabaseAdmin().from("profiles").select("*").eq("id", userId).maybeSingle<Profile>();
  return data ?? null;
}

let ticking = false;
/** Every few minutes: each source runs for each user once its interval has passed. */
async function searchTick() {
  if (ticking || stopping) return;
  ticking = true;
  try {
    for (const p of await usersToSearch()) {
      if (stopping) break;
      try {
        if (ONCE) log(`${p.email}: searching…${gmailAccounts().has((p.email ?? "").toLowerCase()) ? "" : " (no Gmail app password for this email in GMAIL_ACCOUNTS)"}`);
        const r = await runJobSearch(p.id, { trigger: "worker", profile: p, worker: NAME });
        if (!r.ran) {
          if (!ONCE) continue;
          const why = [...new Set(Object.values(r.sources).map((s) => s.skipped).filter(Boolean))].join(", ");
          log(`${p.email}: nothing due${why ? ` (${why})` : ""}${r.log.length ? ` · ${r.log.join("; ")}` : ""}`);
        } else {
          const errs = Object.entries(r.sources).filter(([, s]) => s.error).map(([k]) => k);
          log(`${p.email}: +${r.inserted} jobs (${r.strong} strong) from ${r.fetched} fetched in ${Math.round(r.ms / 1000)}s${errs.length ? ` · errors: ${errs.join(", ")}` : ""}`);
        }
      } catch (e) {
        log(`${p.email}: search failed:`, (e as Error).message);
      }
    }
  } finally {
    ticking = false;
  }
}

/** Once a day: find public Greenhouse / Lever / Ashby boards for the India-focused company list. */
async function seedDiscovery() {
  const admin = supabaseAdmin();
  const { data: due, error } = await admin.rpc("claim_source", { p_key: "global:seed-discovery", p_minutes: 24 * 60 });
  if (error || due !== true) return;
  const { data: row } = await admin.from("source_state").select("data").eq("key", "global:seed-boards").maybeSingle();
  const prev = (row?.data ?? {}) as { log?: DiscoveryLog; boards?: WatchCompany[] };
  log(`discovering career boards for ${INDIA_FOCUS_COMPANIES.length} companies…`);
  const { log: dlog, found } = await discoverBoards(INDIA_FOCUS_COMPANIES, prev.log ?? {}, [], 200);
  const boards = [...(prev.boards ?? []), ...found];
  await admin.from("source_state").upsert({ key: "global:seed-boards", last_run_at: new Date().toISOString(), data: { log: dlog, boards } });
  log(`seed discovery: ${found.length} new boards (${boards.length} total)`);
}

type AgentJob = { id: string; type: string; user_id: string | null; payload: Record<string, unknown>; attempts: number; max_attempts: number };

async function handle(job: AgentJob) {
  const userId = (job.payload.userId as string) ?? job.user_id;
  const profile = userId ? await profileFor(userId) : null;
  if (!profile) throw new Error("user not found");
  switch (job.type) {
    case "job_search": {
      const r = await runJobSearch(userId!, { trigger: "manual", profile, worker: NAME });
      return { inserted: r.inserted, strong: r.strong, fetched: r.fetched, runId: r.runId };
    }
    case "live_search": {
      const extraBoards = (job.payload.extraBoards as WatchCompany[]) ?? [];
      const r = await runJobSearch(userId!, {
        trigger: "live",
        profile,
        worker: NAME,
        planOverride: job.payload.plan as SearchPlan,
        searchId: job.payload.searchId as string,
        onlySources: [...LIVE_SOURCE_IDS, ...(extraBoards.length ? ["ats"] : [])],
        extraBoards,
      });
      return { inserted: r.inserted, fetched: r.fetched, runId: r.runId };
    }
    default:
      throw new Error(`unknown job type ${job.type}`);
  }
}

/** Processes queued work (Search now, live searches). Returns false when the queue is empty. */
async function queueOnce(): Promise<boolean> {
  const admin = supabaseAdmin();
  const { data, error } = await admin.rpc("claim_agent_job", { p_worker: NAME, p_types: JOB_TYPES });
  if (error) {
    log("queue unavailable:", error.message);
    return false;
  }
  const job = (data as AgentJob[] | null)?.[0];
  if (!job) return false;
  log(`job ${job.type} ${job.id.slice(0, 8)} (attempt ${job.attempts})`);
  try {
    const result = await handle(job);
    await admin.from("agent_jobs").update({ status: "done", result, error: null }).eq("id", job.id);
  } catch (e) {
    const msg = (e as Error).message.slice(0, 500);
    log(`job ${job.id.slice(0, 8)} failed: ${msg}`);
    const retry = job.attempts < job.max_attempts;
    await admin
      .from("agent_jobs")
      .update({
        status: retry ? "queued" : "error",
        error: msg,
        run_after: new Date(Date.now() + 2 ** job.attempts * 60_000).toISOString(),
      })
      .eq("id", job.id);
  }
  return true;
}

async function main() {
  for (const k of ["NEXT_PUBLIC_SUPABASE_URL"]) if (!process.env[k]) throw new Error(`${k} is not set (copy .env.local / worker/.env)`);
  if (!process.env.SUPABASE_SECRET_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SECRET_KEY is not set");
  log(`Scout worker ${VERSION} starting · JobSpy: ${jobspySites().join(", ") || "off"} · Gmail: ${gmailAccounts().size} account(s) · tick ${TICK_MINUTES}m`);

  await heartbeat();
  if (ONCE) {
    await seedDiscovery().catch((e) => log("seed discovery failed:", e.message));
    await searchTick();
    while (await queueOnce());
    log("done (--once)");
    return;
  }

  const hb = setInterval(() => heartbeat().catch(() => {}), 60_000);
  const tick = setInterval(() => searchTick(), TICK_MINUTES * 60_000);
  const seed = setInterval(() => seedDiscovery().catch((e) => log("seed discovery failed:", e.message)), 60 * 60_000);
  const shutdown = (sig: string) => {
    log(`${sig} — finishing current work, then exiting`);
    stopping = true;
    clearInterval(hb);
    clearInterval(tick);
    clearInterval(seed);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  seedDiscovery().catch((e) => log("seed discovery failed:", e.message));
  searchTick();
  while (!stopping) {
    const worked = await queueOnce().catch((e) => {
      log("queue error:", (e as Error).message);
      return false;
    });
    if (!worked) await sleep(4_000);
  }
  // Let an in-flight search tick finish before exiting.
  while (ticking) await sleep(500);
  log("stopped");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
