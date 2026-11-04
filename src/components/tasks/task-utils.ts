import { addDays, diffDays, weekdayOf } from "@/lib/time";
import type { Task } from "@/lib/types";

export const PRIORITY_COLOR: Record<number, string> = {
  1: "var(--p1)",
  2: "var(--p2)",
  3: "var(--p3)",
  4: "var(--faint)",
};

export const PRIORITY_LABEL: Record<number, string> = { 1: "Urgent", 2: "High", 3: "Medium", 4: "None" };

const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function prettyDate(d: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) {
  return new Date(`${d}T12:00:00`).toLocaleDateString(undefined, opts);
}

export function dateLabel(d: string, today: string): string {
  const diff = diffDays(d, today);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 1 && diff < 7) return WEEKDAY_LONG[weekdayOf(d)];
  const sameYear = d.slice(0, 4) === today.slice(0, 4);
  return prettyDate(d, { weekday: "short", day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

export function formatTime(t: string | null | undefined): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: m ? "2-digit" : undefined });
}

export function sortTasks(a: Task, b: Task): number {
  if (a.due_date !== b.due_date) {
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date < b.due_date ? -1 : 1;
  }
  if (a.due_time !== b.due_time) {
    if (!a.due_time) return 1;
    if (!b.due_time) return -1;
    return a.due_time < b.due_time ? -1 : 1;
  }
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.sort_order - b.sort_order;
}

export function quickDates(today: string) {
  const wd = weekdayOf(today);
  const saturday = addDays(today, (6 - wd + 7) % 7 || 7);
  const nextMonday = addDays(today, ((1 - wd + 7) % 7) || 7);
  return {
    today,
    tomorrow: addDays(today, 1),
    weekend: wd === 6 || wd === 0 ? addDays(today, 1) : saturday,
    nextWeek: nextMonday,
  };
}

/** Local date + time -> ISO instant (browser time zone). */
export function localIso(date: string, time: string): string {
  return new Date(`${date}T${time.slice(0, 5)}:00`).toISOString();
}

export function isOverdue(t: Task, today: string) {
  return t.status === "todo" && !!t.due_date && t.due_date < today;
}

const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "daily", "every 2 weeks · Mon, Wed", "weekdays" … */
export function describeRecurrence(t: Pick<Task, "recurrence" | "recurrence_interval" | "recurrence_days">): string {
  if (!t.recurrence) return "";
  const n = t.recurrence_interval ?? 1;
  const unit = { daily: "day", weekly: "week", monthly: "month", yearly: "year", weekdays: "" }[t.recurrence];
  const base = t.recurrence === "weekdays" ? "weekdays" : n > 1 ? `every ${n} ${unit}s` : t.recurrence;
  const days = t.recurrence === "weekly" && t.recurrence_days?.length ? ` · ${[...t.recurrence_days].sort().map((d) => SHORT_DAYS[d]).join(", ")}` : "";
  return base + days;
}

export function formatMinutes(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}
