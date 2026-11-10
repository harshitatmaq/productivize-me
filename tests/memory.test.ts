import { describe, expect, it } from "vitest";
import { confidenceWord, digestActivity, factKey, factLines, peakWindow, planFactUpdates, type Fact } from "@/lib/memory/facts";
import { earliestStart, isPlanOwned, settleBlocks, typicalMinutes } from "@/lib/planning";

const NOW = "2026-11-10T10:00:00.000Z";
const fact = (p: Partial<Fact>): Fact => ({
  id: p.id ?? "f1",
  kind: "habit",
  statement: "Reads at night",
  key: factKey(p.statement ?? "Reads at night"),
  confidence: 60,
  status: "active",
  source: "learned",
  pinned: false,
  evidence: [],
  evidence_count: 1,
  routine: null,
  last_seen_at: NOW,
  ...p,
});

describe("personal memory rules", () => {
  it("normalises statements so near-duplicates match", () => {
    expect(factKey("Reads after 22:30.")).toBe(factKey("reads   after 22:30"));
    expect(factKey("Usually reads at night")).toBe(factKey("reads at night"));
    expect(confidenceWord(90)).toBe("sure");
    expect(confidenceWord(70)).toBe("likely");
    expect(confidenceWord(50)).toBe("maybe");
  });

  it("trusts your own words, asks before using weak patterns and drops noise", () => {
    const ops = planFactUpdates(
      [],
      [
        {
          statement: "Believes rest days matter",
          kind: "value",
          stated: true,
          confidence: 50,
        },
        {
          statement: "Finishes study tasks in the morning",
          kind: "schedule",
          confidence: 80,
        },
        {
          statement: "Likes podcasts while cooking",
          kind: "like",
          confidence: 55,
        },
        { statement: "Might enjoy chess", kind: "like", confidence: 30 },
      ],
      { now: NOW },
    );
    const rows = ops.flatMap((o) => (o.op === "insert" ? [o.row] : []));
    expect(rows.map((r) => [r.statement, r.status, r.source])).toEqual([
      ["Believes rest days matter", "active", "you"],
      ["Finishes study tasks in the morning", "active", "learned"],
      ["Likes podcasts while cooking", "suggested", "learned"],
    ]);
    expect(rows[0].confidence).toBeGreaterThanOrEqual(90);
  });

  it("reinforces what it sees again, never revives rejected ones and weakens contradicted ones", () => {
    const known = [
      fact({
        id: "a",
        statement: "Reads at night",
        confidence: 70,
        status: "suggested",
      }),
      fact({ id: "b", statement: "Works out in the morning", confidence: 70 }),
      fact({ id: "c", statement: "Likes long meetings", status: "rejected" }),
      fact({
        id: "d",
        statement: "Hates early calls",
        source: "you",
        confidence: 100,
      }),
    ];
    const ops = planFactUpdates(
      known,
      [
        {
          id: "a",
          statement: "Reads at night",
          confidence: 85,
          evidence: "6 of 7 reading tasks after 22:00",
        },
        { statement: "Likes long meetings!", confidence: 90 },
        {
          statement: "Works out in the evening now",
          kind: "schedule",
          confidence: 80,
          contradicts: "b",
        },
      ],
      { now: NOW, weaken: [{ id: "d" }] },
    );
    const upd = (id: string) => ops.find((o) => o.op === "update" && o.id === id) as { patch: Partial<Fact> } | undefined;
    expect(upd("a")?.patch.status).toBe("active");
    expect(upd("a")?.patch.confidence).toBeGreaterThan(70);
    expect(upd("a")?.patch.evidence_count).toBe(2);
    expect(ops.some((o) => o.op === "insert" && o.row.statement.startsWith("Likes long meetings"))).toBe(false);
    expect(upd("b")?.patch.confidence).toBe(45);
    expect(upd("d")).toBeUndefined(); // your own words are never weakened by learning
    expect(ops.some((o) => o.op === "insert" && o.row.statement === "Works out in the evening now")).toBe(true);
  });

  it("lets old learned facts fade and drops them when they're no longer supported", () => {
    const old = new Date(Date.parse(NOW) - 60 * 86_400_000).toISOString();
    const ops = planFactUpdates(
      [fact({ id: "x", confidence: 45, last_seen_at: old }), fact({ id: "y", statement: "Pinned", pinned: true, last_seen_at: old })],
      [],
      { now: NOW },
    );
    expect(ops).toEqual([{ op: "update", id: "x", patch: { confidence: 40, status: "suggested" } }]);
    const gone = planFactUpdates([fact({ id: "x", confidence: 42, last_seen_at: old })], [], { now: NOW });
    expect(gone).toEqual([{ op: "delete", id: "x" }]);
  });

  it("gives the AI pinned and stated facts first, filtered by purpose", () => {
    const lines = factLines(
      [
        fact({
          id: "1",
          statement: "Likes Fabric",
          kind: "like",
          confidence: 95,
        }),
        fact({
          id: "2",
          statement: "Reads at night",
          kind: "schedule",
          confidence: 70,
        }),
        fact({
          id: "3",
          statement: "Family first on Sundays",
          kind: "value",
          source: "you",
          confidence: 100,
        }),
        fact({
          id: "4",
          statement: "Maybe",
          kind: "schedule",
          status: "suggested",
        }),
      ],
      "planning",
    );
    expect(lines).toEqual(["Family first on Sundays (they said so)", "Reads at night (likely, noticed 1×)"]);
  });
});

describe("activity digest", () => {
  const at = (day: number, h: number) => new Date(Date.UTC(2026, 9, day, h - 5, 30)).toISOString(); // IST = UTC+5:30 → local h:00
  it("finds when things really happen and routines that don't fit", () => {
    const reading = [1, 2, 3, 5, 6, 7].map((d) => ({
      title: "Read 20 pages",
      tags: [],
      completed_at: at(d, 7),
      actual_minutes: 35,
    }));
    const lines = digestActivity({
      tz: "Asia/Kolkata",
      done: reading,
      carried: [
        { title: "Update portfolio site", carry_count: 4 },
        { title: "Portfolio case study", carry_count: 3 },
      ],
      focus: [],
      workouts: [],
      learning: [],
      routines: [
        {
          id: "r",
          label: "Reading",
          keywords: ["read"],
          start: "22:30",
          end: "23:30",
        },
      ],
    });
    expect(lines.join("\n")).toContain("Tasks about “read”: 6 done, 6 of them between 06:00 and 09:00, usually taking about 35 min.");
    expect(lines.join("\n")).toContain("Their routine “Reading” is set for 22:30–23:30, but only 0 of 6 matching tasks were finished then");
    expect(lines.join("\n")).toContain("Keeps postponing tasks about “portfolio”");
  });
  it("finds a peak window", () => {
    expect(peakWindow([22, 23, 22, 0, 23, 9])).toMatchObject({
      from: 22,
      to: 1,
      count: 5,
    });
    expect(peakWindow([1, 5, 9, 13, 17, 21])).toBeNull();
  });
});

describe("plan durations and re-planning", () => {
  it("knows which times a plan set", () => {
    expect(isPlanOwned({ due_time: "15:20:00", planned_time: "15:20" })).toBe(true);
    expect(isPlanOwned({ due_time: "16:00:00", planned_time: "15:20" })).toBe(false);
    expect(isPlanOwned({ due_time: "16:00:00", planned_time: null })).toBe(false);
  });
  it("estimates from how long similar tasks took", () => {
    const history = [
      { title: "Azure SQL day 3", actual_minutes: 100 },
      { title: "azure sql days 4-5", actual_minutes: 140 },
      { title: "Azure SQL practice", actual_minutes: 120 },
      { title: "Groceries", actual_minutes: 40 },
    ];
    expect(typicalMinutes({ title: "finish azure sql days 0-2" }, history)).toEqual({ minutes: 120, samples: 3 });
    expect(typicalMinutes({ title: "Call the bank" }, history)).toBeNull();
  });
  it("starts a few minutes from now and keeps blocks apart", () => {
    expect(earliestStart("15:19")).toBe("15:25");
    expect(earliestStart("15:20")).toBe("15:25");
    const out = settleBlocks(
      [
        { task_id: "a", start: "15:19", end: "15:49" },
        { task_id: "b", start: "15:40", end: "16:40" },
        { task_id: "fixed", start: "18:00", end: "18:30" },
      ],
      new Set(["fixed"]),
      "15:25",
    );
    expect(out.map((b) => `${b.task_id} ${b.start}-${b.end}`)).toEqual(["a 15:25-15:55", "b 15:55-16:55", "fixed 18:00-18:30"]);
  });
});
