"use client";

import { AlarmClock, CalendarDays, CornerDownLeft, Flag, Hash, Plus, Repeat, Timer } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/misc";
import { useToday } from "@/lib/hooks";
import { parseQuickAdd } from "@/lib/nlp";
import { useCreateTask } from "@/lib/queries/tasks";
import { cn } from "@/lib/utils";
import { dateLabel, formatTime, localIso, PRIORITY_COLOR } from "./task-utils";

/**
 * Natural-language task input:
 *   "Call Priya tomorrow 6pm p1 #jobs ~20m", "Gym every weekday 7am"
 */
export function QuickAdd({
  defaultDate,
  placeholder = "Add a task — try “Submit resume tomorrow 6pm p1 #jobs”",
  autoFocus,
  onDone,
  className,
  initialText,
}: {
  initialText?: string;
  defaultDate?: string | null;
  placeholder?: string;
  autoFocus?: boolean;
  onDone?: () => void;
  className?: string;
}) {
  const [text, setText] = useState(initialText ?? "");
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const today = useToday();
  const create = useCreateTask();
  const parsed = useMemo(() => (text.trim() ? parseQuickAdd(text) : null), [text]);
  const due = parsed?.due_date ?? defaultDate ?? null;

  const submit = () => {
    if (!parsed?.title) return;
    const due_time = parsed.due_time;
    create.mutate(
      {
        title: parsed.title,
        due_date: due,
        due_time,
        priority: parsed.priority,
        tags: parsed.tags,
        recurrence: parsed.recurrence,
        estimate_minutes: parsed.estimate_minutes,
        reminder_at: due && due_time ? localIso(due, due_time) : null,
      },
      { onError: (e) => toast.error(`Couldn't add task: ${(e as Error).message}`) },
    );
    setText("");
    onDone?.();
  };

  const active = focused || !!text;

  return (
    <div
      className={cn(
        "rounded-xl border bg-panel transition-all duration-150",
        active ? "border-accent/60 shadow-[0_0_0_3px_var(--accent-soft)]" : "border-line hover:border-line-strong",
        className,
      )}
    >
      <div className="flex items-center gap-2.5 px-3">
        <Plus className={cn("h-4 w-4 shrink-0", active ? "text-accent" : "text-faint")} />
        <input
          ref={ref}
          value={text}
          autoFocus={autoFocus}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") {
              setText("");
              ref.current?.blur();
              onDone?.();
            }
          }}
          placeholder={placeholder}
          className="h-11 min-w-0 flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-faint"
          enterKeyHint="done"
        />
        {text ? (
          <button
            onClick={submit}
            className="hidden h-6 items-center gap-1 rounded-md bg-accent px-2 text-[11.5px] font-medium text-accent-fg sm:inline-flex"
          >
            Add <CornerDownLeft className="h-3 w-3" />
          </button>
        ) : null}
      </div>
      {parsed && (due || parsed.due_time || parsed.priority < 4 || parsed.tags.length || parsed.recurrence || parsed.estimate_minutes) ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-3 py-2 animate-fade-in">
          {due ? (
            <Badge tone="accent">
              <CalendarDays className="h-3 w-3" />
              {dateLabel(due, today)}
            </Badge>
          ) : null}
          {parsed.due_time ? (
            <Badge tone="accent">
              <AlarmClock className="h-3 w-3" />
              {formatTime(parsed.due_time)} · reminder on
            </Badge>
          ) : null}
          {parsed.priority < 4 ? (
            <Badge>
              <Flag className="h-3 w-3" style={{ color: PRIORITY_COLOR[parsed.priority] }} />P{parsed.priority}
            </Badge>
          ) : null}
          {parsed.recurrence ? (
            <Badge>
              <Repeat className="h-3 w-3" />
              {parsed.recurrence}
            </Badge>
          ) : null}
          {parsed.estimate_minutes ? (
            <Badge>
              <Timer className="h-3 w-3" />
              {parsed.estimate_minutes}m
            </Badge>
          ) : null}
          {parsed.tags.map((t) => (
            <Badge key={t}>
              <Hash className="h-3 w-3" />
              {t}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}
