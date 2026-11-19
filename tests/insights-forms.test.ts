import { describe, expect, it } from "vitest";
import { ashbyFields, leverFields, parseAshbyUrl, parseLeverUrl } from "@/lib/jobs/apply";
import { applicationInsights, outcomeOf, sourceGroup, weeklyLine, type InsightApp, type InsightJob } from "@/lib/jobs/insights";

const NOW = Date.parse("2026-11-19T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

let n = 0;
function job(p: Partial<InsightJob> & { applied: number }): InsightJob {
  n++;
  return { id: `j${n}`, title: `Role ${n}`, company: `Co ${n}`, status: "applied", source: "jobspy:linkedin", score: 70, applied_at: daysAgo(p.applied), ...p };
}
const app = (j: InsightJob, p: Partial<InsightApp> = {}): InsightApp => ({ job_id: j.id, applied_at: j.applied_at, timeline: [], channel: "direct", tailored: false, ...p });

describe("application outcomes", () => {
  it("reads interviews, rejections, silence and waiting", () => {
    const iv = job({ applied: 20, status: "interviewing" });
    expect(outcomeOf(iv, app(iv, { timeline: [{ at: daysAgo(15), kind: "interview" }] }), NOW)).toMatchObject({ outcome: "interview", replyDays: 5 });
    const rj = job({ applied: 30, status: "rejected" });
    expect(outcomeOf(rj, undefined, NOW).outcome).toBe("rejected");
    expect(outcomeOf(job({ applied: 25 }), undefined, NOW).outcome).toBe("silent");
    expect(outcomeOf(job({ applied: 5 }), undefined, NOW).outcome).toBe("waiting");
  });

  it("an auto-confirmation email is not a reply", () => {
    const j = job({ applied: 30 });
    expect(outcomeOf(j, app(j, { timeline: [{ at: daysAgo(29), kind: "received" }] }), NOW).outcome).toBe("silent");
  });

  it("groups sources", () => {
    expect(sourceGroup("jobspy:linkedin")).toBe("LinkedIn");
    expect(sourceGroup("email:naukri")).toBe("Naukri");
    expect(sourceGroup("greenhouse")).toBe("Company job board");
    expect(sourceGroup("web:tavily")).toBe("Web / Google Jobs");
  });
});

describe("what's working", () => {
  it("compares channels and gives a tip only when the difference is clear", () => {
    const jobs: InsightJob[] = [];
    const apps: InsightApp[] = [];
    // 3 referrals: 2 interviews, 1 silent. 5 direct: 1 rejection, 4 silent.
    for (const [i, status] of ["interviewing", "interviewing", "applied"].entries()) {
      const j = job({ applied: 30 + i, status });
      jobs.push(j);
      apps.push(app(j, { channel: "referral", tailored: true }));
    }
    for (const [i, status] of ["rejected", "applied", "applied", "applied", "applied"].entries()) {
      const j = job({ applied: 25 + i, status, source: "greenhouse", score: 62 });
      jobs.push(j);
      apps.push(app(j, { channel: "direct" }));
    }
    const recent = job({ applied: 2 });
    jobs.push(recent);
    const ins = applicationInsights(jobs, apps, NOW);
    expect(ins.applied).toBe(9);
    expect(ins.decided).toBe(8);
    expect(ins.waiting).toBe(1);
    expect(ins.replies).toBe(3);
    expect(ins.replyRate).toBe(38);
    expect(ins.interviewRate).toBe(25);
    expect(ins.enough).toBe(true);
    const how = ins.groups.find((g) => g.title === "How you applied")!;
    expect(how.rows.map((r) => [r.label, r.rate])).toEqual([
      ["Applied directly", 20],
      ["Referral", 67],
      ["Not recorded", null],
    ]);
    expect(ins.tip).toMatch(/Referral: 67% got a reply/);
    expect(ins.week.applied).toBe(1);
  });

  it("lists applications quiet for 10+ days (not rejected, not interviewing)", () => {
    const quiet = job({ applied: 12, title: "Data Engineer" });
    const fresh = job({ applied: 3 });
    const rejected = job({ applied: 14, status: "rejected" });
    const ins = applicationInsights([quiet, fresh, rejected], [], NOW);
    expect(ins.quiet.map((q) => q.title)).toEqual(["Data Engineer"]);
    expect(weeklyLine(ins)).toMatch(/1 quiet 10\+ days/);
  });

  it("stays quiet with too little data", () => {
    const ins = applicationInsights([job({ applied: 25 })], [], NOW);
    expect(ins.enough).toBe(false);
    expect(ins.tip).toBeNull();
    expect(applicationInsights([], [], NOW).applied).toBe(0);
    expect(weeklyLine(applicationInsights([], [], NOW))).toBeNull();
  });
});

describe("Ashby and Lever forms", () => {
  it("parses their job URLs", () => {
    expect(parseAshbyUrl("https://jobs.ashbyhq.com/Sarvam%20AI/0b5c1a2e-1111-2222-3333-444455556666/application")).toEqual({ board: "Sarvam AI", id: "0b5c1a2e-1111-2222-3333-444455556666" });
    expect(parseLeverUrl("https://jobs.eu.lever.co/acme/0B5C1A2E-1111-2222-3333-444455556666/apply")).toEqual({ site: "acme", id: "0b5c1a2e-1111-2222-3333-444455556666", eu: true });
    expect(parseAshbyUrl("https://jobs.ashbyhq.com/acme")).toBeNull();
    expect(parseLeverUrl("https://jobs.lever.co/acme")).toBeNull();
  });

  it("maps Ashby's application form", () => {
    const fields = ashbyFields([
      {
        fieldEntries: [
          { id: "1", isRequired: true, field: { path: "_systemfield_name", title: "Name", type: "String" } },
          { id: "2", isRequired: true, field: { path: "_systemfield_resume", title: "Resume", type: "File" } },
          { id: "3", isRequired: false, field: { path: "q1", title: "Why do you want to join?", type: "LongText" } },
          { id: "4", isRequired: true, field: { path: "q2", title: "Need visa sponsorship?", type: "ValueSelect", selectableValues: [{ label: "Yes" }, { label: "No" }] } },
          { id: "5", isRequired: false, field: { path: "q3", title: "Preferred stack", type: "MultiValueSelect", selectableValues: [{ label: "Python" }, { label: "Go" }] } },
          { id: "6", isRequired: false, field: { path: "q4", title: "Willing to relocate?", type: "Boolean" } },
          { id: "7", field: null },
        ],
      },
    ]);
    expect(fields.map((f) => [f.label, f.type, f.required])).toEqual([
      ["Name", "text", true],
      ["Resume", "file", true],
      ["Why do you want to join?", "textarea", false],
      ["Need visa sponsorship?", "yesno", true],
      ["Preferred stack", "multiselect", false],
      ["Willing to relocate?", "yesno", false],
    ]);
    expect(ashbyFields(undefined)).toEqual([]);
  });

  it("reads Lever's standard fields and custom questions", () => {
    const tpl = JSON.stringify({
      text: "Questions",
      fields: [
        { type: "multiple-choice", text: "Are you authorized to work in India?", required: true, options: [{ text: "Yes" }, { text: "No" }] },
        { type: "textarea", text: "Tell us about a project you're proud of", required: false },
        { type: "dropdown", text: "Notice period", required: true, options: [{ text: "Immediate" }, { text: "30 days" }, { text: "60+ days" }] },
      ],
    }).replace(/"/g, "&quot;");
    const html = `<form><input type="file" name="resume"><input name="name"><input name="email"><input name="phone"><input name="org">
      <input name="urls[LinkedIn]"><input name="urls[GitHub]">
      <input type="hidden" name="cards[abc-123][baseTemplate]" value="${tpl}">
      <textarea name="comments"></textarea></form>`;
    const fields = leverFields(html);
    expect(fields.map((f) => f.label)).toEqual([
      "Resume / CV",
      "Full name",
      "Email",
      "Phone number",
      "Current company",
      "LinkedIn profile",
      "GitHub",
      "Are you authorized to work in India?",
      "Tell us about a project you're proud of",
      "Notice period",
      "Additional information",
    ]);
    expect(fields.find((f) => f.label === "Notice period")).toMatchObject({ type: "select", required: true, options: ["Immediate", "30 days", "60+ days"] });
    expect(fields.find((f) => f.label.startsWith("Are you"))?.type).toBe("yesno");
    expect(leverFields("<html>nothing</html>")).toEqual([]);
  });
});
