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
