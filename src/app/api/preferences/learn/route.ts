import { z } from "zod";
import { chatJson } from "@/lib/ai/llm";
import { handle, HttpError, requireUser } from "@/lib/auth";
import { sanitizePrefs, type PlanningPrefs, type Routine } from "@/lib/planning";

const Body = z.object({ text: z.string().trim().min(3).max(500) });

type Learned = {
  routines?: Omit<Routine, "id">[];
  wake?: string;
  sleep?: string;
  work?: { start: string; end: string; days: number[] };
  focus_peak?: "morning" | "afternoon" | "evening";
  note?: string;
  summary?: string;
};

/**
 * "Remember this": turns a sentence about how you like your day ("I read after
 * 10:30 PM and journal before bed") into saved planning preferences.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const { user, supabase } = await requireUser();
    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new HttpError(400, "Write a sentence about how you like your day.");
    const { text } = parsed.data;
    const { data: me } = await supabase.from("profiles").select("planning").eq("id", user.id).maybeSingle();
    const current = sanitizePrefs(me?.planning);

    let learned: Learned = {};
    try {
      const { data } = await chatJson<Learned>(
        {
          purpose: "preferences-learn",
          temperature: 0,
          maxTokens: 500,
          deadlineMs: 30_000,
          messages: [
            {
              role: "system",
              content: `Turn the person's sentence about their daily routine into JSON. Times are 24h HH:MM. Days: 0=Sun … 6=Sat (empty = every day).
Return ONLY JSON with any of: {"routines":[{"label":"short name","keywords":["words that would appear in matching task titles, lowercase, include synonyms"],"start":"HH:MM","end":"HH:MM","days":[]}],
"wake":"HH:MM","sleep":"HH:MM","work":{"start":"HH:MM","end":"HH:MM","days":[1,2,3,4,5]},"focus_peak":"morning"|"afternoon"|"evening",
"note":"anything that doesn't fit the fields, in their words","summary":"one short sentence confirming what you saved"}.
If they give a start but no end, make the window 60 minutes. "After 10:30 PM" means start 22:30.`,
            },
            { role: "user", content: text },
          ],
        },
        (v) => v as Learned,
      );
      learned = data ?? {};
    } catch {
      learned = { note: text, summary: "Saved to your notes — the AI reads them every time it plans your day." };
    }

    const next: PlanningPrefs = sanitizePrefs({
      ...current,
      wake: learned.wake ?? current.wake,
      sleep: learned.sleep ?? current.sleep,
      work: learned.work ?? current.work,
      focus_peak: learned.focus_peak ?? current.focus_peak,
      // A routine with the same name replaces the old one.
      routines: [
        ...(current.routines ?? []).filter((r) => !(learned.routines ?? []).some((n) => n.label?.toLowerCase() === r.label.toLowerCase())),
        ...(learned.routines ?? []),
      ],
      notes: learned.note && !(current.notes ?? "").includes(learned.note) ? [current.notes, learned.note].filter(Boolean).join("\n") : current.notes,
    });
    const { error } = await supabase.from("profiles").update({ planning: next }).eq("id", user.id);
    if (error) throw new HttpError(500, `${error.message} (did you run supabase/migrations/0005_planning_health_chat_memory.sql?)`);
    return { ok: true, planning: next, summary: learned.summary ?? "Saved." };
  });
}
