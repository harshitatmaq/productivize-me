import { chatJson } from "@/lib/ai/llm";
import { handle, requireUser } from "@/lib/auth";
import { memoryContext } from "@/lib/memory/personal";
import type { JobAnalysis, JobProfile } from "@/lib/jobs/types";

export const maxDuration = 90;

export type LearningSuggestion = { topic: string; why: string; first_step: string; evidence: number };

const STOP = new Set(["experience", "team", "work", "years", "skills", "strong", "ability", "knowledge", "communication", "development", "engineering", "software"]);

/**
 * Turns your job search into a learning plan: gaps the AI found in job analyses
 * plus skills that keep appearing in strong matches but aren't on your profile.
 */
export async function POST() {
  return handle(async () => {
    const { user, supabase } = await requireUser();
    const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const [{ data: jobs }, { data: jp }, { data: recent }] = await Promise.all([
      supabase
        .from("jobs")
        .select("title, company, analysis, concerns, description, score, status")
        .gte("created_at", since)
        .gte("score", 65)
        .neq("status", "archived")
        .order("score", { ascending: false })
        .limit(60),
      supabase.from("job_profiles").select("profile").eq("user_id", user.id).maybeSingle(),
      supabase.from("learning_entries").select("title, tags").order("entry_date", { ascending: false }).limit(30),
    ]);
    const profile = (jp?.profile as JobProfile) ?? {};
    const have = new Set([...(profile.skills ?? []), ...(profile.tools ?? [])].map((s) => s.toLowerCase()));

    const gaps: string[] = [];
    const keywordCount = new Map<string, number>();
    for (const j of jobs ?? []) {
      const a = j.analysis as JobAnalysis | null;
      if (a?.gaps) gaps.push(...a.gaps.map((g) => `${g} (from ${j.title}${j.company ? ` @ ${j.company}` : ""})`));
      for (const c of (j.concerns as string[]) ?? []) gaps.push(c);
      for (const k of a?.keywords ?? []) {
        const key = k.toLowerCase().trim();
        if (key && !have.has(key) && !STOP.has(key)) keywordCount.set(key, (keywordCount.get(key) ?? 0) + 2);
      }
    }
    const frequent = [...keywordCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
    if (!gaps.length && !frequent.length) {
      return { ok: true, suggestions: [], message: "Analyze a few jobs with “Tailor with AI” — gaps from those turn into learning suggestions here." };
    }

    const memory = await memoryContext(supabase, user.id, "learning", 10);
    try {
      const { data } = await chatJson<{ suggestions: LearningSuggestion[] }>(
        {
          messages: [
            {
              role: "system",
              content: `You turn job-search skill gaps into a focused learning plan. Merge duplicates, skip soft fluff,
skip anything the learner already covers, and rank by how often it blocks good jobs.
Return ONLY JSON: {"suggestions":[{"topic":"short topic","why":"one line tying it to their target jobs","first_step":"a concrete 30-60 min first step","evidence":number_of_jobs_it_affects}]} (4-6 items).`,
            },
            {
              role: "user",
              content: `Target roles: ${(profile.target_titles ?? []).join(", ")}\nCurrent skills: ${[...have].slice(0, 40).join(", ")}\nRecently learned: ${(recent ?? []).map((r) => r.title).join("; ")}\n\nGaps from job analyses:\n${gaps.slice(0, 40).join("\n")}\n\nKeywords in strong matches missing from profile (count): ${frequent.map(([k, n]) => `${k} (${n})`).join(", ")}${memory.length ? `\n\nWhat you know about how they like to learn (fit first steps to this):\n- ${memory.join("\n- ")}` : ""}`,
            },
          ],
          temperature: 0.3,
          maxTokens: 1500,
          purpose: "learning-suggest",
        },
        (v) => {
          const arr = (v as { suggestions?: unknown }).suggestions;
          if (!Array.isArray(arr)) throw new Error("no suggestions");
          return { suggestions: (arr as LearningSuggestion[]).filter((s) => s.topic).slice(0, 6) };
        },
      );
      return { ok: true, suggestions: data.suggestions };
    } catch {
      return {
        ok: true,
        suggestions: frequent.slice(0, 5).map(([k, n]) => ({
          topic: k,
          why: `Shows up in ${Math.round(n / 2)} strong matches but isn't on your profile.`,
          first_step: `Spend 45 minutes on a hands-on intro to ${k}, then log what you learned.`,
          evidence: Math.round(n / 2),
        })),
      };
    }
  });
}
