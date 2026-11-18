"use client";

import { Flame } from "lucide-react";
import { useNow } from "@/lib/hooks";
import { applyToday } from "@/lib/jobs/board";
import type { Job } from "@/lib/types";
import { timeAgo } from "@/lib/utils";
import { CompanyLogo, ScoreBadge } from "./job-bits";

/** Jobs → Matches: the 5 freshest strong fits — apply while few people have. */
export function ApplyToday({ jobs, onOpen, minScore = 70 }: { jobs: Job[]; onOpen: (j: Job) => void; minScore?: number }) {
  const now = useNow(60_000);
  const picks = applyToday(jobs, now, { minScore });
  if (!picks.length) return null;
  return (
    <section className="mb-4 rounded-xl border border-accent/30 bg-accent/[0.04] p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[12.5px] font-medium text-fg">
        <Flame className="h-3.5 w-3.5 text-warning" /> Apply today
        <span className="font-normal text-muted">· strong fits posted in the last 3 days — early applications get seen first</span>
      </div>
      <ul className="divide-y divide-line/60">
        {picks.map((j) => (
          <li key={j.id}>
            <button type="button" onClick={() => onOpen(j)} className="flex w-full items-center gap-3 rounded-md px-1 py-2 text-left hover:bg-panel-hover">
              <CompanyLogo name={j.company} domain={j.company_domain} logo={j.company_logo} size={28} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-fg">{j.title}</span>
                <span className="block truncate text-[11.5px] text-muted">
                  {j.company ?? "Unknown company"} · posted {timeAgo(j.posted_at ?? j.created_at)}
                  {j.status === "saved" ? " · saved" : ""}
                </span>
              </span>
              <ScoreBadge score={j.score} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
