export type RemotePreference = "remote" | "hybrid" | "onsite" | "any";

/** Structured candidate profile, built by the onboarding agent and editable by the user. */
export type JobProfile = {
  name?: string;
  headline?: string;
  summary?: string;
  current_title?: string;
  years_experience?: number;
  skills?: string[];
  tools?: string[];
  domains?: string[];
  experience?: {
    title: string;
    company: string;
    start?: string;
    end?: string;
    location?: string;
    highlights?: string[];
  }[];
  education?: { degree: string; school: string; year?: string }[];
  certifications?: string[];
  target_titles?: string[];
  seniority?: string[];
  locations?: string[];
  countries?: string[];
  remote?: RemotePreference;
  open_to_relocate?: boolean;
  work_authorization?: string;
  salary_expectation?: string;
  notice_period?: string;
  job_types?: string[];
  industries?: string[];
  company_preferences?: string;
  target_companies?: string[];
  avoid_companies?: string[];
  include_keywords?: string[];
  exclude_keywords?: string[];
  must_haves?: string[];
  deal_breakers?: string[];
  languages?: string[];
  links?: { linkedin?: string; github?: string; portfolio?: string; other?: string };
  notes?: string;
};

export type WebQuery = { q: string; domains?: "india" | "ats" | "global" | "startups" | "remote" };

/** What the hourly search actually looks for; regenerated from the profile daily. */
export type SearchPlan = {
  titles: string[];
  keywords: string[];
  locations: string[];
  countries: string[];
  remote: RemotePreference;
  exclude: string[];
  web_queries: WebQuery[];
};

export type RawJob = {
  source: string;
  external_id?: string;
  url: string;
  title: string;
  company?: string | null;
  company_domain?: string | null;
  company_logo?: string | null;
  location?: string | null;
  remote?: boolean | null;
  employment_type?: string | null;
  salary?: string | null;
  description?: string | null;
  posted_at?: string | null;
  tags?: string[];
  /** Direct application link when it differs from the listing URL. */
  apply_url?: string | null;
  /** Search hits whose title/company need cleaning up by the LLM. */
  needs_extraction?: boolean;
  /** The job board's own level label ("Mid-level", "Entry level"), when it gives one. */
  board_level?: string | null;
  /** The job board's own experience field ("0-2 Yrs" on Naukri). */
  board_years?: string | null;
  /** Countries/regions a remote job is limited to, from the board's own field. */
  board_restrictions?: string[];
  /** What the posting asks for (set by the fit rules). */
  requirements?: import("./fit-rules").Requirements;
  /** Sub-scores and flags the app shows with the job (stored in jobs.signals). */
  signals?: JobSignals;
};

export type ScoredJob = RawJob & {
  score: number;
  verdict: string;
  reasons: string[];
  concerns: string[];
  seniority?: string | null;
};

/** Extra facts about a job, stored in jobs.signals. */
export type JobSignals = {
  /** Sub-scores (0-100) behind the overall match. */
  fit?: { skills: number; experience: number; location: number; growth: number };
  /** The deal-breaker from your profile this job breaks. */
  deal_breaker?: string;
  /** Sentences addressed to AI tools that were removed from the description. */
  hidden_text?: string[];
  /** Hashes of other links where the same company posted the same role again. */
  reposts?: string[];
  reposted_at?: string;
};

export type WatchCompany = {
  ats: "greenhouse" | "lever" | "ashby" | "workable" | "smartrecruiters" | "workday";
  /** For Workday: "<host>/<site>", e.g. "nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite". */
  slug: string;
  name?: string;
  /** Found automatically from the "dream companies" list. */
  auto?: boolean;
};

export type JobStatus = "new" | "saved" | "applied" | "interviewing" | "offer" | "rejected" | "archived";

export type JobAnalysis = {
  fit_score: number;
  summary: string;
  strengths: string[];
  gaps: string[];
  resume_bullets: string[];
  keywords: string[];
  cover_letter: string;
  interview_prep: string[];
  questions_to_ask: string[];
  generated_at: string;
  provider?: string;
};

/** Structured resume used for the tailored PDF. */
export type ResumeData = {
  name: string;
  headline?: string;
  contact: { email?: string; phone?: string; location?: string; links: string[] };
  summary?: string;
  skills: { group: string; items: string[] }[];
  experience: { role: string; company: string; location?: string; start?: string; end?: string; bullets: string[] }[];
  projects: { name: string; description: string; tech: string[]; link?: string }[];
  education: { degree: string; school: string; year?: string }[];
  certifications: string[];
  tailoredFor?: { title: string; company?: string | null };
};
