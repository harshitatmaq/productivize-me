import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { centroid, cosine, embed, embeddingsConfigured, jobEmbeddingText, parseVector } from "@/lib/ai/embeddings";
import { hash } from "./normalize";
import { candidateBrief } from "./profile";
import type { JobProfile, RawJob } from "./types";

export type Candidate = { job: RawJob; rel: number; semantic?: number; vector?: number[] };

type ProfileEmbedding = { model: string; hash: string; vector: number[] } | null;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * Re-ranks keyword candidates by meaning: cosine similarity between the
 * profile and each job, nudged towards jobs like the ones you 👍 and away
 * from ones you 👎. Falls back to the keyword order if no embedding provider works.
 */
export async function semanticRank(
  admin: SupabaseClient,
  userId: string,
  profile: JobProfile,
  stored: ProfileEmbedding,
  candidates: Candidate[],
  log: (m: string) => void,
): Promise<{ ranked: Candidate[]; model?: string }> {
  if (!candidates.length || !embeddingsConfigured()) return { ranked: candidates };

  const profileText = `${candidateBrief(profile)}\n${profile.summary ?? ""}`.trim();
  const profileHash = hash(profileText);
  let profileVec = stored?.hash === profileHash ? stored : null;
  if (!profileVec) {
    const r = await embed([profileText], stored?.model);
    const r2 = r ?? (stored?.model ? await embed([profileText]) : null);
    if (!r2) {
      log("embeddings unavailable — using keyword ranking");
      return { ranked: candidates };
    }
    profileVec = { model: r2.model, hash: profileHash, vector: r2.vectors[0] };
    await admin.from("job_profiles").update({ profile_embedding: profileVec }).eq("user_id", userId);
  }
  const model = profileVec.model;

  const jobs = await embed(candidates.map((c) => jobEmbeddingText(c.job)), model);
  if (!jobs) {
    log(`embedding jobs with ${model} failed — using keyword ranking`);
    return { ranked: candidates };
  }

  // Learned taste from 👍 / 👎 (same embedding model only).
  const { data: fb } = await admin
    .from("jobs")
    .select("embedding, feedback")
    .eq("user_id", userId)
    .eq("embedding_model", model)
    .not("feedback", "is", null)
    .order("feedback_at", { ascending: false })
    .limit(80);
  const liked = centroid((fb ?? []).filter((r) => r.feedback === 1).map((r) => parseVector(r.embedding)).filter((v): v is number[] => !!v));
  const disliked = centroid((fb ?? []).filter((r) => r.feedback === -1).map((r) => parseVector(r.embedding)).filter((v): v is number[] => !!v));

  const ranked = candidates.map((c, i) => {
    const v = jobs.vectors[i];
    const sim = cosine(profileVec!.vector, v);
    const scaled = clamp01((sim - 0.25) / 0.5);
    const pref = (liked ? cosine(v, liked) : 0) - (disliked ? cosine(v, disliked) : 0);
    return { ...c, semantic: Math.round(sim * 1000) / 1000, vector: v, rel: clamp01(0.4 * c.rel + 0.6 * scaled + 0.15 * pref) };
  });
  ranked.sort((a, b) => b.rel - a.rel);
  log(`semantic ranking with ${model}${liked || disliked ? " + your feedback" : ""}`);
  return { ranked, model };
}

/** A short description of what the user liked / disliked, for the scoring prompt. */
export async function feedbackContext(admin: SupabaseClient, userId: string): Promise<string | undefined> {
  const { data } = await admin
    .from("jobs")
    .select("title, company, location, feedback, feedback_reason")
    .eq("user_id", userId)
    .not("feedback", "is", null)
    .order("feedback_at", { ascending: false })
    .limit(16);
  if (!data?.length) return undefined;
  const line = (j: (typeof data)[number]) =>
    `- ${j.title}${j.company ? ` @ ${j.company}` : ""}${j.location ? ` (${j.location})` : ""}${j.feedback_reason ? ` — reason: ${j.feedback_reason}` : ""}`;
  const liked = data.filter((j) => j.feedback === 1).slice(0, 8);
  const disliked = data.filter((j) => j.feedback === -1).slice(0, 8);
  return [
    liked.length ? `Liked:\n${liked.map(line).join("\n")}` : "",
    disliked.length ? `Not interested:\n${disliked.map(line).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
