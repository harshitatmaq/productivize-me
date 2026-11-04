import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { toPgVector } from "@/lib/ai/embeddings";
import { envInt } from "@/lib/env";
import { notify, type NotifyProfile } from "@/lib/notify";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { discoverBoards, type DiscoveryLog } from "./discover";
import { fetchFullDescription } from "./enrich";
import { dedupeKey, detectAts, domainOf, hash, normalizeUrl, relevance } from "./normalize";
import { buildSearchPlan } from "./profile";
import { feedbackContext, semanticRank, type Candidate } from "./rank";
import { scoreJobs } from "./scoring";
import { JOB_SOURCES, type JobSource } from "./sources";
import type { JobProfile, RawJob, SearchPlan, WatchCompany } from "./types";

export type RunStats = {
  sources: Record<string, { fetched: number; error?: string; skipped?: string; running?: boolean }>;
  fetched: number;
  unique: number;
  fresh: number;
  scored: number;
  dropped: number;
  inserted: number;
  strong: number;
  providers: string[];
  log: string[];
  ms: number;
  stage?: string;
};

export type RunOptions = {
  /**
   * cron    — Vercel fallback scheduler (only when no worker is online; 45-minute guard)
   * worker  — Scout worker tick (every few minutes; sources claimed atomically per interval)
   * manual  — "Search now" (short intervals)
   * live    — one-off Search & ask Scout query with its own plan
   */
  trigger: "cron" | "manual" | "worker" | "live";
  profile: NotifyProfile & { job_alert_min_score: number };
  worker?: string;
  planOverride?: SearchPlan;
  searchId?: string;
  onlySources?: string[];
  /** Extra company boards to search in a live query (companies named in the request). */
  extraBoards?: WatchCompany[];
};

type JobProfileRow = {
  user_id: string;
  status: string;
  profile: JobProfile;
  search_plan: SearchPlan | Record<string, never>;
  search_plan_at: string | null;
  watch_companies: WatchCompany[];
  disabled_sources: string[];
  last_search_at: string | null;
  profile_updated_at: string | null;
  profile_embedding: { model: string; hash: string; vector: number[] } | null;
  ats_discovery: DiscoveryLog | null;
};

type SourceStateRow = { key: string; last_run_at: string | null; data: Record<string, unknown> | null };

const PLAN_MAX_AGE_MS = 24 * 3_600_000;
export const isWorkerProcess = () => process.env.SCOUT_WORKER === "1";

/** Claims a source for this run; falls back to a plain time check if migration 0003 isn't applied yet. */
async function claimSource(admin: SupabaseClient, key: string, minutes: number, prev: SourceStateRow | undefined): Promise<boolean> {
  const { data, error } = await admin.rpc("claim_source", { p_key: key, p_minutes: minutes });
  if (!error) return data === true;
  const last = prev?.last_run_at ? Date.parse(prev.last_run_at) : 0;
  if (Date.now() - last < minutes * 60_000) return false;
  await admin.from("source_state").upsert({ key, last_run_at: new Date().toISOString(), data: prev?.data ?? {} });
  return true;
}

/** Saved searches add their titles, keywords and queries to the hourly plan. */
async function withSavedSearches(admin: SupabaseClient, userId: string, plan: SearchPlan): Promise<SearchPlan> {
  const { data } = await admin.from("searches").select("query, plan").eq("user_id", userId).eq("saved", true).limit(10);
  if (!data?.length) return plan;
  const uniq = (xs: string[]) => [...new Map(xs.filter(Boolean).map((x) => [x.toLowerCase(), x])).values()];
  const extra = data.map((s) => s.plan as Partial<SearchPlan>);
  return {
    ...plan,
    titles: uniq([...plan.titles, ...extra.flatMap((p) => p.titles ?? [])]).slice(0, 12),
    keywords: uniq([...plan.keywords, ...extra.flatMap((p) => p.keywords ?? [])]).slice(0, 24),
    locations: uniq([...plan.locations, ...extra.flatMap((p) => p.locations ?? [])]).slice(0, 6),
    web_queries: [...plan.web_queries, ...data.map((s) => ({ q: s.query }))].slice(0, 20),
  };
}

/** Runs one search pass for one user. Returns `ran: false` when nothing was due. */
export async function runJobSearch(userId: string, opts: RunOptions): Promise<RunStats & { ran: boolean; runId?: string }> {
  const started = Date.now();
  const admin = supabaseAdmin();
  const manual = opts.trigger === "manual";
  const live = opts.trigger === "live";
  const stats: RunStats = { sources: {}, fetched: 0, unique: 0, fresh: 0, scored: 0, dropped: 0, inserted: 0, strong: 0, providers: [], log: [], ms: 0 };
  const log = (m: string) => {
    stats.log.push(m.slice(0, 300));
  };
  const done = (ran: boolean, runId?: string) => ({ ...stats, ms: Date.now() - started, ran, runId });

  const { data: jp } = await admin.from("job_profiles").select("*").eq("user_id", userId).maybeSingle<JobProfileRow>();
  if (!live && (!jp || jp.status !== "ready")) {
    log("profile not ready — finish onboarding first");
    return done(false);
  }
  const profile: JobProfile = jp?.profile ?? {};

  // Vercel fallback scheduler: one run per ~hour per user.
  if (opts.trigger === "cron" && jp?.last_search_at && Date.now() - Date.parse(jp.last_search_at) < 45 * 60_000) {
    log("ran less than 45 minutes ago — skipping");
    return done(false);
  }

  // 1. Pick sources and claim the ones that are due (atomic across workers).
  const disabled = new Set(jp?.disabled_sources ?? []);
  const watch = live && opts.extraBoards?.length ? [...opts.extraBoards] : [...(jp?.watch_companies ?? [])];
  const candidates: JobSource[] = JOB_SOURCES.filter((s) => {
    const skip = (why: string) => {
      stats.sources[s.id] = { fetched: 0, skipped: why };
      return false;
    };
    if (opts.onlySources && !opts.onlySources.includes(s.id)) return false;
    if (disabled.has(s.id)) return skip("turned off");
    if (s.workerOnly && !isWorkerProcess()) return skip("runs on the Scout worker");
    if (!s.configured()) return skip(s.kind === "scrape" ? "not enabled on this worker" : "not configured");
    if (s.id === "ats" && !watch.length) return skip("no watched companies");
    return true;
  });

  const keyFor = (s: JobSource) => (live ? `${userId}:live:${s.id}` : `${userId}:${s.id}`);
  const { data: stateRows } = await admin.from("source_state").select("key, last_run_at, data").in("key", candidates.map(keyFor));
  const states = new Map(((stateRows ?? []) as SourceStateRow[]).map((r) => [r.key, r]));

  const claimed: JobSource[] = [];
  for (const s of candidates) {
    const minutes = live ? 0 : manual ? Math.min(s.minIntervalMin, 10) : s.minIntervalMin;
    if (await claimSource(admin, keyFor(s), minutes, states.get(keyFor(s)))) claimed.push(s);
    else stats.sources[s.id] = { fetched: 0, skipped: "ran recently" };
  }
  if (!claimed.length) return done(false);

  // 2. Start a run record (streams to the app via Realtime).
  const { data: run } = await admin
    .from("job_search_runs")
    .insert({ user_id: userId, trigger: opts.trigger, status: "running", worker: opts.worker ?? null, search_id: opts.searchId ?? null, stats })
    .select("id")
    .single();
  const runId = run?.id as string | undefined;
  let lastPush = 0;
  const pushProgress = async (force = false) => {
    if (!runId || (!force && Date.now() - lastPush < 1500)) return;
    lastPush = Date.now();
    await admin.from("job_search_runs").update({ stats: { ...stats, ms: Date.now() - started } }).eq("id", runId);
  };
  if (!live) await admin.from("job_profiles").update({ last_search_at: new Date().toISOString() }).eq("user_id", userId);

  try {
    // 3. Plan: the live query's own plan, or the daily-refreshed profile plan + saved searches.
    let plan: SearchPlan;
    if (live && opts.planOverride) {
      plan = opts.planOverride;
    } else {
      plan = jp!.search_plan as SearchPlan;
      const stale =
        !plan?.titles?.length ||
        !jp!.search_plan_at ||
        Date.now() - Date.parse(jp!.search_plan_at) > PLAN_MAX_AGE_MS ||
        (!!jp!.profile_updated_at && Date.parse(jp!.profile_updated_at) > Date.parse(jp!.search_plan_at));
      if (stale) {
        stats.stage = "Refreshing your search plan";
        await pushProgress(true);
        plan = await buildSearchPlan(profile);
        await admin.from("job_profiles").update({ search_plan: plan, search_plan_at: new Date().toISOString() }).eq("user_id", userId);
        log(`search plan refreshed: ${plan.titles.join(", ")}`);
      }
      plan = await withSavedSearches(admin, userId, plan);

      // Dream companies → public boards (probed once; misses retried monthly).
      if (profile.target_companies?.length) {
        const { log: dlog, found } = await discoverBoards(profile.target_companies, jp!.ats_discovery ?? {}, watch);
        if (found.length || Object.keys(dlog).length !== Object.keys(jp!.ats_discovery ?? {}).length) {
          watch.push(...found);
          await admin.from("job_profiles").update({ ats_discovery: dlog, watch_companies: watch }).eq("user_id", userId);
          if (found.length) log(`found career boards: ${found.map((f) => `${f.name} (${f.ats})`).join(", ")}`);
        }
      }
    }

    // 4. Fetch every claimed source in parallel, streaming progress.
    stats.stage = "Searching";
    for (const s of claimed) stats.sources[s.id] = { fetched: 0, running: true };
    await pushProgress(true);
    const all: RawJob[] = [];
    await Promise.all(
      claimed.map(async (s) => {
        const prev = states.get(keyFor(s));
        const prevData = (prev?.data ?? {}) as Record<string, unknown>;
        const cursor = Number(prevData.cursor ?? 0);
        let statePatch: Record<string, unknown> = {};
        try {
          const jobs = await s.fetch({
            plan,
            watch,
            manual: manual || live,
            cursor,
            log,
            userId,
            userEmail: opts.profile.email,
            lastRunAt: prev?.last_run_at ? Date.parse(prev.last_run_at) : null,
            state: prevData,
            saveState: (patch) => {
              statePatch = { ...statePatch, ...patch };
            },
          });
          all.push(...jobs);
          stats.sources[s.id] = { fetched: jobs.length };
          await admin.from("source_state").upsert({
            key: keyFor(s),
            last_run_at: new Date().toISOString(),
            data: { ...prevData, ...statePatch, cursor: cursor + 1, last_count: jobs.length, last_error: null },
          });
        } catch (e) {
          stats.sources[s.id] = { fetched: 0, error: (e as Error).message.slice(0, 200) };
          await admin.from("source_state").upsert({
            key: keyFor(s),
            last_run_at: new Date().toISOString(),
            data: { ...prevData, ...statePatch, last_error: (e as Error).message.slice(0, 200) },
          });
        }
        await pushProgress();
      }),
    );
    stats.fetched = all.length;

    // 5. Normalise + de-duplicate within this batch.
    const byKey = new Map<string, RawJob & { url_hash: string; dedupe_key: string }>();
    for (const j of all) {
      if (!j.url || !j.title) continue;
      const url = normalizeUrl(j.url);
      const item = { ...j, url, url_hash: hash(url), dedupe_key: dedupeKey({ ...j, url }) };
      if (!byKey.has(item.dedupe_key)) byKey.set(item.dedupe_key, item);
    }
    const unique = [...byKey.values()];
    stats.unique = unique.length;

    // 6. Drop anything already stored for this user.
    const known = new Set<string>();
    for (let i = 0; i < unique.length; i += 200) {
      const chunk = unique.slice(i, i + 200);
      const [{ data: a }, { data: b }] = await Promise.all([
        admin.from("jobs").select("url_hash").eq("user_id", userId).in("url_hash", chunk.map((j) => j.url_hash)),
        admin.from("jobs").select("dedupe_key").eq("user_id", userId).in("dedupe_key", chunk.map((j) => j.dedupe_key)),
      ]);
      a?.forEach((r) => known.add(`u:${r.url_hash}`));
      b?.forEach((r) => known.add(`d:${r.dedupe_key}`));
    }
    const fresh = unique.filter((j) => !known.has(`u:${j.url_hash}`) && !known.has(`d:${j.dedupe_key}`));
    stats.fresh = fresh.length;

    // 7. Keyword pre-filter → semantic re-rank (embeddings + 👍/👎) → full descriptions → LLM scoring.
    stats.stage = "Ranking and scoring";
    await pushProgress(true);
    const maxScore = envInt("JOBS_MAX_SCORED_PER_RUN", manual || live ? 40 : 32);
    const minRel = live ? 0.15 : Number(process.env.JOBS_MIN_RELEVANCE ?? 0.3);
    const keywordPool: Candidate[] = fresh
      .map((job) => ({ job, rel: job.needs_extraction ? Math.max(relevance(job, plan, profile), 0.45) : relevance(job, plan, profile) }))
      .filter((x) => x.rel >= minRel * 0.6)
      .sort((a, b) => b.rel - a.rel)
      .slice(0, 120);
    const { ranked: reranked, model: embeddingModel } = await semanticRank(admin, userId, profile, jp?.profile_embedding ?? null, keywordPool, log);
    const ranked = reranked.filter((x) => x.rel >= minRel).slice(0, maxScore);

    const enrichCount = envInt("JOBS_ENRICH_PER_RUN", manual || live ? 10 : 8);
    const toEnrich = ranked.slice(0, enrichCount).filter((c) => (c.job.description ?? "").length < 1200);
    let enriched = 0;
    for (let i = 0; i < toEnrich.length; i += 4) {
      await Promise.all(
        toEnrich.slice(i, i + 4).map(async (c) => {
          const full = await fetchFullDescription(c.job.apply_url || c.job.url);
          if (full && full.length > (c.job.description ?? "").length) {
            c.job.description = full;
            enriched++;
          }
        }),
      );
    }
    if (enriched) log(`fetched full descriptions for ${enriched} jobs`);

    const preferences = await feedbackContext(admin, userId);
    const vectorFor = new Map(ranked.map((c) => [c.job.url, c]));
    const { scored, dropped, providers } = await scoreJobs(profile, ranked, log, 8, preferences);
    stats.scored = scored.length;
    stats.dropped = dropped;
    stats.providers = providers;

    // 8. Store (each insert streams to the app).
    stats.stage = "Saving matches";
    if (scored.length) {
      const rows = scored.map((j) => {
        const url = normalizeUrl(j.url);
        const c = vectorFor.get(j.url);
        return {
          user_id: userId,
          source: j.source,
          external_id: j.external_id ?? null,
          url,
          url_hash: hash(url),
          dedupe_key: dedupeKey({ title: j.title, company: j.company, url }),
          apply_url: j.apply_url ?? null,
          ats: detectAts(j.apply_url ?? url),
          search_id: opts.searchId ?? null,
          title: j.title.slice(0, 300),
          company: j.company?.slice(0, 200) ?? null,
          company_domain: j.company_domain ?? domainOf(j.apply_url ?? url),
          company_logo: j.company_logo ?? null,
          location: j.location?.slice(0, 200) ?? null,
          remote: j.remote ?? null,
          employment_type: j.employment_type ?? null,
          seniority: j.seniority ?? null,
          salary: j.salary ?? null,
          description: j.description?.slice(0, 6000) ?? null,
          posted_at: j.posted_at ?? null,
          score: j.score,
          verdict: j.verdict,
          reasons: j.reasons,
          concerns: j.concerns,
          tags: (j.tags ?? []).slice(0, 10),
          status: !live && j.score < 35 ? "archived" : "new",
          embedding: c?.vector && embeddingModel ? toPgVector(c.vector) : null,
          embedding_model: c?.vector ? (embeddingModel ?? null) : null,
          semantic_score: c?.semantic ?? null,
        };
      });
      const { data: inserted, error } = await admin
        .from("jobs")
        .upsert(rows, { onConflict: "user_id,url_hash", ignoreDuplicates: true })
        .select("id, title, company, score");
      let ok: { id: string; title: string; company: string | null; score: number }[] = inserted ?? [];
      if (error) {
        // A dedupe_key clash aborts the whole batch; fall back to row-by-row inserts.
        log(`bulk insert failed (${error.message}); inserting individually`);
        ok = [];
        for (const row of rows) {
          const { data } = await admin.from("jobs").insert(row).select("id, title, company, score");
          if (data?.[0]) ok.push(data[0]);
        }
      }
      stats.inserted = ok.length;
      if (!live) await alert(ok);
    }

    async function alert(rows: { id: string; title: string; company: string | null; score: number }[]) {
      const min = opts.profile.job_alert_min_score ?? 75;
      const strong = rows.filter((r) => (r.score ?? 0) >= min).sort((a, b) => b.score - a.score);
      stats.strong = strong.length;
      if (!strong.length) return;
      const top = strong[0];
      await notify(opts.profile, {
        kind: "jobs",
        dedupeKey: `jobs:${runId ?? Date.now()}`,
        title: strong.length === 1 ? `New ${top.score}% match: ${top.title}` : `${strong.length} new strong job matches`,
        body:
          strong
            .slice(0, 3)
            .map((r) => `${r.title}${r.company ? ` · ${r.company}` : ""} (${r.score})`)
            .join("\n") + (strong.length > 3 ? `\n+${strong.length - 3} more` : ""),
        url: "/jobs",
        push: { tag: "jobs" },
      });
    }

    if (live && opts.searchId) {
      const { count } = await admin.from("jobs").select("id", { count: "exact", head: true }).eq("search_id", opts.searchId);
      await admin.from("searches").update({ last_run_at: new Date().toISOString(), result_count: count ?? stats.inserted }).eq("id", opts.searchId);
    }

    const anyError = Object.values(stats.sources).some((s) => s.error);
    stats.stage = undefined;
    stats.ms = Date.now() - started;
    await admin
      .from("job_search_runs")
      .update({ status: anyError ? "partial" : "ok", stats, finished_at: new Date().toISOString() })
      .eq("id", runId);
    return done(true, runId);
  } catch (e) {
    log(`fatal: ${(e as Error).message}`);
    stats.ms = Date.now() - started;
    await admin
      .from("job_search_runs")
      .update({ status: "error", stats, error: (e as Error).message, finished_at: new Date().toISOString() })
      .eq("id", runId);
    throw e;
  }
}
