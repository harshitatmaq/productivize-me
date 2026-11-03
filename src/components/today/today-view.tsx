"use client";

import { AlertCircle, ChevronDown, Moon, Sparkles, Sun } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useUi } from "@/components/shell/ui-store";
import { QuickAdd } from "@/components/tasks/quick-add";
import { TaskItem } from "@/components/tasks/task-item";
import { sortTasks } from "@/components/tasks/task-utils";
import { Button } from "@/components/ui/button";
import { ProgressRing, Skeleton } from "@/components/ui/misc";
import { useNowMinutes, useToday } from "@/lib/hooks";
import { useProfile } from "@/lib/queries/profile";
import { useCarryTasks, useTasks } from "@/lib/queries/tasks";
import { minutesOf } from "@/lib/time";
import { cn, plural } from "@/lib/utils";
import { TodayRail } from "./today-rail";

function greeting(minutes: number) {
  if (minutes < 5 * 60) return "Burning the midnight oil";
  if (minutes < 12 * 60) return "Good morning";
  if (minutes < 17 * 60) return "Good afternoon";
  return "Good evening";
}

export function TodayView() {
  const today = useToday();
  const now = useNowMinutes();
  const { data: tasks, isLoading } = useTasks();
  const { data: profile } = useProfile();
  const { setReviewOpen, editTask } = useUi();
  const carry = useCarryTasks();
  const params = useSearchParams();
  const router = useRouter();
  const [showDone, setShowDone] = useState(false);

  // Deep links from notifications: /?review=1 and /?task=<id>
  useEffect(() => {
    if (params.get("review")) {
      setReviewOpen(true);
      router.replace("/");
    }
  }, [params, setReviewOpen, router]);
  useEffect(() => {
    const id = params.get("task");
    if (id && tasks) {
      const t = tasks.find((x) => x.id === id);
      if (t) editTask(t);
      router.replace("/");
    }
  }, [params, tasks, editTask, router]);

  const { overdue, open, done } = useMemo(() => {
    const all = tasks ?? [];
    return {
      overdue: all.filter((t) => t.status === "todo" && t.due_date && t.due_date < today).sort(sortTasks),
      open: all.filter((t) => t.status === "todo" && t.due_date === today).sort(sortTasks),
      done: all
        .filter((t) => t.status === "done" && t.completed_at && new Date(t.completed_at).toDateString() === new Date().toDateString())
        .sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? "")),
    };
  }, [tasks, today]);

  const total = open.length + done.length;
  const dayEnd = profile ? minutesOf(profile.day_end_time) : 21 * 60;
  const wrapUp = now >= dayEnd - 60 && open.length > 0;
  const name = profile?.full_name?.split(" ")[0];

  const carryAll = (to: "today" | "tomorrow") =>
    carry.mutate(
      { to },
      {
        onSuccess: (r) => toast.success(`${plural(r.moved, "task")} moved to ${to}`),
        onError: (e) => toast.error((e as Error).message),
      },
    );

  return (
    <div className="mx-auto grid max-w-[1180px] gap-8 px-4 pt-5 md:px-8 md:pt-10 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <div className="mb-1 text-[12.5px] text-muted">
              {greeting(now)}
              {name ? `, ${name}` : ""}
            </div>
            <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-fg">Today</h1>
            <div className="mt-0.5 text-[13px] text-muted">
              {new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
            </div>
          </div>
          {total > 0 ? (
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-[13px] font-medium tabular-nums text-fg">
                  {done.length}/{total}
                </div>
                <div className="text-[11.5px] text-muted">done</div>
              </div>
              <ProgressRing value={total ? done.length / total : 0} size={40} stroke={4} color={done.length === total ? "var(--success)" : "var(--accent)"}>
                {done.length === total ? <Sparkles className="h-3.5 w-3.5 text-success" /> : null}
              </ProgressRing>
            </div>
          ) : null}
        </div>

        {overdue.length > 0 ? (
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-danger/25 bg-danger/[0.06] px-3.5 py-2.5 animate-fade-in">
            <AlertCircle className="h-4 w-4 shrink-0 text-danger" />
            <div className="min-w-0 flex-1 text-[13px] text-fg-2">
              <span className="font-medium text-fg">{plural(overdue.length, "task")}</span> left unfinished from earlier days.
            </div>
            <div className="flex gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => setReviewOpen(true)}>
                Review
              </Button>
              <Button size="sm" variant="secondary" onClick={() => carryAll("today")} loading={carry.isPending}>
                <Sun className="h-3.5 w-3.5" /> Move all to today
              </Button>
            </div>
          </div>
        ) : null}

        {wrapUp ? (
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-accent/25 bg-accent-soft px-3.5 py-2.5 animate-fade-in">
            <Moon className="h-4 w-4 shrink-0 text-accent" />
            <div className="min-w-0 flex-1 text-[13px] text-fg-2">
              Day&apos;s wrapping up — <span className="font-medium text-fg">{plural(open.length, "task")}</span> still open.
            </div>
            <div className="flex gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => setReviewOpen(true)}>
                Review
              </Button>
              <Button size="sm" variant="primary" onClick={() => carryAll("tomorrow")} loading={carry.isPending}>
                Carry to tomorrow
              </Button>
            </div>
          </div>
        ) : null}

        <QuickAdd defaultDate={today} className="mb-5" />

        {isLoading ? (
          <div className="space-y-3 px-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-[18px] w-[18px] rounded-full" />
                <Skeleton className="h-4 flex-1" />
              </div>
            ))}
          </div>
        ) : (
          <>
            {overdue.length ? (
              <section className="mb-5">
                <h2 className="mb-1 px-2.5 text-[12px] font-medium text-danger">Overdue · {overdue.length}</h2>
                <div>
                  {overdue.map((t) => (
                    <TaskItem key={t.id} task={t} />
                  ))}
                </div>
              </section>
            ) : null}

            <section className="mb-5">
              {overdue.length ? <h2 className="mb-1 px-2.5 text-[12px] font-medium text-muted">Today · {open.length}</h2> : null}
              {open.length ? (
                <div>
                  {open.map((t) => (
                    <TaskItem key={t.id} task={t} showDate={false} />
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-line-strong px-6 py-10 text-center">
                  <div className="text-[14px] font-medium text-fg">{done.length ? "All clear for today ✨" : "A blank page"}</div>
                  <div className="mt-1 text-[13px] text-muted">
                    {done.length ? "Everything planned is done. Pull something from Upcoming or rest." : "Add the 3 things that would make today a win."}
                  </div>
                </div>
              )}
            </section>

            {done.length ? (
              <section>
                <button
                  onClick={() => setShowDone((s) => !s)}
                  className="mb-1 flex items-center gap-1 px-2.5 text-[12px] font-medium text-muted hover:text-fg"
                >
                  <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !showDone && "-rotate-90")} />
                  Completed · {done.length}
                </button>
                {showDone ? (
                  <div className="animate-fade-in">
                    {done.map((t) => (
                      <TaskItem key={t.id} task={t} showDate={false} compact />
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}
          </>
        )}
      </div>
      <TodayRail />
    </div>
  );
}
