"use client";

import { Clock, MessageCircleQuestion, ThumbsDown, ThumbsUp } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/misc";
import { useCheckIns } from "@/lib/queries/interests";
import type { MemoryQuestion } from "@/lib/types";
import { cn } from "@/lib/utils";

const LABELS: Record<MemoryQuestion["kind"], { yes: string; no: string }> = {
  confirm_interest: { yes: "Yes, that's me", no: "Not interested" },
  job_use: { yes: "Use it for jobs", no: "Don't" },
  exclude_term: { yes: "Hide them", no: "Keep showing" },
  confirm_fact: { yes: "That's right", no: "Not true" },
  fact_routine: { yes: "Make it a routine", no: "Keep it flexible" },
};

/** Scout's check-in questions (max 2 a day). Hidden when there's nothing to ask. */
export function CheckIns({ className }: { className?: string }) {
  const { questions, answer } = useCheckIns();
  if (!questions.length) return null;
  const reply = (q: MemoryQuestion, a: "yes" | "no" | "later") =>
    answer.mutate({ id: q.id, answer: a }, { onSuccess: (r) => toast.success(r.message), onError: (e) => toast.error((e as Error).message) });
  return (
    <Card className={cn("p-4", className)}>
      <div className="mb-3 flex items-center gap-2 text-[13px] font-medium text-fg">
        <MessageCircleQuestion className="h-4 w-4 text-accent" /> {questions.some((q) => q.kind.includes("fact")) ? "Quick question" : "Scout has a question"}
      </div>
      <div className="space-y-3">
        <AnimatePresence initial={false}>
          {questions.map((q) => (
            <motion.div key={q.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} className="space-y-2">
              <p className="text-[13px] leading-snug text-fg-2">{q.question}</p>
              {q.detail ? <p className="line-clamp-2 text-[11.5px] text-faint">{q.detail}</p> : null}
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="primary" onClick={() => reply(q, "yes")}>
                  <ThumbsUp className="h-3.5 w-3.5" /> {LABELS[q.kind].yes}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => reply(q, "no")}>
                  <ThumbsDown className="h-3.5 w-3.5" /> {LABELS[q.kind].no}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => reply(q, "later")}>
                  <Clock className="h-3.5 w-3.5" /> Later
                </Button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Card>
  );
}
