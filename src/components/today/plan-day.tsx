"use client";

import { CalendarClock, Sparkles, Wand2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/misc";
import { useToday } from "@/lib/hooks";
import { useProfile } from "@/lib/queries/profile";
import { useCarryTasks, useTasks, useUpdateTask } from "@/lib/queries/tasks";
import type { DayPlan } from "@/app/api/tasks/plan/route";
import { api } from "@/lib/utils";
import { formatTime } from "@/components/tasks/task-utils";

/** "Plan my day": AI orders today's tasks into time blocks; apply the order (and optionally times). */
export function PlanDay() {
  const today = useToday();
  const { data: profile } = useProfile();
  const { data: tasks = [] } = useTasks();
  const update = useUpdateTask();
  const carry = useCarryTasks();
  const [open, setOpen] = useState(false);
  const [energy, setEnergy] = useState<"low" | "normal" | "high">("normal");
  const [plan, setPlan] = useState<DayPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [setTimes, setSetTimes] = useState(true);
  const byId = new Map(tasks.map((t) => [t.id, t]));

  const generate = async () => {
    setLoading(true);
    try {
      const d = new Date();
      const now = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      const r = await api<{ plan: DayPlan }>("/api/tasks/plan", {
        json: { date: today, now, dayEnd: profile?.day_end_time?.slice(0, 5), energy },
      });
      setPlan(r.plan);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const apply = () => {
    if (!plan) return;
    const base = Date.now() / 1000;
    plan.blocks.forEach((b, i) => {
      const t = byId.get(b.task_id);
      if (!t) return;
      update.mutate({
        id: t.id,
        patch: {
          sort_order: base + i,
          // Pull overdue items into today and, if asked, give un-timed tasks their slot.
          ...(t.due_date !== today ? { due_date: today } : {}),
          ...(setTimes && !t.due_time ? { due_time: b.start } : {}),
        },
      });
    });
    if (plan.defer.length) {
      carry.mutate({ to: "tomorrow", ids: plan.defer.map((d) => d.task_id) });
    }
    toast.success(`Plan applied${plan.defer.length ? ` · ${plan.defer.length} moved to tomorrow` : ""}`);
    setOpen(false);
    setPlan(null);
  };

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Wand2 className="h-3.5 w-3.5" /> Plan my day
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setPlan(null);
        }}
        title="Plan my day"
        description="The AI orders what's left today around fixed-time tasks, estimates and priorities."
        size="md"
        footer={
          plan ? (
            <>
              <label className="mr-auto flex items-center gap-2 text-[12.5px] text-muted">
                <input type="checkbox" checked={setTimes} onChange={(e) => setSetTimes(e.target.checked)} />
                Also set times on un-timed tasks
              </label>
              <Button variant="ghost" onClick={() => setPlan(null)}>
                Redo
              </Button>
              <Button variant="primary" onClick={apply}>
                Apply plan
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={generate} loading={loading}>
              <Sparkles className="h-3.5 w-3.5" /> Build my plan
            </Button>
          )
        }
      >
        {!plan ? (
          <div className="space-y-3">
            <div className="text-[13px] text-fg-2">How&apos;s your energy right now?</div>
            <Segmented
              value={energy}
              onChange={setEnergy}
              options={[
                { value: "low", label: "Low 🪫" },
                { value: "normal", label: "Normal" },
                { value: "high", label: "High ⚡" },
              ]}
            />
            <p className="text-[12px] text-muted">Tip: add estimates like “~30m” when you create tasks — plans get much more realistic.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {plan.summary ? <p className="text-[13px] leading-relaxed text-fg-2">{plan.summary}</p> : null}
            <ol className="relative space-y-2 border-l border-line pl-4">
              {plan.blocks.map((b) => (
                <li key={b.task_id} className="relative">
                  <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-accent" />
                  <div className="flex items-baseline gap-2">
                    <span className="w-[92px] shrink-0 font-mono text-[12px] tabular-nums text-muted">
                      {formatTime(b.start)}–{formatTime(b.end)}
                    </span>
                    <span className="text-[13.5px] text-fg">{byId.get(b.task_id)?.title ?? "Task"}</span>
                  </div>
                  {b.note ? <div className="ml-[100px] text-[12px] text-faint">{b.note}</div> : null}
                </li>
              ))}
            </ol>
            {plan.defer.length ? (
              <div className="rounded-lg border border-warning/25 bg-warning/8 p-3 text-[12.5px]">
                <div className="mb-1 flex items-center gap-1.5 font-medium text-warning">
                  <CalendarClock className="h-3.5 w-3.5" /> Move to tomorrow
                </div>
                <ul className="space-y-0.5 text-fg-2">
                  {plan.defer.map((d) => (
                    <li key={d.task_id}>
                      {byId.get(d.task_id)?.title} <span className="text-faint">— {d.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {plan.tips.length ? <ul className="list-disc space-y-0.5 pl-4 text-[12px] text-muted">{plan.tips.map((t, i) => <li key={i}>{t}</li>)}</ul> : null}
          </div>
        )}
      </Dialog>
    </>
  );
}
