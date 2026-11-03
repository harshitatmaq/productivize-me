import { describe, expect, it } from "vitest";
import { dedupeKey, looksLikeListingPage, normalizeUrl, parseWatchCompany, relevance, stripHtml } from "@/lib/jobs/normalize";
import { fallbackPlan, mergeProfile, sanitizeProfile } from "@/lib/jobs/profile";
import type { SearchPlan } from "@/lib/jobs/types";

describe("job normalisation", () => {
  it("strips tracking params and LinkedIn noise", () => {
    expect(normalizeUrl("https://www.linkedin.com/jobs/view/123456/?refId=abc&trackingId=x")).toBe("https://linkedin.com/jobs/view/123456");
    expect(normalizeUrl("https://jobs.lever.co/acme/uuid?lever-source=LinkedIn&utm_source=x#apply")).toBe("https://jobs.lever.co/acme/uuid");
  });

  it("dedupes the same role at the same company", () => {
    expect(dedupeKey({ title: "Senior Data Engineer (Remote)", company: "Acme Inc.", url: "a" })).toBe(
      dedupeKey({ title: "Senior Data Engineer", company: "ACME", url: "b" }),
    );
  });

  it("recognises listing pages", () => {
    expect(looksLikeListingPage("1,203 Data Engineer jobs in Pune", "https://x.com")).toBe(true);
    expect(looksLikeListingPage("Data Engineer", "https://www.naukri.com/data-engineer-jobs-in-pune")).toBe(true);
    expect(looksLikeListingPage("Data Engineer - Acme | LinkedIn", "https://www.linkedin.com/jobs/view/123")).toBe(false);
  });

  it("strips (double-encoded) html", () => {
    expect(stripHtml("&lt;p&gt;Hello &amp;amp; welcome&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Go&lt;/li&gt;&lt;/ul&gt;")).toBe("Hello & welcome\n• Go");
  });

  it("parses ATS career URLs", () => {
    expect(parseWatchCompany("https://boards.greenhouse.io/stripe")).toEqual({ ats: "greenhouse", slug: "stripe", name: "stripe" });
    expect(parseWatchCompany("https://jobs.ashbyhq.com/openai/123")).toMatchObject({ ats: "ashby", slug: "openai" });
    expect(parseWatchCompany("lever:netflix")).toMatchObject({ ats: "lever", slug: "netflix" });
    expect(parseWatchCompany("not a url")).toBeNull();
  });

  it("ranks relevant jobs above irrelevant ones", () => {
    const plan: SearchPlan = {
      titles: ["Data Engineer", "Analytics Engineer"],
      keywords: ["spark", "airflow", "python", "sql"],
      locations: ["Bengaluru"],
      countries: ["in"],
      remote: "hybrid",
      exclude: ["intern"],
      web_queries: [],
    };
    const good = relevance(
      { source: "x", url: "u", title: "Senior Data Engineer", location: "Bengaluru, India", description: "Spark, Airflow, Python and SQL" },
      plan,
      {},
    );
    const bad = relevance({ source: "x", url: "u", title: "Sales Executive", location: "Delhi", description: "cold calling" }, plan, {});
    const excluded = relevance({ source: "x", url: "u", title: "Data Engineer Intern", description: "spark" }, plan, {});
    expect(good).toBeGreaterThan(0.7);
    expect(bad).toBeLessThan(0.3);
    expect(excluded).toBe(0);
  });
});

describe("profile helpers", () => {
  it("sanitizes and merges", () => {
    const patch = sanitizeProfile({ skills: "Python", countries: ["IN"], years_experience: "4.5", remote: "hybrid", bogus: 1 });
    expect(patch).toEqual({ skills: ["Python"], countries: ["in"], years_experience: 4.5, remote: "hybrid" });
    const merged = mergeProfile({ skills: ["python", "SQL"] }, { skills: ["Python", "Spark"], headline: "DE" });
    expect(merged.skills).toEqual(["python", "SQL", "Spark"]);
    expect(merged.headline).toBe("DE");
  });

  it("builds a fallback plan", () => {
    const plan = fallbackPlan({ target_titles: ["Backend Engineer"], locations: ["Pune"], countries: ["in"], remote: "any" });
    expect(plan.titles).toEqual(["Backend Engineer"]);
    expect(plan.web_queries.some((q) => q.domains === "india")).toBe(true);
    expect(plan.web_queries.some((q) => q.domains === "remote")).toBe(true);
  });
});
