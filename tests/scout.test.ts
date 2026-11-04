import { describe, expect, it } from "vitest";
import { CAREER_OPS_BOARDS, INDIA_FOCUS_COMPANIES } from "@/lib/jobs/company-seed";
import { canonicalJobUrl, classifyEmail, extractJobsFromEmail } from "@/lib/jobs/gmail-parse";
import { countryForIndeed, mapJobspyRecord } from "@/lib/jobs/jobspy";
import { detectAts, titleScore } from "@/lib/jobs/normalize";
import { fallbackParse } from "@/lib/jobs/query";

describe("gmail job alerts", () => {
  it("classifies alerts vs replies", () => {
    expect(classifyEmail("LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>", "Data Engineer: 12 new jobs")).toBe("alert");
    expect(classifyEmail("Naukri <info@naukri.com>", "Jobs matching your profile")).toBe("alert");
    expect(classifyEmail("Razorpay Recruiting <no-reply@greenhouse.io>", "Thank you for applying to Razorpay")).toBe("reply");
    expect(classifyEmail("Friend <a@b.com>", "Lunch?")).toBe("other");
  });

  it("canonicalises tracking links", () => {
    expect(canonicalJobUrl("https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=abc&refId=x")).toEqual({
      url: "https://www.linkedin.com/jobs/view/4012345678",
      site: "linkedin",
    });
    expect(canonicalJobUrl("https://www.naukri.com/job-listings-data-engineer-acme-bengaluru-3-to-6-years-031125012345?src=jobalert")?.url).toBe(
      "https://www.naukri.com/job-listings-data-engineer-acme-bengaluru-3-to-6-years-031125012345",
    );
    expect(canonicalJobUrl("https://in.indeed.com/rc/clk?jk=abc123&from=ja")?.url).toBe("https://in.indeed.com/viewjob?jk=abc123");
    expect(canonicalJobUrl("https://www.linkedin.com/jobs/search?keywords=x")).toBeNull();
    expect(canonicalJobUrl("https://www.linkedin.com/comm/feed/")).toBeNull();
  });

  it("extracts each job once with the most descriptive title", () => {
    const html = `
      <a href="https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=1"><img src="logo.png"></a>
      <a href="https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=2">Senior Data Engineer</a>
      <a href="https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=3">View job</a>
      <a href="https://www.linkedin.com/comm/jobs/view/4099999999/">Analytics Engineer &amp; BI</a>
      <a href="https://www.linkedin.com/comm/jobs/search/?x=1">See all jobs</a>
      <a href="https://www.linkedin.com/comm/psettings/">Unsubscribe</a>`;
    const jobs = extractJobsFromEmail(html, new Date("2026-11-04T05:00:00Z"));
    expect(jobs.map((j) => [j.url, j.title])).toEqual([
      ["https://www.linkedin.com/jobs/view/4012345678", "Senior Data Engineer"],
      ["https://www.linkedin.com/jobs/view/4099999999", "Analytics Engineer & BI"],
    ]);
    expect(jobs[0]).toMatchObject({ source: "email:linkedin", needs_extraction: true, posted_at: "2026-11-04T05:00:00.000Z" });
  });
});

describe("jobspy mapping", () => {
  it("maps records and keeps the direct apply link", () => {
    const job = mapJobspyRecord(
      {
        id: "in-1",
        job_url: "https://in.indeed.com/viewjob?jk=1",
        job_url_direct: "https://boards.greenhouse.io/acme/jobs/123",
        title: "Data Engineer",
        company: "Acme",
        location: "Bengaluru, KA, IN",
        date_posted: "2026-11-03",
        min_amount: 2000000,
        max_amount: 3000000,
        currency: "INR",
        interval: "yearly",
        is_remote: false,
        description: "**Spark** and Airflow",
        skills: "Spark, Airflow",
      },
      "indeed",
    )!;
    expect(job).toMatchObject({ source: "jobspy:indeed", apply_url: "https://boards.greenhouse.io/acme/jobs/123", salary: "INR 2000k–3000k / year" });
    expect(job.description).toContain("Skills: Spark, Airflow");
    expect(mapJobspyRecord({ title: "x" }, "indeed")).toBeNull();
    expect(countryForIndeed("in")).toBe("india");
    expect(countryForIndeed(undefined)).toBe("india");
  });
});

describe("search helpers", () => {
  it("parses a query without an LLM", () => {
    const p = fallbackParse("Fabric data engineer in Bengaluru", { skills: ["SQL"] });
    expect(p.titles[0]).toBe("Fabric data engineer");
    expect(p.locations).toEqual(["Bengaluru"]);
    expect(p.countries).toEqual(["in"]);
    expect(fallbackParse("remote analytics engineer jobs", {}).remote).toBe("remote");
  });

  it("matches titles and detects ATS", () => {
    expect(titleScore("Senior Data Engineer, Platform", ["Data Engineer"])).toBe(1);
    expect(titleScore("Sales Manager", ["Data Engineer"])).toBe(0);
    expect(detectAts("https://jobs.ashbyhq.com/acme/123")).toBe("ashby");
    expect(detectAts("https://acme.wd5.myworkdayjobs.com/Careers/job/1")).toBe("workday");
  });

  it("ships a valid curated company list", () => {
    expect(CAREER_OPS_BOARDS.length).toBeGreaterThan(100);
    for (const b of CAREER_OPS_BOARDS) {
      expect(["greenhouse", "lever", "ashby", "workable", "smartrecruiters"]).toContain(b.ats);
      expect(b.slug).toMatch(/^[A-Za-z0-9_.-]+$/);
    }
    expect(new Set(INDIA_FOCUS_COMPANIES).size).toBe(INDIA_FOCUS_COMPANIES.length);
  });
});
