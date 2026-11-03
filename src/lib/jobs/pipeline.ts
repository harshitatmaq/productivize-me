import "server-only";

import { envInt } from "@/lib/env";
import { notify, type NotifyProfile } from "@/lib/notify";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { toPgVector } from "@/lib/ai/embeddings";
import { dedupeKey, domainOf, hash, normalizeUrl, relevance } from "./normalize";
import { discoverBoards, type DiscoveryLog } from "./discover";
import { fetchFullDescription } from "./enrich";
import { buildSearchPlan } from "./profile";
import { feedbackContext, semanticRank, type Candidate } from "./rank";
import { scoreJobs } from "./scoring";
import { JOB_SOURCES } from "./sources";
import type { JobProfile, RawJob, SearchPlan, WatchCompany } from "./types";

export type RunStats = {
  sources: Record<string, { fetched: number; error?: string; skipped?: string }>;
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

const PLAN_MAX_AGE_MS = 24 * 3_600_000;

/** Runs one search for one user. Safe to call concurrently from cron and "search now". */
export async function runJobSearch(
  userId: string,
  opts: { trigger: "cron" | "manual"; profile: NotifyProfile & { job_alert_min_score: number } },
): Promise<RunStats> {
  const started = Date.now();
  const admin = supabaseAdmin();
  const manual = opts.trigger === "manual";
  const stats: RunStats = {
    sources: {},
    fetched: 0,
    unique: 0,
    fresh: 0,
    scored: 0,
    dropped: 0,
    inserted: 0,
    strong: 0,
    providers: [],
    log: [],
    ms: 0,
  };
  const log = (m: string) => stats.log.push(m.slice(0, 300));

  const { data: jp } = await admin.from("job_profiles").select("*").eq("user_id", userId).maybeSingle<JobProfileRow>();
  if (!jp || jp.status !== "ready") {
    log("profile not ready — finish onboarding first");
    stats.ms = Date.now() - started;
    return stats;
  }

  // Avoid double runs when both pg_cron and another scheduler call in the same hour.
  if (!manual && jp.last_search_at && Date.now() - Date.parse(jp.last_search_at) < 45 * 60_000) {
    log("ran less than 45 minutes ago — skipping");
    stats.ms = Date.now() - started;
    return stats;
  }

  const { data: run } = await admin
    .from("job_search_runs")
    .insert({ user_id: userId, trigger: opts.trigger, status: "running" })
    .select("id")
    .single();
  await admin.from("job_profiles").update({ last_search_at: new Date().toISOString() }).eq("user_id", userId);

  try {
    // 1. Search plan (refreshed daily or when the profile changes)
    let plan = jp.search_plan as SearchPlan;
    const stale =
      !plan?.titles?.length ||
      !jp.search_plan_at ||
      Date.now() - Date.parse(jp.search_plan_at) > PLAN_MAX_AGE_MS ||
      (!!jp.profile_updated_at && Date.parse(jp.profile_updated_at) > Date.parse(jp.search_plan_at));
    if (stale) {
      plan = await buildSearchPlan(jp.profile);
      await admin
        .from("job_profiles")
        .update({ search_plan: plan, search_plan_at: new Date().toISOString() })
        .eq("user_id", userId);
      log(`search plan refreshed: ${plan.titles.join(", ")}`);
    }

    // 1b. Find public job boards for "dream companies" (each company is probed once; misses retried monthly)
    let watch = jp.watch_companies ?? [];
    if (jp.profile.target_companies?.length) {
      const { log: dlog, found } = await discoverBoards(jp.profile.target_companies, jp.ats_discovery ?? {}, watch);
      if (found.length || Object.keys(dlog).length !== Object.keys(jp.ats_discovery ?? {}).length) {
        watch = [...watch, ...found];
        await admin.from("job_profiles").update({ ats_discovery: dlog, watch_companies: watch }).eq("user_id", userId);
        if (found.length) log(`found career boards: ${found.map((f) => `${f.name} (${f.ats})`).join(", ")}`);
      }
    }

    // 2. Fetch from every source that is due
    const stateKeys = JOB_SOURCES.map((s) => `${userId}:${s.id}`);
    const { data: states } = await admin.from("source_state").select("*").in("key", stateKeys);
    const stateMap = new Map((states ?? []).map((s) => [s.key as string, s]));
    const disabled = new Set(jp.disabled_sources ?? []);

    const due = JOB_SOURCES.filter((s) => {
      if (disabled.has(s.id)) {
        stats.sources[s.id] = { fetched: 0, skipped: "disabled" };
        return false;
      }
      if (!s.configured()) {
        stats.sources[s.id] = { fetched: 0, skipped: "no API key" };
        return false;
      }
      if (s.id === "ats" && !watch.length) {
        stats.sources[s.id] = { fetched: 0, skipped: "no watched companies" };
        return false;
      }
      const st = stateMap.get(`${userId}:${s.id}`);
      const last = st?.last_run_at ? Date.parse(st.last_run_at) : 0;
      const minGap = manual ? Math.min(s.minIntervalMin, 10) : s.minIntervalMin;
      if (Date.now() - last < minGap * 60_000) {
        stats.sources[s.id] = { fetched: 0, skipped: "ran recently" };
        return false;
      }
      return true;
    });

    const results = await Promise.allSettled(
      due.map(async (s) => {
        const st = stateMap.get(`${userId}:${s.id}`);
        const cursor = Number((st?.data as { cursor?: number })?.cursor ?? 0);
        const jobs = await s.fetch({ plan, watch, manual, cursor, log });
        await admin.from("source_state").upsert({
          key: `${userId}:${s.id}`,
          last_run_at: new Date().toISOString(),
          data: { cursor: cursor + 1, last_count: jobs.length },
        });
        return jobs;
      }),
    );

    const all: RawJob[] = [];
    results.forEach((r, i) => {
      const id = due[i].id;
      if (r.status === "fulfilled") {
        stats.sources[id] = { fetched: r.value.length };
        all.push(...r.value);
      } else {
        stats.sources[id] = { fetched: 0, error: (r.reason as Error).message.slice(0, 200) };
      }
    });
    stats.fetched = all.length;

    // 3. Normalise + de-duplicate within this batch
    const byKey = new Map<string, RawJob & { url_hash: string; dedupe_key: string }>();
    for (const j of all) {
      if (!j.url || !j.title) continue;
      const url = normalizeUrl(j.url);
      const item = { ...j, url, url_hash: hash(url), dedupe_key: dedupeKey({ ...j, url }) };
      if (!byKey.has(item.dedupe_key)) byKey.set(item.dedupe_key, item);
    }
    const unique = [...byKey.values()];
    stats.unique = unique.length;

    // 4. Drop anything already stored for this user
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

    // 5. Keyword pre-filter → semantic re-rank (embeddings + your 👍/👎) → full descriptions → LLM scoring
    const maxScore = envInt("JOBS_MAX_SCORED_PER_RUN", manual ? 40 : 32);
    const minRel = Number(process.env.JOBS_MIN_RELEVANCE ?? 0.3);
    const keywordPool: Candidate[] = fresh
      .map((job) => ({ job, rel: job.needs_extraction ? Math.max(relevance(job, plan, jp.profile), 0.45) : relevance(job, plan, jp.profile) }))
      .filter((x) => x.rel >= minRel * 0.6)
      .sort((a, b) => b.rel - a.rel)
      .slice(0, 120);
    const { ranked: reranked, model: embeddingModel } = await semanticRank(admin, userId, jp.profile, jp.profile_embedding, keywordPool, log);
    const ranked = reranked.filter((x) => x.rel >= minRel).slice(0, maxScore);

    const enrichCount = envInt("JOBS_ENRICH_PER_RUN", manual ? 10 : 8);
    const toEnrich = ranked.slice(0, enrichCount).filter((c) => (c.job.description ?? "").length < 1200);
    let enriched = 0;
    for (let i = 0; i < toEnrich.length; i += 4) {
      await Promise.all(
        toEnrich.slice(i, i + 4).map(async (c) => {
          const full = await fetchFullDescription(c.job.url);
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
    const { scored, dropped, providers } = await scoreJobs(jp.profile, ranked, log, 8, preferences);
    stats.scored = scored.length;
    stats.dropped = dropped;
    stats.providers = providers;

    // 6. Store
    if (scored.length) {
      const rows = scored.map((j) => {
        const url = normalizeUrl(j.url);
        return {
          user_id: userId,
          source: j.source,
          external_id: j.external_id ?? null,
          url,
          url_hash: hash(url),
          dedupe_key: dedupeKey({ title: j.title, company: j.company, url }),
          title: j.title.slice(0, 300),
          company: j.company?.slice(0, 200) ?? null,
          company_domain: j.company_domain ?? domainOf(url),
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
          status: j.score < 35 ? "archived" : "new",
          embedding: vectorFor.get(j.url)?.vector && embeddingModel ? toPgVector(vectorFor.get(j.url)!.vector!) : null,
          embedding_model: vectorFor.get(j.url)?.vector ? (embeddingModel ?? null) : null,
          semantic_score: vectorFor.get(j.url)?.semantic ?? null,
        };
      });
      const { data: inserted, error } = await admin
        .from("jobs")
        .upsert(rows, { onConflict: "user_id,url_hash", ignoreDuplicates: true })
        .select("id, title, company, score");
      if (error) {
        // A dedupe_key clash aborts the whole batch; fall back to row-by-row inserts.
        log(`bulk insert failed (${error.message}); inserting individually`);
        const ok: { id: string; title: string; company: string | null; score: number }[] = [];
        for (const row of rows) {
          const { data } = await admin.from("jobs").insert(row).select("id, title, company, score");
          if (data?.[0]) ok.push(data[0]);
        }
        stats.inserted = ok.length;
        await alert(ok);
      } else {
        stats.inserted = inserted?.length ?? 0;
        await alert(inserted ?? []);
      }
    }

    async function alert(rows: { id: string; title: string; company: string | null; score: number }[]) {
      const min = opts.profile.job_alert_min_score ?? 75;
      const strong = rows.filter((r) => (r.score ?? 0) >= min).sort((a, b) => b.score - a.score);
      stats.strong = strong.length;
      if (!strong.length) return;
      const top = strong[0];
      await notify(opts.profile, {
        kind: "jobs",
        dedupeKey: `jobs:${run?.id ?? Date.now()}`,
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

    const anyError = Object.values(stats.sources).some((s) => s.error);
    stats.ms = Date.now() - started;
    await admin
      .from("job_search_runs")
      .update({ status: anyError ? "partial" : "ok", stats, finished_at: new Date().toISOString() })
      .eq("id", run?.id);
    return stats;
  } catch (e) {
    stats.ms = Date.now() - started;
    log(`fatal: ${(e as Error).message}`);
    await admin
      .from("job_search_runs")
      .update({ status: "error", stats, error: (e as Error).message, finished_at: new Date().toISOString() })
      .eq("id", run?.id);
    throw e;
  }
}
