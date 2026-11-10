import { z } from "zod";
import { handle, HttpError, requireUser } from "@/lib/auth";
import { memoryContext, noteForMemory } from "@/lib/memory/personal";
import { mergeProfile, onboardingTurn, type OnboardingTurn } from "@/lib/jobs/profile";
import type { JobProfile } from "@/lib/jobs/types";

export const maxDuration = 120;

const Body = z.object({
  message: z.string().max(20_000).optional(),
  restart: z.boolean().optional(),
});

type ChatItem = OnboardingTurn & { progress?: number; suggestions?: string[]; provider?: string };

/** One turn of the onboarding interview with the "Scout" agent. */
export async function POST(request: Request) {
  return handle(async () => {
    const { user, supabase } = await requireUser();
    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new HttpError(400, "Invalid request");

    const { data: row } = await supabase.from("job_profiles").select("*").eq("user_id", user.id).maybeSingle();
    let chat: ChatItem[] = parsed.data.restart ? [] : ((row?.chat as ChatItem[]) ?? []);
    const profile: JobProfile = (row?.profile as JobProfile) ?? {};
    const now = new Date().toISOString();

    if (parsed.data.message?.trim()) {
      chat = [...chat, { role: "user", content: parsed.data.message.trim(), at: now }];
      void noteForMemory(supabase, user.id, "scout-chat", parsed.data.message);
    }

    const turn = await onboardingTurn({
      history: chat.map(({ role, content }) => ({ role, content })),
      profile,
      resumeText: row?.resume_text,
      memory: await memoryContext(supabase, user.id, "jobs", 12),
    });
    const nextProfile = mergeProfile(profile, turn.profile_patch);
    chat = [
      ...chat,
      {
        role: "assistant",
        content: turn.reply,
        at: new Date().toISOString(),
        progress: turn.progress,
        suggestions: turn.suggestions,
        provider: turn.provider,
      },
    ];

    const patch = {
      user_id: user.id,
      chat,
      profile: nextProfile,
      profile_updated_at: new Date().toISOString(),
      status: row?.status === "ready" ? "ready" : "onboarding",
    };
    const { error } = await supabase.from("job_profiles").upsert(patch);
    if (error) throw new HttpError(500, error.message);

    return { reply: turn.reply, done: turn.done, progress: turn.progress, suggestions: turn.suggestions ?? [], profile: nextProfile, provider: turn.provider };
  });
}
