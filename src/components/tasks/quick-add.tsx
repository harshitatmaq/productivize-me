"use client";

import { AlarmClock, CalendarDays, CornerDownLeft, Flag, Hash, Mic, Plus, Repeat, Timer, X } from "lucide-react";
import { useVoiceInput } from "@/lib/voice";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/misc";
import { useToday } from "@/lib/hooks";
import { parseQuickAdd } from "@/lib/nlp";
import { suggestTime } from "@/lib/planning";
import { useProfile } from "@/lib/queries/profile";
import { useCreateTask } from "@/lib/queries/tasks";
import { cn } from "@/lib/utils";
import { dateLabel, describeRecurrence, formatTime, localIso, PRIORITY_COLOR } from "./task-utils";

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
  // Your routines decide the time when you didn't type one ("Read 20 pages" → 22:30).
  const { data: profile } = useProfile();
  const [declined, setDeclined] = useState<string | null>(null);
  const suggestion =
    parsed?.title && !parsed.due_time
      ? suggestTime({ title: parsed.title, tags: parsed.tags }, profile?.planning, due ? new Date(`${due}T12:00:00`).getDay() : undefined)
      : null;
  const useSuggestion = !!suggestion && declined !== suggestion.routine.id;
  const voice = useVoiceInput((heard) => {
    setText((t) => (t ? `${t} ${heard}` : heard));
    ref.current?.focus();
  });

  const submit = () => {
    if (!parsed?.title) return;
    const due_time = parsed.due_time ?? (useSuggestion ? suggestion!.time : null);
    create.mutate(
      {
        title: parsed.title,
        due_date: due,
        due_time,
        priority: parsed.priority,
        tags: parsed.tags,
        recurrence: parsed.recurrence,
        recurrence_interval: parsed.recurrence_interval,
        recurrence_days: parsed.recurrence_days,
        estimate_minutes: parsed.estimate_minutes,
        reminder_at: due && due_time ? localIso(due, due_time) : null,
      },
      { onError: (e) => toast.error(`Couldn't add task: ${(e as Error).message}`) },
    );
    setText("");
    setDeclined(null);
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
        {voice.supported ? (
          <button
            type="button"
            onClick={voice.listening ? voice.stop : voice.start}
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors",
              voice.listening ? "animate-pulse bg-danger/15 text-danger" : "text-faint hover:bg-panel-hover hover:text-fg",
            )}
            aria-label={voice.listening ? "Stop listening" : "Add by voice"}
            title={voice.listening ? "Listening… tap to stop" : "Add by voice"}
          >
            <Mic className="h-4 w-4" />
          </button>
        ) : null}
        {text ? (
          <button
            onClick={submit}
            className="hidden h-6 items-center gap-1 rounded-md bg-accent px-2 text-[11.5px] font-medium text-accent-fg sm:inline-flex"
          >
            Add <CornerDownLeft className="h-3 w-3" />
          </button>
        ) : null}
      </div>
      {parsed && (due || parsed.due_time || suggestion || parsed.priority < 4 || parsed.tags.length || parsed.recurrence || parsed.estimate_minutes) ? (
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
          {suggestion ? (
            useSuggestion ? (
              <Badge tone="accent">
                <AlarmClock className="h-3 w-3" />
                {formatTime(suggestion.time)} · your {suggestion.routine.label.toLowerCase()} time
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setDeclined(suggestion.routine.id)}
                  aria-label="Don't use this time"
                  title="Don't use this time"
                  className="-mr-0.5 rounded hover:text-fg"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ) : (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setDeclined(null)}
                className="text-[11.5px] text-muted underline-offset-2 hover:text-fg hover:underline"
              >
                Use your {suggestion.routine.label.toLowerCase()} time ({formatTime(suggestion.time)})
              </button>
            )
          ) : null}
          {parsed.priority < 4 ? (
            <Badge>
              <Flag className="h-3 w-3" style={{ color: PRIORITY_COLOR[parsed.priority] }} />P{parsed.priority}
            </Badge>
          ) : null}
          {parsed.recurrence ? (
            <Badge>
              <Repeat className="h-3 w-3" />
              {describeRecurrence(parsed)}
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
