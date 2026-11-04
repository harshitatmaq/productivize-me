import { z } from "zod";
import { chatJson } from "@/lib/ai/llm";
import { handle, HttpError, requireUser } from "@/lib/auth";
import { candidateBrief } from "@/lib/jobs/profile";
import type { JobAnalysis, JobProfile } from "@/lib/jobs/types";
import { readPage } from "@/lib/search/web";

export const maxDuration = 120;

const Body = z.object({ id: z.string().uuid() });



/** Deep-dive on one job: fetches the full posting and writes tailored application material. */
export async function POST(request: Request) {
  return handle(async () => {
    const { user, supabase } = await requireUser();
    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new HttpError(400, "Invalid request");
    const [{ data: job }, { data: jp }] = await Promise.all([
      supabase.from("jobs").select("*").eq("id", parsed.data.id).single(),
      supabase.from("job_profiles").select("profile, resume_text").eq("user_id", user.id).maybeSingle(),
    ]);
    if (!job) throw new HttpError(404, "Job not found");
    const profile = (jp?.profile as JobProfile) ?? {};

    let description: string = job.description ?? "";
    if (description.length < 1500) {
      const page = await readPage(job.url, 10_000);
      if (page && page.length > description.length) description = page;
    }

    const { data, provider } = await chatJson<Omit<JobAnalysis, "generated_at">>(
      {
        messages: [
          {
            role: "system",
            content: `You are an expert career coach. Analyse the job against the candidate and write tailored, truthful material.
Never invent experience the candidate doesn't have; reframe real experience instead.
Return ONLY JSON: {"fit_score":0-100,"summary":"2-3 sentences","strengths":["..."],"gaps":["... with how to address"],
"resume_bullets":["5 tailored, quantified resume bullets using the job's language"],"keywords":["ATS keywords to include"],
"cover_letter":"~180 word cover letter, plain text, no placeholders other than [Hiring Manager] if needed",
"interview_prep":["5 likely questions with a hint each"],"questions_to_ask":["3 sharp questions for the interviewer"]}`,
          },
          {
            role: "user",
            content: `CANDIDATE\n${candidateBrief(profile)}\n\nEXPERIENCE\n${JSON.stringify(profile.experience ?? []).slice(0, 3000)}\n\nRESUME (excerpt)\n${(jp?.resume_text ?? "").slice(0, 4000)}\n\nJOB\nTitle: ${job.title}\nCompany: ${job.company ?? "unknown"}\nLocation: ${job.location ?? "n/a"}\nURL: ${job.url}\n\n${description.slice(0, 9000)}`,
          },
        ],
        temperature: 0.4,
        maxTokens: 3000,
        purpose: "job-analysis",
      },
      (v) => {
        const o = v as Record<string, unknown>;
        if (typeof o.summary !== "string") throw new Error("missing summary");
        const arr = (x: unknown) => (Array.isArray(x) ? x.map(String) : []);
        return {
          fit_score: Math.max(0, Math.min(100, Number(o.fit_score) || 0)),
          summary: o.summary,
          strengths: arr(o.strengths),
          gaps: arr(o.gaps),
          resume_bullets: arr(o.resume_bullets),
          keywords: arr(o.keywords),
          cover_letter: String(o.cover_letter ?? ""),
          interview_prep: arr(o.interview_prep),
          questions_to_ask: arr(o.questions_to_ask),
        };
      },
    );
    const analysis: JobAnalysis = { ...data, generated_at: new Date().toISOString(), provider };
    await supabase
      .from("jobs")
      .update({ analysis, description: description.length > (job.description ?? "").length ? description.slice(0, 12000) : job.description })
      .eq("id", job.id);
    return { ok: true, analysis };
  });
}
