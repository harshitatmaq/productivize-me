import { describe, expect, it } from "vitest";
import { e1rm, movingAverage, nextDayType, sessionsThisWeek, suggestNext, weeklyTrend, weekStreak, type WorkoutLite } from "@/lib/health";

const bench = { measure: "weight_reps" as const, target_sets: 3, reps_min: 6, reps_max: 8, increment: 2.5 };

describe("rotation", () => {
  it("picks the day after the last completed session; rest days don't advance it", () => {
    const w: WorkoutLite[] = [
      { date: "2026-11-07", day_type: "push", status: "done" },
      { date: "2026-11-08", day_type: null, status: "rest" },
      { date: "2026-11-09", day_type: "pull", status: "done" },
    ];
    expect(nextDayType(undefined, w)).toBe("legs");
    expect(nextDayType(undefined, [...w, { date: "2026-11-10", day_type: "legs", status: "done" }])).toBe("core");
    expect(nextDayType(undefined, [...w, { date: "2026-11-11", day_type: "core", status: "done" }, { date: "2026-11-10", day_type: "legs", status: "done" }])).toBe("push");
    expect(nextDayType(undefined, [])).toBe("push");
    // Logging today's session doesn't change what "today" was.
    expect(nextDayType(undefined, [...w, { date: "2026-11-10", day_type: "legs", status: "done" }], "2026-11-10")).toBe("legs");
  });
});

describe("double progression", () => {
  it("adds weight only when every set hits the top of the range", () => {
    expect(suggestNext(bench, [{ weight: 60, reps: 8 }, { weight: 60, reps: 8 }, { weight: 60, reps: 8 }])).toMatchObject({ weight: 62.5, reps: 6 });
    expect(suggestNext(bench, [{ weight: 60, reps: 8 }, { weight: 60, reps: 7 }, { weight: 60, reps: 6 }])).toMatchObject({ weight: 60, reps: 7 });
    expect(suggestNext(bench, [])).toBeNull();
  });
  it("progresses holds by seconds and bodyweight moves by reps", () => {
    const plank = { measure: "time" as const, target_sets: 3, reps_min: 45, reps_max: 60, increment: 10 };
    expect(suggestNext(plank, [{ weight: null, reps: 60 }, { weight: null, reps: 60 }, { weight: null, reps: 62 }])?.reps).toBe(72);
    const pullup = { measure: "reps" as const, target_sets: 3, reps_min: 6, reps_max: 10, increment: 2.5 };
    expect(suggestNext(pullup, [{ weight: null, reps: 7 }, { weight: null, reps: 6 }, { weight: null, reps: 6 }])).toMatchObject({ weight: null, reps: 8 });
    expect(suggestNext(pullup, [{ weight: null, reps: 10 }, { weight: null, reps: 10 }, { weight: null, reps: 10 }])).toMatchObject({ weight: 2.5, reps: 6 });
  });
  it("estimates one-rep max", () => {
    expect(e1rm(100, 1)).toBe(100);
    expect(e1rm(60, 8)).toBe(76);
    expect(e1rm(null, 8)).toBeNull();
  });
});

describe("weight and weeks", () => {
  const pts = [
    { date: "2026-11-01", value: 80 },
    { date: "2026-11-03", value: 79.6 },
    { date: "2026-11-05", value: 79.4 },
    { date: "2026-11-08", value: 79 },
  ];
  it("smooths and trends body weight", () => {
    expect(movingAverage(pts).at(-1)?.value).toBe(79.3); // 11-03..11-08
    expect(weeklyTrend(pts)).toBeLessThan(-0.6);
    expect(weeklyTrend(pts.slice(0, 2))).toBeNull();
  });
  it("counts sessions per week and streaks of weeks meeting the goal", () => {
    const w: WorkoutLite[] = ["2026-10-26", "2026-10-27", "2026-10-29", "2026-11-02", "2026-11-04", "2026-11-05", "2026-11-09"].map((date) => ({ date, day_type: "push", status: "done" }));
    expect(sessionsThisWeek(w, "2026-11-10")).toBe(1); // Mon 11-09 only
    expect(sessionsThisWeek(w, "2026-11-08")).toBe(3);
    expect(weekStreak(w, "2026-11-10", 3)).toBe(2); // current week in progress, last two weeks met 3
  });
});
