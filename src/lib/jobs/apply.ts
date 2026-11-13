/**
 * Applications: the answer bank, turning a form into an application pack, and
 * reading reply emails. Pure functions (shared by the server, the UI and tests).
 *
 * Honesty rule: answers come from you (answer bank / profile) or are drafted by
 * the AI for open questions. Facts the app doesn't know (visa, salary, dates…)
 * are never guessed: they're marked "needs you".
 */
import type { JobProfile } from "./types";

export type BankCategory = "contact" | "work" | "eligibility" | "education" | "reusable" | "other";
export type BankEntry = { id?: string; key: string; question: string; answer: string; category: BankCategory };

export type StandardQuestion = {
  key: string;
  question: string;
  category: BankCategory;
  /** Matches form labels that ask this. */
  match: RegExp;
  /** Suggested answer from your profile, if any. */
  fromProfile?: (p: JobProfile, email?: string | null) => string | undefined;
};

const firstExp = (p: JobProfile) => p.experience?.[0];

export const STANDARD_QUESTIONS: StandardQuestion[] = [
  { key: "full_name", question: "Full name", category: "contact", match: /^(full |legal |your )?name\b|^name$/i, fromProfile: (p) => p.name },
  { key: "first_name", question: "First name", category: "contact", match: /first name|given name/i, fromProfile: (p) => p.name?.trim().split(/\s+/)[0] },
  { key: "last_name", question: "Last name", category: "contact", match: /last name|surname|family name/i, fromProfile: (p) => (p.name?.trim().split(/\s+/).length ?? 0) > 1 ? p.name!.trim().split(/\s+/).slice(1).join(" ") : undefined },
  { key: "email", question: "Email", category: "contact", match: /e-?mail/i, fromProfile: (_p, email) => email ?? undefined },
  { key: "phone", question: "Phone number", category: "contact", match: /phone|mobile|contact number/i },
  { key: "location", question: "Current city / location", category: "contact", match: /current (city|location)|where (are you|do you) (based|live)|^location\b|^city\b/i, fromProfile: (p) => p.locations?.[0] },
  { key: "linkedin", question: "LinkedIn profile", category: "contact", match: /linked ?in/i, fromProfile: (p) => p.links?.linkedin },
  { key: "github", question: "GitHub profile", category: "contact", match: /git ?hub/i, fromProfile: (p) => p.links?.github },
  { key: "portfolio", question: "Portfolio / website", category: "contact", match: /portfolio|personal (site|website)|^website\b/i, fromProfile: (p) => p.links?.portfolio },
  { key: "current_company", question: "Current company", category: "work", match: /current (company|employer|organi[sz]ation)/i, fromProfile: (p) => firstExp(p)?.company },
  { key: "current_title", question: "Current job title", category: "work", match: /current (job )?(title|role|designation|position)/i, fromProfile: (p) => p.current_title ?? firstExp(p)?.title },
  { key: "total_experience", question: "Total years of experience", category: "work", match: /(total|years of|how many years).*(experience)|experience.*\(?years\)?/i, fromProfile: (p) => (p.years_experience != null ? String(p.years_experience) : undefined) },
  { key: "current_ctc", question: "Current CTC / salary", category: "work", match: /current (ctc|salary|compensation|pay)/i },
  { key: "expected_ctc", question: "Expected CTC / salary", category: "work", match: /expected (ctc|salary|compensation|pay)|salary expectation|desired (salary|compensation)/i, fromProfile: (p) => p.salary_expectation },
  { key: "notice_period", question: "Notice period", category: "work", match: /notice period|when can you (start|join)|earliest (start|joining)|availability to (start|join)/i, fromProfile: (p) => p.notice_period },
  { key: "work_authorization", question: "Work authorization (which countries)", category: "eligibility", match: /authori[sz]ed to work|work authori[sz]ation|legally (allowed|eligible)|right to work|work permit/i, fromProfile: (p) => p.work_authorization },
  { key: "sponsorship", question: "Do you need visa sponsorship?", category: "eligibility", match: /sponsor/i },
  { key: "relocation", question: "Willing to relocate?", category: "eligibility", match: /relocat/i, fromProfile: (p) => (p.open_to_relocate == null ? undefined : p.open_to_relocate ? "Yes" : "No") },
  { key: "work_mode", question: "Preferred work mode (remote / hybrid / onsite)", category: "eligibility", match: /work (mode|arrangement|setup)|remote|hybrid|on-?site/i, fromProfile: (p) => p.remote },
  { key: "degree", question: "Highest degree", category: "education", match: /degree|highest (level of )?education|qualification/i, fromProfile: (p) => p.education?.[0]?.degree },
  { key: "school", question: "College / university", category: "education", match: /college|university|school|institut/i, fromProfile: (p) => p.education?.[0]?.school },
  { key: "graduation_year", question: "Graduation year", category: "education", match: /graduat|year of (passing|completion)|passing year/i, fromProfile: (p) => p.education?.[0]?.year },
  { key: "how_heard", question: "How did you hear about us?", category: "reusable", match: /how did you (hear|find|learn)|where did you (hear|find|see)|source of (application|referral)/i },
  { key: "why_role", question: "Why are you interested in this role? (your general reason)", category: "reusable", match: /^why (are you interested|this role|do you want)/i },
  { key: "gender", question: "Gender (optional questions)", category: "other", match: /gender|sex\b/i },
  { key: "veteran", question: "Veteran status (optional questions)", category: "other", match: /veteran/i },
  { key: "disability", question: "Disability status (optional questions)", category: "other", match: /disabilit/i },
  { key: "ethnicity", question: "Race / ethnicity (optional questions)", category: "other", match: /race|ethnic/i },
];

/** Normalised key for a custom question ("Why Productivize?" ≈ "why productivize"). */
export function questionKey(label: string): string {
  return (
    "q:" +
    label
      .toLowerCase()
      .replace(/\*|\(required\)|\(optional\)/g, "")
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 110)
  );
}

/** Which standard question a form label asks, if any. */
export function standardFor(label: string): StandardQuestion | undefined {
  const l = label.replace(/\*/g, "").trim();
  // Name variants first so "First name" isn't read as "Full name".
  const order = [...STANDARD_QUESTIONS].sort((a, b) => Number(a.key === "full_name") - Number(b.key === "full_name"));
  return order.find((q) => q.match.test(l));
}

export type FieldType = "text" | "textarea" | "select" | "multiselect" | "file" | "yesno";
export type PackField = {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  options?: string[];
  answer: string;
  /** bank: your answer bank · profile: your job profile · ai: drafted, check it · you: needs your answer · file: upload */
  source: "bank" | "profile" | "ai" | "you" | "file";
  confidence?: number;
  note?: string;
  /** Answer-bank key this field maps to (standard or custom). */
  bankKey: string;
};

export type FormField = { id: string; label: string; type: FieldType; required: boolean; options?: string[] };

/** Questions most application forms ask, used when the real form can't be read. */
export const COMMON_FORM: FormField[] = [
  { id: "c-name", label: "Full name", type: "text", required: true },
  { id: "c-email", label: "Email", type: "text", required: true },
  { id: "c-phone", label: "Phone number", type: "text", required: true },
  { id: "c-location", label: "Current city / location", type: "text", required: false },
  { id: "c-linkedin", label: "LinkedIn profile", type: "text", required: false },
  { id: "c-resume", label: "Resume / CV", type: "file", required: true },
  { id: "c-company", label: "Current company", type: "text", required: false },
  { id: "c-title", label: "Current job title", type: "text", required: false },
  { id: "c-exp", label: "Total years of experience", type: "text", required: false },
  { id: "c-ctc", label: "Current CTC / salary", type: "text", required: false },
  { id: "c-ectc", label: "Expected CTC / salary", type: "text", required: false },
  { id: "c-notice", label: "Notice period", type: "text", required: false },
  { id: "c-auth", label: "Are you authorized to work in this location?", type: "yesno", required: false },
  { id: "c-sponsor", label: "Will you need visa sponsorship?", type: "yesno", required: false },
  { id: "c-relocate", label: "Are you willing to relocate?", type: "yesno", required: false },
  { id: "c-why", label: "Why do you want to work here?", type: "textarea", required: false },
  { id: "c-cover", label: "Cover letter", type: "textarea", required: false },
];

/** Open questions the AI may draft (opinions, motivation, experience) vs facts only you know. */
export function isOpenQuestion(f: FormField): boolean {
  if (f.type === "file") return false;
  if (/cover letter/i.test(f.label)) return false; // handled separately
  if (standardFor(f.label) && !/why/i.test(f.label)) return false;
  if (f.type === "yesno" || f.type === "select" || f.type === "multiselect") {
    // Choosing an option about skills/experience is fine to suggest; eligibility and personal facts are not.
    return !/authori|sponsor|visa|citizen|relocat|gender|race|ethnic|veteran|disab|salary|ctc|notice|age\b|criminal|background check/i.test(f.label);
  }
  return f.type === "textarea" || /why|describe|tell us|explain|what (excites|interests|motivates)|experience with|example|how would you|project/i.test(f.label);
}

/**
 * Fills a form from the answer bank and profile. Open questions are left for the
 * AI (source "ai" with an empty answer), and everything else unknown is "you".
 */
export function fillForm(fields: FormField[], bank: BankEntry[], profile: JobProfile, email?: string | null): PackField[] {
  const byKey = new Map(bank.filter((b) => b.answer.trim()).map((b) => [b.key, b]));
  return fields.map((f) => {
    const std = standardFor(f.label);
    const custom = questionKey(f.label);
    const base = { id: f.id, label: f.label, type: f.type, required: f.required, options: f.options };
    if (f.type === "file") return { ...base, answer: /resume|cv/i.test(f.label) ? "Upload the tailored resume PDF" : "", source: "file", bankKey: custom };
    if (/cover letter/i.test(f.label)) return { ...base, answer: "", source: "ai", note: "Uses the cover letter below", bankKey: custom };
    // "Why this role/company?" is tailored per job by the AI (your saved general answer is its starting point).
    const tailored = std?.key === "why_role";
    const saved = byKey.get(custom) ?? (std && !tailored ? byKey.get(std.key) : undefined);
    if (saved) return { ...base, answer: pickOption(saved.answer, f.options), source: "bank", bankKey: saved.key, confidence: 100 };
    const fromProfile = tailored ? undefined : std?.fromProfile?.(profile, email);
    if (fromProfile) return { ...base, answer: pickOption(fromProfile, f.options), source: "profile", bankKey: std!.key, confidence: 90 };
    if (isOpenQuestion(f)) return { ...base, answer: "", source: "ai", bankKey: custom };
    return { ...base, answer: "", source: "you", bankKey: std?.key ?? custom };
  });
}

/** For select fields, use the option that matches the saved answer (e.g. "Yes" → "Yes, I am authorized"). */
export function pickOption(answer: string, options?: string[]): string {
  if (!options?.length) return answer;
  const a = answer.trim().toLowerCase();
  const exact = options.find((o) => o.trim().toLowerCase() === a);
  if (exact) return exact;
  const starts = options.find((o) => o.trim().toLowerCase().startsWith(a) || a.startsWith(o.trim().toLowerCase()));
  return starts ?? answer;
}

export function packStats(fields: PackField[]) {
  const answered = fields.filter((f) => f.answer.trim() || f.source === "file").length;
  const needYou = fields.filter((f) => !f.answer.trim() && f.source !== "file" && (f.required || f.source === "you")).length;
  const drafts = fields.filter((f) => f.source === "ai" && f.answer.trim()).length;
  return { total: fields.length, answered, needYou, drafts };
}

// ---------------------------------------------------------------------------
// Greenhouse (official public API, no sign-in)
// ---------------------------------------------------------------------------

/** Board and job id from a Greenhouse URL, if it is one. */
export function parseGreenhouseUrl(url: string | null | undefined): { board: string; id: string } | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!/(^|\.)greenhouse\.io$/.test(u.hostname)) return null;
    const m = u.pathname.match(/^\/([^/]+)\/jobs\/(\d+)/);
    if (m && m[1] !== "embed") return { board: m[1], id: m[2] };
    const forBoard = u.searchParams.get("for");
    const token = u.searchParams.get("token");
    if (forBoard && token && /^\d+$/.test(token)) return { board: forBoard, id: token };
  } catch {
    return null;
  }
  return null;
}

type GhQuestion = { label?: string; required?: boolean; fields?: { name?: string; type?: string; values?: { label?: string; value?: unknown }[] }[] };

/** Greenhouse's `questions` → our form fields. */
export function greenhouseFields(questions: GhQuestion[]): FormField[] {
  const out: FormField[] = [];
  questions.forEach((q, i) => {
    const field = q.fields?.[0];
    if (!q.label || !field) return;
    const t = field.type ?? "input_text";
    const options = (field.values ?? []).map((v) => String(v.label ?? v.value ?? "")).filter(Boolean);
    const type: FieldType =
      t === "input_file" ? "file" : t === "textarea" ? "textarea" : t === "multi_value_multi_select" ? "multiselect" : t === "multi_value_single_select" ? (options.length === 2 && options.every((o) => /^(yes|no)$/i.test(o)) ? "yesno" : "select") : "text";
    out.push({ id: `gh-${field.name ?? i}`, label: q.label.trim(), type, required: !!q.required, options: options.length ? options : undefined });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Reply emails → application status (rules only; emails are never sent to an AI)
// ---------------------------------------------------------------------------

export type ReplyOutcome = "interview" | "rejected" | "offer" | "received" | "other";

export function classifyReply(subject: string, text: string): ReplyOutcome {
  const s = `${subject}\n${text}`.toLowerCase();
  if (/unfortunately|not (be )?moving forward|decided to (move forward|proceed) with other|not (been )?selected|regret to inform|will not be (progressing|proceeding)|position has been filled|other candidates/.test(s)) return "rejected";
  if (/pleased to (extend|offer)|offer letter|job offer|offer of employment/.test(s)) return "offer";
  if (/interview|schedule (a|some) time|availability for a (call|chat)|next (round|step|stage)|phone screen|technical (round|assessment)|coding (test|assessment)|online assessment|take-home/.test(s)) return "interview";
  if (/thank(s| you) for (applying|your application|your interest)|application (has been )?(received|submitted)|we('ve| have) received your application/.test(s)) return "received";
  return "other";
}

type JobLite = { id: string; company: string | null; title: string; status: string; applied_at: string | null; company_domain?: string | null };

/** The application an email is about: company name or domain in the sender/subject/body; most recent first. */
export function matchReplyToJob(from: string, subject: string, text: string, jobs: JobLite[]): JobLite | null {
  const hay = `${from} ${subject} ${text.slice(0, 2000)}`.toLowerCase();
  const domain = from.toLowerCase().match(/@([a-z0-9.-]+)/)?.[1] ?? "";
  const clean = (c: string) => c.toLowerCase().replace(/\b(inc|llc|ltd|limited|pvt|private|technologies|technology|labs|software|solutions|corp|corporation|co)\b\.?/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const candidates = jobs
    .filter((j) => ["applied", "interviewing", "saved", "offer"].includes(j.status))
    .filter((j) => {
      const name = clean(j.company ?? "");
      if (j.company_domain && domain.endsWith(j.company_domain.toLowerCase())) return true;
      if (name.length < 3) return false;
      return new RegExp(`(^|[^a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(hay) || (domain && domain.split(".").some((part) => part.length >= 4 && name.replace(/ /g, "") === part));
    })
    .sort((a, b) => (b.applied_at ?? "").localeCompare(a.applied_at ?? ""));
  return candidates[0] ?? null;
}

const RANK: Record<string, number> = { new: 0, saved: 1, applied: 2, interviewing: 3, rejected: 4, offer: 5, archived: -1 };

/** The job status an outcome moves to (never backwards, never over an offer). */
export function statusAfter(current: string, outcome: ReplyOutcome): string | null {
  const next = outcome === "interview" ? "interviewing" : outcome === "rejected" ? "rejected" : outcome === "offer" ? "offer" : null;
  if (!next || current === "offer" || current === next) return null;
  if (next === "rejected") return current === "archived" ? null : next;
  return (RANK[next] ?? 0) > (RANK[current] ?? 0) ? next : null;
}
