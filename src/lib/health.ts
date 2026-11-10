/**
 * Health: Push / Pull / Legs + Core training, double progression and body weight.
 * Pure helpers shared by the UI and tests.
 */

export type DayType = "push" | "pull" | "legs" | "core";
export type Measure = "weight_reps" | "reps" | "time";

export type HealthSettings = {
  unit?: "kg" | "lb";
  /** Order the training days repeat in. */
  rotation?: DayType[];
  workouts_per_week?: number;
  goal_weight?: number | null;
};

export const DAY_LABEL: Record<DayType | "other", string> = { push: "Push", pull: "Pull", legs: "Legs", core: "Core", other: "Other" };
export const DAY_HINT: Record<DayType, string> = {
  push: "Chest, shoulders, triceps",
  pull: "Back, rear delts, biceps",
  legs: "Quads, hamstrings, glutes, calves",
  core: "Abs, obliques, stability",
};
export const DEFAULT_ROTATION: DayType[] = ["push", "pull", "legs", "core"];

export type ExerciseTemplate = { name: string; day_type: DayType; measure: Measure; target_sets: number; reps_min: number; reps_max: number; increment: number };

/** A sensible starting routine; every number is editable on the Routine tab. */
export const DEFAULT_ROUTINE: ExerciseTemplate[] = [
  { name: "Barbell bench press", day_type: "push", measure: "weight_reps", target_sets: 3, reps_min: 6, reps_max: 8, increment: 2.5 },
  { name: "Overhead press", day_type: "push", measure: "weight_reps", target_sets: 3, reps_min: 6, reps_max: 8, increment: 2.5 },
  { name: "Incline dumbbell press", day_type: "push", measure: "weight_reps", target_sets: 3, reps_min: 8, reps_max: 12, increment: 2 },
  { name: "Lateral raise", day_type: "push", measure: "weight_reps", target_sets: 3, reps_min: 12, reps_max: 15, increment: 1 },
  { name: "Triceps pushdown", day_type: "push", measure: "weight_reps", target_sets: 3, reps_min: 10, reps_max: 12, increment: 2.5 },
  { name: "Barbell row", day_type: "pull", measure: "weight_reps", target_sets: 3, reps_min: 6, reps_max: 8, increment: 2.5 },
  { name: "Pull-up", day_type: "pull", measure: "reps", target_sets: 3, reps_min: 6, reps_max: 10, increment: 2.5 },
  { name: "Lat pulldown", day_type: "pull", measure: "weight_reps", target_sets: 3, reps_min: 8, reps_max: 12, increment: 2.5 },
  { name: "Face pull", day_type: "pull", measure: "weight_reps", target_sets: 3, reps_min: 12, reps_max: 15, increment: 2.5 },
  { name: "Barbell curl", day_type: "pull", measure: "weight_reps", target_sets: 3, reps_min: 8, reps_max: 12, increment: 1.25 },
  { name: "Back squat", day_type: "legs", measure: "weight_reps", target_sets: 3, reps_min: 5, reps_max: 8, increment: 2.5 },
  { name: "Romanian deadlift", day_type: "legs", measure: "weight_reps", target_sets: 3, reps_min: 8, reps_max: 10, increment: 2.5 },
  { name: "Leg press", day_type: "legs", measure: "weight_reps", target_sets: 3, reps_min: 10, reps_max: 12, increment: 5 },
  { name: "Lying leg curl", day_type: "legs", measure: "weight_reps", target_sets: 3, reps_min: 10, reps_max: 12, increment: 2.5 },
  { name: "Standing calf raise", day_type: "legs", measure: "weight_reps", target_sets: 4, reps_min: 10, reps_max: 15, increment: 2.5 },
  { name: "Plank", day_type: "core", measure: "time", target_sets: 3, reps_min: 45, reps_max: 60, increment: 10 },
  { name: "Hanging leg raise", day_type: "core", measure: "reps", target_sets: 3, reps_min: 10, reps_max: 15, increment: 2.5 },
  { name: "Cable crunch", day_type: "core", measure: "weight_reps", target_sets: 3, reps_min: 12, reps_max: 15, increment: 2.5 },
  { name: "Ab wheel rollout", day_type: "core", measure: "reps", target_sets: 3, reps_min: 8, reps_max: 12, increment: 2.5 },
  { name: "Pallof press", day_type: "core", measure: "weight_reps", target_sets: 3, reps_min: 10, reps_max: 12, increment: 2.5 },
];

export type WorkoutLite = { date: string; day_type: DayType | "other" | null; status: "done" | "rest" | "skipped" };
export type SetLite = { reps: number | null; weight: number | null };

/** Today's training day: the one after your last completed session (rest days don't advance it). */
export function nextDayType(rotation: DayType[] = DEFAULT_ROTATION, workouts: WorkoutLite[], today?: string): DayType {
  const order = rotation.length ? rotation : DEFAULT_ROTATION;
  const done = workouts
    .filter((w) => w.status === "done" && w.day_type && w.day_type !== "other" && (!today || w.date < today))
    .sort((a, b) => b.date.localeCompare(a.date));
  const last = done[0]?.day_type as DayType | undefined;
  if (!last || !order.includes(last)) return order[0];
  return order[(order.indexOf(last) + 1) % order.length];
}

/** Estimated one-rep max (Epley); bodyweight/time sets have none. */
export function e1rm(weight: number | null | undefined, reps: number | null | undefined): number | null {
  if (!weight || !reps || reps <= 0) return null;
  if (reps === 1) return weight;
  return Math.round(weight * (1 + Math.min(reps, 12) / 30) * 10) / 10;
}

export type Suggestion = { weight: number | null; reps: number; reason: string };

/**
 * Double progression: once every working set reaches the top of the rep range,
 * add weight and go back to the bottom; otherwise keep the weight and add reps.
 * Time holds and bodyweight reps progress by seconds / reps.
 */
export function suggestNext(
  ex: { measure: Measure; target_sets: number; reps_min: number; reps_max: number; increment: number },
  last: SetLite[],
  unit = "kg",
): Suggestion | null {
  const sets = last.filter((s) => (s.reps ?? 0) > 0);
  if (!sets.length) return null;
  const hitTop = sets.length >= ex.target_sets && sets.every((s) => (s.reps ?? 0) >= ex.reps_max);
  if (ex.measure === "time") {
    const best = Math.max(...sets.map((s) => s.reps ?? 0));
    return hitTop
      ? { weight: null, reps: best + ex.increment, reason: `All sets hit ${ex.reps_max}s — hold ${best + ex.increment}s.` }
      : { weight: null, reps: Math.min(ex.reps_max, best + 5), reason: `Build to ${ex.reps_max}s on every set.` };
  }
  const weight = Math.max(...sets.map((s) => s.weight ?? 0));
  if (ex.measure === "reps" && !weight) {
    const best = Math.max(...sets.map((s) => s.reps ?? 0));
    return hitTop
      ? { weight: ex.increment, reps: ex.reps_min, reason: `All sets hit ${ex.reps_max} — add ${ex.increment} ${unit}.` }
      : { weight: null, reps: Math.min(ex.reps_max, best + 1), reason: `Aim for ${Math.min(ex.reps_max, best + 1)} reps.` };
  }
  if (hitTop) {
    const w = Math.round((weight + ex.increment) * 100) / 100;
    return { weight: w, reps: ex.reps_min, reason: `All sets hit ${ex.reps_max} — go up to ${w} ${unit}.` };
  }
  const lowest = Math.min(...sets.map((s) => s.reps ?? 0));
  const target = Math.min(ex.reps_max, Math.max(ex.reps_min, lowest + 1));
  return { weight, reps: target, reason: `Stay at ${weight} ${unit}, aim for ${target}+ reps on every set.` };
}

/** Trailing moving average over entries sorted by date. */
export function movingAverage(points: { date: string; value: number }[], window = 7): { date: string; value: number }[] {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.map((p, i) => {
    const from = new Date(`${p.date}T12:00:00`).getTime() - (window - 1) * 86_400_000;
    const inWin = sorted.slice(0, i + 1).filter((q) => new Date(`${q.date}T12:00:00`).getTime() >= from);
    return { date: p.date, value: Math.round((inWin.reduce((s, q) => s + q.value, 0) / inWin.length) * 10) / 10 };
  });
}

/** Weight change per week from the last `days` of entries (least squares), or null with too little data. */
export function weeklyTrend(points: { date: string; value: number }[], days = 28): number | null {
  if (!points.length) return null;
  const last = Math.max(...points.map((p) => new Date(`${p.date}T12:00:00`).getTime()));
  const recent = points.filter((p) => new Date(`${p.date}T12:00:00`).getTime() >= last - days * 86_400_000);
  if (recent.length < 3) return null;
  const xs = recent.map((p) => (new Date(`${p.date}T12:00:00`).getTime() - last) / 86_400_000);
  const ys = recent.map((p) => p.value);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const den = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  if (!den) return null;
  const slope = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / den;
  return Math.round(slope * 7 * 100) / 100;
}

/** Completed sessions in the week containing `today` (week starts on `weekStartsOn`). */
export function sessionsThisWeek(workouts: WorkoutLite[], today: string, weekStartsOn = 1): number {
  const d = new Date(`${today}T12:00:00`);
  const diff = (d.getDay() - weekStartsOn + 7) % 7;
  const start = new Date(d.getTime() - diff * 86_400_000);
  const s = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
  return workouts.filter((w) => w.status === "done" && w.date >= s && w.date <= today).length;
}

/** Consecutive weeks (ending with the current or last full week) that met the weekly goal. */
export function weekStreak(workouts: WorkoutLite[], today: string, goal: number, weekStartsOn = 1): number {
  let streak = 0;
  let cursor = new Date(`${today}T12:00:00`);
  for (let i = 0; i < 104; i++) {
    const day = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    const n = sessionsThisWeek(workouts, day, weekStartsOn);
    if (n >= goal) streak++;
    else if (i > 0) break; // the current week may still be in progress
    const diff = (cursor.getDay() - weekStartsOn + 7) % 7;
    cursor = new Date(cursor.getTime() - (diff + 1) * 86_400_000);
  }
  return streak;
}

export const formatSet = (s: SetLite, measure: Measure, unit = "kg") =>
  measure === "time" ? `${s.reps ?? 0}s` : s.weight ? `${s.weight} ${unit} × ${s.reps ?? 0}` : `${s.reps ?? 0} reps`;
