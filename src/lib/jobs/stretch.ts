/**
 * Stretch jobs (a reach, ~40-69 match): a detailed prompt you paste into
 * Claude or ChatGPT to tailor your resume, with honesty rules built in.
 * Pure: built in the browser from data you already have, no AI call.
 */
import type { JobAnalysis, JobProfile } from "./types";

export const isStretch = (score: number | null | undefined) => score != null && score >= 40 && score < 70;

export function stretchPrompt(input: {
  profile: JobProfile;
  resumeText?: string | null;
  job: { title: string; company: string | null; location?: string | null; url: string; description?: string | null };
  analysis?: JobAnalysis | null;
  learning?: string[];
}): string {
  const { profile, job, analysis } = input;
  const exp = (profile.experience ?? [])
    .map((e) => `- ${e.title} at ${e.company}${e.start ? ` (${e.start}–${e.end ?? "present"})` : ""}${e.highlights?.length ? `: ${e.highlights.join("; ")}` : ""}`)
    .join("\n");
  const parts = [
    `I'm applying for a role that's a bit of a stretch for me. Please rewrite my resume for it, honestly.`,
    `## The job\n${job.title}${job.company ? ` at ${job.company}` : ""}${job.location ? ` (${job.location})` : ""}\n${job.url}\n\n${(job.description ?? "").replace(/\s+\n/g, "\n").slice(0, 7000) || "(Open the link for the full description.)"}`,
    `## About me\n${[profile.headline, profile.current_title && `Current title: ${profile.current_title}`, profile.years_experience != null && `${profile.years_experience} years of experience`, profile.skills?.length && `Skills: ${profile.skills.join(", ")}`, profile.tools?.length && `Tools: ${profile.tools.join(", ")}`, profile.domains?.length && `Domains: ${profile.domains.join(", ")}`]
      .filter(Boolean)
      .join("\n")}${exp ? `\n\nExperience:\n${exp}` : ""}${profile.education?.length ? `\n\nEducation: ${profile.education.map((e) => `${e.degree}, ${e.school}${e.year ? ` (${e.year})` : ""}`).join("; ")}` : ""}${profile.certifications?.length ? `\nCertifications: ${profile.certifications.join(", ")}` : ""}`,
    input.resumeText?.trim() ? `## My current resume (text)\n${input.resumeText.slice(0, 6000)}` : `(I'll attach my resume file in this chat.)`,
    analysis?.gaps?.length ? `## Gaps already identified\n${analysis.gaps.map((g) => `- ${g}`).join("\n")}` : "",
    analysis?.strengths?.length ? `## Strengths for this role\n${analysis.strengths.map((g) => `- ${g}`).join("\n")}` : "",
    input.learning?.length ? `## What I'm learning right now (relevant)\n${input.learning.map((l) => `- ${l}`).join("\n")}` : "",
    `## Rules
- Never invent employers, titles, dates, numbers, tools or results. Reframe and reorder what's real.
- Lead with the experience most relevant to this job and use the job's own language for things I've actually done.
- If a requirement isn't covered, don't fake it: list it under "Gaps to close" at the end with one concrete way to close each.
- Keep it to one or two pages, ATS-friendly (no tables or columns).

## Output
Markdown with these sections: Name and contact line, Summary (2–3 lines), Skills (grouped), Experience (role, company, dates, 3–5 impact-first bullets each), Projects (max 3), Education, Certifications, then "Gaps to close".`,
  ];
  return parts.filter(Boolean).join("\n\n");
}
