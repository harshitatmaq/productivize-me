import { describe, expect, it } from "vitest";
import { describePrefs, enforcePlan, matchRoutine, sanitizePrefs, suggestTime, type PlanningPrefs } from "@/lib/planning";

const prefs: PlanningPrefs = sanitizePrefs({
  wake: "07:00",
  sleep: "23:45",
  routines: [
    { id: "read", label: "Reading & journaling", keywords: ["read", "book", "pages", "journal"], start: "22:30", end: "23:30" },
    { id: "gym", label: "Workout", keywords: ["gym", "workout"], start: "07:00", end: "08:00", days: [1, 2, 3, 4, 5] },
  ],
});

describe("routine matching", () => {
  it("matches titles and tags on whole words, per weekday", () => {
    expect(matchRoutine({ title: "Read 20 pages" }, prefs.routines)?.label).toBe("Reading & journaling");
    expect(matchRoutine({ title: "Journal before bed" }, prefs.routines)?.label).toBe("Reading & journaling");
    expect(matchRoutine({ title: "Spread sheets cleanup" }, prefs.routines)).toBeNull(); // "spread" contains "read"
    expect(matchRoutine({ title: "Gym — upper body" }, prefs.routines, 2)?.label).toBe("Workout");
    expect(matchRoutine({ title: "Gym — upper body" }, prefs.routines, 0)).toBeNull(); // weekdays only
    expect(suggestTime({ title: "Read 20 pages" }, prefs)?.time).toBe("22:30");
  });

  it("drops malformed input", () => {
    const p = sanitizePrefs({ wake: "7am", sleep: "23:30", routines: [{ label: "x", start: "25:00", end: "26:00" }, { label: "ok", keywords: ["A"], start: "09:00", end: "10:00", days: [9, 1] }] });
    expect(p.wake).toBeUndefined();
    expect(p.routines).toHaveLength(1);
    expect(p.routines![0]).toMatchObject({ keywords: ["a"], days: [1] });
  });

  it("describes preferences for the AI", () => {
    const lines = describePrefs(prefs, 0);
    expect(lines.join(" ")).toContain("Reading & journaling happens 22:30–23:30");
    expect(lines.join(" ")).not.toContain("Workout"); // not on Sundays
  });
});

describe("enforcing the plan", () => {
  const tasks = [
    { id: "read", title: "Read 20 pages", estimate_minutes: 30 },
    { id: "mail", title: "Reply to recruiter" },
    { id: "call", title: "Call bank", due_time: "12:00" },
    { id: "jrnl", title: "Journal" },
  ];

  it("moves a routine task the AI put at noon into its window", () => {
    const r = enforcePlan(
      { blocks: [{ task_id: "read", start: "12:00", end: "12:30" }, { task_id: "mail", start: "12:30", end: "13:00" }, { task_id: "call", start: "12:00", end: "12:15" }], defer: [] },
      tasks,
      prefs,
      { now: "09:00", weekday: 2 },
    );
    expect(r.blocks.find((b) => b.task_id === "read")).toMatchObject({ start: "22:30", end: "23:00" });
    // The forgotten journaling task is added after reading, inside the window.
    expect(r.blocks.find((b) => b.task_id === "jrnl")).toMatchObject({ start: "23:00", end: "23:30" });
    expect(r.blocks.find((b) => b.task_id === "call")?.start).toBe("12:00");
    expect(r.adjusted).toBe(2);
    expect(r.blocks.map((b) => b.task_id)).toEqual(["call", "mail", "read", "jrnl"]);
  });

  it("keeps blocks that already follow the routine and defers when the window has passed", () => {
    const ok = enforcePlan({ blocks: [{ task_id: "read", start: "22:45", end: "23:15" }], defer: [] }, tasks.slice(0, 1), prefs, { now: "20:00", weekday: 2 });
    expect(ok.blocks[0]).toMatchObject({ start: "22:45", end: "23:15" });
    expect(ok.adjusted).toBe(0);
    const late = enforcePlan({ blocks: [{ task_id: "read", start: "23:40", end: "23:59" }], defer: [] }, tasks.slice(0, 1), prefs, { now: "23:35", weekday: 2 });
    expect(late.blocks).toHaveLength(0);
    expect(late.defer[0].reason).toContain("has passed");
  });

  it("defers ordinary tasks scheduled after bedtime", () => {
    const r = enforcePlan({ blocks: [{ task_id: "mail", start: "23:50", end: "23:59" }], defer: [] }, tasks, prefs, { now: "23:00", weekday: 2 });
    expect(r.defer.map((d) => d.task_id)).toContain("mail");
  });
});
