"use client";

import { ArrowRight, Check, Moon, Sun, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useUi } from "@/components/shell/ui-store";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/misc";
import { useToday } from "@/lib/hooks";
import { addDays } from "@/lib/time";
import { useCarryTasks, useTasks, useUpdateTask } from "@/lib/queries/tasks";
import { cn, plural } from "@/lib/utils";
import { RescheduleMenu } from "./reschedule-menu";
import { dateLabel, PRIORITY_COLOR } from "./task-utils";

/**
 * Review of unfinished tasks: carry each (or all) forward, finish, or drop.
 * Opened from the end-of-day notification (/?review=1) or the overdue banner.
 */
export function CarryReview() {
  const { reviewOpen, setReviewOpen } = useUi();
  const today = useToday();
  const { data: tasks = [] } = useTasks();
  const update = useUpdateTask();
  const carry = useCarryTasks();
  const [scope, setScope] = useState<"overdue" | "today">("overdue");

  const overdue = useMemo(() => tasks.filter((t) => t.status === "todo" && t.due_date && t.due_date < today), [tasks, today]);
  const todayOpen = useMemo(() => tasks.filter((t) => t.status === "todo" && t.due_date === today), [tasks, today]);
  const hour = new Date().getHours();
  const effectiveScope = overdue.length === 0 || (hour >= 17 && scope !== "overdue") ? "today" : scope;
  const list = effectiveScope === "overdue" ? overdue : [...overdue, ...todayOpen];
  const target = effectiveScope === "overdue" ? today : addDays(today, 1);

  const carryAll = () => {
    carry.mutate(
      { to: effectiveScope === "overdue" ? "today" : "tomorrow" },
      {
        onSuccess: (r) => {
          toast.success(`${plural(r.moved, "task")} moved to ${dateLabel(r.to, today).toLowerCase()}`);
          setReviewOpen(false);
        },
        onError: (e) => toast.error((e as Error).message),
      },
    );
  };

  const carryOne = (id: string, to: string) => {
    carry.mutate({ to, ids: [id] }, { onError: (e) => toast.error((e as Error).message) });
  };

  return (
    <Dialog
      open={reviewOpen}
      onOpenChange={setReviewOpen}
      title={effectiveScope === "overdue" ? "Unfinished from earlier days" : "Wrap up your day"}
      description={
        list.length
          ? `${plural(list.length, "task")} still open. Carry forward, reschedule, finish or let go.`
          : "Nothing left open. Nice work!"
      }
      size="md"
      footer={
        list.length ? (
          <>
            <Button variant="ghost" onClick={() => setReviewOpen(false)}>
              Later
            </Button>
            <Button variant="primary" onClick={carryAll} loading={carry.isPending}>
              {effectiveScope === "overdue" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
              Carry all to {effectiveScope === "overdue" ? "today" : "tomorrow"}
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={() => setReviewOpen(false)}>
            Done
          </Button>
        )
      }
    >
      {overdue.length && todayOpen.length ? (
        <div className="mb-3 flex gap-1.5">
          <button
            onClick={() => setScope("overdue")}
            className={cn("rounded-md px-2 py-1 text-xs", effectiveScope === "overdue" ? "bg-accent-soft text-accent" : "text-muted hover:text-fg")}
          >
            Overdue ({overdue.length})
          </button>
          <button
            onClick={() => setScope("today")}
            className={cn("rounded-md px-2 py-1 text-xs", effectiveScope === "today" ? "bg-accent-soft text-accent" : "text-muted hover:text-fg")}
          >
            Overdue + today ({overdue.length + todayOpen.length})
          </button>
        </div>
      ) : null}
      {list.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted">🎉 Everything is wrapped up.</div>
      ) : (
        <ul className="-mx-2 divide-y divide-line">
          {list.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-2 py-2.5">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: PRIORITY_COLOR[t.priority] }} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] text-fg">{t.title}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-muted">
                  <span className={cn(t.due_date! < today && "text-danger")}>{dateLabel(t.due_date!, today)}</span>
                  {t.carry_count > 0 ? <Badge tone="warning">carried {t.carry_count}×</Badge> : null}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button size="xs" variant="secondary" onClick={() => carryOne(t.id, target)} title={`Move to ${dateLabel(target, today)}`}>
                  <ArrowRight className="h-3 w-3" />
                  {effectiveScope === "overdue" ? "Today" : "Tmrw"}
                </Button>
                <RescheduleMenu
                  onPick={(d) => (d ? carryOne(t.id, d) : update.mutate({ id: t.id, patch: { due_date: null } }))}
                  trigger={
                    <Button size="xs" variant="ghost">
                      Pick…
                    </Button>
                  }
                />
                <Button size="icon-sm" variant="ghost" title="Mark done" onClick={() => update.mutate({ id: t.id, patch: { status: "done" } })}>
                  <Check className="h-3.5 w-3.5 text-success" />
                </Button>
                <Button size="icon-sm" variant="ghost" title="Drop it" onClick={() => update.mutate({ id: t.id, patch: { status: "dropped" } })}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
