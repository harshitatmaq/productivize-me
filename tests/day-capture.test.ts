import { describe, expect, it } from "vitest";
import { normalizeDrafts, normalizeQuestions } from "@/lib/day-capture";

const prefs = { routines: [{ id: "r1", label: "Reading & journaling", keywords: ["read", "pages"], start: "22:30", end: "23:30", days: [] }] };

describe("Describe your day", () => {
  it("cleans the AI's tasks and keeps only valid values", () => {
    const tasks = normalizeDrafts(
      [
        { title: "  Reply to the Razorpay recruiter ", date: "2026-11-16", time: "11:30", estimate_min: 15, priority: 1, tags: ["#Jobs"] },
        { title: "Finish Azure SQL days 0-2", date: "tomorrow", time: "25:00", estimate_min: 120, priority: 9 },
        { title: "x" },
        { title: "Read 20 pages", date: "2026-11-16", time: null },
      ],
      { today: "2026-11-16", prefs },
    );
    expect(tasks).toHaveLength(3);
    expect(tasks[0]).toMatchObject({ title: "Reply to the Razorpay recruiter", due_time: "11:30", priority: 1, tags: ["jobs"], estimate_minutes: 15 });
    expect(tasks[1]).toMatchObject({ due_date: null, due_time: null, priority: 4, estimate_minutes: 120 }); // bad date/time/priority dropped
    expect(tasks[2]).toMatchObject({ due_time: "22:30", routine: "Reading & journaling" }); // routine time for untimed tasks
  });

  it("turns repeat phrases into the same repeats quick add makes", () => {
    const [weekday, mondays, gym] = normalizeDrafts(
      [
        { title: "Stand-up", date: "2026-11-16", time: "10:00", repeat: "every weekday" },
        { title: "Plan the week", repeat: "every Monday" },
        { title: "Gym", time: "07:00", repeat: "Mon and Thu" },
      ],
      { today: "2026-11-16" },
    );
    expect(weekday).toMatchObject({ recurrence: "weekdays", due_date: "2026-11-16" });
    expect(mondays.recurrence).toBe("weekly");
    expect(mondays.due_date).not.toBeNull();
    expect(gym).toMatchObject({ recurrence: "weekly", recurrence_days: [1, 4], due_time: "07:00" });
  });

  it("keeps at most three clear questions with a few options", () => {
    const qs = normalizeQuestions([
      { id: "q1", question: "Is the dentist on Friday or Saturday?", options: ["Friday", "Saturday", "", "x", "y", "z", "w"] },
      { question: "?" },
      { question: "Should 'groceries and pharmacy' be one task or two?", options: ["One", "Two"] },
      { question: "Third question here?" },
      { question: "Fourth question here?" },
    ]);
    expect(qs).toHaveLength(3);
    expect(qs[0].options).toEqual(["Friday", "Saturday", "x", "y", "z"]);
    expect(qs[1].id).toBe("q2");
  });
});
