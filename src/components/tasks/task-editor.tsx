"use client";

import { AlarmClock, Trash2 } from "lucide-react";
import { useResettableState } from "@/lib/hooks";
import { toast } from "sonner";
import { useUi } from "@/components/shell/ui-store";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ChipsInput } from "@/components/ui/chips-input";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Segmented } from "@/components/ui/misc";
import { useDeleteTask, useUpdateTask } from "@/lib/queries/tasks";
import type { Task } from "@/lib/types";
import { localIso, PRIORITY_COLOR, PRIORITY_LABEL } from "./task-utils";

type ReminderMode = "none" | "at" | "10" | "30" | "60" | "custom";

function reminderMode(t: Task): ReminderMode {
  if (!t.reminder_at) return "none";
  if (!t.due_date || !t.due_time) return "custom";
  const due = Date.parse(localIso(t.due_date, t.due_time));
  const diff = Math.round((due - Date.parse(t.reminder_at)) / 60_000);
  return diff === 0 ? "at" : diff === 10 ? "10" : diff === 30 ? "30" : diff === 60 ? "60" : "custom";
}

function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function TaskEditor() {
  const { editing, editTask } = useUi();
  const update = useUpdateTask();
  const del = useDeleteTask();
  const [draft, setDraft] = useResettableState<Task | null, Task | null>(editing, (t) => t);
  const [mode, setMode] = useResettableState<ReminderMode, Task | null>(editing, (t) => (t ? reminderMode(t) : "none"));
  const [custom, setCustom] = useResettableState(editing, (t) => toLocalInput(t?.reminder_at ?? null));

  if (!draft) return null;
  const set = <K extends keyof Task>(k: K, v: Task[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  const save = () => {
    if (!draft.title.trim()) return toast.error("Title can't be empty");
    let reminder_at: string | null = null;
    if (mode === "custom") reminder_at = custom ? new Date(custom).toISOString() : null;
    else if (mode !== "none" && draft.due_date && draft.due_time) {
      const offset = mode === "at" ? 0 : Number(mode);
      reminder_at = new Date(Date.parse(localIso(draft.due_date, draft.due_time)) - offset * 60_000).toISOString();
    }
    const changedReminder = reminder_at !== editing?.reminder_at;
    update.mutate(
      {
        id: draft.id,
        patch: {
          title: draft.title.trim(),
          notes: draft.notes?.trim() || null,
          due_date: draft.due_date || null,
          due_time: draft.due_time || null,
          priority: draft.priority,
          tags: draft.tags,
          estimate_minutes: draft.estimate_minutes || null,
          recurrence: draft.recurrence || null,
          reminder_at,
          ...(changedReminder ? { reminder_sent_at: null } : {}),
        },
      },
      { onError: (e) => toast.error((e as Error).message) },
    );
    editTask(null);
  };

  const needsTime = mode !== "none" && mode !== "custom" && !draft.due_time;

  return (
    <Dialog
      open={!!editing}
      onOpenChange={(o) => !o && editTask(null)}
      title="Edit task"
      size="md"
      footer={
        <>
          <Button
            variant="ghost"
            className="mr-auto text-danger hover:text-danger"
            onClick={() => {
              del.mutate(draft.id);
              editTask(null);
              toast("Task deleted");
            }}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
          <Button variant="ghost" onClick={() => editTask(null)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <input
          value={draft.title}
          onChange={(e) => set("title", e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          className="w-full bg-transparent text-[17px] font-medium text-fg outline-none placeholder:text-faint"
          placeholder="Task name"
        />
        <Textarea value={draft.notes ?? ""} onChange={(e) => set("notes", e.target.value)} placeholder="Notes, links, sub-steps…" rows={3} />

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <Input type="date" value={draft.due_date ?? ""} onChange={(e) => set("due_date", e.target.value || null)} />
          </Field>
          <Field label="Time">
            <Input type="time" value={draft.due_time?.slice(0, 5) ?? ""} onChange={(e) => set("due_time", e.target.value || null)} />
          </Field>
        </div>

        <Field label="Priority">
          <Segmented
            value={String(draft.priority)}
            onChange={(v) => set("priority", Number(v) as Task["priority"])}
            options={[1, 2, 3, 4].map((p) => ({
              value: String(p),
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: PRIORITY_COLOR[p] }} />
                  {PRIORITY_LABEL[p]}
                </span>
              ),
            }))}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Repeat">
            <Select value={draft.recurrence ?? ""} onChange={(e) => set("recurrence", (e.target.value || null) as Task["recurrence"])}>
              <option value="">Doesn&apos;t repeat</option>
              <option value="daily">Every day</option>
              <option value="weekdays">Every weekday</option>
              <option value="weekly">Every week</option>
              <option value="monthly">Every month</option>
              <option value="yearly">Every year</option>
            </Select>
          </Field>
          <Field label="Estimate (minutes)">
            <Input
              type="number"
              min={0}
              step={5}
              value={draft.estimate_minutes ?? ""}
              onChange={(e) => set("estimate_minutes", e.target.value ? Number(e.target.value) : null)}
              placeholder="e.g. 30"
            />
          </Field>
        </div>

        <Field label={<span className="inline-flex items-center gap-1.5"><AlarmClock className="h-3.5 w-3.5" /> Reminder (push + in-app)</span>}>
          <Select value={mode} onChange={(e) => setMode(e.target.value as ReminderMode)}>
            <option value="none">No reminder</option>
            <option value="at">At due time</option>
            <option value="10">10 minutes before</option>
            <option value="30">30 minutes before</option>
            <option value="60">1 hour before</option>
            <option value="custom">Custom date & time…</option>
          </Select>
          {mode === "custom" ? (
            <Input className="mt-2" type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} />
          ) : null}
          {needsTime ? <span className="mt-1.5 block text-xs text-warning">Set a date and time for this reminder to work.</span> : null}
        </Field>

        <Field label="Tags">
          <ChipsInput value={draft.tags} onChange={(v) => set("tags", v.map((t) => t.toLowerCase()))} placeholder="work, health, jobs…" prefix="#" />
        </Field>

        {draft.carry_count > 0 ? (
          <p className="text-xs text-muted">
            Carried forward {draft.carry_count}× · originally due {draft.original_due_date}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
