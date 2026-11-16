/**
 * "Describe your day": turns one message ("gym at 7, then finish the Azure SQL
 * module, call mom tonight, and every Monday plan the week") into tasks.
 * The AI splits and understands the message; these pure functions check its
 * answer, reuse the quick-add parser for repeats, and apply your routine times.
 */
import { parseQuickAdd, type TaskRecurrence } from "./nlp";
import { suggestTime, type PlanningPrefs } from "./planning";

export type DraftTask = {
  key: string;
  title: string;
  due_date: string | null;
  due_time: string | null;
  estimate_minutes: number | null;
  priority: 1 | 2 | 3 | 4;
  tags: string[];
  recurrence: TaskRecurrence | null;
  recurrence_interval: number;
  recurrence_days: number[];
  notes: string | null;
  /** Set when the time came from one of your routines, e.g. "Reading & journaling". */
  routine?: string;
};

export type ClarifyingQuestion = { id: string; question: string; options: string[] };

const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00`));
const isTime = (s: unknown): s is string => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

type RawTask = {
  title?: unknown;
  date?: unknown;
  time?: unknown;
  estimate_min?: unknown;
  priority?: unknown;
  tags?: unknown;
  repeat?: unknown;
  notes?: unknown;
};

/** Cleans up the AI's tasks: valid dates/times only, repeats via the quick-add parser, routine times for untimed tasks. */
export function normalizeDrafts(raw: unknown, opts: { today: string; prefs?: PlanningPrefs | null; max?: number }): DraftTask[] {
  const list = Array.isArray(raw) ? (raw as RawTask[]) : [];
  const out: DraftTask[] = [];
  for (const [i, t] of list.entries()) {
    if (out.length >= (opts.max ?? 40)) break;
    const title = String(t?.title ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
    if (title.length < 2) continue;
    let due_date = isDate(t.date) ? t.date : null;
    let due_time = isTime(t.time) ? t.time : null;
    const est = Math.round(Number(t.estimate_min));
    const pr = Math.round(Number(t.priority));
    const tags = (Array.isArray(t.tags) ? t.tags : [])
      .map((x) => String(x).toLowerCase().replace(/^#/, "").replace(/[^\p{L}\p{N}_-]/gu, ""))
      .filter(Boolean)
      .slice(0, 3);

    // Repeats use exactly the same rules as quick add ("every weekday", "every Mon and Thu", "every 2 weeks").
    let recurrence: TaskRecurrence | null = null;
    let recurrence_interval = 1;
    let recurrence_days: number[] = [];
    const repeat = typeof t.repeat === "string" ? t.repeat.trim().slice(0, 60) : "";
    if (repeat) {
      const ref = new Date(`${due_date ?? opts.today}T09:00:00`);
      const parsed = parseQuickAdd(`task ${/^every|daily|weekly|monthly|yearly|weekdays|annually/i.test(repeat) ? repeat : `every ${repeat}`}`, ref);
      if (parsed.recurrence) {
        recurrence = parsed.recurrence;
        recurrence_interval = parsed.recurrence_interval;
        recurrence_days = parsed.recurrence_days;
        if (!due_date) due_date = parsed.due_date ?? opts.today;
        if (!due_time && parsed.due_time) due_time = parsed.due_time;
      }
    }

    const draft: DraftTask = {
      key: `d${i}-${title.slice(0, 12)}`,
      title,
      due_date,
      due_time,
      estimate_minutes: Number.isFinite(est) && est > 0 && est <= 720 ? est : null,
      priority: (pr >= 1 && pr <= 4 ? pr : 4) as DraftTask["priority"],
      tags,
      recurrence,
      recurrence_interval,
      recurrence_days,
      notes: typeof t.notes === "string" && t.notes.trim() ? t.notes.trim().slice(0, 500) : null,
    };
    if (!draft.due_time && opts.prefs) {
      const s = suggestTime({ title: draft.title, tags: draft.tags }, opts.prefs, draft.due_date ? new Date(`${draft.due_date}T12:00:00`).getDay() : undefined);
      if (s) {
        draft.due_time = s.time;
        draft.routine = s.routine.label;
      }
    }
    out.push(draft);
  }
  return out;
}

export function normalizeQuestions(raw: unknown): ClarifyingQuestion[] {
  return (Array.isArray(raw) ? raw : [])
    .map((q, i) => {
      const o = (q ?? {}) as { id?: unknown; question?: unknown; options?: unknown };
      return {
        id: typeof o.id === "string" && o.id ? o.id.slice(0, 40) : `q${i}`,
        question: String(o.question ?? "").trim().slice(0, 240),
        options: (Array.isArray(o.options) ? o.options : []).map((x) => String(x).trim().slice(0, 60)).filter(Boolean).slice(0, 5),
      };
    })
    .filter((q) => q.question.length > 3)
    .slice(0, 3);
}

/** One line per draft for the AI when it revises the list after your answers. */
export function describeDraft(d: DraftTask): string {
  return [d.title, d.due_date, d.due_time, d.estimate_minutes ? `${d.estimate_minutes}m` : "", d.priority < 4 ? `p${d.priority}` : "", d.tags.map((t) => `#${t}`).join(" "), d.recurrence ? `repeats ${d.recurrence}` : ""].filter(Boolean).join(" · ");
}
