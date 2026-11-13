import { describe, expect, it } from "vitest";
import { classifyReply, COMMON_FORM, fillForm, greenhouseFields, matchReplyToJob, packStats, parseGreenhouseUrl, pickOption, questionKey, standardFor, statusAfter, type BankEntry } from "@/lib/jobs/apply";
import type { JobProfile } from "@/lib/jobs/types";

const profile: JobProfile = {
  name: "Harshit Agrawal",
  current_title: "Data Engineer",
  years_experience: 3,
  experience: [{ title: "Data Engineer", company: "Acme" }],
  links: { linkedin: "https://linkedin.com/in/h" },
  notice_period: "60 days",
  locations: ["Bengaluru"],
};

describe("answer bank matching", () => {
  it("recognises standard questions in form labels", () => {
    expect(standardFor("First Name*")?.key).toBe("first_name");
    expect(standardFor("Name")?.key).toBe("full_name");
    expect(standardFor("LinkedIn Profile URL")?.key).toBe("linkedin");
    expect(standardFor("What is your notice period?")?.key).toBe("notice_period");
    expect(standardFor("Will you now or in the future require sponsorship?")?.key).toBe("sponsorship");
    expect(standardFor("Expected CTC (LPA)")?.key).toBe("expected_ctc");
    expect(questionKey("Why Productivize? *")).toBe(questionKey("why productivize"));
  });

  it("fills from the bank first, then the profile; leaves facts for you and open questions for the AI", () => {
    const bank: BankEntry[] = [
      { key: "phone", question: "Phone number", answer: "+91 90000 00000", category: "contact" },
      { key: "why_role", question: "Why this role", answer: "I love data platforms", category: "reusable" },
      { key: questionKey("Do you have experience with Spark?"), question: "Do you have experience with Spark?", answer: "Yes, 2 years", category: "other" },
    ];
    const fields = fillForm(
      [
        ...COMMON_FORM,
        { id: "x1", label: "Do you have experience with Spark?", type: "text", required: false },
        { id: "x2", label: "Describe a data pipeline you built", type: "textarea", required: true },
      ],
      bank,
      profile,
      "h@example.com",
    );
    const by = (label: string) => fields.find((f) => f.label === label)!;
    expect(by("Full name")).toMatchObject({ answer: "Harshit Agrawal", source: "profile" });
    expect(by("Email")).toMatchObject({ answer: "h@example.com", source: "profile" });
    expect(by("Phone number")).toMatchObject({ answer: "+91 90000 00000", source: "bank" });
    expect(by("Notice period")).toMatchObject({ answer: "60 days", source: "profile" });
    expect(by("Current CTC / salary")).toMatchObject({ answer: "", source: "you" }); // never guessed
    expect(by("Will you need visa sponsorship?").source).toBe("you");
    expect(by("Why do you want to work here?")).toMatchObject({ answer: "", source: "ai" }); // tailored per job, not pasted
    expect(by("Do you have experience with Spark?")).toMatchObject({ answer: "Yes, 2 years", source: "bank" });
    expect(by("Describe a data pipeline you built").source).toBe("ai");
    expect(by("Resume / CV").source).toBe("file");
    const s = packStats(fields);
    expect(s.needYou).toBeGreaterThan(0);
    expect(s.total).toBe(fields.length);
  });

  it("picks the matching option for select questions", () => {
    expect(pickOption("Yes", ["Yes, I am authorized", "No"])).toBe("Yes, I am authorized");
    expect(pickOption("no", ["Yes", "No"])).toBe("No");
    expect(pickOption("Maybe", ["Yes", "No"])).toBe("Maybe");
  });
});

describe("Greenhouse forms", () => {
  it("parses board and job id from Greenhouse links", () => {
    expect(parseGreenhouseUrl("https://boards.greenhouse.io/razorpay/jobs/4567")).toEqual({ board: "razorpay", id: "4567" });
    expect(parseGreenhouseUrl("https://job-boards.greenhouse.io/acme/jobs/123?gh_src=x")).toEqual({ board: "acme", id: "123" });
    expect(parseGreenhouseUrl("https://boards.greenhouse.io/embed/job_app?for=acme&token=99")).toEqual({ board: "acme", id: "99" });
    expect(parseGreenhouseUrl("https://jobs.lever.co/acme/abc")).toBeNull();
  });
  it("maps Greenhouse questions to form fields", () => {
    const f = greenhouseFields([
      { label: "First Name", required: true, fields: [{ name: "first_name", type: "input_text" }] },
      { label: "Resume/CV", required: true, fields: [{ name: "resume", type: "input_file" }] },
      { label: "Are you authorized to work in India?", required: true, fields: [{ name: "q1", type: "multi_value_single_select", values: [{ label: "Yes", value: 1 }, { label: "No", value: 0 }] }] },
      { label: "Why Acme?", required: false, fields: [{ name: "q2", type: "textarea" }] },
    ]);
    expect(f.map((x) => x.type)).toEqual(["text", "file", "yesno", "textarea"]);
    expect(f[2].options).toEqual(["Yes", "No"]);
  });
});

describe("reply emails", () => {
  it("classifies outcomes", () => {
    expect(classifyReply("Your application to Acme", "Unfortunately we have decided to move forward with other candidates")).toBe("rejected");
    expect(classifyReply("Interview invitation – Data Engineer", "Please share your availability for a call")).toBe("interview");
    expect(classifyReply("Thank you for applying", "We have received your application")).toBe("received");
    expect(classifyReply("Offer letter", "We are pleased to extend an offer")).toBe("offer");
    expect(classifyReply("Newsletter", "Top stories")).toBe("other");
  });
  it("finds the application by company and never moves status backwards", () => {
    const jobs = [
      { id: "a", company: "Acme Technologies Pvt Ltd", title: "DE", status: "applied", applied_at: "2026-11-01" },
      { id: "b", company: "Razorpay", title: "DE", status: "applied", applied_at: "2026-11-05", company_domain: "razorpay.com" },
    ];
    expect(matchReplyToJob("Talent Team <jobs@acme.com>", "Your application to Acme", "", jobs)?.id).toBe("a");
    expect(matchReplyToJob("careers@razorpay.com", "Update", "", jobs)?.id).toBe("b");
    expect(matchReplyToJob("noreply@other.com", "Hello", "", jobs)).toBeNull();
    expect(statusAfter("applied", "interview")).toBe("interviewing");
    expect(statusAfter("interviewing", "interview")).toBeNull();
    expect(statusAfter("offer", "rejected")).toBeNull();
    expect(statusAfter("interviewing", "rejected")).toBe("rejected");
    expect(statusAfter("applied", "received")).toBeNull();
  });
});
