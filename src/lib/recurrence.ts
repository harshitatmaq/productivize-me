import { addDays, daysInMonth, localDateStr, parseDateStr, weekdayOf, zonedToUtc } from "./time";

export type ReminderFrequency = "once" | "daily" | "weekdays" | "weekly" | "monthly" | "yearly";

export type ReminderRule = {
  frequency: ReminderFrequency;
  time_of_day: string; // HH:MM[:SS]
  days_of_week?: number[] | null; // 0 = Sun … 6 = Sat (weekly)
  day_of_month?: number | null; // monthly / yearly
  month_of_year?: number | null; // yearly (1-12)
  start_date: string; // YYYY-MM-DD; for "once" this is the date it fires
};

export function occursOn(rule: ReminderRule, dateStr: string): boolean {
  return matchesDay(rule, dateStr);
}

function matchesDay(rule: ReminderRule, dateStr: string): boolean {
  const wd = weekdayOf(dateStr);
  const { y, m, d } = parseDateStr(dateStr);
  switch (rule.frequency) {
    case "once":
      return dateStr === rule.start_date;
    case "daily":
      return true;
    case "weekdays":
      return wd >= 1 && wd <= 5;
    case "weekly": {
      const days = rule.days_of_week?.length ? rule.days_of_week : [weekdayOf(rule.start_date)];
      return days.includes(wd);
    }
    case "monthly": {
      const target = rule.day_of_month ?? parseDateStr(rule.start_date).d;
      // Clamp e.g. "31st" to the last day of shorter months.
      return d === Math.min(target, daysInMonth(y, m));
    }
    case "yearly": {
      const start = parseDateStr(rule.start_date);
      const month = rule.month_of_year ?? start.m;
      const target = rule.day_of_month ?? start.d;
      return m === month && d === Math.min(target, daysInMonth(y, m));
    }
  }
}

/**
 * Next time (strictly after `after`) the reminder should fire, or null if it never will again.
 */
export function computeNextFire(rule: ReminderRule, tz: string, after: Date = new Date()): Date | null {
  const time = (rule.time_of_day || "09:00").slice(0, 5);
  const startDay = rule.start_date;
  let day = localDateStr(after, tz);
  if (day < startDay) day = startDay;

  // 400 days covers every yearly rule, including Feb 29 clamping.
  for (let i = 0; i < 400; i++) {
    if (matchesDay(rule, day)) {
      const at = zonedToUtc(day, time, tz);
      if (at.getTime() > after.getTime()) return at;
    }
    if (rule.frequency === "once" && day > startDay) return null;
    day = addDays(day, 1);
  }
  return null;
}

export function describeRule(rule: ReminderRule): string {
  const t = formatTime12(rule.time_of_day);
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  switch (rule.frequency) {
    case "once":
      return `Once on ${rule.start_date} at ${t}`;
    case "daily":
      return `Every day at ${t}`;
    case "weekdays":
      return `Weekdays at ${t}`;
    case "weekly": {
      const days = rule.days_of_week?.length ? rule.days_of_week : [weekdayOf(rule.start_date)];
      return `Every ${[...days].sort().map((d) => names[d]).join(", ")} at ${t}`;
    }
    case "monthly":
      return `Monthly on day ${rule.day_of_month ?? parseDateStr(rule.start_date).d} at ${t}`;
    case "yearly": {
      const s = parseDateStr(rule.start_date);
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      return `Every ${months[(rule.month_of_year ?? s.m) - 1]} ${rule.day_of_month ?? s.d} at ${t}`;
    }
  }
}

export function formatTime12(time: string | null | undefined): string {
  if (!time) return "";
  const [hRaw, m] = time.split(":").map(Number);
  const h = hRaw % 24;
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, "0")} ${suffix}` : `${h12} ${suffix}`;
}
