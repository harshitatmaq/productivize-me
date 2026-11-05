"use client";

import { Tip } from "@/components/ui/menu";
import { CalendarRange, Inbox, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { QuickAdd } from "@/components/tasks/quick-add";
import { TaskItem } from "@/components/tasks/task-item";
import { dateLabel, prettyDate, sortTasks } from "@/components/tasks/task-utils";
import { PageHeader, Segmented } from "@/components/ui/misc";
import { useToday } from "@/lib/hooks";
import { useTasks } from "@/lib/queries/tasks";
import { addDays } from "@/lib/time";
import type { Task } from "@/lib/types";
import { cn } from "@/lib/utils";

function DaySection({ date, tasks, today }: { date: string; tasks: Task[]; today: string }) {
  const [adding, setAdding] = useState(false);
  const label = dateLabel(date, today);
  const isToday = date === today;
  return (
    <section className="group/day">
      <div className="sticky top-[52px] z-10 -mx-1 mb-1 flex items-baseline gap-2 border-b border-line bg-bg/90 px-1 pb-1.5 pt-2 backdrop-blur md:top-0">
        <h2 className={cn("text-[13.5px] font-semibold", isToday ? "text-accent" : "text-fg")}>{label}</h2>
        {label !== prettyDate(date) ? <span className="text-[12px] text-faint">{prettyDate(date, { day: "numeric", month: "short" })}</span> : null}
        <span className="ml-auto text-[11.5px] text-faint">{tasks.length || ""}</span>
        <Tip content={`Add a task on ${label}`}>
          <button
            onClick={() => setAdding(true)}
            className="rounded-md p-0.5 text-faint opacity-100 hover:bg-panel-hover hover:text-fg focus:opacity-100 sm:opacity-0 sm:group-hover/day:opacity-100"
            aria-label={`Add task on ${label}`}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </Tip>
      </div>
      {tasks.map((t) => (
        <TaskItem key={t.id} task={t} showDate={false} />
      ))}
      {adding ? (
        <QuickAdd defaultDate={date} autoFocus onDone={() => setAdding(false)} className="my-2" placeholder={`Add to ${label.toLowerCase()}…`} />
      ) : tasks.length === 0 ? (
        <button onClick={() => setAdding(true)} className="w-full px-2.5 py-2 text-left text-[12.5px] text-faint hover:text-muted">
          + Add task
        </button>
      ) : null}
    </section>
  );
}

export function UpcomingView() {
  const today = useToday();
  const { data: tasks = [] } = useTasks();
  const [range, setRange] = useState<"7" | "14" | "30">("7");

  const { days, later, someday } = useMemo(() => {
    const open = tasks.filter((t) => t.status === "todo").sort(sortTasks);
    const n = Number(range);
    const end = addDays(today, n - 1);
    const days = Array.from({ length: n }, (_, i) => addDays(today, i)).map((d) => ({
      date: d,
      tasks: open.filter((t) => t.due_date === d || (d === today && !!t.due_date && t.due_date < today)),
    }));
    return {
      days,
      later: open.filter((t) => t.due_date && t.due_date > end),
      someday: open.filter((t) => !t.due_date),
    };
  }, [tasks, today, range]);

  return (
    <div className="mx-auto max-w-[760px] px-4 pt-5 md:px-8 md:pt-10">
      <PageHeader
        title="Upcoming"
        icon={<CalendarRange className="h-5 w-5" />}
        subtitle="Plan the days ahead. Overdue tasks show under today."
        right={
          <Segmented
            value={range}
            onChange={setRange}
            options={[
              { value: "7", label: "Week" },
              { value: "14", label: "2 weeks" },
              { value: "30", label: "Month" },
            ]}
          />
        }
      />
      <div className="space-y-5">
        {days.map((d) => (
          <DaySection key={d.date} date={d.date} tasks={d.tasks} today={today} />
        ))}
        {later.length ? (
          <section>
            <h2 className="mb-1 border-b border-line pb-1.5 text-[13.5px] font-semibold text-fg">Later</h2>
            {later.map((t) => (
              <TaskItem key={t.id} task={t} />
            ))}
          </section>
        ) : null}
        <section>
          <h2 className="mb-1 flex items-center gap-2 border-b border-line pb-1.5 text-[13.5px] font-semibold text-fg">
            <Inbox className="h-3.5 w-3.5 text-muted" /> Someday
            <span className="ml-auto text-[11.5px] font-normal text-faint">{someday.length || ""}</span>
          </h2>
          {someday.map((t) => (
            <TaskItem key={t.id} task={t} />
          ))}
          <QuickAdd defaultDate={null} className="mt-2" placeholder="Capture an idea without a date…" />
        </section>
      </div>
    </div>
  );
}

