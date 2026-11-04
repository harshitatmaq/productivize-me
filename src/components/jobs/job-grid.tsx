"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { useArrivedJobs } from "@/lib/queries/jobs";
import type { Job } from "@/lib/types";
import { cn } from "@/lib/utils";
import { JobCard } from "./job-card";

const PAGE = 40;

/**
 * Job cards that animate in as Scout finds them (Realtime inserts get a brief
 * accent glow) and paginate so long lists stay fast on phones.
 */
export function JobGrid({ jobs, onOpen, pageSize = PAGE }: { jobs: Job[]; onOpen: (j: Job) => void; pageSize?: number }) {
  const [limit, setLimit] = useState(pageSize);
  const arrived = useArrivedJobs();
  const shown = jobs.slice(0, limit);
  return (
    <>
      <div className="grid gap-3 md:grid-cols-2">
        <AnimatePresence initial={false} mode="popLayout">
          {shown.map((j) => {
            const fresh = arrived.has(j.id);
            return (
              <motion.div
                key={j.id}
                layout="position"
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.15 } }}
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
                className={cn("relative rounded-xl", fresh && "live-arrival")}
              >
                <JobCard job={j} onOpen={() => onOpen(j)} />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
      {jobs.length > limit ? (
        <div className="mt-4 flex justify-center">
          <button
            onClick={() => setLimit((l) => l + pageSize)}
            className="h-8 rounded-lg border border-line px-3 text-[12.5px] text-muted transition-colors hover:border-line-strong hover:text-fg"
          >
            Show {Math.min(pageSize, jobs.length - limit)} more · {jobs.length - limit} left
          </button>
        </div>
      ) : null}
    </>
  );
}
