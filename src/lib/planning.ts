/**
 * Planning preferences: how you like your day to run. "Plan my day" (and time
 * suggestions in quick add) follow these — the AI gets them as hard rules, and
 * enforcePlan() corrects anything it gets wrong afterwards.
 *
 * Pure functions only (shared by the server route, the UI and tests).
 */

export type Routine = {
  id: string;
  /** What you call it: "Reading & journaling". */
  label: string;
  /** Words that identify matching tasks by title or tag: ["read", "book", "journal"]. */
  keywords: string[];
  start: string; // "22:30"
  end: string; // "23:30"
  /** 0 = Sunday … 6 = Saturday; empty = every day. */
  days?: number[];
};

export type PlanningPrefs = {
  wake?: string; // "07:00"
  sleep?: string; // "23:30"
  work?: { start: string; end: string; days: number[] } | null;
  focus_peak?: "morning" | "afternoon" | "evening" | null;
  routines?: Routine[];
  /** Anything else, in your own words: "No calls before 10. Gym is at 7am on weekdays." */
  notes?: string;
};

export const ROUTINE_TEMPLATES: Omit<Routine, "id">[] = [
  { label: "Reading & journaling", keywords: ["read", "reading", "book", "pages", "journal", "journaling"], start: "22:30", end: "23:30" },
  { label: "Workout", keywords: ["gym", "workout", "push day", "pull day", "leg day", "legs", "core", "run", "exercise"], start: "07:00", end: "08:00" },
  { label: "Deep work", keywords: ["deep work", "focus", "write", "study"], start: "10:00", end: "12:30" },
  { label: "Job applications", keywords: ["apply", "application", "resume", "recruiter", "#jobs"], start: "18:30", end: "19:30" },
];

export const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
};
export const toTime = (m: number) => {
  const c = Math.max(0, Math.min(24 * 60 - 1, Math.round(m)));
  return `${String(Math.floor(c / 60)).padStart(2, "0")}:${String(c % 60).padStart(2, "0")}`;
};
const isTime = (s: unknown): s is string => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** Keeps only well-formed values (input comes from the browser or an AI). */
export function sanitizePrefs(input: unknown): PlanningPrefs {
  const o = (input ?? {}) as Record<string, unknown>;
  const days = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : []);
  const work = o.work as Record<string, unknown> | null | undefined;
  return {
    wake: isTime(o.wake) ? o.wake : undefined,
    sleep: isTime(o.sleep) ? o.sleep : undefined,
    work: work && isTime(work.start) && isTime(work.end) ? { start: work.start, end: work.end, days: days(work.days) } : null,
    focus_peak: ["morning", "afternoon", "evening"].includes(o.focus_peak as string) ? (o.focus_peak as PlanningPrefs["focus_peak"]) : null,
    routines: (Array.isArray(o.routines) ? o.routines : [])
      .map((r) => r as Record<string, unknown>)
      .filter((r) => isTime(r.start) && isTime(r.end) && typeof r.label === "string" && r.label.trim())
      .slice(0, 20)
      .map((r, i) => ({
        id: typeof r.id === "string" && r.id ? r.id.slice(0, 40) : `r${Date.now().toString(36)}${i}`,
        label: String(r.label).trim().slice(0, 60),
        keywords: (Array.isArray(r.keywords) ? r.keywords : [])
          .map((k) => String(k).trim().toLowerCase())
          .filter(Boolean)
          .slice(0, 15),
        start: r.start as string,
        end: r.end as string,
        days: days(r.days),
      })),
    notes: typeof o.notes === "string" ? o.notes.slice(0, 2000) : undefined,
  };
}

type TaskLike = { title: string; tags?: string[] | null };

function hasWord(text: string, word: string) {
  const w = word.toLowerCase().replace(/^#/, "");
  if (!w) return false;
  const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, "i").test(text);
}

/** The routine a task belongs to (first match), considering the weekday. */
export function matchRoutine(task: TaskLike, routines: Routine[] = [], weekday?: number): Routine | null {
  const text = `${task.title} ${(task.tags ?? []).map((t) => `#${t} ${t}`).join(" ")}`.toLowerCase();
  for (const r of routines) {
    if (weekday !== undefined && r.days?.length && !r.days.includes(weekday)) continue;
    if (r.keywords.some((k) => (k.startsWith("#") ? (task.tags ?? []).map((t) => t.toLowerCase()).includes(k.slice(1)) : hasWord(text, k)))) return r;
  }
  return null;
}

/** Window in minutes; a window that crosses midnight ("23:00"–"00:30") ends at 23:59 for today's plan. */
function windowOf(r: Routine): [number, number] {
  const s = toMin(r.start);
  let e = toMin(r.end);
  if (e <= s) e = 24 * 60 - 1;
  return [s, e];
}

/** Human summary for prompts and the UI. */
export function describePrefs(p: PlanningPrefs, weekday: number): string[] {
  const out: string[] = [];
  if (p.wake) out.push(`Wakes up around ${p.wake}.`);
  if (p.sleep) out.push(`Goes to bed around ${p.sleep}; nothing should be scheduled after that.`);
  if (p.work && (!p.work.days.length || p.work.days.includes(weekday))) out.push(`Works ${p.work.start}–${p.work.end} today.`);
  if (p.focus_peak) out.push(`Best focus in the ${p.focus_peak} — put demanding tasks there.`);
  for (const r of p.routines ?? []) {
    if (r.days?.length && !r.days.includes(weekday)) continue;
    out.push(`${r.label} happens ${r.start}–${r.end}${r.keywords.length ? ` (tasks about: ${r.keywords.slice(0, 6).join(", ")})` : ""}.`);
  }
  if (p.notes?.trim()) out.push(`In their own words: ${p.notes.trim()}`);
  return out;
}

export type PlanBlock = { task_id: string; start: string; end: string; note?: string };
export type PlanDefer = { task_id: string; reason: string };
export type PlanTask = TaskLike & { id: string; due_time?: string | null; estimate_minutes?: number | null };

/**
 * Puts every task that matches a routine inside that routine's window (keeping
 * its length and avoiding overlaps between them), defers ones whose window has
 * already passed, and adds matching tasks the AI forgot. Fixed-time tasks stay.
 */
export function enforcePlan(
  plan: { blocks: PlanBlock[]; defer: PlanDefer[] },
  tasks: PlanTask[],
  prefs: PlanningPrefs,
  opts: { now: string; weekday: number },
): { blocks: PlanBlock[]; defer: PlanDefer[]; adjusted: number } {
  const routines = prefs.routines ?? [];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const now = toMin(opts.now);
  const cursor = new Map<string, number>(); // routine id → next free minute in its window
  const blocks: PlanBlock[] = [];
  const defer = [...plan.defer];
  let adjusted = 0;

  const place = (task: PlanTask, r: Routine, length: number): PlanBlock | null => {
    const [ws, we] = windowOf(r);
    const start = Math.max(cursor.get(r.id) ?? ws, ws, now);
    if (start + Math.min(length, 15) > we) return null; // window gone (or full)
    const end = Math.min(start + length, we);
    cursor.set(r.id, end);
    return { task_id: task.id, start: toTime(start), end: toTime(end), note: `Your ${r.label.toLowerCase()} time (${r.start}–${r.end})` };
  };

  const ordered = [...plan.blocks].sort((a, b) => toMin(a.start) - toMin(b.start));
  for (const b of ordered) {
    const task = byId.get(b.task_id);
    const r = task && !task.due_time ? matchRoutine(task, routines, opts.weekday) : null;
    if (!task || !r) {
      blocks.push(b);
      continue;
    }
    const [ws, we] = windowOf(r);
    const length = Math.max(15, toMin(b.end) - toMin(b.start) || task.estimate_minutes || 30);
    const s = toMin(b.start);
    const inside = s >= ws && s + Math.min(length, 15) <= we && s >= (cursor.get(r.id) ?? ws);
    if (inside) {
      cursor.set(r.id, Math.max(cursor.get(r.id) ?? ws, s + length));
      blocks.push(b);
      continue;
    }
    const moved = place(task, r, length);
    adjusted++;
    if (moved) blocks.push(moved);
    else defer.push({ task_id: task.id, reason: `Your ${r.label.toLowerCase()} time (${r.start}–${r.end}) has passed today` });
  }

  // Routine tasks the AI left out entirely (and didn't defer).
  const handled = new Set([...blocks.map((b) => b.task_id), ...defer.map((d) => d.task_id)]);
  for (const t of tasks) {
    if (handled.has(t.id) || t.due_time) continue;
    const r = matchRoutine(t, routines, opts.weekday);
    if (!r) continue;
    const moved = place(t, r, t.estimate_minutes || 30);
    adjusted++;
    if (moved) blocks.push(moved);
    else defer.push({ task_id: t.id, reason: `Your ${r.label.toLowerCase()} time (${r.start}–${r.end}) has passed today` });
  }

  // Nothing after bedtime.
  const sleep = prefs.sleep ? toMin(prefs.sleep) : null;
  const final: PlanBlock[] = [];
  for (const b of blocks) {
    const task = byId.get(b.task_id);
    const routineBlock = task && matchRoutine(task, routines, opts.weekday);
    if (sleep !== null && sleep > toMin(prefs.wake ?? "05:00") && toMin(b.start) >= sleep && !task?.due_time && !routineBlock) {
      defer.push({ task_id: b.task_id, reason: "Past your bedtime" });
      adjusted++;
      continue;
    }
    final.push(b);
  }
  final.sort((a, b) => toMin(a.start) - toMin(b.start));
  return { blocks: final, defer: defer.filter((d, i, all) => all.findIndex((x) => x.task_id === d.task_id) === i), adjusted };
}

/** Suggested time for a new task without one (quick add): its routine's start. */
export function suggestTime(task: TaskLike, prefs: PlanningPrefs | null | undefined, weekday?: number): { time: string; routine: Routine } | null {
  const r = matchRoutine(task, prefs?.routines ?? [], weekday);
  return r ? { time: r.start, routine: r } : null;
}
