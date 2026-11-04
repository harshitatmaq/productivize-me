"use client";

import { BellRing, CalendarClock, GraduationCap, Moon, MoreHorizontal, Pencil, Plus, Sunrise, Trash2, CalendarCheck, CalendarRange } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/field";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Card, EmptyState, PageHeader, SectionTitle, Segmented } from "@/components/ui/misc";
import { useToday, useTrigger } from "@/lib/hooks";
import { useProfile, useUpdateProfile } from "@/lib/queries/profile";
import { useDeleteReminder, useReminders, useSaveReminder } from "@/lib/queries/reminders";
import { computeNextFire, describeRule, type ReminderFrequency } from "@/lib/recurrence";
import { browserTimeZone } from "@/lib/time";
import type { Profile, Reminder } from "@/lib/types";
import { cn, timeAgo } from "@/lib/utils";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Draft = {
  id?: string;
  title: string;
  notes: string;
  frequency: ReminderFrequency;
  time_of_day: string;
  days_of_week: number[];
  day_of_month: number | null;
  start_date: string;
  url: string;
};

function relativeFuture(iso: string | null) {
  if (!iso) return "—";
  const ms = Date.parse(iso) - Date.now();
  if (ms < 0) return "due now";
  const m = Math.round(ms / 60000);
  if (m < 60) return `in ${m}m`;
  const h = Math.round(m / 60);
  if (h < 36) return `in ${h}h`;
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

function BuiltIn({ profile }: { profile: Profile }) {
  const update = useUpdateProfile();
  const set = (patch: Partial<Profile>) => update.mutate(patch, { onError: (e) => toast.error((e as Error).message) });
  // Plain render helper (not a component) so inputs keep focus across updates.
  const row = ({
    icon,
    title,
    desc,
    enabledKey,
    timeKey,
    extra,
  }: {
    icon: React.ReactNode;
    title: string;
    desc: string;
    enabledKey: keyof Profile;
    timeKey?: keyof Profile;
    extra?: React.ReactNode;
  }) => (
    <div className="flex flex-wrap items-center gap-3 py-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-panel-2 text-muted">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] text-fg">{title}</div>
        <div className="text-[12px] text-muted">{desc}</div>
        {extra}
      </div>
      {timeKey ? (
        <input
          type="time"
          value={String(profile[timeKey] ?? "").slice(0, 5)}
          onChange={(e) => e.target.value && set({ [timeKey]: e.target.value } as Partial<Profile>)}
          className="field h-8 w-[110px] py-1"
          disabled={!profile[enabledKey]}
        />
      ) : null}
      <Switch checked={Boolean(profile[enabledKey])} onChange={(v) => set({ [enabledKey]: v } as Partial<Profile>)} />
    </div>
  );

  return (
    <Card className="divide-y divide-line px-4">
      {row({ icon: <Sunrise className="h-4 w-4" />, title: "Morning brief", desc: "Today's plan, overdue items and new job matches (push + email digest).", enabledKey: "morning_brief_enabled", timeKey: "day_start_time" })}
      {row({
        icon: <Moon className="h-4 w-4" />,
        title: "End-of-day review",
        desc: "Get asked to carry unfinished tasks to tomorrow.",
        enabledKey: "eod_review_enabled",
        timeKey: "day_end_time",
        extra: (
          <label className="mt-2 flex items-center gap-2 text-[12px] text-muted">
            <Switch checked={profile.auto_carry_forward} onChange={(v) => set({ auto_carry_forward: v })} />
            Carry forward automatically instead of asking
          </label>
        ),
      })}
      {row({
        icon: <GraduationCap className="h-4 w-4" />,
        title: "Learning nudge",
        desc: `If you haven't logged what you learned today. Goal: ${profile.learning_goal_per_week} days/week.`,
        enabledKey: "learning_reminder_enabled",
        timeKey: "learning_reminder_time",
        extra: (
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px] text-muted">
            <span className="flex items-center gap-1.5">
              Goal
              <select
                className="field h-7 w-16 py-0"
                value={profile.learning_goal_per_week}
                onChange={(e) => set({ learning_goal_per_week: Number(e.target.value) })}
              >
                {[3, 4, 5, 6, 7].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              days/week
            </span>
            <label className="flex items-center gap-2">
              <Switch checked={profile.learning_skip_when_goal_met} onChange={(v) => set({ learning_skip_when_goal_met: v })} />
              Stop nudging once the weekly goal is met
            </label>
          </div>
        ),
      })}
      {row({ icon: <CalendarCheck className="h-4 w-4" />, title: "Weekly review", desc: "Last day of your week at 6 PM: what you finished, learned and applied to.", enabledKey: "weekly_review_enabled" })}
      {row({ icon: <CalendarRange className="h-4 w-4" />, title: "Monthly review", desc: "On the 1st: last month in numbers, and a nudge to set goals.", enabledKey: "monthly_review_enabled" })}
    </Card>
  );
}

export function RemindersView() {
  const today = useToday();
  const { data: profile } = useProfile();
  const { data: reminders = [], isLoading } = useReminders();
  const save = useSaveReminder();
  const del = useDeleteReminder();
  const params = useSearchParams();
  const router = useRouter();
  const blank = (): Draft => ({
    title: "",
    notes: "",
    frequency: "daily",
    time_of_day: "09:00",
    days_of_week: [],
    day_of_month: null,
    start_date: today,
    url: "",
  });
  const [draft, setDraft] = useState<Draft | null>(null);

  const wantsNew = params.get("new");
  useTrigger(wantsNew, () => setDraft(blank()));
  useEffect(() => {
    if (wantsNew) router.replace("/reminders");
  }, [wantsNew, router]);

  const tz = profile?.timezone ?? browserTimeZone();

  const submit = () => {
    if (!draft || !draft.title.trim()) return toast.error("Give the reminder a title");
    if (draft.frequency === "weekly" && draft.days_of_week.length === 0) return toast.error("Pick at least one day");
    const rule = {
      frequency: draft.frequency,
      time_of_day: draft.time_of_day,
      days_of_week: draft.days_of_week,
      day_of_month: draft.frequency === "monthly" ? (draft.day_of_month ?? Number(draft.start_date.slice(8))) : null,
      start_date: draft.start_date,
    };
    const next = computeNextFire(rule, tz, new Date());
    save.mutate(
      {
        id: draft.id,
        title: draft.title.trim(),
        notes: draft.notes.trim() || null,
        ...rule,
        url: draft.url.trim() || null,
        next_fire_at: next?.toISOString() ?? null,
        active: next !== null,
      },
      {
        onSuccess: () => {
          toast.success(next ? `Reminder set · next ${relativeFuture(next.toISOString())}` : "Saved (no future occurrences)");
          setDraft(null);
        },
        onError: (e) => toast.error((e as Error).message),
      },
    );
  };

  const toggle = (r: Reminder, active: boolean) => {
    const next = active ? computeNextFire(r, tz, new Date()) : null;
    save.mutate({ id: r.id, title: r.title, active, next_fire_at: active ? (next?.toISOString() ?? null) : r.next_fire_at });
  };

  return (
    <div className="mx-auto max-w-[820px] px-4 pt-5 md:px-8 md:pt-10">
      <PageHeader
        title="Reminders"
        icon={<BellRing className="h-5 w-5" />}
        subtitle="Daily, weekly and monthly nudges — delivered as push notifications on every device you've enabled."
        right={
          <Button variant="primary" onClick={() => setDraft(blank())}>
            <Plus className="h-4 w-4" /> New reminder
          </Button>
        }
      />

      <SectionTitle>Your reminders</SectionTitle>
      {isLoading ? null : reminders.length === 0 ? (
        <EmptyState
          className="mb-8"
          icon={<CalendarClock className="h-5 w-5" />}
          title="No custom reminders yet"
          action={
            <Button variant="secondary" onClick={() => setDraft(blank())}>
              <Plus className="h-4 w-4" /> Add one
            </Button>
          }
        >
          Drink water every 2 hours? Pay rent on the 1st? Weekly 1:1 prep on Fridays? Set it once and forget it.
        </EmptyState>
      ) : (
        <Card className="mb-8 divide-y divide-line">
          {reminders.map((r) => (
            <div key={r.id} className={cn("flex items-center gap-3 px-4 py-3", !r.active && "opacity-55")}>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] text-fg">{r.title}</div>
                <div className="mt-0.5 text-[12px] text-muted">
                  {describeRule(r)}
                  {r.active && r.next_fire_at ? <span className="text-faint"> · next {relativeFuture(r.next_fire_at)}</span> : null}
                  {r.last_fired_at ? <span className="text-faint"> · last {timeAgo(r.last_fired_at)}</span> : null}
                </div>
              </div>
              <Switch checked={r.active} onChange={(v) => toggle(r, v)} />
              <Menu
                trigger={
                  <button className="rounded-md p-1 text-faint hover:bg-panel-hover hover:text-fg" aria-label="More">
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                }
              >
                <MenuItem
                  icon={<Pencil className="h-3.5 w-3.5" />}
                  onSelect={() =>
                    setDraft({
                      id: r.id,
                      title: r.title,
                      notes: r.notes ?? "",
                      frequency: r.frequency,
                      time_of_day: r.time_of_day.slice(0, 5),
                      days_of_week: r.days_of_week ?? [],
                      day_of_month: r.day_of_month,
                      start_date: r.start_date,
                      url: r.url ?? "",
                    })
                  }
                >
                  Edit
                </MenuItem>
                <MenuItem danger icon={<Trash2 className="h-3.5 w-3.5" />} onSelect={() => del.mutate(r.id)}>
                  Delete
                </MenuItem>
              </Menu>
            </div>
          ))}
        </Card>
      )}

      <SectionTitle>Built-in rhythm</SectionTitle>
      {profile ? <BuiltIn profile={profile} /> : null}
      <p className="mt-3 text-[12px] text-faint">Times use your time zone ({tz}). Reminders are checked every 5 minutes.</p>

      <Dialog
        open={!!draft}
        onOpenChange={(o) => !o && setDraft(null)}
        title={draft?.id ? "Edit reminder" : "New reminder"}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} loading={save.isPending}>
              Save reminder
            </Button>
          </>
        }
      >
        {draft ? (
          <div className="space-y-4">
            <Field label="What should we remind you about?">
              <Input value={draft.title} autoFocus onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Review job applications" />
            </Field>
            <Field label="Repeats">
              <div className="overflow-x-auto no-scrollbar">
                <Segmented
                  value={draft.frequency}
                  onChange={(v) => setDraft({ ...draft, frequency: v })}
                  options={[
                    { value: "once", label: "Once" },
                    { value: "daily", label: "Daily" },
                    { value: "weekdays", label: "Weekdays" },
                    { value: "weekly", label: "Weekly" },
                    { value: "monthly", label: "Monthly" },
                    { value: "yearly", label: "Yearly" },
                  ]}
                />
              </div>
            </Field>
            {draft.frequency === "weekly" ? (
              <Field label="On">
                <div className="flex flex-wrap gap-1.5">
                  {DAYS.map((d, i) => {
                    const on = draft.days_of_week.includes(i);
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() =>
                          setDraft({ ...draft, days_of_week: on ? draft.days_of_week.filter((x) => x !== i) : [...draft.days_of_week, i] })
                        }
                        className={cn(
                          "h-8 w-11 rounded-lg border text-[12.5px] font-medium transition-colors",
                          on ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg",
                        )}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
              </Field>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Time">
                <Input type="time" value={draft.time_of_day} onChange={(e) => setDraft({ ...draft, time_of_day: e.target.value })} />
              </Field>
              {draft.frequency === "monthly" ? (
                <Field label="Day of month">
                  <Select
                    value={draft.day_of_month ?? Number(draft.start_date.slice(8))}
                    onChange={(e) => setDraft({ ...draft, day_of_month: Number(e.target.value) })}
                  >
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n}
                        {n > 28 ? " (or last day)" : ""}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <Field label={draft.frequency === "once" ? "Date" : draft.frequency === "yearly" ? "Date (repeats yearly)" : "Starting"}>
                  <Input type="date" value={draft.start_date} onChange={(e) => setDraft({ ...draft, start_date: e.target.value })} />
                </Field>
              )}
            </div>
            <Field label="Notes (shown in the notification)">
              <Textarea rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
            </Field>
            <Field label="Open this link when tapped (optional)" hint="e.g. /jobs, /learning, or any https:// URL">
              <Input value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="/learning" />
            </Field>
            <p className="text-[12px] text-muted">{describeRule({ ...draft, day_of_month: draft.day_of_month })}</p>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
