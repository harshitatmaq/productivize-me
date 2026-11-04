"use client";

import { ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { Menu, MenuItem, MenuLabel, Tip } from "@/components/ui/menu";
import { useUpdateJob } from "@/lib/queries/jobs";
import type { Job } from "@/lib/types";
import { cn } from "@/lib/utils";

const REASONS = ["Wrong kind of role", "Too senior", "Too junior", "Location / remote", "Not this company", "Pay too low", "Tech stack", "Just not for me"];

/** 👍 = "more like this" (also saves it). 👎 = hide + tell Scout why. Both train the hourly search. */
export function JobFeedback({ job, size = "sm" }: { job: Job; size?: "sm" | "md" }) {
  const update = useUpdateJob();
  const now = () => new Date().toISOString();
  const icon = size === "md" ? "h-4 w-4" : "h-4 w-4";
  const like = () => {
    if (job.feedback === 1) {
      update.mutate({ id: job.id, patch: { feedback: null, feedback_at: null } });
      return;
    }
    update.mutate({
      id: job.id,
      patch: { feedback: 1, feedback_reason: null, feedback_at: now(), ...(job.status === "new" ? { status: "saved" } : {}) },
    });
    toast.success("Saved — Scout will look for more like this");
  };
  const dislike = (reason: string) => {
    update.mutate({ id: job.id, patch: { feedback: -1, feedback_reason: reason, feedback_at: now(), status: "archived" } });
    toast("Hidden — Scout will learn from it", {
      action: { label: "Undo", onClick: () => update.mutate({ id: job.id, patch: { feedback: null, feedback_reason: null, status: job.status } }) },
    });
  };
  return (
    <>
      <Tip content={job.feedback === 1 ? "Liked" : "More like this"}>
        <button
          onClick={like}
          className={cn("rounded-md p-1.5 hover:bg-panel-hover", job.feedback === 1 ? "text-success" : "text-faint hover:text-fg")}
          aria-label="More like this"
          aria-pressed={job.feedback === 1}
        >
          <ThumbsUp className={icon} fill={job.feedback === 1 ? "currentColor" : "none"} />
        </button>
      </Tip>
      <Menu
        trigger={
          <button
            className={cn("rounded-md p-1.5 hover:bg-panel-hover", job.feedback === -1 ? "text-danger" : "text-faint hover:text-fg")}
            aria-label="Not interested"
          >
            <ThumbsDown className={icon} />
          </button>
        }
      >
        <MenuLabel>Not interested because…</MenuLabel>
        {REASONS.map((r) => (
          <MenuItem key={r} onSelect={() => dislike(r)}>
            {r}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
