import { z } from "zod";
import { chatJson } from "@/lib/ai/llm";
import { handle, HttpError, requireUser } from "@/lib/auth";
import type { JobAnalysis, JobProfile, ResumeData } from "@/lib/jobs/types";
import { normalizePortfolio, portfolioFromProfile, type PortfolioData } from "@/lib/portfolio";

export const maxDuration = 120;

const Body = z.object({ jobId: z.string().uuid().optional() });

function baseResume(p: PortfolioData, email?: string | null): ResumeData {
  return {
    name: p.name,
    headline: p.headline,
    contact: {
      email: p.links.email ?? email ?? undefined,
      location: p.location,
      links: [p.links.linkedin, p.links.github, p.links.website].filter((x): x is string => !!x),
    },
    summary: p.about.split(/\n{2,}/)[0] ?? "",
    skills: p.skills,
    experience: p.experience.map((e) => ({ role: e.role, company: e.company, location: e.location, start: e.start, end: e.end || "Present", bullets: e.bullets })),
    projects: p.projects.map((x) => ({ name: x.name, description: x.description, tech: x.tech, link: x.url || x.repo })),
    education: p.education,
    certifications: p.certifications,
  };
}

/**
 * Structured resume for the PDF. Without a job: your portfolio as a resume.
 * With a job: the LLM rewrites the summary and bullets for that role (truthfully).
 */
export async function POST(request: Request) {
  return handle(async () => {
    const { user, supabase } = await requireUser();
    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new HttpError(400, "Invalid request");
    const [{ data: portfolio }, { data: jp }] = await Promise.all([
      supabase.from("portfolios").select("data").eq("user_id", user.id).maybeSingle(),
      supabase.from("job_profiles").select("profile, resume_text").eq("user_id", user.id).maybeSingle(),
    ]);
    const profile = (jp?.profile as JobProfile) ?? {};
    const source = portfolio ? normalizePortfolio(portfolio.data) : portfolioFromProfile(profile, { email: user.email });
    if (!source.name && !source.experience.length) {
      throw new HttpError(422, "Fill in your Portfolio (or finish Scout's interview) first — the resume is built from it.");
    }
    const base = baseResume(source, user.email);
    if (!parsed.data.jobId) return { ok: true, resume: base, tailored: false };

    const { data: job } = await supabase.from("jobs").select("title, company, description, analysis").eq("id", parsed.data.jobId).single();
    if (!job) throw new HttpError(404, "Job not found");
    const analysis = job.analysis as JobAnalysis | null;
    try {
      const { data } = await chatJson<Partial<ResumeData>>(
        {
          messages: [
            {
              role: "system",
              content: `You tailor resumes. Rewrite the candidate's resume for the target job:
- a 2-3 line summary aimed at this role
- reorder skill groups/items so the job's keywords come first
- rewrite each role's bullets (max 5, impact-first, using the job's language) — never invent employers, numbers or tools the candidate doesn't have
- keep projects relevant to the role (max 3)
Return ONLY JSON with the same shape as the input resume (name, headline, contact, summary, skills, experience, projects, education, certifications).`,
            },
            {
              role: "user",
              content: `RESUME\n${JSON.stringify(base)}\n\nEXTRA CONTEXT FROM THEIR ORIGINAL RESUME\n${(jp?.resume_text ?? "").slice(0, 5000)}\n\nTARGET JOB: ${job.title} @ ${job.company ?? ""}\n${(job.description ?? "").slice(0, 6000)}\n\n${
                analysis ? `ANALYSIS\nKeywords: ${analysis.keywords.join(", ")}\nSuggested bullets: ${analysis.resume_bullets.join(" | ")}` : ""
              }`,
            },
          ],
          temperature: 0.3,
          maxTokens: 3500,
          purpose: "resume",
        },
        (v) => {
          const o = v as Partial<ResumeData>;
          if (!Array.isArray(o.experience)) throw new Error("bad resume");
          return o;
        },
      );
      const resume: ResumeData = {
        ...base,
        ...data,
        name: base.name,
        contact: base.contact,
        education: base.education,
        certifications: data.certifications ?? base.certifications,
        tailoredFor: { title: job.title, company: job.company },
      };
      return { ok: true, resume, tailored: true };
    } catch {
      // AI unavailable: still useful — add the analysis bullets as a highlights block.
      const resume: ResumeData = {
        ...base,
        summary: analysis?.summary ?? base.summary,
        experience: base.experience.map((e, i) => (i === 0 && analysis?.resume_bullets?.length ? { ...e, bullets: analysis.resume_bullets.slice(0, 5) } : e)),
        tailoredFor: { title: job.title, company: job.company },
      };
      return { ok: true, resume, tailored: false };
    }
  });
}
