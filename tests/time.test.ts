import { describe, expect, it } from "vitest";
import { addDays, diffDays, localDateStr, localTimeStr, startOfWeek, weekdayOf, zonedToUtc } from "@/lib/time";

describe("time helpers", () => {
  it("converts wall-clock time in a zone to UTC", () => {
    expect(zonedToUtc("2026-11-03", "21:00", "Asia/Kolkata").toISOString()).toBe("2026-11-03T15:30:00.000Z");
    expect(zonedToUtc("2026-07-01", "09:00", "America/New_York").toISOString()).toBe("2026-07-01T13:00:00.000Z");
    expect(zonedToUtc("2026-01-15", "09:00", "America/New_York").toISOString()).toBe("2026-01-15T14:00:00.000Z");
  });

  it("handles DST transitions", () => {
    // US spring-forward 2026-03-08: 02:30 does not exist; we land just after the gap.
    const d = zonedToUtc("2026-03-08", "03:30", "America/New_York");
    expect(d.toISOString()).toBe("2026-03-08T07:30:00.000Z");
    expect(localTimeStr(d, "America/New_York")).toBe("03:30");
  });

  it("formats local date/time", () => {
    const d = new Date("2026-11-03T20:00:00Z");
    expect(localDateStr(d, "Asia/Kolkata")).toBe("2026-11-04");
    expect(localTimeStr(d, "Asia/Kolkata")).toBe("01:30");
  });

  it("does date math on strings", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(diffDays("2026-11-10", "2026-11-03")).toBe(7);
    expect(weekdayOf("2026-11-03")).toBe(2); // Tuesday
    expect(startOfWeek("2026-11-03", 1)).toBe("2026-11-02");
    expect(startOfWeek("2026-11-03", 0)).toBe("2026-11-01");
    expect(startOfWeek("2026-11-08", 1)).toBe("2026-11-02"); // Sunday belongs to the Monday week
  });
});
