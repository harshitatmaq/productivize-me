"use client";

import { useState } from "react";
import { Ban } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/menu";
import { useUpdateJob } from "@/lib/queries/jobs";
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

