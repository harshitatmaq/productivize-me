import { z } from "zod";
import { chatJson } from "@/lib/ai/llm";
import { handle, HttpError, requireUser } from "@/lib/auth";
import { memoryContext, noteForMemory } from "@/lib/memory/personal";
import { describePrefs, earliestStart, enforcePlan, isPlanOwned, matchRoutine, sanitizePrefs, settleBlocks, toMin, typicalMinutes } from "@/lib/planning";

export const maxDuration = 90;

const Body = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  now: z.string().regex(/^\d{2}:\d{2}$/),
  dayEnd: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  energy: z.enum(["low", "normal", "high"]).default("normal"),
  /** 0 = Sunday … 6 = Saturday, in the browser's time zone. */
  weekday: z.number().int().min(0).max(6).optional(),
  /** "Azure needs 2 hours, start at 4, keep reading for tonight" — changes to make. */
  instruction: z.string().trim().max(500).optional(),
  /** The plan being changed, so the AI revises it instead of starting over. */
  previous: z
    .object({
      blocks: z.array(z.object({ task_id: z.string(), start: z.string(), end: z.string() })).max(60),
      defer: z
        .array(z.object({ task_id: z.string() }))
        .max(60)
        .default([]),
    })
    .optional(),
});

export type DayPlan = {
  summary: string;
  blocks: {
    task_id: string;
    start: string;
    end: string;
    note?: string;
    /** Total time the task needs, in minutes. */ estimate_min?: number;
  }[];
  defer: { task_id: string; reason: string }[];
  tips: string[];
  /** How many blocks were moved to honour your preferences. */
  adjusted?: number;
  /** The preferences the plan followed (shown in the dialog). */
  followed?: string[];
  /** What the AI knows about how you like to work (from Settings → What the AI knows). */
  memory?: string[];
};

/** "Plan my day": orders today's open tasks into time blocks around fixed-time items. */
export async function POST(request: Request) {
  return handle(async () => {
    const { user, supabase } = await requireUser();
    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new HttpError(400, "Invalid request");
    const { date, now, energy } = parsed.data;
    const weekday = parsed.data.weekday ?? new Date(`${date}T12:00:00`).getDay();
    const { data: me } = await supabase.from("profiles").select("planning, day_end_time").eq("id", user.id).maybeSingle();
    const prefs = sanitizePrefs(me?.planning);
    // Plan until bedtime when you've told us; otherwise until the end-of-day review time.
    const dayEnd =
      prefs.sleep && toMin(prefs.sleep) > toMin(now) ? prefs.sleep : (parsed.data.dayEnd ?? (me?.day_end_time as string | undefined)?.slice(0, 5) ?? "21:00");
    const rules = describePrefs(prefs, weekday);
    const cols = "id, title, priority, due_date, due_time, estimate_minutes, carry_count, tags";
    const open = (c: string) => supabase.from("tasks").select(c).eq("status", "todo").lte("due_date", date).limit(40);
    let res = await open(`${cols}, planned_time`);
    if (res.error) res = await open(cols); // before migration 0005 part 3
    type Row = {
      id: string;
      title: string;
      priority: number;
      due_date: string | null;
      due_time: string | null;
      estimate_minutes: number | null;
      carry_count: number;
      tags: string[];
      planned_time?: string | null;
    };
    const rows = (res.data ?? []) as unknown as Row[];
    if (!rows.length) throw new HttpError(404, "Nothing planned for today yet.");
    // Times an earlier plan set are free to move; times you set yourself are fixed.
    const tasks = rows.map((t) => (isPlanOwned(t) ? { ...t, due_time: null } : t));
    const fixed = new Set(tasks.filter((t) => t.due_time).map((t) => t.id));
    const ids = new Set(tasks.map((t) => t.id));
    const start = earliestStart(now);
    const instruction = parsed.data.instruction?.trim();
    const [{ data: history }, memory] = await Promise.all([
      supabase
        .from("tasks")
        .select("title, tags, actual_minutes")
        .eq("status", "done")
        .gt("actual_minutes", 0)
        .gte("completed_at", new Date(Date.now() - 120 * 86_400_000).toISOString())
        .limit(400),
      memoryContext(supabase, user.id, "planning", 15),
    ]);
    if (instruction) void noteForMemory(supabase, user.id, "plan-day", instruction);
    const previous = parsed.data.previous;

    const { data } = await chatJson<DayPlan>(
      {
        messages: [
          {
            role: "system",
            content: `You are a calm, realistic day planner. Build a schedule for the rest of today.
Rules: keep tasks with a fixed time at that time; put urgent/high-priority and long-carried tasks earlier;
Durations: give every task the time it REALLY needs. Use estimate_min when given, else typical_min (how long similar tasks took them), else judge from the title:
quick admin/messages 10-15 min; reading ~20 pages 30-40 min; a workout 45-75 min; studying a course chunk or "days 0-2" of a programme 90-180 min;
writing/building something 60-120 min. Never give everything the same length. One block per task, at most 120 min; if a task needs more,
schedule a 90-120 min session, set "estimate_min" to the full need, and say in the note how much remains.
The person's own preferences below are HARD rules — they override your general advice (e.g. if they read at night, never put reading at noon).
A task marked "routine" MUST be scheduled inside that routine's window, or deferred if the window has passed.
add 5-10 min breaks between long blocks; don't overfill — if it won't fit before the day ends,
put the lowest-value tasks in "defer". Energy level: ${energy}. Times are HH:MM 24h; the first block starts no earlier than ${start}.
Return ONLY JSON: {"summary":"1-2 sentences","blocks":[{"task_id":"…","start":"HH:MM","end":"HH:MM","estimate_min":total minutes the task needs,"note":"optional short tip"}],
"defer":[{"task_id":"…","reason":"…"}],"tips":["max 2 short tips"]}`,
          },
          {
            role: "user",
            content: `Now: ${now}. Start no earlier than ${start}. Day ends: ${dayEnd}.\n${rules.length ? `Their preferences:\n- ${rules.join("\n- ")}\n` : ""}${
              memory.length ? `What you know about how they like to work (softer than the preferences above):\n- ${memory.join("\n- ")}\n` : ""
            }${
              previous
                ? `Your previous plan (revise it, keep what they didn't ask to change):\n${previous.blocks.map((b) => `- ${b.task_id} ${b.start}-${b.end}`).join("\n")}${previous.defer.length ? `\nDeferred: ${previous.defer.map((d) => d.task_id).join(", ")}` : ""}\n`
                : ""
            }${instruction ? `THEY ASKED: "${instruction}" — do exactly this (it overrides your defaults, but never schedule past their bedtime).\n` : ""}Tasks:\n${tasks
              .map((t) =>
                JSON.stringify({
                  task_id: t.id,
                  title: t.title,
                  priority: t.priority,
                  fixed_time: t.due_time?.slice(0, 5) ?? undefined,
                  estimate_min: t.estimate_minutes ?? undefined,
                  typical_min: (!t.estimate_minutes && typicalMinutes(t, history ?? [])?.minutes) || undefined,
                  overdue: t.due_date! < date || undefined,
                  carried: t.carry_count || undefined,
                  tags: t.tags.length ? t.tags : undefined,
                  routine: (() => {
                    const r = matchRoutine(t, prefs.routines, weekday);
                    return r ? `${r.label} ${r.start}-${r.end}` : undefined;
                  })(),
                }),
              )
              .join("\n")}`,
          },
        ],
        temperature: 0.3,
        maxTokens: 2000,
        purpose: "plan-day",
      },
      (v) => {
        const o = v as Partial<DayPlan>;
        if (!Array.isArray(o.blocks)) throw new Error("no blocks");
        const time = /^\d{2}:\d{2}$/;
        return {
          summary: String(o.summary ?? ""),
          blocks: o.blocks
            .filter((b) => ids.has(b.task_id) && time.test(b.start) && time.test(b.end))
            .filter((b, i, all) => all.findIndex((x) => x.task_id === b.task_id) === i)
            .map((b) => ({
              ...b,
              estimate_min:
                Number.isFinite(Number(b.estimate_min)) && Number(b.estimate_min) > 0 ? Math.min(600, Math.round(Number(b.estimate_min))) : undefined,
            })),
          defer: (o.defer ?? []).filter((d) => ids.has(d.task_id)),
          tips: (o.tips ?? []).map(String).slice(0, 2),
        };
      },
    );
    // The AI's plan, corrected so it always follows your routines and bedtime.
    const enforced = enforcePlan(data, tasks, prefs, { now: start, weekday });
    // Nothing before a few minutes from now, no overlaps, fixed-time tasks untouched.
    const settled = settleBlocks(enforced.blocks, fixed, start);
    // Anything pushed past the end of the day (and not a routine of yours) goes to tomorrow.
    const endMin = toMin(dayEnd) > toMin(start) ? toMin(dayEnd) : 24 * 60;
    const routineTask = (id: string) => {
      const t = tasks.find((x) => x.id === id);
      return !!t && !!matchRoutine(t, prefs.routines, weekday);
    };
    const blocks = settled.filter((b) => fixed.has(b.task_id) || routineTask(b.task_id) || toMin(b.start) < endMin);
    const overflow = settled
      .filter((b) => !blocks.includes(b))
      .map((b) => ({
        task_id: b.task_id,
        reason: "Doesn't fit before your day ends",
      }));
    const plan: DayPlan = {
      ...data,
      blocks,
      defer: [...enforced.defer, ...overflow],
      adjusted: enforced.adjusted,
      followed: rules,
      memory,
    };
    return { ok: true, plan };
  });
}
