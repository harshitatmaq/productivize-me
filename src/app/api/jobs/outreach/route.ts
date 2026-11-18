import { z } from "zod";
import { chatJson } from "@/lib/ai/llm";
import { handle, HttpError, requireUser } from "@/lib/auth";
import { candidateBrief } from "@/lib/jobs/profile";
import type { JobAnalysis, JobProfile } from "@/lib/jobs/types";
import { postingText } from "@/lib/jobs/integrity";

export const maxDuration = 60;

const Body = z.object({ jobId: z.string().uuid() });
export type Outreach = { referral: string; recruiter: string; follow_up: string };

/** Short, personal messages you send yourself: a referral ask, a note to the recruiter, a follow-up. */
export async function POST(request: Request) {
  return handle(async () => {
    const { user, supabase } = await requireUser();
    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new HttpError(400, "Invalid request");
    const [{ data: job }, { data: jp }] = await Promise.all([
      supabase.from("jobs").select("title, company, url, description, analysis").eq("id", parsed.data.jobId).single(),
      supabase.from("job_profiles").select("profile").eq("user_id", user.id).maybeSingle(),
    ]);
    if (!job) throw new HttpError(404, "Job not found");
    const analysis = job.analysis as JobAnalysis | null;
    const { data } = await chatJson<Outreach>(
      {
        purpose: "outreach",
        temperature: 0.5,
        maxTokens: 900,
        messages: [
          {
            role: "system",
            content: `Write three short LinkedIn messages a candidate will send themselves. Warm, specific, confident, no clichés, no flattery, no invented facts.
- "referral": to an employee at the company they don't know yet: who they are in one line, why this role, one concrete relevant thing they've done, a clear small ask (a referral or a 10-minute chat). Max 80 words. Start with "Hi [Name],".
- "recruiter": to the recruiter/hiring manager after applying: the role, one line of fit with a specific achievement, offer to share more. Max 70 words. Start with "Hi [Name],".
- "follow_up": a polite follow-up 5-7 days after applying with no reply. Max 50 words.
Return ONLY JSON: {"referral":"…","recruiter":"…","follow_up":"…"}`,
          },
          {
            role: "user",
            content: `CANDIDATE\n${candidateBrief((jp?.profile ?? {}) as JobProfile)}\n\nJOB\n${job.title} at ${job.company ?? "the company"}\n${job.url}\n${analysis?.strengths?.length ? `Strengths for this role: ${analysis.strengths.join("; ")}\n` : ""}${postingText(job.description).slice(0, 2500)}`,
          },
        ],
      },
      (v) => {
        const o = v as Partial<Outreach>;
        if (typeof o.referral !== "string" || typeof o.recruiter !== "string") throw new Error("missing messages");
        return { referral: o.referral.trim(), recruiter: o.recruiter.trim(), follow_up: String(o.follow_up ?? "").trim() };
      },
    );
    return data;
  });
}
