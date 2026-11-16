import { z } from "zod";
import { chatJson } from "@/lib/ai/llm";
import { handle, HttpError, requireUser } from "@/lib/auth";
import { describeDraft, normalizeDrafts, normalizeQuestions, type ClarifyingQuestion, type DraftTask } from "@/lib/day-capture";
import { memoryContext, noteForMemory } from "@/lib/memory/personal";
import { describePrefs, sanitizePrefs } from "@/lib/planning";

export const maxDuration = 90;

const Draft = z.object({ title: z.string(), due_date: z.string().nullable(), due_time: z.string().nullable() }).passthrough();
const Body = z.object({
  text: z.string().trim().min(3).max(4000),
  /** Today in your time zone, and the time now. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  now: z.string().regex(/^\d{2}:\d{2}$/),
  weekday: z.number().int().min(0).max(6),
  /** Your answers to its questions, when revising. */
  answers: z.array(z.object({ question: z.string().max(240), answer: z.string().trim().max(300) })).max(5).optional(),
  /** The list being revised. */
  previous: z.array(Draft).max(40).optional(),
});

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export type FromTextResult = { tasks: DraftTask[]; questions: ClarifyingQuestion[]; summary: string };

/** "Describe your day": one message → a list of tasks (with up to 3 clarifying questions). */
export async function POST(request: Request) {
  return handle(async () => {
    const { user, supabase } = await requireUser();
    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new HttpError(400, "Write a few words about your tasks.");
    const { text, date, now, weekday, answers, previous } = parsed.data;
    const [{ data: me }, memory] = await Promise.all([supabase.from("profiles").select("planning").eq("id", user.id).maybeSingle(), memoryContext(supabase, user.id, "planning", 10)]);
    const prefs = sanitizePrefs(me?.planning);
    const rules = describePrefs(prefs, weekday);
    if (!answers?.length) void noteForMemory(supabase, user.id, "describe-day", text);

    const { data } = await chatJson<{ tasks: unknown; questions: unknown; summary?: unknown }>(
      {
        purpose: "tasks-from-text",
        temperature: 0.2,
        maxTokens: 2500,
        deadlineMs: 60_000,
        messages: [
          {
            role: "system",
            content: `You turn a person's message about their day into a clean task list for their to-do app.
Today is ${DAYS[weekday]} ${date}; it is now ${now}. Resolve relative dates ("tomorrow", "Friday", "next week") to YYYY-MM-DD.
For each separate thing to do, make one task:
- "title": short and specific, starting with a verb, keeping names and details ("Call Priya about the referral"). No date/time words in the title.
- "date": YYYY-MM-DD. Things with no day mentioned are for today. Use null only for "someday / no date".
- "time": HH:MM 24h only if they gave one or a clear part of day (morning 09:00, noon 12:00, after lunch 14:00, evening 18:30, tonight 21:00), else null.
- "estimate_min": minutes if they said how long, or if obvious (a call ~15, a workout ~60); else null.
- "priority": 1 urgent/deadline today, 2 important, 3 nice to do, 4 normal (default).
- "tags": 0-2 lowercase words like work, jobs, learning, health, home, errands, family.
- "repeat": only if they said it repeats, in words: "every day", "every weekday", "every Mon and Thu", "every 2 weeks"; else null.
- "notes": extra details they gave, else null.
Ask a question ONLY when guessing would likely make a task wrong (e.g. which day, or whether something is one task or two). At most 3 questions, each with 2-4 short options. Still return your best-guess tasks.
${answers?.length ? "They answered your questions below: apply the answers and do not ask again." : ""}
Return ONLY JSON: {"tasks":[{"title":"…","date":"YYYY-MM-DD"|null,"time":"HH:MM"|null,"estimate_min":number|null,"priority":1-4,"tags":["…"],"repeat":"…"|null,"notes":"…"|null}],"questions":[{"id":"q1","question":"…","options":["…"]}],"summary":"one short sentence"}`,
          },
          {
            role: "user",
            content: [
              rules.length ? `Their routines and preferences (use for vague times):\n- ${rules.join("\n- ")}` : "",
              memory.length ? `What you know about how they work:\n- ${memory.join("\n- ")}` : "",
              `Their message:\n${text}`,
              previous?.length ? `Your previous list:\n${(previous as DraftTask[]).map((d) => `- ${describeDraft({ ...d, tags: d.tags ?? [], priority: d.priority ?? 4 } as DraftTask)}`).join("\n")}` : "",
              answers?.length ? `Their answers:\n${answers.map((a) => `- ${a.question} → ${a.answer}`).join("\n")}` : "",
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
        ],
      },
      (v) => {
        const o = v as { tasks?: unknown };
        if (!Array.isArray(o.tasks)) throw new Error("no tasks array");
        return v as { tasks: unknown; questions: unknown; summary?: unknown };
      },
    );
    const tasks = normalizeDrafts(data.tasks, { today: date, prefs });
    if (!tasks.length) throw new HttpError(422, "I couldn't find any tasks in that. Try listing them like “gym at 7, finish the report, call mom tonight”.");
    const result: FromTextResult = { tasks, questions: answers?.length ? [] : normalizeQuestions(data.questions), summary: typeof data.summary === "string" ? data.summary.slice(0, 300) : "" };
    return result;
  });
}
