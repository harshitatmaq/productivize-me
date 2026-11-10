"use client";

import { Brain, CalendarClock, RefreshCw, Settings2, ShieldCheck, Sparkles, Wand2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { Segmented } from "@/components/ui/misc";
import { isPlanOwned, toMin } from "@/lib/planning";
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
  const [note, setNote] = useState("");
  const [change, setChange] = useState("");
  const byId = new Map(tasks.map((t) => [t.id, t]));

  /** Builds a plan, or (with `revise`) changes the current one the way you asked. */
  const generate = async (revise?: string) => {
    setLoading(true);
    try {
      const d = new Date();
      const now = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      const instruction = (revise ?? note).trim() || undefined;
      const r = await api<{ plan: DayPlan }>("/api/tasks/plan", {
        json: {
          date: today,
          now,
          dayEnd: profile?.day_end_time?.slice(0, 5),
          energy,
          weekday: d.getDay(),
          instruction,
          previous:
            revise && plan
              ? {
                  blocks: plan.blocks.map(({ task_id, start, end }) => ({
                    task_id,
                    start,
                    end,
                  })),
                  defer: plan.defer.map((x) => ({ task_id: x.task_id })),
                }
              : undefined,
        },
      });
      setPlan(r.plan);
      if (revise) {
        setChange("");
        toast.success("Plan updated");
      }
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
      // Times you set yourself stay; un-timed tasks and times an earlier plan set get the new slot.
      const movable = !t.due_time || isPlanOwned(t);
      update.mutate({
        id: t.id,
        patch: {
          sort_order: base + i,
          // Pull overdue items into today.
          ...(t.due_date !== today ? { due_date: today } : {}),
          ...(setTimes && movable ? { due_time: b.start, planned_time: b.start } : {}),
          // Remember the AI's estimate so the next plan (and the task row) uses it; you can edit it any time.
          ...(!t.estimate_minutes && b.estimate_min ? { estimate_minutes: b.estimate_min } : {}),
        },
      });
    });
    if (plan.defer.length) {
      carry.mutate({ to: "tomorrow", ids: plan.defer.map((d) => d.task_id) });
    }
    toast.success(`Plan applied${plan.defer.length ? ` · ${plan.defer.length} moved to tomorrow` : ""}`);
    setOpen(false);
    setPlan(null);
    setNote("");
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
        description="The AI orders what's left today around fixed-time tasks, your routines and bedtime, estimates and priorities."
        size="md"
        footer={
          plan ? (
            <>
              <label className="mr-auto flex items-center gap-2 text-[12.5px] text-muted">
                <input type="checkbox" checked={setTimes} onChange={(e) => setSetTimes(e.target.checked)} />
                Also set times on un-timed tasks
              </label>
              <Button variant="ghost" onClick={() => setPlan(null)}>
                Start over
              </Button>
              <Button variant="primary" onClick={apply}>
                Apply plan
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={() => generate()} loading={loading}>
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
            <label className="block space-y-1.5">
              <span className="text-[13px] text-fg-2">Anything to keep in mind today? (optional)</span>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !loading && generate()}
                placeholder="e.g. call at 5pm, Azure needs ~2h, I'm out after 8"
                maxLength={500}
              />
            </label>
            <PrefsSummary profile={profile} />
            <p className="text-[12px] text-muted">
              Each task gets the time it really needs: your estimate if you gave one, how long similar tasks took you before, or the AI&apos;s judgement from
              the title.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {plan.summary ? <p className="text-[13px] leading-relaxed text-fg-2">{plan.summary}</p> : null}
            {plan.followed?.length ? (
              <div className="flex items-start gap-2 rounded-lg border border-success/25 bg-success/[0.06] p-2.5 text-[12px] text-fg-2">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                <span>
                  Followed your preferences
                  {plan.adjusted ? ` (moved ${plan.adjusted} task${plan.adjusted > 1 ? "s" : ""} the AI had placed elsewhere)` : ""}.{" "}
                  <Link href="/settings#planning" className="text-accent hover:underline" onClick={() => setOpen(false)}>
                    Edit preferences
                  </Link>
                </span>
              </div>
            ) : null}
            <ol className="relative space-y-2 border-l border-line pl-4">
              {plan.blocks.map((b) => {
                const len = Math.max(0, toMin(b.end) - toMin(b.start));
                return (
                  <li key={b.task_id} className="relative">
                    <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-accent" />
                    <div className="flex items-baseline gap-2">
                      <span className="w-[118px] shrink-0 whitespace-nowrap font-mono text-[11.5px] tabular-nums text-muted">
                        {formatTime(b.start)}–{formatTime(b.end)}
                      </span>
                      <span className="min-w-0 flex-1 text-[13.5px] text-fg">{byId.get(b.task_id)?.title ?? "Task"}</span>
                      <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-faint">
                        {fmtMin(len)}
                        {b.estimate_min && b.estimate_min > len + 5 ? ` of ${fmtMin(b.estimate_min)}` : ""}
                      </span>
                    </div>
                    {b.note ? <div className="ml-[126px] text-[12px] text-faint">{b.note}</div> : null}
                  </li>
                );
              })}
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
            {plan.tips.length ? (
              <ul className="list-disc space-y-0.5 pl-4 text-[12px] text-muted">
                {plan.tips.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            ) : null}
            {plan.memory?.length ? (
              <div className="flex items-start gap-2 text-[12px] text-muted">
                <Brain className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                <span>
                  Used {plan.memory.length} thing
                  {plan.memory.length > 1 ? "s" : ""} it knows about how you work.{" "}
                  <Link href="/settings#memory" className="text-accent hover:underline" onClick={() => setOpen(false)}>
                    See what it knows
                  </Link>
                </span>
              </div>
            ) : null}
            <form
              className="flex gap-2 border-t border-line pt-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (change.trim()) generate(change);
              }}
            >
              <Input
                value={change}
                onChange={(e) => setChange(e.target.value)}
                placeholder="Change something — “Azure needs 2h”, “start at 4”, “reading tonight”"
                aria-label="Tell the planner what to change"
                maxLength={500}
              />
              <Button type="submit" variant="secondary" loading={loading} disabled={!change.trim()}>
                <RefreshCw className="h-3.5 w-3.5" /> Update
              </Button>
            </form>
          </div>
        )}
      </Dialog>
    </>
  );
}

const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`);

function PrefsSummary({ profile }: { profile: ReturnType<typeof useProfile>["data"] }) {
  const p = profile?.planning ?? {};
  const routines = p.routines ?? [];
  const bits = [
    p.wake ? `up ${formatTime(p.wake)}` : null,
    p.sleep ? `bed ${formatTime(p.sleep)}` : null,
    p.work ? `work ${formatTime(p.work.start)}–${formatTime(p.work.end)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="rounded-lg border border-line bg-panel-2/50 p-3 text-[12.5px]">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-medium text-fg-2">Your preferences</span>
        <Link href="/settings#planning" className="inline-flex items-center gap-1 text-accent hover:underline">
          <Settings2 className="h-3 w-3" /> Edit
        </Link>
      </div>
      {bits || routines.length ? (
        <div className="space-y-0.5 text-muted">
          {bits ? <div>{bits}</div> : null}
          {routines.map((r) => (
            <div key={r.id}>
              {r.label}: {formatTime(r.start)}–{formatTime(r.end)}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-muted">None yet — add your bedtime and routines (e.g. reading at night) so plans fit how you live.</div>
      )}
    </div>
  );
}
