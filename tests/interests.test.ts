import { describe, expect, it } from "vitest";
import {
  applyInterestsToPlan,
  computeStrength,
  heuristicRelevance,
  interestBonus,
  interestContext,
  jobUse,
  matchInterests,
  mentions,
  stageFor,
  type InterestRow,
} from "@/lib/memory/interests";
import type { SearchPlan } from "@/lib/jobs/types";

const row = (name: string, o: Partial<InterestRow> = {}): InterestRow => ({
  id: name,
  name,
  kind: "career",
  status: "active",
  job_use: "auto",
  job_relevance: 50,
  strength: 50,
  ...o,
});

describe("job use bands", () => {
  it("searches at 70+, bonus at 40-69, ignores below 40, respects overrides", () => {
    expect(jobUse(row("Fabric", { job_relevance: 85 }))).toBe("search");
    expect(jobUse(row("Public speaking", { job_relevance: 55 }))).toBe("bonus");
    expect(jobUse(row("Chess", { kind: "hobby", job_relevance: 8 }))).toBe("off");
    expect(jobUse(row("Chess", { kind: "hobby", job_relevance: 8, job_use: "always" }))).toBe("search");
    expect(jobUse(row("Fabric", { job_relevance: 95, job_use: "never" }))).toBe("off");
    // Suggestions are never used until you confirm them.
    expect(jobUse(row("Fabric", { job_relevance: 95, status: "suggested" }))).toBe("off");
  });
});

describe("strength", () => {
  const now = Date.parse("2026-11-05T10:00:00Z");
  it("grows with repeated, recent activity", () => {
    const recent = Array.from({ length: 6 }, (_, i) => ({ type: "learning", label: "x", at: new Date(now - i * 86_400_000).toISOString(), minutes: 40 }));
    const s = computeStrength(recent, { now });
    expect(s).toBeGreaterThanOrEqual(65);
    expect(stageFor(s)).toMatch(/using|strong/);
    expect(computeStrength([], { now })).toBe(0);
    expect(computeStrength([], { now, manual: true })).toBe(25);
    expect(computeStrength([], { now, inProfile: true })).toBe(60);
    const old = [{ type: "task", label: "x", at: new Date(now - 200 * 86_400_000).toISOString() }];
    expect(computeStrength(old, { now })).toBe(7);
  });
});

describe("matching", () => {
  it("finds interests by name and vendor-less name, on word boundaries", () => {
    expect(mentions("Experience with Fabric lakehouses and Power BI", "Microsoft Fabric")).toBe(true);
    expect(mentions("fabricated metal parts", "Microsoft Fabric")).toBe(false);
    expect(mentions("C# and .NET", "C#")).toBe(true);
    const interests = [row("Microsoft Fabric", { job_relevance: 88 }), row("Public speaking", { job_relevance: 50 }), row("Chess", { job_relevance: 5 })];
    const m = matchInterests({ title: "Data Engineer", description: "Fabric, Spark, public speaking at meetups, chess club" }, interests);
    expect(m.map((x) => x.name)).toEqual(["Microsoft Fabric", "Public speaking"]);
    expect(interestBonus(m)).toBe(3);
  });

  it("adds search interests to the plan and excludes not-interested ones", () => {
    const plan: SearchPlan = { titles: ["Data Engineer"], keywords: ["sql"], locations: [], countries: ["in"], remote: "any", exclude: [], web_queries: [] };
    const interests = [row("Microsoft Fabric", { job_relevance: 90 }), row("Guitar", { kind: "hobby", job_relevance: 5 }), row("Java", { status: "not_interested" })];
    const p = applyInterestsToPlan(plan, interests);
    expect(p.keywords).toEqual(["sql", "Microsoft Fabric"]);
    expect(p.exclude).toEqual(["Java"]);
    expect(applyInterestsToPlan(plan, interests, { keywords: false }).keywords).toEqual(["sql"]);
    expect(interestContext(interests)).toContain("NOT interested in");
  });

  it("estimates relevance offline", () => {
    const profile = { target_titles: ["Data Engineer"], skills: ["Power BI", "SQL"] };
    expect(heuristicRelevance({ name: "Power BI", kind: "career" }, profile).relevance).toBeGreaterThanOrEqual(70);
    expect(heuristicRelevance({ name: "Photography", kind: "hobby" }, profile).relevance).toBeLessThan(40);
  });
});
