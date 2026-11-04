import { z } from "zod";
import { chatJson } from "@/lib/ai/llm";
import { handle, HttpError, requireUser } from "@/lib/auth";

export const maxDuration = 90;

const Body = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  now: z.string().regex(/^\d{2}:\d{2}$/),
  dayEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  energy: z.enum(["low", "normal", "high"]).default("normal"),
});

export type DayPlan = {
  summary: string;
  blocks: { task_id: string; start: string; end: string; note?: string }[];
  defer: { task_id: string; reason: string }[];
  tips: string[];
};

/** "Plan my day": orders today's open tasks into time blocks around fixed-time items. */
export async function POST(request: Request) {
  return handle(async () => {
    const { supabase } = await requireUser();
    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new HttpError(400, "Invalid request");
    const { date, now, dayEnd, energy } = parsed.data;
    const { data: tasks } = await supabase
      .from("tasks")
      .select("id, title, priority, due_date, due_time, estimate_minutes, carry_count, tags")
      .eq("status", "todo")
      .lte("due_date", date)
      .limit(40);
    if (!tasks?.length) throw new HttpError(404, "Nothing planned for today yet.");
    const ids = new Set(tasks.map((t) => t.id));

    const { data } = await chatJson<DayPlan>(
      {
        messages: [
          {
            role: "system",
            content: `You are a calm, realistic day planner. Build a schedule for the rest of today.
Rules: keep tasks with a fixed time at that time; put urgent/high-priority and long-carried tasks earlier;
assume 30 minutes when there's no estimate; add short breaks; don't overfill — if it won't fit before the day ends,
put the lowest-value tasks in "defer". Energy level: ${energy}. Times are HH:MM 24h, starting no earlier than the current time.
Return ONLY JSON: {"summary":"1-2 sentences","blocks":[{"task_id":"…","start":"HH:MM","end":"HH:MM","note":"optional short tip"}],
"defer":[{"task_id":"…","reason":"…"}],"tips":["max 2 short tips"]}`,
          },
          {
            role: "user",
            content: `Now: ${now}. Day ends: ${dayEnd ?? "21:00"}.\nTasks:\n${tasks
              .map((t) =>
                JSON.stringify({
                  task_id: t.id,
                  title: t.title,
                  priority: t.priority,
                  fixed_time: t.due_time?.slice(0, 5) ?? undefined,
                  estimate_min: t.estimate_minutes ?? undefined,
                  overdue: t.due_date! < date || undefined,
                  carried: t.carry_count || undefined,
                  tags: t.tags.length ? t.tags : undefined,
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
          blocks: o.blocks.filter((b) => ids.has(b.task_id) && time.test(b.start) && time.test(b.end)),
          defer: (o.defer ?? []).filter((d) => ids.has(d.task_id)),
          tips: (o.tips ?? []).map(String).slice(0, 2),
        };
      },
    );
    return { ok: true, plan: data };
  });
}
