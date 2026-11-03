import type { JobProfile } from "@/lib/jobs/types";

export type PortfolioLinks = {
  github?: string;
  linkedin?: string;
  website?: string;
  twitter?: string;
  resume?: string;
  email?: string;
};

export type PortfolioData = {
  name: string;
  headline: string;
  location?: string;
  avatar_url?: string;
  open_to_work?: boolean;
  availability?: string;
  about: string;
  links: PortfolioLinks;
  skills: { group: string; items: string[] }[];
  experience: { role: string; company: string; start?: string; end?: string; location?: string; bullets: string[] }[];
  projects: { name: string; description: string; tech: string[]; url?: string; repo?: string; image?: string; featured?: boolean }[];
  education: { degree: string; school: string; year?: string }[];
  certifications: string[];
  achievements: string[];
};

export const EMPTY_PORTFOLIO: PortfolioData = {
  name: "",
  headline: "",
  about: "",
  links: {},
  skills: [],
  experience: [],
  projects: [],
  education: [],
  certifications: [],
  achievements: [],
};

export function normalizePortfolio(data: unknown): PortfolioData {
  const d = (data && typeof data === "object" ? data : {}) as Partial<PortfolioData>;
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    ...EMPTY_PORTFOLIO,
    ...d,
    name: d.name ?? "",
    headline: d.headline ?? "",
    about: d.about ?? "",
    links: d.links ?? {},
    skills: arr<PortfolioData["skills"][number]>(d.skills).map((s) => ({ group: s.group ?? "", items: arr<string>(s.items) })),
    experience: arr<PortfolioData["experience"][number]>(d.experience).map((e) => ({ ...e, bullets: arr<string>(e.bullets) })),
    projects: arr<PortfolioData["projects"][number]>(d.projects).map((p) => ({ ...p, tech: arr<string>(p.tech) })),
    education: arr(d.education),
    certifications: arr(d.certifications),
    achievements: arr(d.achievements),
  };
}

/** Straight mapping from the job-search profile (no AI needed). */
export function portfolioFromProfile(p: JobProfile, extra: { name?: string; email?: string } = {}): PortfolioData {
  const skills: PortfolioData["skills"] = [];
  if (p.skills?.length) skills.push({ group: "Core", items: p.skills.slice(0, 16) });
  if (p.tools?.length) skills.push({ group: "Tools", items: p.tools.slice(0, 12) });
  if (p.domains?.length) skills.push({ group: "Domains", items: p.domains.slice(0, 8) });
  return {
    ...EMPTY_PORTFOLIO,
    name: p.name ?? extra.name ?? "",
    headline: p.headline ?? p.current_title ?? "",
    location: p.locations?.[0],
    open_to_work: true,
    about: p.summary ?? "",
    links: {
      github: p.links?.github,
      linkedin: p.links?.linkedin,
      website: p.links?.portfolio,
      email: extra.email,
    },
    skills,
    experience: (p.experience ?? []).map((e) => ({
      role: e.title,
      company: e.company,
      start: e.start,
      end: e.end,
      location: e.location,
      bullets: e.highlights ?? [],
    })),
    projects: [],
    education: p.education ?? [],
    certifications: p.certifications ?? [],
    achievements: [],
  };
}
