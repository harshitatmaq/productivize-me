import { describe, expect, it } from "vitest";
import { buildGraph, layoutGraph, learnNext } from "@/lib/learning-map";
import { checkPlan, closedReason, isDeepSearchTime, isStale, linkedinJobId, localDayHour } from "@/lib/jobs/liveness";
import { isStretch, stretchPrompt } from "@/lib/jobs/stretch";

describe("job freshness", () => {
  it("spots closed postings in page text", () => {
    expect(closedReason("AI/ML Engineer · No longer accepting applications")).toBe("No longer accepting applications");
    expect(closedReason("Sorry, this job has expired.")).toBe("Posting expired");
    expect(closedReason("This position has been filled")).toBe("Position filled");
    expect(closedReason("The job you are looking for is no longer available")).toBe("Posting removed");
    expect(closedReason("Apply now — we're hiring engineers")).toBeNull();
  });
  it("knows how to check each kind of posting", () => {
    expect(checkPlan("https://boards.greenhouse.io/razorpay/jobs/4567")).toEqual({ kind: "greenhouse", url: "https://boards-api.greenhouse.io/v1/boards/razorpay/jobs/4567" });
    expect(checkPlan("https://jobs.lever.co/acme/0f8f6a0e-1b2c-4d3e-9f00-123456789abc")?.kind).toBe("lever");
    expect(checkPlan("https://jobs.ashbyhq.com/acme/0f8f6a0e-1b2c-4d3e-9f00-123456789abc")).toMatchObject({ kind: "ashby", jobId: "0f8f6a0e-1b2c-4d3e-9f00-123456789abc" });
    expect(checkPlan("https://www.linkedin.com/jobs/view/ai-ml-engineer-at-webknot-4012345678/")).toEqual({ kind: "linkedin", url: "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4012345678" });
    expect(checkPlan("https://remoteok.com/remote-jobs/123")?.kind).toBe("page");
    expect(linkedinJobId("https://www.linkedin.com/jobs/search/?currentJobId=4099999999&keywords=x")).toBe("4099999999");
  });
  it("drops very old 'new' jobs", () => {
    const now = Date.parse("2026-11-16T10:00:00Z");
    expect(isStale({ posted_at: "2026-10-01T00:00:00Z", created_at: "2026-11-10T00:00:00Z" }, now)).toBe(true);
    expect(isStale({ posted_at: null, created_at: "2026-11-10T00:00:00Z" }, now)).toBe(false);
  });
  it("runs the deep search on weekend days from 9 AM local", () => {
    // 2026-11-14 is a Saturday
    expect(isDeepSearchTime(new Date("2026-11-14T04:00:00Z"), "Asia/Kolkata")).toBe(true); // 09:30 IST Sat
    expect(isDeepSearchTime(new Date("2026-11-14T02:00:00Z"), "Asia/Kolkata")).toBe(false); // 07:30 IST Sat
    expect(isDeepSearchTime(new Date("2026-11-16T06:00:00Z"), "Asia/Kolkata")).toBe(false); // Monday
    expect(localDayHour(new Date("2026-11-14T20:00:00Z"), "Asia/Kolkata")).toMatchObject({ weekday: 0, date: "2026-11-15" }); // already Sunday in India
  });
});

describe("stretch prompts", () => {
  it("builds an honest, complete prompt", () => {
    expect(isStretch(55)).toBe(true);
    expect(isStretch(80)).toBe(false);
    const p = stretchPrompt({
      profile: { current_title: "Data Engineer", skills: ["SQL", "Python"], experience: [{ title: "Data Engineer", company: "Acme", highlights: ["Built pipelines"] }] },
      job: { title: "ML Engineer", company: "Webknot", url: "https://x.com/j", description: "Build LLM apps" },
      analysis: { gaps: ["No production LLM experience"], strengths: ["Strong SQL"] } as never,
    });
    expect(p).toContain("ML Engineer at Webknot");
    expect(p).toContain("Never invent");
    expect(p).toContain("No production LLM experience");
    expect(p).toContain("Gaps to close");
    expect(p).toContain("Data Engineer at Acme");
  });
});

describe("learning map", () => {
  const entries = [
    { id: "e1", title: "SQL joins", entry_date: "2026-11-01", minutes: 120, topics: ["SQL Joins"] },
    { id: "e2", title: "Window functions", entry_date: "2026-11-03", minutes: 90, topics: ["Window Functions", "SQL Joins"] },
  ];
  const links = [
    { from_topic: "SQL Joins", to_topic: "Window Functions", kind: "prereq" as const },
    { from_topic: "SQL Joins", to_topic: "Query Optimization", kind: "prereq" as const },
    { from_topic: "Window Functions", to_topic: "dbt", kind: "prereq" as const },
  ];
  it("scores learned topics by time, practice and recall", () => {
    const g = buildGraph({ entries, links, cards: [{ entry_id: "e1", tags: [], reps: 3, lapses: 0 }], interests: [{ name: "Query Optimization", job_relevance: 85, status: "active" }] });
    const joins = g.nodes.find((n) => n.id === "sql joins")!;
    expect(joins.learned).toBe(true);
    expect(joins.minutes).toBe(165);
    expect(joins.recall).toBe(1);
    expect(joins.strength).toBeGreaterThan(0.5);
    expect(g.nodes.find((n) => n.id === "query optimization")).toMatchObject({ learned: false, relevance: 85 });
    expect(g.edges).toHaveLength(3);
  });
  it("suggests what to learn next and lays the map out inside the box", () => {
    const g = buildGraph({ entries, links, cards: [], interests: [{ name: "Query Optimization", job_relevance: 85, status: "active" }] });
    const next = learnNext(g, ["Needs dbt and query optimization experience"]);
    expect(next[0].topic).toBe("Query Optimization");
    expect(next[0].reasons.join(" ")).toMatch(/builds on SQL Joins/);
    expect(next.map((n) => n.topic)).toContain("dbt");
    const pos = layoutGraph(g.nodes, g.edges, 700, 400);
    for (const p of pos.values()) expect(p.x >= 70 && p.x <= 630 && p.y >= 30 && p.y <= 376).toBe(true);
  });
});
