"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DEFAULT_ROUTINE } from "@/lib/health";
import type { BodyMetric, Exercise, Workout, WorkoutSet } from "@/lib/types";
import { sb, unwrap } from "./client";

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export function useExercises() {
  return useQuery({
    queryKey: ["exercises"],
    queryFn: async () =>
      (unwrap(await sb().from("exercises").select("*").order("sort").order("created_at")) as Exercise[]).map((e) => ({ ...e, increment: Number(e.increment) })),
  });
}

/** The last ~6 months of workouts with their sets. */
export function useWorkouts() {
  return useQuery({
    queryKey: ["workouts"],
    queryFn: async () => {
      const since = new Date(Date.now() - 200 * 86_400_000).toISOString().slice(0, 10);
      const workouts = unwrap(await sb().from("workouts").select("*").gte("date", since).order("date", { ascending: false })) as Workout[];
      const sets = workouts.length
        ? (unwrap(await sb().from("workout_sets").select("*").in("workout_id", workouts.map((w) => w.id)).order("set_no").limit(5000)) as WorkoutSet[])
        : [];
      return { workouts, sets: sets.map((s) => ({ ...s, weight: num(s.weight) })) };
    },
  });
}

export function useBodyMetrics() {
  return useQuery({
    queryKey: ["body-metrics"],
    queryFn: async () =>
      (unwrap(await sb().from("body_metrics").select("*").order("date", { ascending: true }).limit(800)) as BodyMetric[]).map((m) => ({
        ...m,
        weight: num(m.weight),
        body_fat: num(m.body_fat),
        waist: num(m.waist),
      })),
  });
}

export function useSeedRoutine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => unwrap(await sb().from("exercises").insert(DEFAULT_ROUTINE.map((e, i) => ({ ...e, sort: i }))).select("*")),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exercises"] }),
  });
}

export function useSaveExercise() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (e: Partial<Exercise> & { name: string; day_type: Exercise["day_type"] }) => {
      const { id, ...rest } = e;
      return unwrap(id ? await sb().from("exercises").update(rest).eq("id", id).select("*").single() : await sb().from("exercises").insert({ ...rest, sort: Date.now() / 1e9 }).select("*").single()) as Exercise;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["exercises"] }),
  });
}

export function useDeleteExercise() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await sb().from("exercises").delete().eq("id", id)),
    onMutate: (id) => qc.setQueryData<Exercise[]>(["exercises"], (prev) => prev?.filter((e) => e.id !== id)),
  });
}

export type SetInput = { exercise_id: string | null; exercise_name: string; reps: number | null; weight: number | null };

/** Saves a day's workout (replacing its sets). */
export function useSaveWorkout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { date: string; day_type: Workout["day_type"]; status: Workout["status"]; duration_min?: number | null; notes?: string | null; sets?: SetInput[] }) => {
      const client = sb();
      const { data: u } = await client.auth.getUser();
      const w = unwrap(
        await client
          .from("workouts")
          .upsert({ user_id: u.user!.id, date: v.date, day_type: v.day_type, status: v.status, duration_min: v.duration_min ?? null, notes: v.notes ?? null }, { onConflict: "user_id,date" })
          .select("*")
          .single(),
      ) as Workout;
      if (v.sets) {
        unwrap(await client.from("workout_sets").delete().eq("workout_id", w.id));
        const rows = v.sets
          .filter((s) => (s.reps ?? 0) > 0 || (s.weight ?? 0) > 0)
          .map((s, i) => ({ workout_id: w.id, exercise_id: s.exercise_id, exercise_name: s.exercise_name, set_no: i + 1, reps: s.reps, weight: s.weight }));
        if (rows.length) unwrap(await client.from("workout_sets").insert(rows));
      }
      return w;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["workouts"] }),
  });
}

export function useDeleteWorkout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await sb().from("workouts").delete().eq("id", id)),
    onSettled: () => qc.invalidateQueries({ queryKey: ["workouts"] }),
  });
}

export function useLogMetric() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { date: string; weight: number | null; body_fat?: number | null; waist?: number | null; note?: string | null }) => {
      const { data: u } = await sb().auth.getUser();
      return unwrap(await sb().from("body_metrics").upsert({ user_id: u.user!.id, ...v }, { onConflict: "user_id,date" }).select("*").single()) as BodyMetric;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["body-metrics"] }),
  });
}

export function useDeleteMetric() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await sb().from("body_metrics").delete().eq("id", id)),
    onMutate: (id) => qc.setQueryData<BodyMetric[]>(["body-metrics"], (prev) => prev?.filter((m) => m.id !== id)),
  });
}
