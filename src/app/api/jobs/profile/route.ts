import { after } from "next/server";
import { z } from "zod";
import { handle, HttpError, requireUser } from "@/lib/auth";
import { runJobSearch } from "@/lib/jobs/pipeline";
import { buildSearchPlan, sanitizeProfile, synthesizeProfile, type OnboardingTurn } from "@/lib/jobs/profile";
import type { JobProfile } from "@/lib/jobs/types";
import type { Profile } from "@/lib/cron/tick";

export const maxDuration = 300;

const Body = z.object({
  action: z.enum(["finalize", "save", "replan"]),
  profile: z.record(z.string(), z.unknown()).optional(),
});

/**
 * finalize: turn the interview into a complete profile, build the search plan and kick off the first search.
 * save:     store manual edits from the profile editor.
 * replan:   regenerate the search plan now.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const { user, supabase } = await requireUser();
    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new HttpError(400, "Invalid request");
    const { data: row } = await supabase.from("job_profiles").select("*").eq("user_id", user.id).maybeSingle();
    const current: JobProfile = (row?.profile as JobProfile) ?? {};

    if (parsed.data.action === "save") {
      const clean = { ...current, ...sanitizeProfile(parsed.data.profile) } as JobProfile;
      const { error } = await supabase
        .from("job_profiles")
        .upsert({ user_id: user.id, profile: clean, profile_updated_at: new Date().toISOString() });
      if (error) throw new HttpError(500, error.message);
      return { ok: true, profile: clean };
    }

    if (parsed.data.action === "replan") {
      const plan = await buildSearchPlan(current);
      await supabase.from("job_profiles").update({ search_plan: plan, search_plan_at: new Date().toISOString() }).eq("user_id", user.id);
      return { ok: true, plan };
    }

    // finalize
    const chat = ((row?.chat as OnboardingTurn[]) ?? []).map(({ role, content }) => ({ role, content }));
    const profile = await synthesizeProfile({ history: chat, profile: current, resumeText: row?.resume_text });
    if (!profile.target_titles?.length && !profile.current_title) {
      throw new HttpError(422, "Scout still needs your target roles. Answer a couple more questions first.");
    }
    const plan = await buildSearchPlan(profile);
    const now = new Date().toISOString();
    const { error } = await supabase.from("job_profiles").upsert({
      user_id: user.id,
      profile,
      status: "ready",
      search_plan: plan,
      search_plan_at: now,
      profile_updated_at: now,
    });
    if (error) throw new HttpError(500, error.message);

    const { data: me } = await supabase.from("profiles").select("*").eq("id", user.id).single<Profile>();
    if (me) {
      after(async () => {
        try {
          await runJobSearch(user.id, { trigger: "manual", profile: me });
        } catch (e) {
          console.error("[jobs] first search failed", e);
        }
      });
    }
    return { ok: true, profile, plan };
  });
}
