import { z } from "zod";
import { handle, HttpError, requireUser } from "@/lib/auth";
import { factKey, FACT_KINDS } from "@/lib/memory/facts";
import { addRoutine, learnPreferences } from "@/lib/memory/personal";

export const maxDuration = 90;

const Body = z.discriminatedUnion("action", [
  /** Re-read your activity and what you told the AI now. */
  z.object({ action: z.literal("learn") }),
  /** Add a fact in your own words. */
  z.object({
    action: z.literal("add"),
    statement: z.string().trim().min(3).max(240),
    kind: z.enum(FACT_KINDS.map((k) => k.id) as [string, ...string[]]),
  }),
  /** Turn a timing fact into a planning routine (Plan my day then treats it as a rule). */
  z.object({ action: z.literal("routine"), id: z.string().uuid() }),
  /** Delete everything learned (keeps what you told it yourself). */
  z.object({ action: z.literal("forget-learned") }),
]);

export async function POST(request: Request) {
  return handle(async () => {
    const { user, supabase } = await requireUser();
    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new HttpError(400, "Invalid request");
    const b = parsed.data;
    if (b.action === "learn")
      return {
        ok: true,
        ...(await learnPreferences(user.id, { force: true })),
      };
    if (b.action === "add") {
      const { data, error } = await supabase
        .from("user_facts")
        .upsert(
          {
            user_id: user.id,
            statement: b.statement,
            key: factKey(b.statement),
            kind: b.kind,
            source: "you",
            status: "active",
            confidence: 100,
            evidence_count: 1,
            last_seen_at: new Date().toISOString(),
            evidence: [{ label: "You added it", at: new Date().toISOString() }],
          },
          { onConflict: "user_id,key" },
        )
        .select("*")
        .single();
      if (error) throw new HttpError(500, `${error.message} (did you run supabase/migrations/0005_planning_health_chat_memory.sql?)`);
      return { ok: true, fact: data };
    }
    if (b.action === "routine") {
      const { data: f } = await supabase.from("user_facts").select("routine").eq("id", b.id).maybeSingle();
      if (!f?.routine) throw new HttpError(404, "That memory has no time window to use.");
      if (!(await addRoutine(supabase, user.id, f.routine))) throw new HttpError(500, "Couldn't save the routine.");
      return { ok: true };
    }
    await supabase.from("user_facts").delete().eq("user_id", user.id).eq("source", "learned");
    await supabase.from("memory_inbox").delete().eq("user_id", user.id);
    await supabase.from("memory_questions").delete().eq("user_id", user.id).in("kind", ["confirm_fact", "fact_routine"]);
    return { ok: true };
  });
}
