"use client";

import { AlertCircle, Check, Loader2, Server } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Tip } from "@/components/ui/menu";
import type { JobRun } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Names for the source ids used in run stats (sources.ts). */
export const RUN_SOURCE_LABELS: Record<string, string> = {
  web: "Web search",
  gmail: "Gmail alerts",
  jobspy_linkedin: "LinkedIn",
  jobspy_naukri: "Naukri",
  jobspy_indeed: "Indeed",
  jobspy_glassdoor: "Glassdoor",
  seed: "Curated career sites",
  jsearch: "JSearch",
  serpapi: "Google Jobs",
  adzuna: "Adzuna",
  jooble: "Jooble",
  ats: "Your companies",
  hn: "Hacker News",
  remotive: "Remotive",
  himalayas: "Himalayas",
  remoteok: "Remote OK",
  jobicy: "Jobicy",
  arbeitnow: "Arbeitnow",
};

export const runSourceLabel = (id: string) => RUN_SOURCE_LABELS[id] ?? id;

/**
 * The "Scout is searching" timeline: current stage plus one pill per source,
 * each flipping from a spinner to its count (or an error) as results arrive.
 */
export function LiveRun({ run, found, className }: { run: JobRun; found?: number; className?: string }) {
  const sources = Object.entries(run.stats?.sources ?? {}).filter(([, s]) => !s.skipped);
  const done = sources.filter(([, s]) => !s.running).length;
  const pct = sources.length ? Math.round((done / sources.length) * 100) : 8;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      className={cn("overflow-hidden rounded-xl border border-accent/25 bg-accent/[0.04]", className)}
    >
      <div className="relative h-0.5 bg-accent/10">
        <motion.div className="absolute inset-y-0 left-0 bg-accent" initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ type: "spring", stiffness: 60, damping: 20 }} />
      </div>
      <div className="p-3.5">
        <div className="flex items-center gap-2 text-[13px]">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
          </span>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={run.stats?.stage ?? "starting"} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="font-medium text-fg">
              {run.stats?.stage ?? "Starting"}…
            </motion.span>
          </AnimatePresence>
          <span className="ml-auto flex items-center gap-1.5 text-[11.5px] text-faint">
            {found !== undefined ? <span className="tabular-nums text-fg-2">{found} found</span> : null}
            {run.worker ? (
              <span className="inline-flex items-center gap-1">
                <Server className="h-3 w-3" /> {run.worker}
              </span>
            ) : (
              <span>in the app</span>
            )}
          </span>
        </div>
        {sources.length ? (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {sources.map(([id, s]) => (
              <Tip key={id} content={s.error ?? (s.running ? "searching…" : `${s.fetched} listings`)}>
                <motion.span
                  layout
                  className={cn(
                    "inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[11.5px] transition-colors",
                    s.running && "border-accent/30 text-fg-2",
                    !s.running && !s.error && "border-success/30 bg-success/[0.06] text-fg-2",
                    s.error && "border-danger/30 text-danger",
                  )}
                >
                  {s.running ? (
                    <Loader2 className="h-3 w-3 animate-spin text-accent" />
                  ) : s.error ? (
                    <AlertCircle className="h-3 w-3" />
                  ) : (
                    <Check className="h-3 w-3 text-success" />
                  )}
                  {runSourceLabel(id)}
                  {!s.running && !s.error ? (
                    <motion.span initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} className="tabular-nums text-faint">
                      {s.fetched}
                    </motion.span>
                  ) : null}
                </motion.span>
              </Tip>
            ))}
          </div>
        ) : null}
      </div>
    </motion.div>
  );
}
