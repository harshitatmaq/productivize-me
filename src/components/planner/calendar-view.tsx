"use client";

import { Tip } from "@/components/ui/menu";
import { BellRing, CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { QuickAdd } from "@/components/tasks/quick-add";
import { TaskItem } from "@/components/tasks/task-item";
import { dateLabel, PRIORITY_COLOR, sortTasks } from "@/components/tasks/task-utils";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useMediaQuery, useToday } from "@/lib/hooks";
import { useProfile } from "@/lib/queries/profile";
import { useReminders } from "@/lib/queries/reminders";
import { useTasks } from "@/lib/queries/tasks";
import { formatTime12, occursOn } from "@/lib/recurrence";
import { addDays, daysInMonth, startOfWeek } from "@/lib/time";
import type { Reminder, Task } from "@/lib/types";
import { cn } from "@/lib/utils";

const pad = (n: number) => String(n).padStart(2, "0");

function DayPanel({ date, tasks, reminders, today }: { date: string; tasks: Task[]; reminders: Reminder[]; today: string }) {
  return (
    <div>
      <QuickAdd defaultDate={date} className="mb-3" placeholder={`Add to ${dateLabel(date, today).toLowerCase()}…`} />
      {reminders.length ? (
        <div className="mb-3 space-y-1">
          {reminders.map((r) => (
            <div key={r.id} className="flex items-center gap-2 rounded-lg bg-warning/8 px-2.5 py-1.5 text-[12.5px] text-fg-2">
              <BellRing className="h-3.5 w-3.5 text-warning" />
              <span className="flex-1 truncate">{r.title}</span>
              <span className="text-[11.5px] text-muted">{formatTime12(r.time_of_day)}</span>
            </div>
          ))}
        </div>
      ) : null}
      {tasks.length ? (
        tasks.map((t) => <TaskItem key={t.id} task={t} showDate={false} />)
      ) : (
        <p className="px-2 py-6 text-center text-[13px] text-muted">Nothing planned.</p>
      )}
    </div>
  );
}

export function CalendarView() {
  const today = useToday();
  const { data: tasks = [] } = useTasks();
  const { data: reminders = [] } = useReminders();
  const { data: profile } = useProfile();
  const desktop = useMediaQuery("(min-width: 1024px)");
  const [month, setMonth] = useState(today.slice(0, 7));
  const [picked, setSelected] = useState<string | null>(null);
  // Desktop always shows a day panel (default today); phones open a sheet only after a tap.
  const selected = desktop ? (picked ?? today) : picked;
  const weekStartsOn = profile?.week_starts_on ?? 1;

  const [y, m] = month.split("-").map(Number);
  const first = `${month}-01`;
  const gridStart = startOfWeek(first, weekStartsOn);
  const last = `${month}-${pad(daysInMonth(y, m))}`;
  const weeks = Math.ceil((Number(last.slice(8)) + ((new Date(`${first}T12:00:00`).getDay() - weekStartsOn + 7) % 7)) / 7);
  const cells = Array.from({ length: weeks * 7 }, (_, i) => addDays(gridStart, i));

  const byDate = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!t.due_date || t.status === "dropped") continue;
      const arr = map.get(t.due_date) ?? [];
      arr.push(t);
      map.set(t.due_date, arr);
    }
    map.forEach((arr) => arr.sort(sortTasks));
    return map;
  }, [tasks]);

  // Upcoming occurrences only — past ones already fired and would just add noise.
  const remindersOn = (d: string) => (d < today ? [] : reminders.filter((r) => r.active && occursOn(r, d) && d >= r.start_date));

  const shift = (delta: number) => {
    const d = new Date(y, m - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
  };

  const weekdayNames = Array.from({ length: 7 }, (_, i) =>
    new Date(`${addDays(gridStart, i)}T12:00:00`).toLocaleDateString(undefined, { weekday: desktop ? "short" : "narrow" }),
  );
  const selTasks = selected ? (byDate.get(selected) ?? []) : [];

  return (
    <div className="mx-auto max-w-[1280px] px-4 pt-5 md:px-8 md:pt-10">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <CalendarDays className="h-5 w-5 text-muted" />
          <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-fg">
            {new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
          </h1>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => {
              setMonth(today.slice(0, 7));
              if (desktop) setSelected(today);
            }}>
            Today
          </Button>
          <Tip content="Previous month">
          <Button size="icon-sm" variant="ghost" onClick={() => shift(-1)} aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          </Tip>
          <Tip content="Next month">
          <Button size="icon-sm" variant="ghost" onClick={() => shift(1)} aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </Button>
          </Tip>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="overflow-hidden rounded-xl border border-line bg-panel">
          <div className="grid grid-cols-7 border-b border-line bg-panel-2/60">
            {weekdayNames.map((n, i) => (
              <div key={i} className="px-2 py-2 text-center text-[11.5px] font-medium text-muted lg:text-left">
                {n}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((d, i) => {
              const inMonth = d.slice(0, 7) === month;
              const list = byDate.get(d) ?? [];
              const rems = remindersOn(d);
              const open = list.filter((t) => t.status === "todo");
              const isSel = d === selected;
              return (
                <button
                  key={d}
                  onClick={() => setSelected(d)}
                  aria-label={`${new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}${open.length ? ` · ${open.length} open task${open.length > 1 ? "s" : ""}` : ""}${rems.length ? ` · ${rems.length} reminder${rems.length > 1 ? "s" : ""}` : ""}`}
                  aria-pressed={isSel}
                  className={cn(
                    "group relative flex min-h-[64px] flex-col items-stretch gap-1 border-line p-1.5 text-left transition-colors lg:min-h-[112px]",
                    i % 7 !== 6 && "border-r",
                    i < cells.length - 7 && "border-b",
                    !inMonth && "bg-panel-2/40",
                    isSel ? "bg-accent-soft/60" : "hover:bg-panel-hover/60",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-6 w-6 items-center justify-center self-center rounded-full text-[12px] tabular-nums lg:self-start",
                      d === today ? "bg-accent font-semibold text-white" : inMonth ? "text-fg-2" : "text-faint",
                    )}
                  >
                    {Number(d.slice(8))}
                  </span>
                  {/* desktop: titles; mobile: dots */}
                  <div className="hidden flex-col gap-0.5 lg:flex">
                    {rems.slice(0, 1).map((r) => (
                      <span key={r.id} className="truncate rounded px-1 text-[11px] text-warning">
                        🔔 {r.title}
                      </span>
                    ))}
                    {list.slice(0, rems.length ? 2 : 3).map((t) => (
                      <span
                        key={t.id}
                        className={cn(
                          "flex items-center gap-1 truncate rounded px-1 text-[11.5px]",
                          t.status === "done" ? "text-faint line-through" : "text-fg-2",
                        )}
                      >
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: PRIORITY_COLOR[t.priority] }} />
                        <span className="truncate">{t.title}</span>
                      </span>
                    ))}
                    {list.length > 3 ? <span className="px-1 text-[11px] text-faint">+{list.length - 3} more</span> : null}
                  </div>
                  <div className="flex justify-center gap-0.5 lg:hidden">
                    {open.slice(0, 3).map((t) => (
                      <span key={t.id} className="h-1.5 w-1.5 rounded-full" style={{ background: PRIORITY_COLOR[t.priority] }} />
                    ))}
                    {rems.length ? <span className="h-1.5 w-1.5 rounded-full bg-warning" /> : null}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {desktop ? (
          <aside className="lg:sticky lg:top-10 lg:self-start">
            {selected ? (
              <div className="card p-4">
                <h2 className="mb-3 text-[15px] font-semibold text-fg">
                  {dateLabel(selected, today)}
                  <span className="ml-2 text-[12px] font-normal text-muted">
                    {new Date(`${selected}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "long" })}
                  </span>
                </h2>
                <DayPanel date={selected} tasks={selTasks} reminders={remindersOn(selected)} today={today} />
              </div>
            ) : null}
          </aside>
        ) : (
          <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)} title={selected ? dateLabel(selected, today) : ""}>
            {selected ? <DayPanel date={selected} tasks={selTasks} reminders={remindersOn(selected)} today={today} /> : null}
          </Dialog>
        )}
      </div>
    </div>
  );
}
