"use client";

import { Check, ExternalLink, MapPin, Wallet, Clock, Wifi } from "lucide-react";
import { JobFeedback } from "./job-feedback";
import { Tip } from "@/components/ui/menu";
import type { Job } from "@/lib/types";
import { cn, timeAgo } from "@/lib/utils";
import { CompanyLogo, ScoreBadge, sourceLabel } from "./job-bits";

export function JobCard({ job, onOpen }: { job: Job; onOpen: () => void }) {
  const fresh = !job.seen_at && job.status === "new";

  return (
    <article
      onClick={onOpen}
      className={cn(
        "group relative cursor-pointer rounded-xl border border-line bg-panel p-4 transition-all duration-150 hover:-translate-y-[1px] hover:border-line-strong hover:shadow-card",
        fresh && "border-accent/30",
      )}
    >
      <div className="flex items-start gap-3">
        <CompanyLogo name={job.company} domain={job.company_domain} logo={job.company_logo} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="line-clamp-2 text-[14px] font-medium leading-snug text-fg">{job.title}</h3>
              <div className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-muted">
                <span className="truncate">{job.company ?? "Unknown company"}</span>
                {fresh ? <span className="rounded bg-accent px-1 text-[10px] font-semibold uppercase tracking-wide text-white">new</span> : null}
              </div>
            </div>
            <Tip content={job.verdict ? `${job.verdict} match` : "match score"}>
              <span>
                <ScoreBadge score={job.score} />
              </span>
            </Tip>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
            {job.location ? (
              <span className="inline-flex max-w-[220px] items-center gap-1 truncate">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate">{job.location}</span>
              </span>
            ) : null}
            {job.remote ? (
              <span className="inline-flex items-center gap-1 text-success">
                <Wifi className="h-3 w-3" /> Remote
              </span>
            ) : null}
            {job.salary ? (
              <span className="inline-flex items-center gap-1">
                <Wallet className="h-3 w-3" /> {job.salary}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" /> {timeAgo(job.posted_at ?? job.created_at)}
            </span>
          </div>

          {job.reasons?.length ? (
            <ul className="mt-2.5 space-y-1">
              {job.reasons.slice(0, 2).map((r, i) => (
                <li key={i} className="flex gap-1.5 text-[12.5px] leading-snug text-fg-2">
                  <Check className="mt-0.5 h-3 w-3 shrink-0 text-success" />
                  <span className="line-clamp-1">{r}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="truncate text-[11px] text-faint">{sourceLabel(job.source)}</span>
            <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
              <JobFeedback job={job} />
              <a
                href={job.apply_url ?? job.url}
                target="_blank"
                rel="noreferrer"
                className="ml-1 inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[12px] text-fg-2 hover:border-line-strong hover:text-fg"
              >
                Apply <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
