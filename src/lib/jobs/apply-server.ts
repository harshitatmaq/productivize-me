import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { chatJson } from "@/lib/ai/llm";
import { memoryContext } from "@/lib/memory/personal";
import {
  COMMON_FORM,
  fillForm,
  greenhouseFields,
  packStats,
  parseGreenhouseUrl,
  pickOption,
  standardFor,
  type BankEntry,
  type FormField,
  type PackField,
} from "./apply";
import { candidateBrief } from "./profile";
import type { JobAnalysis, JobProfile } from "./types";

export type TimelineEvent = { at: string; kind: "prepared" | "resume" | "applied" | "received" | "interview" | "rejected" | "offer" | "note"; text: string };
export type Application = {
  job_id: string;
  form_source: "greenhouse" | "common";
  apply_url: string | null;
  fields: PackField[];
  cover_letter: string | null;
  resume: unknown;
  submitted: { at: string; fields: { label: string; answer: string }[]; cover_letter: string | null } | null;
  timeline: TimelineEvent[];
  prepared_at: string | null;
  applied_at: string | null;
};

const stripHtml = (html: string) =>
  html
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The real form for Greenhouse jobs (official public API); otherwise the common questions. */
async function readForm(url: string): Promise<{ source: "greenhouse" | "common"; fields: FormField[]; description?: string }> {
  const gh = parseGreenhouseUrl(url);
  if (gh) {
    try {
      const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(gh.board)}/jobs/${gh.id}?questions=true`, { signal: AbortSignal.timeout(15_000) });
      if (res.ok) {
        const body = (await res.json()) as { questions?: unknown[]; content?: string };
        const fields = greenhouseFields((body.questions ?? []) as Parameters<typeof greenhouseFields>[0]);
        if (fields.length) return { source: "greenhouse", fields, description: body.content ? stripHtml(body.content).slice(0, 12000) : undefined };
      }
    } catch {
      // fall back to the common questions
    }
  }
  return { source: "common", fields: COMMON_FORM };
}

type Draft = { id: string; answer: string; confidence?: number; needs_you?: boolean; note?: string };

/** One AI call: drafts the open questions (and a cover letter when there isn't one yet). */
async function draftOpenQuestions(
  supabase: SupabaseClient,
  userId: string,
  job: { title: string; company: string | null; description: string },
  profile: JobProfile,
  resumeText: string,
  bank: BankEntry[],
  open: PackField[],
  needCover: boolean,
): Promise<{ drafts: Map<string, Draft>; cover?: string }> {
  if (!open.length && !needCover) return { drafts: new Map() };
  const reusable = bank.filter((b) => b.answer.trim() && (b.category === "reusable" || b.category === "work")).map((b) => `- ${b.question}: ${b.answer.slice(0, 600)}`);
  const memory = await memoryContext(supabase, userId, "jobs", 10);
  const { data } = await chatJson<{ answers: Draft[]; cover_letter?: string }>(
    {
      purpose: "application-pack",
      temperature: 0.4,
      maxTokens: 2500,
      messages: [
        {
          role: "system",
          content: `You help a candidate fill in a job application. Draft answers to the open questions in the candidate's own voice: specific, warm, concise (2-5 sentences unless the question needs more), using the job's language.
Honesty: use ONLY facts from the candidate's profile, resume and saved answers. Never invent employers, numbers, dates, visas, salaries or personal facts. If a question needs a fact you don't have, set "needs_you": true, leave "answer" empty and say in "note" what's needed.
For multiple-choice questions, answer with one of the given options exactly.
Return ONLY JSON: {"answers":[{"id":"…","answer":"…","confidence":0-100,"needs_you":false,"note":"optional, short"}]${needCover ? ',"cover_letter":"~180 words, plain text, no placeholders except [Hiring Manager]"' : ""}}`,
        },
        {
          role: "user",
          content: [
            `CANDIDATE\n${candidateBrief(profile)}`,
            `EXPERIENCE\n${JSON.stringify(profile.experience ?? []).slice(0, 2500)}`,
            resumeText ? `RESUME (excerpt)\n${resumeText.slice(0, 3000)}` : "",
            reusable.length ? `SAVED ANSWERS (reuse and adapt)\n${reusable.join("\n")}` : "",
            memory.length ? `HOW THEY LIKE TO WORK\n- ${memory.join("\n- ")}` : "",
            `JOB\n${job.title} at ${job.company ?? "the company"}\n${job.description.slice(0, 6000)}`,
            open.length ? `QUESTIONS\n${open.map((f) => JSON.stringify({ id: f.id, question: f.label, options: f.options })).join("\n")}` : "",
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
    },
    (v) => {
      const o = v as { answers?: unknown; cover_letter?: unknown };
      if (!Array.isArray(o.answers)) throw new Error("no answers array");
      return { answers: o.answers as Draft[], cover_letter: typeof o.cover_letter === "string" ? o.cover_letter : undefined };
    },
  );
  return { drafts: new Map(data.answers.filter((a) => a && typeof a.id === "string").map((a) => [a.id, a])), cover: data.cover_letter?.trim() || undefined };
}

/** Save → Prepare: builds (or rebuilds) the application pack for a job. Your own edits are kept. */
export async function preparePack(supabase: SupabaseClient, user: User, jobId: string): Promise<Application> {
  const [{ data: job }, { data: jp }, { data: bankRows }, { data: existing }] = await Promise.all([
    supabase.from("jobs").select("id, title, company, url, apply_url, description, analysis, status").eq("id", jobId).single(),
    supabase.from("job_profiles").select("profile, resume_text").eq("user_id", user.id).maybeSingle(),
    supabase.from("answer_bank").select("key, question, answer, category"),
    supabase.from("applications").select("*").eq("job_id", jobId).maybeSingle(),
  ]);
  if (!job) throw new Error("Job not found");
  const profile = (jp?.profile ?? {}) as JobProfile;
  const bank = (bankRows ?? []) as BankEntry[];
  const applyUrl = (job.apply_url as string | null) || (job.url as string);
  const form = await readForm(applyUrl);
  const description = form.description && form.description.length > (job.description ?? "").length ? form.description : (job.description ?? "");

  let fields = fillForm(form.fields, bank, profile, user.email);
  // Keep answers you already edited (anything not an AI draft).
  const before = new Map(((existing?.fields ?? []) as PackField[]).map((f) => [f.id, f]));
  fields = fields.map((f) => {
    const old = before.get(f.id);
    return old && old.answer.trim() && old.source !== "ai" ? { ...f, answer: old.answer, source: old.source } : f;
  });

  const analysis = job.analysis as JobAnalysis | null;
  const haveCover = (existing?.cover_letter as string | null) || analysis?.cover_letter || "";
  const open = fields.filter((f) => f.source === "ai" && !f.answer.trim() && !/cover letter/i.test(f.label));
  let cover = haveCover;
  try {
    const { drafts, cover: drafted } = await draftOpenQuestions(supabase, user.id, { title: job.title, company: job.company, description }, profile, jp?.resume_text ?? "", bank, open, !haveCover);
    fields = fields.map((f) => {
      const d = drafts.get(f.id);
      if (!d || f.source !== "ai" || f.answer.trim()) return f;
      if (d.needs_you || !String(d.answer ?? "").trim()) return { ...f, source: "you", note: d.note?.slice(0, 200) || "Needs your answer" };
      return { ...f, answer: pickOption(String(d.answer).trim(), f.options), confidence: Math.max(0, Math.min(100, Number(d.confidence) || 70)), note: d.note?.slice(0, 200) };
    });
    if (drafted) cover = drafted;
  } catch {
    fields = fields.map((f) => (f.source === "ai" && !f.answer.trim() && !/cover letter/i.test(f.label) ? { ...f, source: "you", note: "The AI couldn't draft this right now — write it, or prepare again later" } : f));
  }
  fields = fields.map((f) => (/cover letter/i.test(f.label) && cover ? { ...f, answer: f.type === "file" ? "Upload the cover letter below as a PDF/text" : cover, source: "ai" } : f));

  const stats = packStats(fields);
  const now = new Date().toISOString();
  const event: TimelineEvent = { at: now, kind: "prepared", text: `${form.source === "greenhouse" ? "Read the company's form" : "Used common questions"} · ${stats.answered}/${stats.total} answered${stats.needYou ? ` · ${stats.needYou} need you` : ""}` };
  const row = {
    job_id: job.id,
    user_id: user.id,
    form_source: form.source,
    apply_url: applyUrl,
    fields,
    cover_letter: cover || null,
    prepared_at: now,
    timeline: [...((existing?.timeline ?? []) as TimelineEvent[]), event].slice(-50),
  };
  const { data, error } = await supabase.from("applications").upsert(row, { onConflict: "job_id" }).select("*").single();
  if (error) throw new Error(`${error.message} (did you run supabase/migrations/0005_planning_health_chat_memory.sql?)`);
  if (job.status === "new") await supabase.from("jobs").update({ status: "saved" }).eq("id", job.id);
  return data as Application;
}

/** Mark applied: snapshot what you submitted, remember new answers, move the job to Applied. */
export async function markApplied(supabase: SupabaseClient, user: User, jobId: string): Promise<Application> {
  const { data: app } = await supabase.from("applications").select("*").eq("job_id", jobId).maybeSingle();
  const now = new Date().toISOString();
  const fields = ((app?.fields ?? []) as PackField[]).filter((f) => f.type !== "file");

  // Answers you wrote yourself go into the answer bank, so the next form fills them in.
  const learn = fields.filter((f) => f.source === "you" && f.answer.trim() && !/cover letter/i.test(f.label));
  if (learn.length) {
    await supabase.from("answer_bank").upsert(
      learn.map((f) => {
        const std = standardFor(f.label);
        return { user_id: user.id, key: f.bankKey, question: (std && std.key === f.bankKey ? std.question : f.label).slice(0, 300), answer: f.answer.slice(0, 4000), category: std?.category ?? "other" };
      }),
      { onConflict: "user_id,key" },
    );
  }

  const row = {
    job_id: jobId,
    user_id: user.id,
    applied_at: now,
    submitted: { at: now, fields: fields.map((f) => ({ label: f.label, answer: f.answer })), cover_letter: (app?.cover_letter as string | null) ?? null },
    timeline: [...((app?.timeline ?? []) as TimelineEvent[]), { at: now, kind: "applied", text: learn.length ? `Applied · ${learn.length} new answer${learn.length > 1 ? "s" : ""} saved to your answer bank` : "Applied" }].slice(-50),
  };
  const { data, error } = await supabase.from("applications").upsert(row, { onConflict: "job_id" }).select("*").single();
  if (error) throw new Error(error.message);
  // The database trigger adds the "Follow up" task when a job becomes Applied.
  await supabase.from("jobs").update({ status: "applied", applied_at: now }).eq("id", jobId);
  return data as Application;
}
