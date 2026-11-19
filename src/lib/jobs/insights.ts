/**
 * What's working in your job search: reply and interview rates by how you applied,
 * where you found the job, match score and resume, plus applications gone quiet.
 * Pure (computed from your own jobs and applications).
 */

export type InsightJob = { id: string; title: string; company: string | null; status: string; source: string; score: number | null; applied_at: string | null };
export type InsightApp = { job_id: string; applied_at: string | null; timeline: { at: string; kind: string }[] | null; channel?: string | null; tailored?: boolean | null };

export type Outcome = "interview" | "rejected" | "silent" | "waiting";

export const CHANNELS = [
  { value: "direct", label: "Applied directly" },
  { value: "referral", label: "Referral" },
  { value: "recruiter", label: "Recruiter reached out" },
  { value: "easy", label: "Easy Apply / job board" },
] as const;
export type Channel = (typeof CHANNELS)[number]["value"];

/** No reply after this many days counts as silence. */
export const SILENT_AFTER_DAYS = 21;
/** Applications quiet for this long are worth a follow-up. */
export const FOLLOW_UP_AFTER_DAYS = 10;

const DAY = 86_400_000;
const REPLY_KINDS = new Set(["interview", "offer", "rejected"]);

/** What happened to one application (and how many days the first reply took). */
export function outcomeOf(job: InsightJob, app: InsightApp | undefined, now: number): { outcome: Outcome; replyDays?: number; days: number } {
  const appliedAt = Date.parse(job.applied_at ?? app?.applied_at ?? "");
  const days = Number.isFinite(appliedAt) ? Math.max(0, Math.floor((now - appliedAt) / DAY)) : 0;
  const events = (app?.timeline ?? []).filter((e) => REPLY_KINDS.has(e.kind)).sort((a, b) => a.at.localeCompare(b.at));
  const first = events.find((e) => !Number.isFinite(appliedAt) || Date.parse(e.at) >= appliedAt);
  const replyDays = first && Number.isFinite(appliedAt) ? Math.max(0, Math.round((Date.parse(first.at) - appliedAt) / DAY)) : undefined;
  const interviewed = job.status === "interviewing" || job.status === "offer" || events.some((e) => e.kind === "interview" || e.kind === "offer");
  if (interviewed) return { outcome: "interview", replyDays, days };
  if (job.status === "rejected" || events.some((e) => e.kind === "rejected")) return { outcome: "rejected", replyDays, days };
  return { outcome: days >= SILENT_AFTER_DAYS ? "silent" : "waiting", days };
}

export function channelLabel(channel: string | null | undefined): string {
  return CHANNELS.find((c) => c.value === channel)?.label ?? "Not recorded";
}

/** Where the job was found, grouped. */
export function sourceGroup(source: string): string {
  const [base, sub] = source.split(":");
  if (base === "jobspy") return sub === "linkedin" ? "LinkedIn" : sub === "naukri" ? "Naukri" : "Indeed / Glassdoor";
  if (base === "email") return sub === "linkedin" ? "LinkedIn" : sub === "naukri" ? "Naukri" : "Job alert emails";
  if (["greenhouse", "lever", "ashby", "workable", "smartrecruiters", "workday", "ats", "seed"].includes(base)) return "Company job board";
  if (base === "web" || base === "google" || base === "jsearch") return "Web / Google Jobs";
  if (base === "shared" || base === "manual") return "Added by you";
  return "Other boards";
}

export function scoreBand(score: number | null): string {
  if (score == null) return "Not scored";
  if (score >= 75) return "Match 75+";
  if (score >= 60) return "Match 60–74";
  return "Match under 60";
}

export type InsightRow = { label: string; applied: number; decided: number; replies: number; interviews: number; rate: number | null };
export type InsightGroup = { title: string; rows: InsightRow[] };
export type Insights = {
  applied: number;
  decided: number;
  replies: number;
  interviews: number;
  replyRate: number | null;
  interviewRate: number | null;
  medianReplyDays: number | null;
  waiting: number;
  groups: InsightGroup[];
  quiet: { id: string; title: string; company: string | null; days: number }[];
  week: { applied: number; replies: number };
  /** One plain-language observation, only when the numbers clearly differ. */
  tip: string | null;
  /** Enough decided applications for the rates to mean something. */
  enough: boolean;
};

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : null);

export function applicationInsights(jobs: InsightJob[], apps: InsightApp[], now: number): Insights {
  const byJob = new Map(apps.map((a) => [a.job_id, a]));
  const applied = jobs.filter((j) => j.applied_at || byJob.get(j.id)?.applied_at || ["applied", "interviewing", "offer", "rejected"].includes(j.status));
  const rows = applied.map((j) => {
    const app = byJob.get(j.id);
    return { job: j, app, ...outcomeOf(j, app, now) };
  });

  const decidedRows = rows.filter((r) => r.outcome !== "waiting");
  const replies = decidedRows.filter((r) => r.outcome === "interview" || r.outcome === "rejected").length;
  const interviews = decidedRows.filter((r) => r.outcome === "interview").length;
  const replyDays = rows.map((r) => r.replyDays).filter((d): d is number => d != null).sort((a, b) => a - b);

  const group = (title: string, key: (r: (typeof rows)[number]) => string, order?: string[]): InsightGroup => {
    const map = new Map<string, InsightRow>();
    for (const r of rows) {
      const label = key(r);
      const row = map.get(label) ?? { label, applied: 0, decided: 0, replies: 0, interviews: 0, rate: null };
      row.applied++;
      if (r.outcome !== "waiting") row.decided++;
      if (r.outcome === "interview" || r.outcome === "rejected") row.replies++;
      if (r.outcome === "interview") row.interviews++;
      map.set(label, row);
    }
    const list = [...map.values()].map((r) => ({ ...r, rate: pct(r.replies, r.decided) }));
    list.sort((a, b) => (order ? order.indexOf(a.label) - order.indexOf(b.label) : b.applied - a.applied));
    return { title, rows: list };
  };

  const groups = [
    group("How you applied", (r) => channelLabel(r.app?.channel), [...CHANNELS.map((c) => c.label), "Not recorded"]),
    group("Where you found it", (r) => sourceGroup(r.job.source)),
    group("Match score", (r) => scoreBand(r.job.score), ["Match 75+", "Match 60–74", "Match under 60", "Not scored"]),
    group("Resume", (r) => (r.app?.tailored ? "Tailored resume" : "Standard resume"), ["Tailored resume", "Standard resume"]),
  ].filter((g) => g.rows.length > 1 || g.rows.some((r) => r.label !== "Not recorded"));

  // A tip only when two options each have 3+ decided applications and differ by 20+ points.
  let tip: string | null = null;
  let bestGap = 0;
  for (const g of groups) {
    const ready = g.rows.filter((r) => r.decided >= 3 && r.rate != null && r.label !== "Not recorded" && r.label !== "Not scored");
    if (ready.length < 2) continue;
    const sorted = [...ready].sort((a, b) => b.rate! - a.rate!);
    const [best, worst] = [sorted[0], sorted[sorted.length - 1]];
    const gap = best.rate! - worst.rate!;
    if (gap >= 20 && gap > bestGap) {
      bestGap = gap;
      tip = `${best.label}: ${best.rate}% got a reply, vs ${worst.rate}% for ${worst.label.charAt(0).toLowerCase()}${worst.label.slice(1)}.`;
    }
  }

  const quiet = rows
    .filter((r) => r.job.status === "applied" && r.outcome !== "interview" && r.outcome !== "rejected" && r.days >= FOLLOW_UP_AFTER_DAYS && r.days <= 45)
    .sort((a, b) => b.days - a.days)
    .slice(0, 5)
    .map((r) => ({ id: r.job.id, title: r.job.title, company: r.job.company, days: r.days }));

  const weekAgo = now - 7 * DAY;
  const week = {
    applied: rows.filter((r) => Date.parse(r.job.applied_at ?? r.app?.applied_at ?? "") >= weekAgo).length,
    replies: rows.filter((r) => (r.app?.timeline ?? []).some((e) => REPLY_KINDS.has(e.kind) && Date.parse(e.at) >= weekAgo)).length,
  };

  return {
    applied: rows.length,
    decided: decidedRows.length,
    replies,
    interviews,
    replyRate: pct(replies, decidedRows.length),
    interviewRate: pct(interviews, decidedRows.length),
    medianReplyDays: replyDays.length ? replyDays[Math.floor(replyDays.length / 2)] : null,
    waiting: rows.length - decidedRows.length,
    groups,
    quiet,
    week,
    tip,
    enough: decidedRows.length >= 5,
  };
}

/** One line for the weekly review: "Job search: 5 applied this week · 1 reply · 2 quiet 10+ days". */
export function weeklyLine(i: Insights): string | null {
  if (!i.applied) return null;
  const parts = [`${i.week.applied} applied this week`, `${i.week.replies} repl${i.week.replies === 1 ? "y" : "ies"}`];
  if (i.quiet.length) parts.push(`${i.quiet.length} quiet ${FOLLOW_UP_AFTER_DAYS}+ days — follow up`);
  return `Job search: ${parts.join(" · ")}${i.tip ? `. ${i.tip}` : ""}`;
}
