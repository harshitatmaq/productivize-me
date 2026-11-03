import type { JobAnalysis, JobProfile, JobStatus, SearchPlan, WatchCompany } from "@/lib/jobs/types";
import type { PortfolioData } from "@/lib/portfolio";
import type { ReminderFrequency } from "@/lib/recurrence";
import type { TaskRecurrence } from "@/lib/nlp";

export type Task = {
  id: string;
  user_id: string;
  title: string;
  notes: string | null;
  due_date: string | null;
  due_time: string | null;
  priority: 1 | 2 | 3 | 4;
  tags: string[];
  status: "todo" | "done" | "dropped";
  completed_at: string | null;
  sort_order: number;
  estimate_minutes: number | null;
  reminder_at: string | null;
  reminder_sent_at: string | null;
  recurrence: TaskRecurrence | null;
  carry_count: number;
  original_due_date: string | null;
  last_carried_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Reminder = {
  id: string;
  title: string;
  notes: string | null;
  frequency: ReminderFrequency;
  time_of_day: string;
  days_of_week: number[];
  day_of_month: number | null;
  month_of_year: number | null;
  start_date: string;
  next_fire_at: string | null;
  last_fired_at: string | null;
  active: boolean;
  url: string | null;
  created_at: string;
};

export type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  timezone: string;
  week_starts_on: number;
  morning_brief_enabled: boolean;
  day_start_time: string;
  eod_review_enabled: boolean;
  day_end_time: string;
  learning_reminder_enabled: boolean;
  learning_reminder_time: string;
  learning_goal_per_week: number;
  learning_skip_when_goal_met: boolean;
  weekly_review_enabled: boolean;
  monthly_review_enabled: boolean;
  auto_carry_forward: boolean;
  notify_push: boolean;
  notify_email: boolean;
  email_daily_digest: boolean;
  email_weekly_review: boolean;
  email_alerts: boolean;
  job_search_enabled: boolean;
  job_alert_min_score: number;
};

export type AppNotification = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  url: string | null;
  channels: string[];
  read_at: string | null;
  created_at: string;
};

export type LearningEntry = {
  id: string;
  entry_date: string;
  title: string;
  content: string | null;
  tags: string[];
  minutes: number | null;
  resources: { title?: string; url: string }[];
  confidence: number | null;
  questions: string | null;
  review_count: number;
  last_reviewed_at: string | null;
  created_at: string;
};

export type ChatItem = {
  role: "user" | "assistant";
  content: string;
  at?: string;
  progress?: number;
  suggestions?: string[];
  provider?: string;
};

export type JobProfileRow = {
  user_id: string;
  status: "new" | "onboarding" | "ready";
  profile: JobProfile;
  resume_text: string | null;
  chat: ChatItem[];
  search_plan: Partial<SearchPlan>;
  search_plan_at: string | null;
  watch_companies: WatchCompany[];
  disabled_sources: string[];
  last_search_at: string | null;
};

export type Job = {
  id: string;
  source: string;
  url: string;
  title: string;
  company: string | null;
  company_domain: string | null;
  company_logo: string | null;
  location: string | null;
  remote: boolean | null;
  employment_type: string | null;
  seniority: string | null;
  salary: string | null;
  description: string | null;
  posted_at: string | null;
  score: number | null;
  verdict: string | null;
  reasons: string[];
  concerns: string[];
  tags: string[];
  status: JobStatus;
  seen_at: string | null;
  applied_at: string | null;
  next_step: string | null;
  next_step_date: string | null;
  notes: string | null;
  analysis: JobAnalysis | null;
  created_at: string;
  updated_at: string;
};

export type JobRun = {
  id: string;
  trigger: string;
  status: string;
  stats: {
    fetched?: number;
    unique?: number;
    fresh?: number;
    scored?: number;
    inserted?: number;
    strong?: number;
    providers?: string[];
    sources?: Record<string, { fetched: number; error?: string; skipped?: string }>;
    log?: string[];
    ms?: number;
  };
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

export type PortfolioRow = {
  user_id: string;
  slug: string | null;
  is_public: boolean;
  data: PortfolioData;
  accent: string;
  updated_at: string;
};
