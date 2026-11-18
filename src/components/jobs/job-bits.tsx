"use client";

import { useState } from "react";
import { Ban, Eye, Repeat } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/menu";
import { useJobProfile, useUpdateJob, useUpdateJobProfile } from "@/lib/queries/jobs";
import { boardForJob, isWatched } from "@/lib/jobs/ats-url";
import type { Job } from "@/lib/types";
import { cn } from "@/lib/utils";

const PALETTE = ["#5e6ad2", "#2f9e6e", "#d9730d", "#c2410c", "#7c3aed", "#0e7490", "#be185d", "#4d7c0f"];

export function CompanyLogo({ name, domain, logo, size = 36 }: { name?: string | null; domain?: string | null; logo?: string | null; size?: number }) {
  const [failed, setFailed] = useState(0);
  const sources = [logo, domain && !/linkedin|naukri|indeed|glassdoor|greenhouse|lever|ashby|workable|google/.test(domain) ? `https://www.google.com/s2/favicons?domain=${domain}&sz=128` : null].filter(
    Boolean,
  ) as string[];
  const src = sources[failed];
  const letter = (name ?? "?").trim()[0]?.toUpperCase() ?? "?";
  const color = PALETTE[(name ?? "").split("").reduce((s, c) => s + c.charCodeAt(0), 0) % PALETTE.length];
  return (
    <span
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-panel-2"
      style={{ width: size, height: size }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-contain p-1" onError={() => setFailed((f) => f + 1)} loading="lazy" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-[13px] font-semibold text-white" style={{ background: color }}>
          {letter}
        </span>
      )}
    </span>
  );
}

export function scoreTone(score: number | null | undefined) {
  const s = score ?? 0;
  if (s >= 85) return { text: "text-success", bg: "bg-success/12", ring: "var(--success)", label: "Excellent" };
  if (s >= 70) return { text: "text-accent", bg: "bg-accent-soft", ring: "var(--accent)", label: "Strong" };
  if (s >= 55) return { text: "text-warning", bg: "bg-warning/12", ring: "var(--warning)", label: "Decent" };
  return { text: "text-muted", bg: "bg-panel-2", ring: "var(--faint)", label: "Stretch" };
}

export function ScoreBadge({ score, className }: { score: number | null; className?: string }) {
  const t = scoreTone(score);
  return (
    <span className={cn("inline-flex h-7 min-w-10 items-center justify-center rounded-lg px-1.5 text-[12.5px] font-semibold tabular-nums", t.bg, t.text, className)}>
      {score ?? "–"}
    </span>
  );
}

export function sourceLabel(source: string) {
  const [base, sub] = source.split(":");
  const names: Record<string, string> = {
    web: "Web",
    jsearch: "JSearch",
    google: "Google Jobs",
    adzuna: "Adzuna",
    jooble: "Jooble",
    remotive: "Remotive",
    remoteok: "Remote OK",
    himalayas: "Himalayas",
    jobicy: "Jobicy",
    arbeitnow: "Arbeitnow",
    greenhouse: "Greenhouse",
    lever: "Lever",
    ashby: "Ashby",
    workable: "Workable",
    smartrecruiters: "SmartRecruiters",
    workday: "Workday",
    hn: "Hacker News",
    jobspy: "",
    email: "Email alert",
    manual: "Added by you",
  };
  const sites: Record<string, string> = { linkedin: "LinkedIn", naukri: "Naukri", indeed: "Indeed", glassdoor: "Glassdoor", wellfound: "Wellfound", instahyre: "Instahyre", foundit: "Foundit" };
  if (base === "web") return "Web search";
  if (base === "jobspy") return sites[sub] ?? sub;
  if (base === "email") return `${sites[sub] ?? sub ?? "Job"} alert email`;
  return sub ? `${names[base] ?? base} · ${sub}` : (names[base] ?? base);
}

export const STATUS_META: Record<string, { label: string; color: string }> = {
  new: { label: "New", color: "var(--faint)" },
  saved: { label: "Saved", color: "var(--p3)" },
  applied: { label: "Applied", color: "var(--accent)" },
  interviewing: { label: "Interviewing", color: "var(--warning)" },
  offer: { label: "Offer", color: "var(--success)" },
  rejected: { label: "Rejected", color: "var(--danger)" },
  archived: { label: "Hidden", color: "var(--faint)" },
};

/** "No longer accepting applications?" — removes the job from the board in one click (with undo). */
export function MarkClosedButton({ job, variant = "icon" }: { job: Job; variant?: "icon" | "button" }) {
  const update = useUpdateJob();
  if (job.closed_at) return null;
  const mark = () => {
    const prev = { status: job.status, closed_at: job.closed_at ?? null, closed_reason: job.closed_reason ?? null };
    update.mutate({ id: job.id, patch: { closed_at: new Date().toISOString(), closed_reason: "You marked it closed", ...(job.status === "new" ? { status: "archived" } : {}) } });
    toast("Removed — no longer accepting applications", { action: { label: "Undo", onClick: () => update.mutate({ id: job.id, patch: prev }) } });
  };
  return variant === "icon" ? (
    <Tip content="No longer accepting applications? Remove it">
      <button onClick={mark} aria-label="Mark as closed" className="rounded-md p-1.5 text-faint transition-colors hover:bg-panel-hover hover:text-danger">
        <Ban className="h-3.5 w-3.5" />
      </button>
    </Tip>
  ) : (
    <Button size="xs" variant="ghost" onClick={mark}>
      <Ban className="h-3.5 w-3.5" /> It&apos;s closed
    </Button>
  );
}

/** "Asks 3+ years · mid level · only hires in India". */
export function requirementsLabel(job: Pick<Job, "requirements">): string | null {
  const r = job.requirements;
  if (!r) return null;
  const parts = [r.min_years != null ? `asks ${r.min_years}${r.max_years ? `–${r.max_years}` : "+"} yrs` : "", r.level && r.level !== "mid" ? `${r.level} level` : r.level === "mid" ? "mid level" : "", r.restricted_to?.length ? `only ${r.restricted_to.slice(0, 2).join(", ")}` : ""].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}


/** "Reposted 2×" — the same company posted this role again under new links. */
export function RepostBadge({ job, compact = false }: { job: Pick<Job, "signals">; compact?: boolean }) {
  const n = job.signals?.reposts?.length ?? 0;
  if (!n) return null;
  const tip =
    n >= 2
      ? `Posted ${n + 1} times under new links. Could be an evergreen or "ghost" listing — a referral or a recruiter message is worth more than a cold apply here.`
      : "Posted again under a new link. Once is normal (a refresh); more often can mean an evergreen listing.";
  return (
    <Tip content={tip}>
      <span
        tabIndex={0}
        className={cn(
          "inline-flex items-center gap-1 rounded px-1 font-semibold uppercase tracking-wide",
          compact ? "text-[10px]" : "h-6 rounded-md px-2 text-[11.5px] normal-case tracking-normal",
          n >= 2 ? "bg-warning/15 text-warning" : "bg-panel-2 text-muted",
        )}
      >
        <Repeat className="h-3 w-3" /> {compact ? `repost${n > 1 ? ` ${n}×` : ""}` : `Reposted ${n}×`}
      </span>
    </Tip>
  );
}

const FIT_LABELS: [keyof NonNullable<NonNullable<Job["signals"]>["fit"]>, string, string][] = [
  ["skills", "Skills", "Core skills and tools"],
  ["experience", "Experience", "Years and seniority"],
  ["location", "Location", "Location, remote and work authorization"],
  ["growth", "Growth", "Moves you toward your target roles"],
];

/** The four sub-scores behind a match. */
export function FitBreakdown({ job }: { job: Pick<Job, "signals"> }) {
  const fit = job.signals?.fit;
  if (!fit) return null;
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
      {FIT_LABELS.map(([k, label, tip]) => {
        const v = fit[k];
        const t = scoreTone(v);
        return (
          <Tip key={k} content={tip}>
            <div tabIndex={0} className="min-w-0">
              <div className="flex items-baseline justify-between text-[12px]">
                <span className="text-muted">{label}</span>
                <span className={cn("font-medium tabular-nums", t.text)}>{v}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel-2">
                <div className="h-full rounded-full" style={{ width: `${v}%`, background: t.ring }} />
              </div>
            </div>
          </Tip>
        );
      })}
    </div>
  );
}

/** Watch the company's own job board (found from the job's apply link). */
export function WatchCompanyButton({ job }: { job: Pick<Job, "url" | "apply_url" | "company"> }) {
  const { data: row } = useJobProfile();
  const update = useUpdateJobProfile();
  const board = boardForJob(job);
  if (!board || !row) return null;
  if (isWatched(board, row.watch_companies)) {
    return (
      <Tip content={`Scout checks ${board.name}'s own job board for new roles`}>
        <span tabIndex={0} className="inline-flex items-center gap-1 text-[12px] text-success">
          <Eye className="h-3.5 w-3.5" /> Watching {board.name}
        </span>
      </Tip>
    );
  }
  return (
    <Tip content={`Adds ${board.name}'s own job board (${board.ats}) to your watched companies — their new roles show up within hours, straight from the source`}>
      <Button
        size="xs"
        variant="ghost"
        loading={update.isPending}
        onClick={() =>
          update.mutate(
            { watch_companies: [...(row.watch_companies ?? []), board] },
            { onSuccess: () => toast.success(`Watching ${board.name}`), onError: (e) => toast.error((e as Error).message) },
          )
        }
      >
        <Eye className="h-3.5 w-3.5" /> Watch {board.name}
      </Button>
    </Tip>
  );
}
