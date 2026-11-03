"use client";

import { Check, Flame, Plus, Repeat } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useUi } from "@/components/shell/ui-store";
import { TaskCheckbox } from "@/components/tasks/task-checkbox";
import { describeRecurrence, formatTime, localIso } from "@/components/tasks/task-utils";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { Tip } from "@/components/ui/menu";
import { Card, EmptyState, PageHeader, ProgressRing } from "@/components/ui/misc";
import { useToday } from "@/lib/hooks";
import { useCreateTask, useTasks, useUpdateTask } from "@/lib/queries/tasks";
import { addDays, todayStr } from "@/lib/time";
import type { Task } from "@/lib/types";
import { cn } from "@/lib/utils";

type Habit = {
  seriesId: string;
  current: Task; // newest occurrence
  open: Task | null; // the occurrence you can tick now
  doneDays: Set<string>;
  missedDays: Set<string>;
  streak: number;
  rate: number; // completion rate over the last 28 days (scheduled occurrences)
};

const DAYS = 28;

function buildHabits(tasks: Task[], today: string): Habit[] {
  const groups = new Map<string, Task[]>();
  for (const t of tasks) {
    if (!t.series_id) continue;
    groups.set(t.series_id, [...(groups.get(t.series_id) ?? []), t]);
  }
  const from = addDays(today, -(DAYS - 1));
  const habits: Habit[] = [];
  for (const [seriesId, list] of groups) {
    const sorted = [...list].sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "") || a.created_at.localeCompare(b.created_at));
    const current = sorted[sorted.length - 1];
    if (!current.recurrence && current.status === "todo") continue; // repeat turned off
    const open = sorted.find((t) => t.status === "todo" && (t.due_date ?? today) <= today) ?? null;
    const doneDays = new Set<string>();
    const missedDays = new Set<string>();
    for (const t of sorted) {
      if (t.status === "done" && t.completed_at) doneDays.add(todayStr(new Date(t.completed_at)));
      else if (t.status === "dropped" && t.due_date) missedDays.add(t.due_date);
      else if (t.status === "todo" && t.due_date && t.due_date < today && t.carry_count === 0) missedDays.add(t.due_date);
    }
    // Streak: consecutive completed occurrences, newest first (an open one due today doesn't break it).
    let streak = 0;
    for (const t of [...sorted].reverse()) {
      if (t.status === "todo" && (t.due_date ?? today) >= today) continue;
      if (t.status === "done") streak++;
      else break;
    }
    const recent = sorted.filter((t) => t.due_date && t.due_date >= from && t.due_date <= today);
    const rate = recent.length ? recent.filter((t) => t.status === "done").length / recent.length : 0;
    habits.push({ seriesId, current, open, doneDays, missedDays, streak, rate });
  }
  return habits.sort((a, b) => Number(!!b.open) - Number(!!a.open) || b.streak - a.streak);
}

export function HabitsView() {
  const today = useToday();
  const { data: tasks = [], isLoading } = useTasks();
  const update = useUpdateTask();
  const create = useCreateTask();
  const { editTask } = useUi();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: "", rule: "daily", interval: 2, time: "" });
  const habits = useMemo(() => buildHabits(tasks, today), [tasks, today]);
  const days = Array.from({ length: DAYS }, (_, i) => addDays(today, -(DAYS - 1) + i));
  const doneToday = habits.filter((h) => h.doneDays.has(today)).length;
  const dueToday = habits.filter((h) => h.open || h.doneDays.has(today)).length;

  const add = () => {
    if (!form.title.trim()) return toast.error("Name the habit");
    const rule = form.rule === "interval" ? "daily" : form.rule;
    create.mutate(
      {
        title: form.title.trim(),
        due_date: today,
        due_time: form.time || null,
        reminder_at: form.time ? localIso(today, form.time) : null,
        recurrence: rule as Task["recurrence"],
        recurrence_interval: form.rule === "interval" ? Math.max(2, form.interval) : 1,
        recurrence_days: [],
        tags: ["habit"],
      },
      { onSuccess: () => toast.success("Habit added — it shows up on Today when it's due") },
    );
    setAdding(false);
    setForm({ title: "", rule: "daily", interval: 2, time: "" });
  };

  return (
    <div className="mx-auto max-w-[980px] px-4 pt-5 md:px-8 md:pt-10">
      <PageHeader
        title="Habits"
        icon={<Flame className="h-5 w-5" />}
        subtitle="Every repeating task is a habit. Tick it on Today or here; streaks build themselves."
        right={
          <>
            {dueToday ? (
              <div className="mr-1 flex items-center gap-2 text-[12.5px] text-muted">
                <ProgressRing value={doneToday / dueToday} size={28} stroke={3} color="var(--success)" />
                {doneToday}/{dueToday} today
              </div>
            ) : null}
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> New habit
            </Button>
          </>
        }
      />

      {isLoading ? null : habits.length === 0 ? (
        <EmptyState
          icon={<Repeat className="h-5 w-5" />}
          title="No habits yet"
          action={
            <Button variant="secondary" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> Add your first habit
            </Button>
          }
        >
          Add one here, or type something like “Gym every mon, wed and fri 7am” or “Read 20 pages daily” in quick add.
        </EmptyState>
      ) : (
        <Card className="divide-y divide-line">
          {habits.map((h) => (
            <div key={h.seriesId} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                {h.open ? (
                  <TaskCheckbox checked={false} priority={h.open.priority} onToggle={() => update.mutate({ id: h.open!.id, patch: { status: "done" } })} size={22} />
                ) : (
                  <span className={cn("flex h-[22px] w-[22px] items-center justify-center rounded-full", h.doneDays.has(today) ? "bg-success text-white" : "border border-line-strong")}>
                    {h.doneDays.has(today) ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                  </span>
                )}
                <button className="min-w-0 text-left" onClick={() => editTask(h.open ?? h.current)}>
                  <div className="truncate text-[14px] text-fg">{h.current.title}</div>
                  <div className="text-[12px] text-muted">
                    {describeRecurrence(h.current)}
                    {h.current.due_time ? ` · ${formatTime(h.current.due_time)}` : ""}
                    {!h.open && h.current.due_date && h.current.due_date > today ? ` · next ${h.current.due_date.slice(5)}` : ""}
                  </div>
                </button>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex gap-[3px]">
                  {days.map((d) => (
                    <Tip key={d} content={`${new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}${h.doneDays.has(d) ? " · done" : h.missedDays.has(d) ? " · missed" : ""}`}>
                      <span
                        className={cn(
                          "block h-4 w-[7px] rounded-[2px] sm:w-2",
                          h.doneDays.has(d) ? "bg-success" : h.missedDays.has(d) ? "bg-danger/40" : "bg-panel-2",
                          d === today && "ring-1 ring-accent",
                        )}
                      />
                    </Tip>
                  ))}
                </div>
                <div className="w-[88px] shrink-0 text-right">
                  <div className="inline-flex items-center gap-1 text-[13px] font-semibold tabular-nums text-fg">
                    <Flame className={cn("h-3.5 w-3.5", h.streak ? "text-p2" : "text-faint")} />
                    {h.streak}
                  </div>
                  <div className="text-[11px] text-faint">{Math.round(h.rate * 100)}% · 4 wks</div>
                </div>
              </div>
            </div>
          ))}
        </Card>
      )}

      <Dialog
        open={adding}
        onOpenChange={setAdding}
        title="New habit"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={add}>
              Add habit
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Habit">
            <Input autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Read 20 pages" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Repeats">
              <Select value={form.rule} onChange={(e) => setForm({ ...form, rule: e.target.value })}>
                <option value="daily">Every day</option>
                <option value="weekdays">Weekdays</option>
                <option value="interval">Every few days…</option>
                <option value="weekly">Every week</option>
              </Select>
            </Field>
            {form.rule === "interval" ? (
              <Field label="Every N days">
                <Input type="number" min={2} max={30} value={form.interval} onChange={(e) => setForm({ ...form, interval: Number(e.target.value) || 2 })} />
              </Field>
            ) : (
              <Field label="Time (optional, adds a reminder)">
                <Input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
              </Field>
            )}
          </div>
          <p className="text-[12px] text-muted">Need specific weekdays? Open the habit after adding and pick days in the editor.</p>
        </div>
      </Dialog>
    </div>
  );
}
