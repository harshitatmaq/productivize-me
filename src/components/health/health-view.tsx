"use client";

import { ArrowDown, ArrowUp, Check, Dumbbell, Flame, HeartPulse, Moon, Plus, Scale, Trash2, Trophy, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Tip } from "@/components/ui/menu";
import { Card, EmptyState, PageHeader, Segmented, SectionTitle, Skeleton } from "@/components/ui/misc";
import {
  DAY_HINT,
  DAY_LABEL,
  DEFAULT_ROTATION,
  e1rm,
  formatSet,
  movingAverage,
  nextDayType,
  sessionsThisWeek,
  weeklyTrend,
  weekStreak,
  type DayType,
  type HealthSettings,
} from "@/lib/health";
import { useResettableState, useToday } from "@/lib/hooks";
import {
  useBodyMetrics,
  useDeleteExercise,
  useDeleteMetric,
  useDeleteWorkout,
  useExercises,
  useLogMetric,
  useSaveExercise,
  useSeedRoutine,
  useWorkouts,
} from "@/lib/queries/health";
import { useProfile, useUpdateProfile } from "@/lib/queries/profile";
import { addDays } from "@/lib/time";
import type { BodyMetric, Exercise, Workout, WorkoutSet } from "@/lib/types";
import { cn, plural } from "@/lib/utils";
import { LineChart } from "./line-chart";
import { WorkoutLogger } from "./workout-logger";

type Tab = "log" | "progress" | "weight" | "routine";
const short = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });

function useSettings(): [Required<Pick<HealthSettings, "unit" | "rotation" | "workouts_per_week">> & HealthSettings, (p: Partial<HealthSettings>) => void] {
  const { data: profile } = useProfile();
  const update = useUpdateProfile();
  const h = (profile?.health ?? {}) as HealthSettings;
  const s = { unit: h.unit ?? "kg", rotation: h.rotation?.length ? h.rotation : DEFAULT_ROTATION, workouts_per_week: h.workouts_per_week ?? 4, goal_weight: h.goal_weight ?? null };
  return [s, (p) => update.mutate({ health: { ...h, ...p } }, { onError: (e) => toast.error((e as Error).message) })];
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function FourWeeks({ workouts, today }: { workouts: Workout[]; today: string }) {
  const byDate = new Map(workouts.map((w) => [w.date, w]));
  const days = Array.from({ length: 28 }, (_, i) => addDays(today, i - 27));
  return (
    <div className="grid grid-cols-[repeat(14,minmax(0,1fr))] gap-1 sm:grid-cols-[repeat(28,minmax(0,1fr))]" role="list" aria-label="Last 4 weeks">
      {days.map((d) => {
        const w = byDate.get(d);
        const label = `${short(d)}: ${w ? (w.status === "done" ? `${DAY_LABEL[w.day_type ?? "other"]} day` : w.status === "rest" ? "rest day" : "skipped") : "nothing logged"}`;
        return (
          <Tip key={d} content={label}>
            <span
              role="listitem"
              aria-label={label}
              tabIndex={0}
              className={cn(
                "flex aspect-square items-center justify-center rounded-[5px] text-[9px] font-semibold uppercase",
                w?.status === "done" ? "bg-success text-white" : w?.status === "rest" ? "bg-accent/25 text-accent" : w?.status === "skipped" ? "bg-danger/20 text-danger" : "bg-panel-2 text-faint",
                d === today && "ring-2 ring-accent ring-offset-1 ring-offset-[var(--bg)]",
              )}
            >
              {w?.status === "done" ? (w.day_type ?? "o")[0] : w?.status === "rest" ? "r" : ""}
            </span>
          </Tip>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

function ProgressPanel({ exercises, workouts, sets, unit }: { exercises: Exercise[]; workouts: Workout[]; sets: WorkoutSet[]; unit: string }) {
  const today = useToday();
  const dateOf = new Map(workouts.map((w) => [w.id, w.date]));
  const withHistory = exercises.filter((e) => sets.some((s) => s.exercise_id === e.id));
  const [pick, setPick] = useState<string>(withHistory[0]?.id ?? "");
  const ex = withHistory.find((e) => e.id === pick) ?? withHistory[0];

  const series = (() => {
    if (!ex) return null;
    const byDate = new Map<string, WorkoutSet[]>();
    sets.filter((s) => s.exercise_id === ex.id).forEach((s) => {
      const d = dateOf.get(s.workout_id);
      if (d) byDate.set(d, [...(byDate.get(d) ?? []), s]);
    });
    const sessions = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    if (ex.measure === "weight_reps") {
      return {
        main: sessions.map(([date, ss]) => ({ date, value: Math.max(...ss.map((s) => e1rm(s.weight, s.reps) ?? 0)) })).filter((p) => p.value > 0),
        top: sessions.map(([date, ss]) => ({ date, value: Math.max(...ss.map((s) => s.weight ?? 0)) })).filter((p) => p.value > 0),
        sessions,
      };
    }
    return { main: sessions.map(([date, ss]) => ({ date, value: Math.max(...ss.map((s) => s.reps ?? 0)) })), top: [], sessions };
  })();

  // Sessions per week, last 12 weeks.
  const weeks = (() => {
    const out: { label: string; n: number }[] = [];
    const now = new Date(`${today}T12:00:00`);
    for (let i = 11; i >= 0; i--) {
      const end = new Date(now.getTime() - i * 7 * 86_400_000);
      const start = new Date(end.getTime() - 6 * 86_400_000);
      const s = start.toISOString().slice(0, 10);
      const e = end.toISOString().slice(0, 10);
      out.push({ label: short(s), n: workouts.filter((w) => w.status === "done" && w.date >= s && w.date <= e).length });
    }
    return out;
  })();
  const maxWeek = Math.max(1, ...weeks.map((w) => w.n));

  if (!withHistory.length) {
    return <EmptyState icon={<Trophy className="h-5 w-5" />} title="No progress yet">Log a couple of workouts and your strength curves and personal records show up here.</EmptyState>;
  }
  const best = ex && series ? [...(series.sessions.flatMap(([, ss]) => ss))] : [];
  const prE1 = ex?.measure === "weight_reps" ? Math.max(...best.map((s) => e1rm(s.weight, s.reps) ?? 0)) : null;
  const heaviest = best.reduce<WorkoutSet | null>((m, s) => ((s.weight ?? 0) > (m?.weight ?? 0) ? s : m), null);
  const mostReps = best.reduce<WorkoutSet | null>((m, s) => ((s.reps ?? 0) > (m?.reps ?? 0) ? s : m), null);
  const first = series?.main[0]?.value;
  const last = series?.main.at(-1)?.value;

  return (
    <div className="space-y-6">
      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <Select value={ex?.id ?? ""} onChange={(e) => setPick(e.target.value)} className="w-auto min-w-[220px]" aria-label="Exercise">
            {withHistory.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} · {DAY_LABEL[e.day_type]}
              </option>
            ))}
          </Select>
          {first && last ? (
            <span className={cn("text-[12.5px] tabular-nums", last >= first ? "text-success" : "text-danger")}>
              {last >= first ? "+" : ""}
              {Math.round((last - first) * 10) / 10} {ex?.measure === "time" ? "s" : ex?.measure === "reps" ? "reps" : unit} since {short(series!.main[0].date)}
            </span>
          ) : null}
        </div>
        {series ? (
          <LineChart
            unit={ex?.measure === "time" ? "s" : ex?.measure === "reps" ? "reps" : unit}
            series={[
              { name: ex?.measure === "weight_reps" ? "Estimated 1-rep max" : ex?.measure === "time" ? "Longest hold (s)" : "Best set (reps)", points: series.main, color: "var(--accent)" },
              ...(series.top.length ? [{ name: "Heaviest set", points: series.top, color: "var(--faint)", dashed: true, dots: false, width: 1.5 }] : []),
            ]}
          />
        ) : null}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            prE1 ? { k: "Best est. 1RM", v: `${prE1} ${unit}` } : null,
            heaviest?.weight ? { k: "Heaviest set", v: `${heaviest.weight} ${unit} × ${heaviest.reps}` } : null,
            mostReps ? { k: ex?.measure === "time" ? "Longest hold" : "Most reps", v: ex?.measure === "time" ? `${mostReps.reps}s` : `${mostReps.reps}${mostReps.weight ? ` @ ${mostReps.weight} ${unit}` : ""}` } : null,
            { k: "Sessions", v: String(series?.sessions.length ?? 0) },
          ]
            .filter(Boolean)
            .map((s) => (
              <div key={s!.k} className="rounded-lg border border-line bg-panel-2/50 p-2.5">
                <div className="text-[11px] text-muted">{s!.k}</div>
                <div className="text-[15px] font-semibold tabular-nums text-fg">{s!.v}</div>
              </div>
            ))}
        </div>
      </Card>

      <div>
        <SectionTitle>Workouts per week</SectionTitle>
        <Card className="p-4">
          <div className="flex h-28 items-end gap-1.5" role="img" aria-label="Workouts per week, last 12 weeks">
            {weeks.map((w, i) => (
              <Tip key={i} content={`Week of ${w.label}: ${plural(w.n, "workout")}`}>
                <div className="flex h-full flex-1 flex-col justify-end" tabIndex={0}>
                  <div className={cn("w-full rounded-t-[4px]", i === weeks.length - 1 ? "bg-accent" : "bg-accent/45")} style={{ height: `${Math.max(4, (w.n / maxWeek) * 100)}%`, opacity: w.n ? 1 : 0.35 }} />
                </div>
              </Tip>
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] text-faint">
            <span>{weeks[0].label}</span>
            <span>this week</span>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Weight
// ---------------------------------------------------------------------------

function WeightPanel({ metrics, unit, goal, onGoal }: { metrics: BodyMetric[]; unit: string; goal: number | null; onGoal: (g: number | null) => void }) {
  const today = useToday();
  const log = useLogMetric();
  const del = useDeleteMetric();
  const [date, setDate] = useState(today);
  const existing = metrics.find((m) => m.date === date);
  const [weight, setWeight] = useResettableState(existing?.id ?? date, () => (existing?.weight != null ? String(existing.weight) : ""));
  const [fat, setFat] = useState("");
  const [waist, setWaist] = useState("");
  const [goalText, setGoalText] = useResettableState(goal, (g) => (g ? String(g) : ""));
  const pts = metrics.filter((m) => m.weight != null).map((m) => ({ date: m.date, value: m.weight! }));
  const avg = movingAverage(pts);
  const trend = weeklyTrend(pts);
  const latest = pts.at(-1);
  const monthAgo = [...pts].reverse().find((p) => p.date <= addDays(today, -30));
  const eta =
    goal && latest && trend && Math.sign(goal - latest.value) === Math.sign(trend) && trend !== 0 ? Math.ceil(Math.abs((goal - latest.value) / trend)) : null;

  return (
    <div className="space-y-5">
      <Card className="p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const w = weight ? Number(weight) : null;
            if (!w && !fat && !waist) return toast.error("Enter your weight");
            log.mutate(
              { date, weight: w, body_fat: fat ? Number(fat) : null, waist: waist ? Number(waist) : null },
              { onSuccess: () => toast.success(`Logged ${w ?? ""}${w ? ` ${unit}` : ""} for ${short(date)}`), onError: (er) => toast.error((er as Error).message) },
            );
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <Field label="Date">
            <Input type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-[160px]" />
          </Field>
          <Field label={`Weight (${unit})`}>
            <Input inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value.replace(/[^\d.]/g, ""))} placeholder={latest ? String(latest.value) : "72.5"} className="w-[110px] tabular-nums" />
          </Field>
          <Field label="Body fat % (optional)">
            <Input inputMode="decimal" value={fat} onChange={(e) => setFat(e.target.value.replace(/[^\d.]/g, ""))} className="w-[110px]" />
          </Field>
          <Field label="Waist (optional)">
            <Input inputMode="decimal" value={waist} onChange={(e) => setWaist(e.target.value.replace(/[^\d.]/g, ""))} className="w-[110px]" />
          </Field>
          <Button type="submit" variant="primary" loading={log.isPending}>
            <Scale className="h-4 w-4" /> {existing ? "Update" : "Log weight"}
          </Button>
        </form>
        <p className="mt-2 text-[12px] text-faint">Weigh in at the same time each day (morning, after the bathroom) — the 7-day average smooths out water swings.</p>
      </Card>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { k: "Latest", v: latest ? `${latest.value} ${unit}` : "–", s: latest ? short(latest.date) : "" },
          { k: "7-day average", v: avg.at(-1) ? `${avg.at(-1)!.value} ${unit}` : "–", s: "" },
          { k: "Trend", v: trend !== null ? `${trend > 0 ? "+" : ""}${trend} ${unit}/wk` : "–", s: trend === null ? "needs 3+ weigh-ins" : "last 4 weeks" },
          { k: "30 days", v: latest && monthAgo ? `${latest.value - monthAgo.value > 0 ? "+" : ""}${Math.round((latest.value - monthAgo.value) * 10) / 10} ${unit}` : "–", s: "" },
        ].map((x) => (
          <Card key={x.k} className="p-3">
            <div className="text-[11px] text-muted">{x.k}</div>
            <div className="text-[17px] font-semibold tabular-nums text-fg">{x.v}</div>
            {x.s ? <div className="text-[11px] text-faint">{x.s}</div> : null}
          </Card>
        ))}
      </div>

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <SectionTitle className="mb-0">Body weight</SectionTitle>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onGoal(goalText ? Number(goalText) : null);
              toast.success(goalText ? `Goal set to ${goalText} ${unit}` : "Goal cleared");
            }}
            className="flex items-center gap-2 text-[12.5px] text-muted"
          >
            <label htmlFor="goal-weight">Goal</label>
            <Input id="goal-weight" inputMode="decimal" value={goalText} onChange={(e) => setGoalText(e.target.value.replace(/[^\d.]/g, ""))} placeholder="70" className="h-8 w-[80px]" />
            <Button size="sm" type="submit" variant="ghost">
              Set
            </Button>
            {eta ? <span className="text-fg-2">≈ {plural(eta, "week")} at this pace</span> : null}
          </form>
        </div>
        <LineChart
          unit={unit}
          goal={goal}
          series={[
            { name: "Daily", points: pts, color: "var(--faint)", width: 1, dots: true },
            { name: "7-day average", points: avg, color: "var(--accent)", dots: false, width: 2.5 },
          ]}
        />
      </Card>

      {metrics.length ? (
        <div>
          <SectionTitle>Recent weigh-ins</SectionTitle>
          <Card className="divide-y divide-line">
            {[...metrics].reverse().slice(0, 10).map((m) => (
              <div key={m.id} className="flex items-center gap-3 px-4 py-2 text-[13px]">
                <span className="w-20 text-muted">{short(m.date)}</span>
                <span className="flex-1 tabular-nums text-fg">
                  {m.weight != null ? `${m.weight} ${unit}` : ""}
                  {m.body_fat != null ? <span className="text-faint"> · {m.body_fat}% fat</span> : null}
                  {m.waist != null ? <span className="text-faint"> · waist {m.waist}</span> : null}
                </span>
                <Tip content="Delete this weigh-in">
                  <button onClick={() => del.mutate(m.id)} aria-label={`Delete weigh-in from ${short(m.date)}`} className="rounded p-1 text-faint hover:text-danger">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </Tip>
              </div>
            ))}
          </Card>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Routine
// ---------------------------------------------------------------------------

function ExerciseRow({ e, unit }: { e: Exercise; unit: string }) {
  const save = useSaveExercise();
  const del = useDeleteExercise();
  const [draft, setDraft] = useState(e);
  const dirty = JSON.stringify(draft) !== JSON.stringify(e);
  const commit = () => dirty && save.mutate(draft, { onError: (er) => toast.error((er as Error).message) });
  return (
    <div className="flex flex-wrap items-center gap-2 py-2" onBlur={commit}>
      <Input value={draft.name} onChange={(ev) => setDraft({ ...draft, name: ev.target.value })} className="min-w-[160px] flex-1" aria-label="Exercise name" />
      <Select value={draft.measure} onChange={(ev) => setDraft({ ...draft, measure: ev.target.value as Exercise["measure"] })} className="w-auto" aria-label={`${e.name} measured by`}>
        <option value="weight_reps">{unit} × reps</option>
        <option value="reps">Bodyweight reps</option>
        <option value="time">Seconds</option>
      </Select>
      <Input inputMode="numeric" value={draft.target_sets} onChange={(ev) => setDraft({ ...draft, target_sets: Number(ev.target.value.replace(/\D/g, "")) || 1 })} className="w-[56px] tabular-nums" aria-label={`${e.name} sets`} />
      <span className="text-[12px] text-faint">×</span>
      <Input inputMode="numeric" value={draft.reps_min} onChange={(ev) => setDraft({ ...draft, reps_min: Number(ev.target.value.replace(/\D/g, "")) || 1 })} className="w-[56px] tabular-nums" aria-label={`${e.name} minimum ${draft.measure === "time" ? "seconds" : "reps"}`} />
      <span className="text-[12px] text-faint">–</span>
      <Input inputMode="numeric" value={draft.reps_max} onChange={(ev) => setDraft({ ...draft, reps_max: Number(ev.target.value.replace(/\D/g, "")) || 1 })} className="w-[56px] tabular-nums" aria-label={`${e.name} maximum ${draft.measure === "time" ? "seconds" : "reps"}`} />
      <Tip content={draft.measure === "time" ? "Seconds to add when you hit the top" : `${unit} to add when every set hits the top of the range`}>
        <span className="inline-flex items-center gap-1 text-[12px] text-faint">
          +
          <Input inputMode="decimal" value={draft.increment} onChange={(ev) => setDraft({ ...draft, increment: Number(ev.target.value.replace(/[^\d.]/g, "")) || 0 })} className="w-[64px] tabular-nums" aria-label={`${e.name} increment`} />
        </span>
      </Tip>
      <Tip content={`Delete ${e.name}`}>
        <button
          type="button"
          onClick={() => window.confirm(`Delete ${e.name}? Logged sets stay in your history.`) && del.mutate(e.id)}
          aria-label={`Delete ${e.name}`}
          className="rounded p-1.5 text-faint hover:bg-panel-hover hover:text-danger"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </Tip>
    </div>
  );
}

function RoutinePanel({ exercises, settings, setSettings }: { exercises: Exercise[]; settings: ReturnType<typeof useSettings>[0]; setSettings: (p: Partial<HealthSettings>) => void }) {
  const save = useSaveExercise();
  const [adding, setAdding] = useState<Record<string, string>>({});
  const rot = settings.rotation;
  const move = (i: number, dir: -1 | 1) => {
    const next = [...rot];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    setSettings({ rotation: next });
  };
  const toggle = (d: DayType) => setSettings({ rotation: rot.includes(d) ? rot.filter((x) => x !== d) : [...rot, d] });

  return (
    <div className="space-y-6">
      <Card className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[13.5px] text-fg">Units</div>
          </div>
          <Segmented value={settings.unit} onChange={(v) => setSettings({ unit: v })} options={[{ value: "kg", label: "kg" }, { value: "lb", label: "lb" }]} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[13.5px] text-fg">Workouts per week (goal)</div>
            <div className="text-[12px] text-muted">Used for the weekly count and streak.</div>
          </div>
          <Select value={String(settings.workouts_per_week)} onChange={(e) => setSettings({ workouts_per_week: Number(e.target.value) })} className="w-auto">
            {[2, 3, 4, 5, 6, 7].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <div className="text-[13.5px] text-fg">Rotation</div>
          <div className="mb-2 text-[12px] text-muted">The order your training days repeat in. Today&apos;s suggestion is the day after your last completed one; rest days don&apos;t move it.</div>
          <div className="flex flex-wrap items-center gap-2">
            {rot.map((d, i) => (
              <span key={d} className="inline-flex items-center gap-1 rounded-lg border border-line bg-panel-2 py-1 pl-2.5 pr-1 text-[13px]">
                <span className="mr-1 text-faint">{i + 1}.</span>
                {DAY_LABEL[d]}
                <Tip content="Move earlier">
                  <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${DAY_LABEL[d]} earlier`} className="rounded p-0.5 text-faint hover:text-fg disabled:opacity-30">
                    <ArrowUp className="h-3 w-3 -rotate-90" />
                  </button>
                </Tip>
                <Tip content="Move later">
                  <button type="button" disabled={i === rot.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${DAY_LABEL[d]} later`} className="rounded p-0.5 text-faint hover:text-fg disabled:opacity-30">
                    <ArrowDown className="h-3 w-3 -rotate-90" />
                  </button>
                </Tip>
                <Tip content={`Remove ${DAY_LABEL[d]} from the rotation`}>
                  <button type="button" disabled={rot.length === 1} onClick={() => toggle(d)} aria-label={`Remove ${DAY_LABEL[d]}`} className="rounded p-0.5 text-faint hover:text-danger disabled:opacity-30">
                    <X className="h-3 w-3" />
                  </button>
                </Tip>
              </span>
            ))}
            {(["push", "pull", "legs", "core"] as const)
              .filter((d) => !rot.includes(d))
              .map((d) => (
                <button key={d} type="button" onClick={() => toggle(d)} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-line px-2.5 py-1 text-[13px] text-muted hover:text-fg">
                  <Plus className="h-3 w-3" /> {DAY_LABEL[d]}
                </button>
              ))}
          </div>
        </div>
      </Card>

      {(["push", "pull", "legs", "core"] as const).map((d) => {
        const list = exercises.filter((e) => e.day_type === d && !e.archived);
        return (
          <section key={d}>
            <SectionTitle right={<span className="text-[11.5px] text-faint">{DAY_HINT[d]}</span>}>
              {DAY_LABEL[d]} day · {list.length}
            </SectionTitle>
            <Card className="divide-y divide-line px-4">
              {list.map((e) => (
                <ExerciseRow key={`${e.id}-${e.measure}`} e={e} unit={settings.unit} />
              ))}
              <form
                onSubmit={(ev) => {
                  ev.preventDefault();
                  const name = (adding[d] ?? "").trim();
                  if (!name) return;
                  save.mutate(
                    { name, day_type: d, measure: d === "core" ? "reps" : "weight_reps", target_sets: 3, reps_min: 8, reps_max: 12, increment: 2.5 },
                    { onSuccess: () => setAdding((a) => ({ ...a, [d]: "" })) },
                  );
                }}
                className="flex items-center gap-2 py-2"
              >
                <Plus className="h-4 w-4 shrink-0 text-faint" />
                <input
                  value={adding[d] ?? ""}
                  onChange={(ev) => setAdding((a) => ({ ...a, [d]: ev.target.value }))}
                  placeholder={`Add a ${DAY_LABEL[d].toLowerCase()} exercise`}
                  aria-label={`Add a ${DAY_LABEL[d]} exercise`}
                  maxLength={80}
                  className="h-8 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-faint"
                />
              </form>
            </Card>
          </section>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------

function History({ workouts, sets, exercises, unit }: { workouts: Workout[]; sets: WorkoutSet[]; exercises: Exercise[]; unit: string }) {
  const del = useDeleteWorkout();
  const [open, setOpen] = useState<string | null>(null);
  const recent = workouts.slice(0, 12);
  if (!recent.length) return null;
  return (
    <div>
      <SectionTitle>History</SectionTitle>
      <Card className="divide-y divide-line">
        {recent.map((w) => {
          const ss = sets.filter((s) => s.workout_id === w.id);
          const volume = ss.reduce((v, s) => v + (s.weight ?? 0) * (s.reps ?? 0), 0);
          const groups = [...new Set(ss.map((s) => s.exercise_name))];
          return (
            <div key={w.id} className="px-4 py-2.5">
              <div className="flex items-center gap-3">
                <button onClick={() => setOpen(open === w.id ? null : w.id)} aria-expanded={open === w.id} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <span className="w-16 shrink-0 text-[12.5px] text-muted">{short(w.date)}</span>
                  <span
                    className={cn(
                      "rounded px-1.5 text-[11.5px] leading-5",
                      w.status === "done" ? "bg-success/15 text-success" : w.status === "rest" ? "bg-accent/15 text-accent" : "bg-danger/15 text-danger",
                    )}
                  >
                    {w.status === "done" ? DAY_LABEL[w.day_type ?? "other"] : w.status === "rest" ? "Rest" : "Skipped"}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-faint">
                    {w.status === "done" ? `${plural(ss.length, "set")}${volume ? ` · ${Math.round(volume).toLocaleString()} ${unit} volume` : ""}${w.duration_min ? ` · ${w.duration_min} min` : ""}` : (w.notes ?? "")}
                  </span>
                </button>
                <Tip content="Delete this day">
                  <button onClick={() => window.confirm(`Delete ${short(w.date)}?`) && del.mutate(w.id)} aria-label={`Delete workout from ${short(w.date)}`} className="rounded p-1 text-faint hover:text-danger">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </Tip>
              </div>
              {open === w.id ? (
                <div className="mt-2 space-y-1 pl-[76px] text-[12.5px]">
                  {groups.map((g) => {
                    const ex = exercises.find((e) => e.name === g);
                    return (
                      <div key={g}>
                        <span className="text-fg-2">{g}</span>{" "}
                        <span className="text-faint">
                          {ss
                            .filter((s) => s.exercise_name === g)
                            .map((s) => formatSet(s, ex?.measure ?? "weight_reps", unit))
                            .join(", ")}
                        </span>
                      </div>
                    );
                  })}
                  {w.notes ? <div className="text-muted">“{w.notes}”</div> : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </Card>
    </div>
  );
}

export function HealthView() {
  const params = useSearchParams();
  const router = useRouter();
  const today = useToday();
  const { data: exercises = [], isLoading: exLoading } = useExercises();
  const { data: wdata, isLoading } = useWorkouts();
  const { data: metrics = [] } = useBodyMetrics();
  const seed = useSeedRoutine();
  const [settings, setSettings] = useSettings();
  const [tab, setTabState] = useState<Tab>((params.get("tab") as Tab) || "log");
  const [date, setDate] = useState(today);
  const workouts = wdata?.workouts ?? [];
  const sets = wdata?.sets ?? [];
  const setTab = (t: Tab) => {
    setTabState(t);
    router.replace(t === "log" ? "/health" : `/health?tab=${t}`);
  };

  const suggested = nextDayType(settings.rotation, workouts, date);
  const todayW = workouts.find((w) => w.date === today);
  const week = sessionsThisWeek(workouts, today);
  const streak = weekStreak(workouts, today, settings.workouts_per_week);
  const weights = metrics.filter((m) => m.weight != null).map((m) => ({ date: m.date, value: m.weight! }));
  const avg = movingAverage(weights).at(-1);
  const trend = weeklyTrend(weights);

  return (
    <div className="mx-auto max-w-[980px] px-4 pt-5 md:px-8 md:pt-10">
      <PageHeader title="Health" icon={<HeartPulse className="h-5 w-5" />} subtitle="Push / Pull / Legs + Core: log each session, follow the progression, track your weight." />

      <div className="mb-5 grid gap-3 md:grid-cols-3">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-[12px] text-muted">
            <Dumbbell className="h-3.5 w-3.5 text-accent" /> Today
          </div>
          {todayW ? (
            <div className="mt-1">
              <div className="flex items-center gap-1.5 text-[17px] font-semibold text-fg">
                {todayW.status === "done" ? <Check className="h-4 w-4 text-success" /> : todayW.status === "rest" ? <Moon className="h-4 w-4 text-accent" /> : <X className="h-4 w-4 text-danger" />}
                {todayW.status === "done" ? `${DAY_LABEL[todayW.day_type ?? "other"]} day done` : todayW.status === "rest" ? "Rest day" : "Skipped"}
              </div>
              <div className="text-[12px] text-faint">{todayW.duration_min ? `${todayW.duration_min} min` : "Edit it below any time"}</div>
            </div>
          ) : (
            <div className="mt-1">
              <div className="text-[17px] font-semibold text-fg">{DAY_LABEL[nextDayType(settings.rotation, workouts, today)]} day</div>
              <div className="text-[12px] text-faint">{DAY_HINT[nextDayType(settings.rotation, workouts, today)]} · not logged yet</div>
            </div>
          )}
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-[12px] text-muted">
            <Flame className="h-3.5 w-3.5 text-p2" /> This week
          </div>
          <div className="mt-1 text-[17px] font-semibold tabular-nums text-fg">
            {week}/{settings.workouts_per_week} workouts
          </div>
          <div className="text-[12px] text-faint">{streak ? `${plural(streak, "week")} in a row on target` : "Hit your weekly goal to start a streak"}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-[12px] text-muted">
            <Scale className="h-3.5 w-3.5 text-success" /> Weight
          </div>
          <div className="mt-1 text-[17px] font-semibold tabular-nums text-fg">{avg ? `${avg.value} ${settings.unit}` : "–"}</div>
          <div className="text-[12px] text-faint">
            {avg ? `7-day average${trend !== null ? ` · ${trend > 0 ? "+" : ""}${trend}/wk` : ""}` : "Log a weigh-in on the Weight tab"}
          </div>
        </Card>
      </div>

      <Card className="mb-6 p-4">
        <div className="mb-2 flex items-center justify-between text-[12px] text-muted">
          <span>Last 4 weeks</span>
          <span className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-[3px] bg-success" /> trained</span>
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-[3px] bg-accent/25" /> rest</span>
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-[3px] bg-danger/20" /> skipped</span>
          </span>
        </div>
        {isLoading ? <Skeleton className="h-8" /> : <FourWeeks workouts={workouts} today={today} />}
      </Card>

      <div className="mb-5 overflow-x-auto no-scrollbar">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "log", label: "Log workout" },
            { value: "progress", label: "Progress" },
            { value: "weight", label: "Weight" },
            { value: "routine", label: "Routine" },
          ]}
        />
      </div>

      {tab === "log" ? (
        exLoading ? (
          <Skeleton className="h-64 rounded-xl" />
        ) : !exercises.length ? (
          <EmptyState
            icon={<Dumbbell className="h-5 w-5" />}
            title="Set up your routine"
            action={
              <Button variant="primary" loading={seed.isPending} onClick={() => seed.mutate(undefined, { onSuccess: () => toast.success("PPL + Core routine added — tweak it on the Routine tab") })}>
                <Plus className="h-4 w-4" /> Use the PPL + Core routine
              </Button>
            }
          >
            Starts you with 5 exercises each for Push, Pull, Legs and Core, with rep ranges and weight steps for progression. You can change everything on the Routine tab.
          </EmptyState>
        ) : (
          <div className="space-y-8">
            <WorkoutLogger date={date} onDateChange={setDate} suggestedDay={suggested} exercises={exercises} workouts={workouts} sets={sets} unit={settings.unit} />
            <History workouts={workouts} sets={sets} exercises={exercises} unit={settings.unit} />
          </div>
        )
      ) : null}
      {tab === "progress" ? <ProgressPanel exercises={exercises} workouts={workouts} sets={sets} unit={settings.unit} /> : null}
      {tab === "weight" ? <WeightPanel metrics={metrics} unit={settings.unit} goal={settings.goal_weight ?? null} onGoal={(g) => setSettings({ goal_weight: g })} /> : null}
      {tab === "routine" ? <RoutinePanel exercises={exercises} settings={settings} setSettings={setSettings} /> : null}
    </div>
  );
}
