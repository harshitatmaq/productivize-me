import { describe, expect, it } from "vitest";
import { computeNextFire, describeRule } from "@/lib/recurrence";

const tz = "Asia/Kolkata";

describe("computeNextFire", () => {
  it("daily fires later today, else tomorrow", () => {
    const rule = { frequency: "daily" as const, time_of_day: "09:00", start_date: "2026-01-01" };
    expect(computeNextFire(rule, tz, new Date("2026-11-03T02:00:00Z"))!.toISOString()).toBe("2026-11-03T03:30:00.000Z");
    expect(computeNextFire(rule, tz, new Date("2026-11-03T04:00:00Z"))!.toISOString()).toBe("2026-11-04T03:30:00.000Z");
  });

  it("weekdays skip the weekend", () => {
    const rule = { frequency: "weekdays" as const, time_of_day: "08:00", start_date: "2026-01-01" };
    // Friday 2026-11-06 10:00 IST -> Monday 2026-11-09 08:00 IST
    expect(computeNextFire(rule, tz, new Date("2026-11-06T04:30:00Z"))!.toISOString()).toBe("2026-11-09T02:30:00.000Z");
  });

  it("weekly on chosen days", () => {
    const rule = { frequency: "weekly" as const, time_of_day: "18:00", days_of_week: [0, 3], start_date: "2026-01-01" };
    // Tue -> Wed
    expect(computeNextFire(rule, tz, new Date("2026-11-03T00:00:00Z"))!.toISOString()).toBe("2026-11-04T12:30:00.000Z");
  });

  it("monthly clamps to the last day", () => {
    const rule = { frequency: "monthly" as const, time_of_day: "10:00", day_of_month: 31, start_date: "2026-01-31" };
    expect(computeNextFire(rule, tz, new Date("2026-11-01T00:00:00Z"))!.toISOString()).toBe("2026-11-30T04:30:00.000Z");
  });

  it("yearly", () => {
    const rule = { frequency: "yearly" as const, time_of_day: "09:00", start_date: "2020-02-29" };
    expect(computeNextFire(rule, tz, new Date("2026-03-01T00:00:00Z"))!.toISOString()).toBe("2027-02-28T03:30:00.000Z");
  });

  it("once fires once then never", () => {
    const rule = { frequency: "once" as const, time_of_day: "15:00", start_date: "2026-11-05" };
    expect(computeNextFire(rule, tz, new Date("2026-11-03T00:00:00Z"))!.toISOString()).toBe("2026-11-05T09:30:00.000Z");
    expect(computeNextFire(rule, tz, new Date("2026-11-05T10:00:00Z"))).toBeNull();
  });

  it("describes rules", () => {
    expect(describeRule({ frequency: "weekly", time_of_day: "18:30", days_of_week: [1, 3], start_date: "2026-01-01" })).toBe(
      "Every Mon, Wed at 6:30 PM",
    );
  });
});
