import { z } from "zod";
import { chatJson } from "@/lib/ai/llm";
import { handle, HttpError, requireUser } from "@/lib/auth";
import type { ResumeData } from "@/lib/jobs/types";

export const maxDuration = 90;

const Body = z.object({ jobId: z.string().uuid(), text: z.string().trim().min(200).max(20_000) });

/** Paste back the resume Claude/ChatGPT wrote → saved as this job's resume (rendered to the same PDF). */
export async function POST(request: Request) {
  return handle(async () => {
    const { user, supabase } = await requireUser();
    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new HttpError(400, "Paste the whole resume it wrote (at least a few paragraphs).");
    const { jobId, text } = parsed.data;
    const { data: job } = await supabase.from("jobs").select("title, company").eq("id", jobId).single();
    if (!job) throw new HttpError(404, "Job not found");

    const { data } = await chatJson<ResumeData>(
      {
        purpose: "resume-import",
        temperature: 0,
        maxTokens: 3500,
        messages: [
          {
            role: "system",
            content: `Convert a resume written in Markdown into JSON. Copy the wording exactly — do not rewrite, add or drop content (skip any "Gaps to close" section).
Return ONLY JSON: {"name":"","headline":"","contact":{"email":"","phone":"","location":"","links":[""]},"summary":"","skills":[{"group":"","items":[""]}],"experience":[{"role":"","company":"","location":"","start":"","end":"","bullets":[""]}],"projects":[{"name":"","description":"","tech":[""],"link":""}],"education":[{"degree":"","school":"","year":""}],"certifications":[""]}`,
          },
          { role: "user", content: text },
        ],
      },
      (v) => {
        const o = v as Partial<ResumeData>;
        if (!Array.isArray(o.experience) || !o.experience.length) throw new Error("no experience section");
        return o as ResumeData;
      },
    );
    const resume: ResumeData = { ...data, tailoredFor: { title: job.title, company: job.company } };
    const { data: app } = await supabase.from("applications").select("timeline").eq("job_id", jobId).maybeSingle();
    const timeline = [...((app?.timeline ?? []) as unknown[]), { at: new Date().toISOString(), kind: "resume", text: "Saved the resume version you tailored with Claude/ChatGPT" }].slice(-50);
    const { error } = await supabase.from("applications").upsert({ job_id: jobId, user_id: user.id, resume, timeline }, { onConflict: "job_id" });
    if (error) throw new HttpError(500, `${error.message} (did you run supabase/migrations/0005_planning_health_chat_memory.sql?)`);
    return { ok: true, resume };
  });
}
