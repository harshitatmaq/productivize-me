import { describe, expect, it } from "vitest";
import { parseQuickAdd } from "@/lib/nlp";

// Tuesday 3 Nov 2026, 10:00 local
const ref = new Date(2026, 10, 3, 10, 0, 0);

describe("parseQuickAdd", () => {
  it("extracts date, time, priority, tags and estimate", () => {
    const r = parseQuickAdd("Send resume to Priya tomorrow 6pm p1 #jobs ~30m", ref);
    expect(r.title).toBe("Send resume to Priya");
    expect(r.due_date).toBe("2026-11-04");
    expect(r.due_time).toBe("18:00");
    expect(r.priority).toBe(1);
    expect(r.tags).toEqual(["jobs"]);
    expect(r.estimate_minutes).toBe(30);
  });

  it("parses recurrence", () => {
    const r = parseQuickAdd("Gym every weekday 7am #health", ref);
    expect(r.recurrence).toBe("weekdays");
    expect(r.due_time).toBe("07:00");
    expect(r.title).toBe("Gym");
    expect(r.due_date).not.toBeNull();
  });

  it("every monday => weekly starting next monday", () => {
    const r = parseQuickAdd("Weekly planning every monday", ref);
    expect(r.recurrence).toBe("weekly");
    expect(r.due_date).toBe("2026-11-09");
    expect(r.title).toBe("Weekly planning");
  });

  it("leaves plain text alone", () => {
    const r = parseQuickAdd("Read chapter 3 of DDIA", ref);
    expect(r.title).toBe("Read chapter 3 of DDIA");
    expect(r.due_date).toBeNull();
    expect(r.priority).toBe(4);
  });

  it("supports !!! priority", () => {
    expect(parseQuickAdd("Pay rent !!! today", ref).priority).toBe(1);
  });
});

describe("richer recurrence", () => {
  it("every 2 weeks / every other day", () => {
    const a = parseQuickAdd("1:1 with manager every 2 weeks", ref);
    expect([a.recurrence, a.recurrence_interval, a.title]).toEqual(["weekly", 2, "1:1 with manager"]);
    const b = parseQuickAdd("Water plants every other day", ref);
    expect([b.recurrence, b.recurrence_interval, b.title]).toEqual(["daily", 2, "Water plants"]);
  });

  it("chosen weekdays", () => {
    const r = parseQuickAdd("Gym every mon, wed and fri 7am #health", ref);
    expect(r.recurrence).toBe("weekly");
    expect(r.recurrence_days).toEqual([1, 3, 5]);
    expect(r.due_date).toBe("2026-11-04"); // next Wednesday after Tue 3 Nov
    expect(r.due_time).toBe("07:00");
    expect(r.title).toBe("Gym");
  });

  it("keeps 'every weekday' and 'every week' working", () => {
    expect(parseQuickAdd("Standup every weekday", ref).recurrence).toBe("weekdays");
    const w = parseQuickAdd("Review every week", ref);
    expect([w.recurrence, w.recurrence_days]).toEqual(["weekly", []]);
  });
});

describe("month is not monday", () => {
  it("every month stays monthly", () => {
    const r = parseQuickAdd("Pay rent every month", ref);
    expect([r.recurrence, r.recurrence_days, r.title]).toEqual(["monthly", [], "Pay rent"]);
    const t = parseQuickAdd("Team lunch every tuesday and thursday", ref);
    expect(t.recurrence_days).toEqual([2, 4]);
  });
});
