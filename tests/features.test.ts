import { describe, expect, it } from "vitest";
import { centroid, cosine, normalize, parseVector, toPgVector } from "@/lib/ai/embeddings";
import { review, newCard, previewIntervals, formatInterval } from "@/lib/fsrs";
import { buildCalendar, foldLine, icsEscape, toRrule } from "@/lib/ics";
import { parseWatchCompany } from "@/lib/jobs/normalize";
import { parseHnPosting } from "@/lib/jobs/sources";
import { slugCandidates } from "@/lib/jobs/discover";

describe("ics", () => {
  it("escapes, folds and builds a valid calendar", () => {
    expect(icsEscape("a,b;c\nd")).toBe("a\\,b\;c\\nd");
    const long = "SUMMARY:" + "x".repeat(200);
    expect(foldLine(long).split("\r\n ").every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
    const ics = buildCalendar({
      name: "Productivize",
      tz: "Asia/Kolkata",
      now: new Date("2026-11-03T00:00:00Z"),
      events: [
        { uid: "1@p", summary: "Standup", date: "2026-11-03", time: "10:00", durationMin: 15 },
        { uid: "2@p", summary: "Pay rent", date: "2026-12-01", rrule: toRrule({ frequency: "monthly", day_of_month: 1 }) },
      ],
    });
    expect(ics).toContain("DTSTART;TZID=Asia/Kolkata:20261103T100000");
    expect(ics).toContain("DURATION:PT15M");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261201");
    expect(ics).toContain("RRULE:FREQ=MONTHLY;BYMONTHDAY=1");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("builds RRULEs", () => {
    expect(toRrule({ frequency: "weekly", days_of_week: [5, 1], interval: 2 })).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR");
    expect(toRrule({ frequency: "weekdays" })).toBe("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
    expect(toRrule({ frequency: "yearly", start_date: "2026-02-14" })).toBe("FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=14");
    expect(toRrule({ frequency: "once" })).toBeNull();
  });
});

describe("fsrs", () => {
  it("schedules Good later than Again", () => {
    const now = new Date("2026-11-03T10:00:00Z");
    let card = newCard(now);
    const again = review(card, 1, now);
    const good = review(card, 3, now);
    expect(Date.parse(good.due)).toBeGreaterThan(Date.parse(again.due));
    // a few good reviews push the card out by days
    for (let i = 0; i < 4; i++) {
      const r = review(card, 3, new Date(Date.parse(card.due) + 1000));
      card = r.card;
    }
    expect(Date.parse(card.due) - now.getTime()).toBeGreaterThan(3 * 86_400_000);
    expect(Object.keys(previewIntervals(card, now))).toHaveLength(4);
    expect(formatInterval(90 * 60_000)).toBe("2h");
  });
});

describe("embeddings math", () => {
  it("cosine, centroid and pgvector round-trip", () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(centroid([normalize([1, 0]), normalize([0, 1])])!.map((x) => Number(x.toFixed(3)))).toEqual([0.707, 0.707]);
    expect(parseVector(toPgVector([0.1, 0.25]))).toEqual([0.1, 0.25]);
  });
});

describe("new job sources", () => {
  it("parses Workday career URLs", () => {
    expect(parseWatchCompany("https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite")).toEqual({
      ats: "workday",
      slug: "nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite",
      name: "nvidia",
    });
  });

  it("parses HN 'Who is hiring' first lines", () => {
    expect(parseHnPosting("Acme Robotics | Senior Backend Engineer | Remote (US, EU) | $150k–$190k")).toEqual({
      company: "Acme Robotics",
      title: "Senior Backend Engineer",
      location: "Remote (US, EU)",
      remote: true,
    });
    expect(parseHnPosting("Just some chatter")).toBeNull();
  });

  it("guesses ATS slugs for company names", () => {
    expect(slugCandidates("Razorpay")).toContain("razorpay");
    expect(slugCandidates("Acme Labs Pvt Ltd")).toEqual(expect.arrayContaining(["acme"]));
    expect(slugCandidates("Scale AI")).toEqual(expect.arrayContaining(["scaleai", "scale-ai"]));
  });
});
