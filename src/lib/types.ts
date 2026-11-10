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
  recurrence_interval: number;
  recurrence_days: number[];
  series_id: string | null;
  actual_minutes: number;
  job_id: string | null;
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
  calendar_token: string | null;
  share_progress: boolean;
  /** How you like your day to run — Plan my day follows it. */
  planning: import("@/lib/planning").PlanningPrefs;
  health: import("@/lib/health").HealthSettings;
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
  ats_discovery: Record<string, { at: string; found: WatchCompany | null }>;
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
  feedback: -1 | 1 | null;
  feedback_reason: string | null;
  feedback_at: string | null;
  semantic_score: number | null;
  follow_up_task_id: string | null;
  /** Direct application link (company ATS) when it differs from the listing. */
  apply_url: string | null;
  ats: string | null;
  /** Your interests this job mentions (with their job relevance at the time). */
  interest_matches: { id: string; name: string; relevance: number }[];
  /** Set when the job was found by a "Search & ask Scout" query. */
  search_id: string | null;
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
    sources?: Record<string, { fetched: number; error?: string; skipped?: string; running?: boolean }>;
    log?: string[];
    ms?: number;
    /** What the run is doing right now (cleared when it finishes). */
    stage?: string;
  };
  error: string | null;
  worker: string | null;
  search_id: string | null;
  started_at: string;
  finished_at: string | null;
};

export type SavedSearch = {
  id: string;
  query: string;
  plan: Partial<SearchPlan> & { companies?: string[]; posted_within_days?: number | null; summary?: string };
  saved: boolean;
  alerts: boolean;
  result_count: number;
  last_run_at: string | null;
  created_at: string;
};

export type PortfolioRow = {
  user_id: string;
  slug: string | null;
  is_public: boolean;
  data: PortfolioData;
  accent: string;
  updated_at: string;
};

export type Flashcard = {
  id: string;
  entry_id: string | null;
  front: string;
  back: string;
  tags: string[];
  card: import("@/lib/fsrs").StoredCard;
  due: string;
  reps: number;
  lapses: number;
  suspended: boolean;
  last_reviewed_at: string | null;
  created_at: string;
};

export type FocusSession = {
  id: string;
  task_id: string | null;
  kind: "focus" | "pomodoro" | "stopwatch";
  started_at: string;
  ended_at: string;
  minutes: number;
};

export type BuddyStats = {
  user_id: string;
  name: string;
  is_me: boolean;
  tasks_done_week: number;
  tasks_done_today: number;
  tasks_open_today: number;
  learning_days_week: number;
  learning_goal: number;
  learning_streak: number;
  applications_week: number;
  focus_minutes_week: number;
  last_active: string | null;
};

// ---------------------------------------------------------------------------
// Shared dashboards ("spaces")
// ---------------------------------------------------------------------------
export type Space = { id: string; name: string; emoji: string; owner_id: string; created_at: string; updated_at: string };
export type SpacePerson = {
  user_id: string;
  name: string;
  email: string | null;
  role: "owner" | "member";
  joined_at: string;
  /** Identity colour in this dashboard (unique per dashboard). */
  color: string | null;
};
export type SpaceInvite = {
  id: string;
  space_id: string;
  email: string;
  invited_by: string | null;
  status: "pending" | "accepted" | "declined" | "revoked";
  created_at: string;
};
export type ShareKind = "task" | "job" | "learning" | "link" | "flashcards" | "interest" | "note";
export type SpaceItem = {
  id: string;
  space_id: string;
  kind: ShareKind;
  title: string;
  body: string | null;
  payload: Record<string, unknown>;
  note: string | null;
  shared_by: string | null;
  source_id: string | null;
  done: boolean;
  done_by: string | null;
  done_at: string | null;
  status: string | null;
  created_at: string;
  updated_at: string;
};
export type SpaceComment = { id: string; space_id: string; item_id: string; user_id: string; body: string; created_at: string };
export type SpaceReaction = { item_id: string; space_id: string; user_id: string; emoji: string; created_at: string };
export type SpaceList = { id: string; space_id: string; title: string; created_by: string | null; sort: number; created_at: string };
export type SpaceListItem = {
  id: string;
  list_id: string;
  space_id: string;
  text: string;
  done: boolean;
  done_by: string | null;
  done_at: string | null;
  created_by: string | null;
  sort: number;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Interests + career memory
// ---------------------------------------------------------------------------
export type InterestKind = "career" | "learning" | "hobby";
export type InterestEvidence = { type: string; id?: string; label: string; at?: string; minutes?: number };
export type Interest = {
  id: string;
  name: string;
  kind: InterestKind;
  stage: "curious" | "learning" | "using" | "strong";
  strength: number;
  job_relevance: number | null;
  relevance_reason: string | null;
  job_use: "auto" | "always" | "never";
  status: "active" | "suggested" | "not_interested";
  source: "manual" | "scout";
  evidence: InterestEvidence[];
  evidence_count: number;
  minutes: number;
  notes: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};
export type MemoryQuestion = {
  id: string;
  interest_id: string | null;
  kind: "confirm_interest" | "job_use" | "exclude_term";
  question: string;
  detail: string | null;
  term: string | null;
  status: "pending" | "answered" | "dismissed";
  snooze_until: string | null;
  shown_on: string | null;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
export type Exercise = {
  id: string;
  name: string;
  day_type: import("@/lib/health").DayType;
  measure: import("@/lib/health").Measure;
  target_sets: number;
  reps_min: number;
  reps_max: number;
  increment: number;
  sort: number;
  archived: boolean;
};
export type Workout = {
  id: string;
  date: string;
  day_type: import("@/lib/health").DayType | "other" | null;
  status: "done" | "rest" | "skipped";
  duration_min: number | null;
  notes: string | null;
  created_at: string;
};
export type WorkoutSet = {
  id: string;
  workout_id: string;
  exercise_id: string | null;
  exercise_name: string;
  set_no: number;
  reps: number | null;
  weight: number | null;
};
export type BodyMetric = { id: string; date: string; weight: number | null; body_fat: number | null; waist: number | null; note: string | null };
