"use client";

import { Minus, Plus, Sparkles, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Tip } from "@/components/ui/menu";
import { Segmented } from "@/components/ui/misc";
import { DAY_HINT, DAY_LABEL, formatSet, suggestNext, type DayType } from "@/lib/health";
import { useResettableState } from "@/lib/hooks";
import { useSaveWorkout, type SetInput } from "@/lib/queries/health";
import type { Exercise, Workout, WorkoutSet } from "@/lib/types";
import { cn } from "@/lib/utils";

type Row = { weight: string; reps: string };
type Block = { key: string; exercise: Exercise | null; name: string; measure: Exercise["measure"]; rows: Row[] };

const n = (s: string) => (s.trim() === "" ? null : Number(s));

/** Sets from the most recent earlier session of this exercise. */
function lastSession(exerciseId: string, name: string, before: string, workouts: Workout[], sets: WorkoutSet[]) {
  const byWorkout = new Map(workouts.map((w) => [w.id, w]));
  const relevant = sets.filter((s) => (s.exercise_id === exerciseId || s.exercise_name === name) && (byWorkout.get(s.workout_id)?.date ?? "") < before);
  if (!relevant.length) return null;
  const latestDate = relevant.reduce((d, s) => ((byWorkout.get(s.workout_id)?.date ?? "") > d ? (byWorkout.get(s.workout_id)?.date ?? "") : d), "");
  return { date: latestDate, sets: relevant.filter((s) => byWorkout.get(s.workout_id)?.date === latestDate) };
}

export function WorkoutLogger({
  date,
  onDateChange,
  suggestedDay,
  exercises,
  workouts,
  sets,
  unit,
}: {
  date: string;
  onDateChange: (d: string) => void;
  suggestedDay: DayType;
  exercises: Exercise[];
  workouts: Workout[];
  sets: WorkoutSet[];
  unit: string;
}) {
  const existing = workouts.find((w) => w.date === date) ?? null;
  const existingSets = useMemo(() => (existing ? sets.filter((s) => s.workout_id === existing.id) : []), [existing, sets]);
  // Re-pick once history loads (the suggestion depends on it) or the date changes.
  const [dayChoice, setDayChoice] = useResettableState(`${existing?.id ?? date}|${suggestedDay}`, () => (existing?.day_type ?? suggestedDay) as DayType | "other");
  const save = useSaveWorkout();
  const [extraName, setExtraName] = useState("");

  const plan = exercises.filter((e) => !e.archived && e.day_type === dayChoice);
  const sourceKey = `${date}|${dayChoice}|${existing?.id ?? ""}|${existingSets.length}|${sets.length}|${plan.map((e) => e.id).join(",")}`;
  const [blocks, setBlocks] = useResettableState(sourceKey, (): Block[] => {
    const fromExisting = new Map<string, Row[]>();
    existingSets.forEach((s) => {
      const k = s.exercise_id ?? `name:${s.exercise_name}`;
      fromExisting.set(k, [...(fromExisting.get(k) ?? []), { weight: s.weight != null ? String(s.weight) : "", reps: s.reps != null ? String(s.reps) : "" }]);
    });
    const out: Block[] = plan.map((e) => {
      const prev = lastSession(e.id, e.name, date, workouts, sets);
      const sug = prev ? suggestNext(e, prev.sets, unit) : null;
      const rows = fromExisting.get(e.id) ?? Array.from({ length: e.target_sets }, () => ({ weight: sug?.weight != null ? String(sug.weight) : "", reps: "" }));
      fromExisting.delete(e.id);
      return { key: e.id, exercise: e, name: e.name, measure: e.measure, rows };
    });
    // One-off exercises logged that day.
    for (const [k, rows] of fromExisting) out.push({ key: k, exercise: null, name: k.replace(/^name:/, "").replace(/^.*?:/, ""), measure: "weight_reps", rows });
    return out;
  });

  const setRow = (key: string, i: number, patch: Partial<Row>) =>
    setBlocks((bs) => bs.map((b) => (b.key === key ? { ...b, rows: b.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) } : b)));
  const addRow = (key: string) => setBlocks((bs) => bs.map((b) => (b.key === key ? { ...b, rows: [...b.rows, { weight: b.rows.at(-1)?.weight ?? "", reps: "" }] } : b)));
  const removeRow = (key: string) => setBlocks((bs) => bs.map((b) => (b.key === key ? { ...b, rows: b.rows.slice(0, -1) } : b)));

  const [duration, setDuration] = useResettableState(sourceKey, () => (existing?.duration_min ? String(existing.duration_min) : ""));
  const [notes, setNotes] = useResettableState(sourceKey, () => existing?.notes ?? "");

  const submit = (status: Workout["status"]) => {
    const payload: SetInput[] = blocks.flatMap((b) =>
      b.rows.map((r) => ({ exercise_id: b.exercise?.id ?? null, exercise_name: b.name, reps: n(r.reps), weight: b.measure === "time" ? null : n(r.weight) })),
    );
    const logged = payload.filter((p) => (p.reps ?? 0) > 0).length;
    if (status === "done" && !logged && !window.confirm("No sets entered. Mark the workout as done anyway?")) return;
    save.mutate(
      {
        date,
        day_type: status === "rest" ? null : dayChoice,
        status,
        duration_min: duration ? Number(duration) : null,
        notes: notes.trim() || null,
        sets: status === "done" ? payload : [],
      },
      {
        onSuccess: () => toast.success(status === "done" ? `${DAY_LABEL[dayChoice]} day saved · ${logged} sets` : status === "rest" ? "Rest day logged" : "Marked as skipped"),
        onError: (e) => toast.error((e as Error).message),
      },
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => e.target.value && onDateChange(e.target.value)} className="w-[160px]" />
        </Field>
        <div>
          <div className="mb-1.5 text-[12px] font-medium text-muted">Training day</div>
          <Segmented
            value={dayChoice}
            onChange={setDayChoice}
            options={(["push", "pull", "legs", "core", "other"] as const).map((d) => ({ value: d, label: d === suggestedDay && !existing ? `${DAY_LABEL[d]} ★` : DAY_LABEL[d] }))}
          />
        </div>
        {existing ? (
          <span className="pb-1.5 text-[12px] text-muted">
            Logged as <b className="text-fg-2">{existing.status === "done" ? `${DAY_LABEL[existing.day_type ?? "other"]} · done` : existing.status}</b> — saving replaces it.
          </span>
        ) : null}
      </div>
      {dayChoice !== "other" ? <p className="-mt-2 text-[12px] text-faint">{DAY_HINT[dayChoice]} · ★ = next in your rotation</p> : null}

      {blocks.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line p-4 text-[12.5px] text-muted">
          No exercises for this day yet. Add them on the <b>Routine</b> tab, or log a one-off exercise below.
        </p>
      ) : null}

      <div className="space-y-3">
        {blocks.map((b) => {
          const prev = b.exercise ? lastSession(b.exercise.id, b.name, date, workouts, sets) : null;
          const sug = b.exercise && prev ? suggestNext(b.exercise, prev.sets, unit) : null;
          const repsLabel = b.measure === "time" ? "sec" : "reps";
          return (
            <div key={b.key} className="rounded-xl border border-line bg-panel p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <div className="text-[14px] font-medium text-fg">{b.name}</div>
                {b.exercise ? (
                  <div className="text-[12px] text-faint">
                    {b.exercise.target_sets} × {b.exercise.reps_min}–{b.exercise.reps_max} {repsLabel}
                  </div>
                ) : null}
              </div>
              {prev ? (
                <div className="mt-0.5 text-[12px] text-muted">
                  Last ({new Date(`${prev.date}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" })}): {prev.sets.map((s) => formatSet(s, b.measure, unit)).join(", ")}
                </div>
              ) : null}
              {sug ? (
                <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-accent/10 px-2 py-0.5 text-[12px] text-accent">
                  <Sparkles className="h-3 w-3" /> {sug.reason}
                </div>
              ) : null}
              <div className="mt-2 space-y-1.5">
                {b.rows.map((r, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-10 shrink-0 text-[11.5px] tabular-nums text-faint">Set {i + 1}</span>
                    {b.measure !== "time" ? (
                      <div className="relative w-[110px]">
                        <Input
                          inputMode="decimal"
                          value={r.weight}
                          onChange={(e) => setRow(b.key, i, { weight: e.target.value.replace(/[^\d.]/g, "") })}
                          placeholder={b.measure === "reps" ? "+kg" : "0"}
                          aria-label={`${b.name} set ${i + 1} weight`}
                          className="pr-9 tabular-nums"
                        />
                        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-faint">{unit}</span>
                      </div>
                    ) : null}
                    <span className="text-faint">×</span>
                    <div className="relative w-[96px]">
                      <Input
                        inputMode="numeric"
                        value={r.reps}
                        onChange={(e) => setRow(b.key, i, { reps: e.target.value.replace(/\D/g, "") })}
                        placeholder={sug ? String(sug.reps) : String(b.exercise?.reps_min ?? "")}
                        aria-label={`${b.name} set ${i + 1} ${repsLabel}`}
                        className="pr-10 tabular-nums"
                      />
                      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-faint">{repsLabel}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex gap-1">
                <Tip content="Add a set">
                  <button type="button" onClick={() => addRow(b.key)} aria-label={`Add a set of ${b.name}`} className="rounded-md border border-line p-1 text-muted hover:text-fg">
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </Tip>
                {b.rows.length > 1 ? (
                  <Tip content="Remove the last set">
                    <button type="button" onClick={() => removeRow(b.key)} aria-label={`Remove last set of ${b.name}`} className="rounded-md border border-line p-1 text-muted hover:text-fg">
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                  </Tip>
                ) : null}
                {!b.exercise ? (
                  <Tip content="Remove this exercise">
                    <button
                      type="button"
                      onClick={() => setBlocks((bs) => bs.filter((x) => x.key !== b.key))}
                      aria-label={`Remove ${b.name}`}
                      className="rounded-md border border-line p-1 text-muted hover:text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </Tip>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const name = extraName.trim();
          if (!name) return;
          setBlocks((bs) => [...bs, { key: `extra:${name}:${Date.now()}`, exercise: null, name, measure: "weight_reps", rows: [{ weight: "", reps: "" }] }]);
          setExtraName("");
        }}
        className="flex gap-2"
      >
        <Input value={extraName} onChange={(e) => setExtraName(e.target.value)} placeholder="Add a one-off exercise (e.g. Dips)" aria-label="One-off exercise name" maxLength={80} />
        <Button type="submit" variant="secondary" disabled={!extraName.trim()}>
          <Plus className="h-4 w-4" /> Add
        </Button>
      </form>

      <div className="grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)]">
        <Field label="Duration (min)">
          <Input inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value.replace(/\D/g, ""))} placeholder="60" />
        </Field>
        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={1} placeholder="Felt strong, left shoulder a bit tight…" maxLength={2000} />
        </Field>
      </div>

      <div className={cn("flex flex-wrap items-center justify-end gap-2")}>
        <Button variant="ghost" onClick={() => submit("skipped")} disabled={save.isPending}>
          Skipped today
        </Button>
        <Button variant="secondary" onClick={() => submit("rest")} disabled={save.isPending}>
          Rest day
        </Button>
        <Button variant="primary" onClick={() => submit("done")} loading={save.isPending}>
          Save workout
        </Button>
      </div>
    </div>
  );
}
