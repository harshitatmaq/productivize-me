import { describe, expect, it } from "vitest";
import { canWorkIn, fitGate, judge, locationRestrictions, requiredYears, ruleFromDislike, titleLevel } from "@/lib/jobs/fit-rules";
import { applyToday, groupByCompany } from "@/lib/jobs/board";
import { keywordCoverage } from "@/lib/jobs/apply";
import { seniorityExcludes } from "@/lib/jobs/profile";
import { linkedinApplyUrl } from "@/lib/jobs/liveness-run";
import type { JobProfile } from "@/lib/jobs/types";

const me: JobProfile = { years_experience: 1, countries: ["in"], locations: ["Bengaluru"], work_authorization: "Indian citizen; needs visa sponsorship for US", target_titles: ["ML Engineer"] };

describe("reading what a posting asks for", () => {
  it("finds the years of experience", () => {
    expect(requiredYears("Experience: 2+ Years")).toEqual({ min: 2, max: undefined });
    expect(requiredYears("You have 3-5 years of experience building ML systems")).toEqual({ min: 3, max: 5 });
    expect(requiredYears("Minimum of 3 years in a similar role")).toMatchObject({ min: 3 });
    expect(requiredYears("3 years of professional Python experience")).toMatchObject({ min: 3 });
    expect(requiredYears("We've served customers for 15+ years. 1+ years experience with Python")).toMatchObject({ min: 1 });
    expect(requiredYears("Great culture and benefits")).toBeNull();
  });
  it("reads level from titles and remote limits from the location", () => {
    expect(titleLevel("Senior Machine Learning Engineer")).toBe("senior");
    expect(titleLevel("Staff Engineer, Platform")).toBe("lead");
    expect(titleLevel("SDE-1, Backend")).toBe("junior");
    expect(titleLevel("Machine Learning Engineer, Evaluation")).toBeNull();
    expect(locationRestrictions({ location: "Remote (United States)", remote: true })).toEqual(["United States"]);
    expect(locationRestrictions({ location: "Remote (worldwide)", remote: true })).toEqual([]);
  });
  it("knows where you can work, and that needing sponsorship isn't authorization", () => {
    expect(canWorkIn(["United States"], me)).toBe(false);
    expect(canWorkIn(["India"], me)).toBe(true);
    expect(canWorkIn(["APAC"], me)).toBe(true);
    expect(canWorkIn(["United States"], { ...me, work_authorization: "US citizen" })).toBe(true);
  });
});

describe("hard fit rules", () => {
  it("blocks the US-only, 3+ years role from the screenshot", () => {
    const g = fitGate(
      { source: "himalayas", url: "x", title: "Machine Learning Engineer, Evaluation & Reliability", description: "3 years minimum experience", location: "Remote (United States)", remote: true, board_level: "Mid-level", board_restrictions: ["United States"] },
      me,
    );
    expect(g.verdict).toBe("block");
    expect(g.reasons.join(" ")).toMatch(/United States/);
    expect(g.requirements).toMatchObject({ min_years: 3, level: "mid", restricted_to: ["United States"] });
  });
  it("caps a 2+ years Bengaluru role as a stretch, blocks senior titles, and passes good fits", () => {
    expect(fitGate({ source: "", url: "", title: "AI/ML Engineer", description: "Experience: 2+ Years. Location: Bangalore", location: "Bengaluru" }, { ...me, years_experience: 0.5 })).toMatchObject({ verdict: "stretch", cap: 55 });
    expect(fitGate({ source: "", url: "", title: "Senior AI Engineer", location: "Bengaluru" }, me).verdict).toBe("block");
    expect(fitGate({ source: "", url: "", title: "Junior ML Engineer", description: "0-2 years", location: "Bengaluru" }, me).verdict).toBe("ok");
    // Without years in the profile, the experience rules stay off.
    expect(judge({ min_years: 5 }, { countries: ["in"] }).verdict).toBe("ok");
  });
  it("turns 👎 reasons into profile rules and excludes senior titles for juniors", () => {
    expect(ruleFromDislike("Not this company", { title: "x", company: "Bask Health" }, me)?.patch).toEqual({ avoid_companies: ["Bask Health"] });
    expect(ruleFromDislike("Too senior", { title: "Lead ML Engineer", company: "A" }, me)?.patch).toEqual({ exclude_keywords: ["lead"] });
    expect(ruleFromDislike("Location / remote", { title: "x", company: "A" }, { locations: ["Bengaluru"] })?.patch).toEqual({ countries: ["in"] });
    expect(seniorityExcludes(me)).toContain("senior");
    expect(seniorityExcludes({ years_experience: 8 })).toEqual([]);
  });
});

describe("applying", () => {
  const now = Date.parse("2026-11-18T10:00:00Z");
  const job = (id: string, score: number, hoursAgo: number, company = id, extra = {}) => ({ id, company, score, status: "new", created_at: new Date(now - hoursAgo * 3_600_000).toISOString(), ...extra });
  it("picks fresh strong fits to apply to today", () => {
    const picks = applyToday([job("old", 95, 100), job("fresh", 80, 2), job("weak", 60, 1), job("closed", 90, 1, "c", { closed_at: "x" }), job("day", 82, 30)], now);
    expect(picks.map((p) => p.id)).toEqual(["fresh", "day"]);
  });
  it("groups roles by company", () => {
    const jobs = [job("a1", 85, 1, "Bask Health"), job("b", 84, 1, "Supabase"), job("a2", 85, 1, "Bask Health Inc")];
    const g = groupByCompany(jobs, new Set());
    expect(g.shown.map((j) => j.id)).toEqual(["a1", "b"]);
    expect(g.more.get("baskhealth")).toBe(1);
    expect(groupByCompany(jobs, new Set(["baskhealth"])).shown).toHaveLength(3);
  });
  it("measures keyword coverage and finds LinkedIn's company apply link", () => {
    expect(keywordCoverage(["Python", "RAG", "LangChain", "Kubernetes"], "Built a RAG app in Python with LangChain")).toEqual({ covered: ["Python", "RAG", "LangChain"], missing: ["Kubernetes"] });
    const html = `<code id="applyUrl" style="display: none"><!--"https://www.linkedin.com/jobs/view/externalApply/123?url=https%3A%2F%2Fboards%2Egreenhouse%2Eio%2Facme%2Fjobs%2F9&amp;urlHash=x"--></code>`;
    expect(linkedinApplyUrl(html)).toBe("https://boards.greenhouse.io/acme/jobs/9");
  });
});
