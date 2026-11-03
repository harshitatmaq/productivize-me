import * as chrono from "chrono-node";

export type TaskRecurrence = "daily" | "weekdays" | "weekly" | "monthly" | "yearly";

export type QuickAddResult = {
  title: string;
  due_date: string | null;
  due_time: string | null;
  priority: 1 | 2 | 3 | 4;
  tags: string[];
  recurrence: TaskRecurrence | null;
  estimate_minutes: number | null;
};

const pad = (n: number) => String(n).padStart(2, "0");
const toDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const RECURRENCE_PATTERNS: [RegExp, TaskRecurrence][] = [
  [/\b(every\s*day|daily|everyday)\b/i, "daily"],
  [/\b(every\s*weekday|weekdays|on\s+weekdays)\b/i, "weekdays"],
  [/\b(every\s*week|weekly)\b/i, "weekly"],
  [/\b(every\s*month|monthly)\b/i, "monthly"],
  [/\b(every\s*year|yearly|annually)\b/i, "yearly"],
];

const WEEKLY_DAY = /\bevery\s+(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/i;

/**
 * Parses quick-add text such as
 *   "Send resume to Priya tomorrow 6pm p1 #jobs ~30m"
 *   "Gym every weekday 7am #health"
 */
export function parseQuickAdd(input: string, ref: Date = new Date()): QuickAddResult {
  let text = ` ${input.trim()} `;
  let priority: QuickAddResult["priority"] = 4;
  let recurrence: TaskRecurrence | null = null;
  let estimate: number | null = null;
  const tags: string[] = [];

  // Priority: p1..p4 or !!! / !! / !
  text = text.replace(/\s(p[1-4])(?=\s)/i, (_, p: string) => {
    priority = Number(p[1]) as QuickAddResult["priority"];
    return " ";
  });
  text = text.replace(/\s(!{1,3})(?=\s)/, (_, bang: string) => {
    priority = (4 - bang.length) as QuickAddResult["priority"];
    return " ";
  });

  // Tags: #tag
  text = text.replace(/\s#([\p{L}\p{N}_-]+)/gu, (_, tag: string) => {
    tags.push(tag.toLowerCase());
    return " ";
  });

  // Estimate: ~30m, ~1h, ~1.5h
  text = text.replace(/\s~(\d+(?:\.\d+)?)\s*(m|min|mins|h|hr|hrs)(?=\s)/i, (_, n: string, unit: string) => {
    const v = parseFloat(n);
    estimate = Math.round(unit.toLowerCase().startsWith("h") ? v * 60 : v);
    return " ";
  });

  // "every monday" => weekly, starting next monday
  const weekly = text.match(WEEKLY_DAY);
  if (weekly) {
    recurrence = "weekly";
    text = text.replace(WEEKLY_DAY, ` ${weekly[1]} `);
  } else {
    for (const [re, rule] of RECURRENCE_PATTERNS) {
      if (re.test(text)) {
        recurrence = rule;
        text = text.replace(re, " ");
        break;
      }
    }
  }

  let due_date: string | null = null;
  let due_time: string | null = null;
  const results = chrono.parse(text, ref, { forwardDate: true });
  const hit = results[0];
  if (hit) {
    const start = hit.start;
    const date = start.date();
    due_date = toDateStr(date);
    if (start.isCertain("hour")) {
      due_time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }
    text = text.slice(0, hit.index) + " " + text.slice(hit.index + hit.text.length);
  }

  if (recurrence && !due_date) due_date = toDateStr(ref);

  const title = text
    .replace(/\s+/g, " ")
    .replace(/\s+(at|on|by)\s*$/i, "")
    .trim();

  return {
    title: title || input.trim(),
    due_date,
    due_time,
    priority,
    tags: Array.from(new Set(tags)),
    recurrence,
    estimate_minutes: estimate,
  };
}
