import { after } from "next/server";
import { z } from "zod";
import { embed, jobEmbeddingText, toPgVector } from "@/lib/ai/embeddings";
import { handle, HttpError, requireUser } from "@/lib/auth";
import { noteForMemory } from "@/lib/memory/personal";
import type { Profile } from "@/lib/cron/tick";
import { discoverBoard } from "@/lib/jobs/discover";
import { runJobSearch } from "@/lib/jobs/pipeline";
import { parseJobQuery } from "@/lib/jobs/query";
import { LIVE_SOURCE_IDS } from "@/lib/jobs/sources";
import type { JobProfile, WatchCompany } from "@/lib/jobs/types";
import { enqueue, workerOnline } from "@/lib/worker";

export const maxDuration = 300;

const Body = z.object({ query: z.string().trim().min(2).max(500), live: z.boolean().default(true) });

/**
 * Search & ask Scout. Returns matching jobs already stored (by meaning, instantly),
 * then starts a live search whose results stream into the app via Realtime.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const { user, supabase } = await requireUser();
    const parsedBody = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsedBody.success) throw new HttpError(400, "Type what you're looking for (2+ characters).");
    const { query, live } = parsedBody.data;

    const [{ data: jp }, { data: me }] = await Promise.all([
      supabase.from("job_profiles").select("profile, profile_embedding, watch_companies").eq("user_id", user.id).maybeSingle(),
      supabase.from("profiles").select("*").eq("id", user.id).single<Profile>(),
    ]);
    if (!me) throw new HttpError(404, "Profile not found");
    const profile = (jp?.profile as JobProfile) ?? {};
    void noteForMemory(supabase, user.id, "job-search", query);
    const plan = await parseJobQuery(query, profile);

    const { data: search, error } = await supabase.from("searches").insert({ query, plan }).select("*").single();
    if (error) throw new HttpError(500, error.message);

    // 1. Instant: semantic match over jobs Scout already found.
    let stored: { id: string; similarity: number }[] = [];
    const model = (jp?.profile_embedding as { model?: string } | null)?.model;
    const vec = await embed([jobEmbeddingText({ title: plan.titles.join(" / "), description: `${query}\n${plan.keywords.join(", ")}` })], model);
    if (vec) {
      const { data } = await supabase.rpc("match_jobs", { p_embedding: toPgVector(vec.vectors[0]), p_model: vec.model, p_count: 40 });
      stored = ((data ?? []) as { id: string; similarity: number }[]).filter((r) => r.similarity >= 0.45);
    }
    if (stored.length < 5) {
      // Keyword fallback when embeddings aren't configured or found little.
      const words = plan.titles.flatMap((t) => t.split(/\s+/)).filter((w) => w.length > 3).slice(0, 4);
      if (words.length) {
        const { data } = await supabase
          .from("jobs")
          .select("id")
          .neq("status", "archived")
          .or(words.map((w) => `title.ilike.%${w.replace(/[%,()]/g, "")}%`).join(","))
          .order("score", { ascending: false })
          .limit(40);
        const seen = new Set(stored.map((s) => s.id));
        stored.push(...(data ?? []).filter((r) => !seen.has(r.id)).map((r) => ({ id: r.id as string, similarity: 0 })));
      }
    }

    // 2. Live search: on the worker when one is online (JobSpy etc.), otherwise inline with web + boards.
    let mode: "worker" | "inline" | "none" = "none";
    if (live) {
      // Named companies → look up their public boards for this search.
      const extraBoards: WatchCompany[] = [];
      for (const c of plan.companies.slice(0, 5)) {
        const b = await discoverBoard(c).catch(() => null);
        if (b) extraBoards.push(b);
      }
      const payload = { userId: user.id, searchId: search.id, plan, extraBoards };
      if (await workerOnline()) {
        const id = await enqueue("live_search", payload, { userId: user.id, priority: 1 });
        mode = id ? "worker" : "none";
      }
      if (mode === "none") {
        mode = "inline";
        after(async () => {
          try {
            await runJobSearch(user.id, {
              trigger: "live",
              profile: me,
              planOverride: plan,
              searchId: search.id,
              onlySources: [...LIVE_SOURCE_IDS, ...(extraBoards.length ? ["ats"] : [])],
              extraBoards,
            });
          } catch (e) {
            console.error("[query] live search failed", e);
          }
        });
      }
    }

    return { ok: true, search, plan, stored, mode };
  });
}
