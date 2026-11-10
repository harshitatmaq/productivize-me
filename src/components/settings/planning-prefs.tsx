"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ChipsInput } from "@/components/ui/chips-input";
import { Field, Input, Switch, Textarea } from "@/components/ui/field";
import { Menu, MenuItem, MenuLabel, MenuSeparator, Tip } from "@/components/ui/menu";
import { Card, Segmented } from "@/components/ui/misc";
import { useResettableState } from "@/lib/hooks";
import { ROUTINE_TEMPLATES, sanitizePrefs, type PlanningPrefs, type Routine } from "@/lib/planning";
import { useUpdateProfile, useUser } from "@/lib/queries/profile";
import type { Profile } from "@/lib/types";
import { api, cn } from "@/lib/utils";

const DAYS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function DayPicker({ value, onChange, label }: { value: number[]; onChange: (v: number[]) => void; label: string }) {
  return (
    <div className="flex gap-1" role="group" aria-label={label}>
      {DAYS.map((d, i) => {
        const on = value.includes(i);
        return (
          <Tip key={i} content={DAY_NAMES[i]}>
          <button
            type="button"
            aria-pressed={on}
            aria-label={DAY_NAMES[i]}
            onClick={() => onChange(on ? value.filter((x) => x !== i) : [...value, i].sort())}
            className={cn("h-7 w-7 rounded-md border text-[11.5px] font-medium", on ? "border-accent bg-accent text-white" : "border-line text-muted hover:text-fg")}
          >
            {d}
          </button>
          </Tip>
        );
      })}
    </div>
  );
}

const newId = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/**
 * Settings → Planning preferences. Plan my day, quick-add time suggestions and
 * the AI's tips all follow these.
 */
export function PlanningPrefsCard({ profile }: { profile: Profile }) {
  const update = useUpdateProfile();
  const qc = useQueryClient();
  const { data: user } = useUser();
  const [draft, setDraft] = useResettableState(profile.planning, (p) => sanitizePrefs(p));
  const [sentence, setSentence] = useState("");
  const [learning, setLearning] = useState(false);
  const dirty = JSON.stringify(sanitizePrefs(draft)) !== JSON.stringify(sanitizePrefs(profile.planning));
  const set = (patch: Partial<PlanningPrefs>) => setDraft((d) => ({ ...d, ...patch }));
  const setRoutine = (id: string, patch: Partial<Routine>) => set({ routines: (draft.routines ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)) });

  const save = () =>
    update.mutate(
      { planning: sanitizePrefs(draft) },
      { onSuccess: () => toast.success("Preferences saved — Plan my day follows them now"), onError: (e) => toast.error((e as Error).message) },
    );

  const learn = async () => {
    if (sentence.trim().length < 3) return;
    setLearning(true);
    try {
      const r = await api<{ planning: PlanningPrefs; summary: string }>("/api/preferences/learn", { json: { text: sentence.trim() } });
      qc.setQueryData<Profile>(["profile", user?.id], (p) => (p ? { ...p, planning: r.planning } : p));
      setDraft(r.planning);
      setSentence("");
      toast.success(r.summary);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLearning(false);
    }
  };

  return (
    <Card className="space-y-5 p-4">
      <div>
        <div className="mb-1.5 text-[13.5px] text-fg">Tell it in your own words</div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            learn();
          }}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <Input value={sentence} onChange={(e) => setSentence(e.target.value)} placeholder="e.g. I read after 10:30 PM and journal before bed" maxLength={500} aria-label="Describe a preference" />
          <Button type="submit" variant="secondary" loading={learning} disabled={sentence.trim().length < 3}>
            <Sparkles className="h-4 w-4" /> Remember
          </Button>
        </form>
        <p className="mt-1 text-[12px] text-muted">The AI turns it into a routine below. You can edit it after.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="I usually wake up at">
          <Input type="time" value={draft.wake ?? ""} onChange={(e) => set({ wake: e.target.value || undefined })} />
        </Field>
        <Field label="I go to bed around" hint="Plans run until bedtime; nothing is scheduled after it.">
          <Input type="time" value={draft.sleep ?? ""} onChange={(e) => set({ sleep: e.target.value || undefined })} />
        </Field>
      </div>

      <div className="space-y-2">
        <Switch
          label="I have fixed work hours"
          description="Plan my day keeps personal tasks outside them (unless you've given them a time)."
          checked={!!draft.work}
          onChange={(v) => set({ work: v ? { start: "09:30", end: "18:30", days: [1, 2, 3, 4, 5] } : null })}
        />
        {draft.work ? (
          <div className="flex flex-wrap items-end gap-3">
            <Field label="From">
              <Input type="time" value={draft.work.start} onChange={(e) => set({ work: { ...draft.work!, start: e.target.value } })} className="w-[120px]" />
            </Field>
            <Field label="To">
              <Input type="time" value={draft.work.end} onChange={(e) => set({ work: { ...draft.work!, end: e.target.value } })} className="w-[120px]" />
            </Field>
            <DayPicker value={draft.work.days} onChange={(days) => set({ work: { ...draft.work!, days } })} label="Work days" />
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[13.5px] text-fg">I focus best in the</div>
          <div className="text-[12px] text-muted">Demanding tasks go there.</div>
        </div>
        <Segmented
          value={draft.focus_peak ?? "none"}
          onChange={(v) => set({ focus_peak: v === "none" ? null : (v as PlanningPrefs["focus_peak"]) })}
          options={[
            { value: "morning", label: "Morning" },
            { value: "afternoon", label: "Afternoon" },
            { value: "evening", label: "Evening" },
            { value: "none", label: "No preference" },
          ]}
        />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <div className="text-[13.5px] text-fg">Routines</div>
            <div className="text-[12px] text-muted">Tasks whose title or tag contains one of the words always go in that time window.</div>
          </div>
          <Menu
            label="Add a routine"
            trigger={
              <Button size="sm" variant="secondary" aria-label="Add a routine">
                <Plus className="h-3.5 w-3.5" /> Add
              </Button>
            }
          >
            <MenuLabel>Start from</MenuLabel>
            {ROUTINE_TEMPLATES.map((t) => (
              <MenuItem key={t.label} onSelect={() => set({ routines: [...(draft.routines ?? []), { ...t, id: newId(), days: [] }] })}>
                {t.label} · {t.start}–{t.end}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem onSelect={() => set({ routines: [...(draft.routines ?? []), { id: newId(), label: "New routine", keywords: [], start: "18:00", end: "19:00", days: [] }] })}>
              Blank routine
            </MenuItem>
          </Menu>
        </div>
        {(draft.routines ?? []).length ? (
          <div className="space-y-2">
            {(draft.routines ?? []).map((r) => (
              <div key={r.id} className="space-y-2 rounded-lg border border-line bg-panel-2/40 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Input value={r.label} onChange={(e) => setRoutine(r.id, { label: e.target.value })} className="min-w-[140px] flex-1" aria-label="Routine name" />
                  <Input type="time" value={r.start} onChange={(e) => setRoutine(r.id, { start: e.target.value })} className="w-[128px]" aria-label={`${r.label} starts`} />
                  <span className="text-faint">–</span>
                  <Input type="time" value={r.end} onChange={(e) => setRoutine(r.id, { end: e.target.value })} className="w-[128px]" aria-label={`${r.label} ends`} />
                  <Tip content={`Delete ${r.label}`}>
                    <button
                      type="button"
                      onClick={() => set({ routines: (draft.routines ?? []).filter((x) => x.id !== r.id) })}
                      aria-label={`Delete ${r.label}`}
                      className="rounded p-1.5 text-faint hover:bg-panel-hover hover:text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </Tip>
                </div>
                <ChipsInput value={r.keywords} onChange={(keywords) => setRoutine(r.id, { keywords: keywords.map((k) => k.toLowerCase()) })} placeholder="Words in matching tasks: read, book, journal…" />
                <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
                  <span>Only on</span>
                  <DayPicker value={r.days ?? []} onChange={(days) => setRoutine(r.id, { days })} label={`${r.label} days`} />
                  <span className="text-faint">{r.days?.length ? "" : "(every day)"}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-line p-3 text-[12.5px] text-muted">
            No routines yet. Add “Reading &amp; journaling 22:30–23:30” and “Read 20 pages” will always be planned at night.
          </p>
        )}
      </div>

      <Field label="Anything else the planner should know" hint="Read every time it plans your day.">
        <Textarea value={draft.notes ?? ""} onChange={(e) => set({ notes: e.target.value })} rows={3} maxLength={2000} placeholder="No calls before 10. Keep Sunday evenings free. Groceries on Saturday mornings." />
      </Field>

      <div className="flex items-center justify-end gap-2">
        {dirty ? (
          <Button variant="ghost" onClick={() => setDraft(sanitizePrefs(profile.planning))}>
            Discard
          </Button>
        ) : null}
        <Button variant="primary" onClick={save} loading={update.isPending} disabled={!dirty}>
          Save preferences
        </Button>
      </div>
    </Card>
  );
}
