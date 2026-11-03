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
  /** Search hits whose title/company need cleaning up by the LLM. */
  needs_extraction?: boolean;
};

export type ScoredJob = RawJob & {
  score: number;
  verdict: string;
  reasons: string[];
  concerns: string[];
  seniority?: string | null;
};

export type WatchCompany = {
  ats: "greenhouse" | "lever" | "ashby" | "workable" | "smartrecruiters";
  slug: string;
  name?: string;
};

export type JobStatus = "new" | "saved" | "applied" | "interviewing" | "offer" | "rejected" | "archived";
