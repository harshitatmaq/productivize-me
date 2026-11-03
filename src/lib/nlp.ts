import * as chrono from "chrono-node";

export type TaskRecurrence = "daily" | "weekdays" | "weekly" | "monthly" | "yearly";

export type QuickAddResult = {
  title: string;
  due_date: string | null;
  due_time: string | null;
  priority: 1 | 2 | 3 | 4;
  tags: string[];
  recurrence: TaskRecurrence | null;
  /** "every 2 weeks" → 2 */
  recurrence_interval: number;
  /** Chosen weekdays for weekly repeats, 0 = Sunday … 6 = Saturday. */
  recurrence_days: number[];
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

const DAY_INDEX: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const INTERVAL = /\bevery\s+(other|\d{1,3})\s+(day|week|month|year)s?\b/i;
const DAY_NAME = "(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)";
const WEEKDAY_LIST = new RegExp(`\\bevery\\s+(${DAY_NAME}\\b(?:\\s*(?:,|and|&|\\/)\\s*${DAY_NAME}\\b)*)`, "i");
const WEEKLY_DAY_STRIP = (matched: string) => new RegExp(matched.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

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

  let interval = 1;
  let days: number[] = [];
  let dayStart: string | null = null;
  const every = text.match(INTERVAL);
  const dayList = text.match(WEEKDAY_LIST);
  if (every) {
    // "every 2 weeks", "every other day", "every 3 months"
    interval = every[1].toLowerCase() === "other" ? 2 : Math.max(1, Number(every[1]));
    const unit = every[2].toLowerCase();
    recurrence = unit === "day" ? "daily" : unit === "week" ? "weekly" : unit === "month" ? "monthly" : "yearly";
    text = text.replace(INTERVAL, " ");
  } else if (dayList) {
    // "every monday", "every mon, wed and fri" → weekly on those days, starting at the next one
    days = [...new Set((dayList[1].toLowerCase().match(/mon|tue|wed|thu|fri|sat|sun/g) ?? []).map((d) => DAY_INDEX[d]))].sort();
    recurrence = "weekly";
    text = text.replace(WEEKLY_DAY_STRIP(dayList[0]), " ");
    const start = new Date(ref);
    for (let i = 0; i < 7; i++) {
      if (days.includes(start.getDay())) break;
      start.setDate(start.getDate() + 1);
    }
    dayStart = toDateStr(start);
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

  if (dayStart && !due_date) due_date = dayStart;
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
    recurrence_interval: interval,
    recurrence_days: days,
    estimate_minutes: estimate,
  };
}
