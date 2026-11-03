import { describe, expect, it } from "vitest";
import { elapsedFraction, withinPace } from "@/lib/usage";

describe("budget pacing", () => {
  it("spreads a monthly quota evenly", () => {
    // 10% into the month with a 1000 limit: ~150 allowed (10% + 5% burst)
    expect(withinPace(100, 1000, 0.1)).toBe(true);
    expect(withinPace(150, 1000, 0.1)).toBe(false);
    expect(withinPace(999, 1000, 1)).toBe(true);
    expect(withinPace(1000, 1000, 1)).toBe(false);
    expect(withinPace(0, 0, 0.5)).toBe(false);
  });

  it("always allows the first call of a period", () => {
    expect(withinPace(0, 100, 0)).toBe(true);
  });

  it("computes elapsed fractions", () => {
    expect(elapsedFraction("day", new Date("2026-11-03T12:00:00Z"))).toBeCloseTo(0.5);
    expect(elapsedFraction("month", new Date("2026-11-16T00:00:00Z"))).toBeCloseTo(0.5);
  });
});
