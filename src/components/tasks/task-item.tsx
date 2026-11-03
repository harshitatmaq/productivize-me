"use client";

import { AlarmClock, AlignLeft, CalendarArrowUp, Copy, MoreHorizontal, Redo2, Repeat, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useUi } from "@/components/shell/ui-store";
import { Menu, MenuItem, MenuSeparator, Tip } from "@/components/ui/menu";
import { useToday } from "@/lib/hooks";
import { useCreateTask, useDeleteTask, useUpdateTask } from "@/lib/queries/tasks";
import type { Task } from "@/lib/types";
import { cn } from "@/lib/utils";
import { RescheduleMenu } from "./reschedule-menu";
import { TaskCheckbox } from "./task-checkbox";
import { dateLabel, formatTime, PRIORITY_COLOR } from "./task-utils";

export function TaskItem({ task, showDate = true, compact = false }: { task: Task; showDate?: boolean; compact?: boolean }) {
  const today = useToday();
  const { editTask } = useUi();
  const update = useUpdateTask();
  const del = useDeleteTask();
  const create = useCreateTask();
  const done = task.status === "done";
  const overdue = !done && !!task.due_date && task.due_date < today;

  const toggle = () => {
    const next = done ? "todo" : "done";
    update.mutate({ id: task.id, patch: { status: next } });
    if (next === "done") {
      toast.success("Completed", {
        description: task.title,
        action: { label: "Undo", onClick: () => update.mutate({ id: task.id, patch: { status: "todo" } }) },
        duration: 3500,
      });
    }
  };

  const reschedule = (date: string | null) => {
    update.mutate({ id: task.id, patch: { due_date: date } });
    toast(date ? `Moved to ${dateLabel(date, today)}` : "Moved to Someday");
  };

  return (
    <div
      className={cn(
        "group relative flex items-start gap-3 rounded-lg px-2.5 transition-colors hover:bg-panel-hover/70",
        compact ? "py-1.5" : "py-2",
        task.id.startsWith("temp-") && "opacity-60",
      )}
      onClick={() => editTask(task)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") editTask(task);
      }}
    >
      <div className="pt-[1px]">
        <TaskCheckbox checked={done} priority={task.priority} onToggle={toggle} />
      </div>
      <div className="min-w-0 flex-1">
        <div className={cn("text-[13.5px] leading-snug text-fg", done && "text-muted line-through decoration-faint")}>{task.title}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11.5px] text-muted empty:hidden">
          {showDate && task.due_date ? (
            <span className={cn(overdue && "text-danger")}>{dateLabel(task.due_date, today)}</span>
          ) : null}
          {task.due_time ? <span className={cn(overdue && "text-danger")}>{formatTime(task.due_time)}</span> : null}
          {task.recurrence ? (
            <span className="inline-flex items-center gap-1">
              <Repeat className="h-3 w-3" />
              {task.recurrence}
            </span>
          ) : null}
          {task.reminder_at && !done ? (
            <Tip content={`Reminder ${new Date(task.reminder_at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`}>
              <AlarmClock className="h-3 w-3" />
            </Tip>
          ) : null}
          {task.estimate_minutes ? <span>{task.estimate_minutes >= 60 ? `${Math.round(task.estimate_minutes / 6) / 10}h` : `${task.estimate_minutes}m`}</span> : null}
          {task.carry_count > 0 && !done ? (
            <Tip content={`Carried forward ${task.carry_count}× · originally ${task.original_due_date ?? "?"}`}>
              <span className="inline-flex items-center gap-1 text-warning">
                <Redo2 className="h-3 w-3" />
                {task.carry_count}
              </span>
            </Tip>
          ) : null}
          {task.notes ? <AlignLeft className="h-3 w-3" /> : null}
          {task.tags.map((t) => (
            <span key={t} className="text-faint">
              #{t}
            </span>
          ))}
        </div>
      </div>
      <div
        className="flex items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
        onClick={(e) => e.stopPropagation()}
      >
        {!done ? (
          <RescheduleMenu
            onPick={reschedule}
            trigger={
              <button className="rounded-md p-1 text-faint hover:bg-panel-2 hover:text-fg" aria-label="Reschedule">
                <CalendarArrowUp className="h-3.5 w-3.5" />
              </button>
            }
          />
        ) : null}
        <Menu
          trigger={
            <button className="rounded-md p-1 text-faint hover:bg-panel-2 hover:text-fg" aria-label="More">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          }
        >
          {[1, 2, 3, 4].map((p) => (
            <MenuItem
              key={p}
              onSelect={() => update.mutate({ id: task.id, patch: { priority: p as Task["priority"] } })}
              icon={<span className="h-2.5 w-2.5 rounded-full" style={{ background: PRIORITY_COLOR[p] }} />}
              shortcut={task.priority === p ? "✓" : undefined}
            >
              {p === 4 ? "No priority" : `Priority ${p}`}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem
            icon={<Copy className="h-3.5 w-3.5" />}
            onSelect={() =>
              create.mutate({
                title: task.title,
                notes: task.notes,
                due_date: task.due_date,
                due_time: task.due_time,
                priority: task.priority,
                tags: task.tags,
                estimate_minutes: task.estimate_minutes,
              })
            }
          >
            Duplicate
          </MenuItem>
          <MenuItem
            danger
            icon={<Trash2 className="h-3.5 w-3.5" />}
            onSelect={() => {
              del.mutate(task.id);
              toast("Task deleted", { description: task.title });
            }}
          >
            Delete
          </MenuItem>
        </Menu>
      </div>
      {task.priority < 4 && !done ? (
        <span className="absolute left-0 top-2.5 bottom-2.5 w-[2px] rounded-full opacity-70" style={{ background: PRIORITY_COLOR[task.priority] }} />
      ) : null}
    </div>
  );
}
