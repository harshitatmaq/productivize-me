/** Minimal iCalendar (RFC 5545) writer for the subscribable task/reminder feed. */

export type IcsEvent = {
  uid: string;
  summary: string;
  description?: string;
  url?: string;
  /** All-day when `time` is absent. */
  date: string; // YYYY-MM-DD
  time?: string | null; // HH:MM[:SS], wall time in the calendar's time zone
  durationMin?: number;
  rrule?: string | null;
  status?: "CONFIRMED" | "CANCELLED";
  categories?: string[];
};

export function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Lines longer than 75 octets are folded with CRLF + space. */
export function foldLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const compactDate = (d: string) => d.replace(/-/g, "");
const compactTime = (t: string) => `${t.slice(0, 2)}${t.slice(3, 5)}00`;

function nextDay(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day + 1)).toISOString().slice(0, 10);
}

export function stampUtc(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function buildCalendar(opts: { name: string; tz: string; events: IcsEvent[]; now?: Date }): string {
  const stamp = stampUtc(opts.now);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Productivize//Tasks//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(opts.name)}`,
    `X-WR-TIMEZONE:${opts.tz}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const e of opts.events) {
    lines.push("BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${stamp}`);
    if (e.time) {
      lines.push(`DTSTART;TZID=${opts.tz}:${compactDate(e.date)}T${compactTime(e.time)}`);
      lines.push(`DURATION:PT${Math.max(5, Math.round(e.durationMin ?? 30))}M`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${compactDate(e.date)}`, `DTEND;VALUE=DATE:${compactDate(nextDay(e.date))}`);
    }
    lines.push(`SUMMARY:${icsEscape(e.summary)}`);
    if (e.description) lines.push(`DESCRIPTION:${icsEscape(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    if (e.rrule) lines.push(`RRULE:${e.rrule}`);
    if (e.categories?.length) lines.push(`CATEGORIES:${e.categories.map(icsEscape).join(",")}`);
    lines.push(`STATUS:${e.status ?? "CONFIRMED"}`, "TRANSP:TRANSPARENT", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/** RRULE for a reminder or a recurring task. */
export function toRrule(r: {
  frequency: string;
  days_of_week?: number[] | null;
  day_of_month?: number | null;
  month_of_year?: number | null;
  interval?: number | null;
  start_date?: string;
}): string | null {
  const interval = r.interval && r.interval > 1 ? `;INTERVAL=${r.interval}` : "";
  switch (r.frequency) {
    case "daily":
      return `FREQ=DAILY${interval}`;
    case "weekdays":
      return "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
    case "weekly":
      return `FREQ=WEEKLY${interval}${r.days_of_week?.length ? `;BYDAY=${[...r.days_of_week].sort().map((d) => BYDAY[d]).join(",")}` : ""}`;
    case "monthly":
      return `FREQ=MONTHLY${interval}${r.day_of_month ? `;BYMONTHDAY=${r.day_of_month}` : ""}`;
    case "yearly": {
      const [, m, d] = (r.start_date ?? "").split("-").map(Number);
      const month = r.month_of_year ?? m;
      const day = r.day_of_month ?? d;
      return `FREQ=YEARLY${interval}${month ? `;BYMONTH=${month}` : ""}${day ? `;BYMONTHDAY=${day}` : ""}`;
    }
    default:
      return null;
  }
}
