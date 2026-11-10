"use client";

import { Check, Dumbbell, Moon } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { DAY_HINT, DAY_LABEL, DEFAULT_ROTATION, nextDayType, sessionsThisWeek, type HealthSettings } from "@/lib/health";
import { useToday } from "@/lib/hooks";
import { useSaveWorkout, useWorkouts } from "@/lib/queries/health";
import { useProfile } from "@/lib/queries/profile";

/** Today rail: today's training day, with one-tap Rest day and a link to log it. */
export function HealthWidget() {
  const today = useToday();
  const { data: profile } = useProfile();
  const { data, isLoading, isError } = useWorkouts();
  const save = useSaveWorkout();
  if (isLoading || isError) return null;
  const h = (profile?.health ?? {}) as HealthSettings;
  const workouts = data?.workouts ?? [];
  const todayW = workouts.find((w) => w.date === today);
  const day = nextDayType(h.rotation?.length ? h.rotation : DEFAULT_ROTATION, workouts, today);
  const week = sessionsThisWeek(workouts, today, profile?.week_starts_on ?? 1);
  return (
    <section className="card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-[12.5px] font-medium text-muted">
          <Dumbbell className="h-3.5 w-3.5 text-accent" /> Workout
        </h3>
        <span className="text-[11.5px] tabular-nums text-faint">
          {week}/{h.workouts_per_week ?? 4} this week
        </span>
      </div>
      {todayW ? (
        <div className="flex items-center gap-2 text-[13.5px] text-fg">
          {todayW.status === "done" ? <Check className="h-4 w-4 text-success" /> : <Moon className="h-4 w-4 text-accent" />}
          {todayW.status === "done" ? `${DAY_LABEL[todayW.day_type ?? "other"]} day done` : todayW.status === "rest" ? "Rest day" : "Skipped today"}
        </div>
      ) : (
        <>
          <div className="text-[14px] font-medium text-fg">{DAY_LABEL[day]} day</div>
          <div className="text-[12px] text-muted">{DAY_HINT[day]}</div>
          <div className="mt-3 flex gap-2">
            <Link href="/health" className="flex h-8 flex-1 items-center justify-center rounded-lg bg-accent text-[12.5px] font-medium text-white">
              Log workout
            </Link>
            <button
              onClick={() => save.mutate({ date: today, day_type: null, status: "rest" }, { onSuccess: () => toast("Rest day logged — recovery counts too") })}
              className="h-8 rounded-lg border border-line px-3 text-[12.5px] text-fg-2 hover:border-line-strong"
            >
              Rest day
            </button>
          </div>
        </>
      )}
    </section>
  );
}
