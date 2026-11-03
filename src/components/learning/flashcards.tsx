"use client";

import { Brain, Layers, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { Grade } from "ts-fsrs";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/field";
import { Markdown } from "@/components/ui/markdown";
import { Card, SectionTitle } from "@/components/ui/misc";
import { GRADES, previewIntervals } from "@/lib/fsrs";
import { useNow, useResettableState } from "@/lib/hooks";
import { useAddCard, useDeleteCard, useFlashcards, useReviewCard, useUpdateCard } from "@/lib/queries/flashcards";
import type { Flashcard } from "@/lib/types";
import { cn } from "@/lib/utils";

const GRADE_STYLE: Record<number, string> = {
  1: "border-danger/30 text-danger hover:bg-danger/10",
  2: "border-warning/30 text-warning hover:bg-warning/10",
  3: "border-success/30 text-success hover:bg-success/10",
  4: "border-accent/30 text-accent hover:bg-accent-soft",
};

export function ReviewDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: cards = [] } = useFlashcards();
  const reviewCard = useReviewCard();
  const del = useDeleteCard();
  const update = useUpdateCard();
  const now = useNow(30_000);
  // The queue is fixed when a session opens (re-seeded once cards finish loading after a
  // deep link); cards graded "Again" go to the back of the queue.
  const sessionKey = open ? `open:${cards.length > 0}` : "closed";
  const [queue, setQueue] = useResettableState(sessionKey, () => (open ? cards.filter((c) => Date.parse(c.due) <= now).map((c) => c.id) : []));
  const [shown, setShown] = useResettableState(sessionKey, () => false);
  const [done, setDone] = useResettableState(sessionKey, () => 0);
  const [editing, setEditing] = useState<Flashcard | null>(null);

  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const current = queue.length ? byId.get(queue[0]) : undefined;
  const preview = useMemo(() => (current ? previewIntervals(current.card, new Date(now)) : {}), [current, now]);

  const grade = (g: Grade) => {
    if (!current) return;
    reviewCard.mutate({ card: current, grade: g });
    setQueue((q) => (g === 1 ? [...q.slice(1), q[0]] : q.slice(1)));
    if (g !== 1) setDone((d) => d + 1);
    setShown(false);
  };

  useEffect(() => {
    if (!open || editing) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setShown(true);
      } else if (shown && ["1", "2", "3", "4"].includes(e.key)) {
        grade(Number(e.key) as Grade);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Review flashcards" description={current ? `${queue.length} left · ${done} done` : undefined} size="md">
      {!current ? (
        <div className="py-10 text-center">
          <div className="text-[28px]">🎉</div>
          <div className="mt-2 text-[14px] font-medium text-fg">{done ? `${done} card${done === 1 ? "" : "s"} reviewed` : "Nothing due right now"}</div>
          <p className="mt-1 text-[12.5px] text-muted">FSRS schedules each card right before you&apos;d forget it.</p>
        </div>
      ) : editing ? (
        <EditCard
          card={editing}
          onSave={(front, back) => {
            update.mutate({ id: editing.id, patch: { front, back } });
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <div>
          <div className="min-h-28 rounded-xl border border-line bg-panel-2/60 p-4 text-[15px] leading-relaxed text-fg">
            <Markdown text={current.front} />
          </div>
          {shown ? (
            <div className="mt-3 min-h-20 rounded-xl border border-accent/25 bg-accent-soft/40 p-4 text-[14px] leading-relaxed text-fg-2 animate-fade-in">
              <Markdown text={current.back} />
            </div>
          ) : null}
          <div className="mt-4">
            {shown ? (
              <div className="grid grid-cols-4 gap-2">
                {GRADES.map((g) => (
                  <button
                    key={g.grade}
                    onClick={() => grade(g.grade)}
                    className={cn("flex flex-col items-center rounded-xl border py-2 text-[13px] font-medium transition-colors", GRADE_STYLE[g.grade])}
                  >
                    {g.label}
                    <span className="text-[11px] font-normal opacity-70">{preview[g.grade]}</span>
                  </button>
                ))}
              </div>
            ) : (
              <Button className="w-full" size="lg" variant="primary" onClick={() => setShown(true)}>
                Show answer <kbd className="kbd ml-1 border-white/30 bg-white/10 text-white">space</kbd>
              </Button>
            )}
          </div>
          <div className="mt-3 flex justify-between text-[11.5px] text-faint">
            <span>{shown ? "Keys 1–4 to grade" : `${current.reps} reviews · ${current.lapses} lapses`}</span>
            <span className="flex gap-2">
              <button className="inline-flex items-center gap-1 hover:text-fg" onClick={() => setEditing(current)}>
                <Pencil className="h-3 w-3" /> Edit
              </button>
              <button
                className="inline-flex items-center gap-1 hover:text-danger"
                onClick={() => {
                  del.mutate(current.id);
                  setQueue((q) => q.slice(1));
                }}
              >
                <Trash2 className="h-3 w-3" /> Delete
              </button>
            </span>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function EditCard({ card, onSave, onCancel }: { card?: Flashcard; onSave: (front: string, back: string) => void; onCancel: () => void }) {
  const [front, setFront] = useState(card?.front ?? "");
  const [back, setBack] = useState(card?.back ?? "");
  return (
    <div className="space-y-3">
      <Field label="Question">
        <Textarea rows={3} value={front} onChange={(e) => setFront(e.target.value)} autoFocus />
      </Field>
      <Field label="Answer">
        <Textarea rows={4} value={back} onChange={(e) => setBack(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!front.trim() || !back.trim()} onClick={() => onSave(front.trim(), back.trim())}>
          Save card
        </Button>
      </div>
    </div>
  );
}

export function AddCardDialog({ open, onOpenChange, entryId }: { open: boolean; onOpenChange: (o: boolean) => void; entryId?: string | null }) {
  const add = useAddCard();
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New flashcard">
      {open ? (
        <EditCard
          onCancel={() => onOpenChange(false)}
          onSave={(front, back) =>
            add.mutate(
              { front, back, entry_id: entryId ?? null },
              {
                onSuccess: () => {
                  toast.success("Card added — it's due now");
                  onOpenChange(false);
                },
              },
            )
          }
        />
      ) : null}
    </Dialog>
  );
}

/** Sidebar panel on the Learning page. */
export function FlashcardsPanel({ onReview }: { onReview: () => void }) {
  const { data: cards = [] } = useFlashcards();
  const now = useNow(60_000);
  const [adding, setAdding] = useState(false);
  const due = cards.filter((c) => Date.parse(c.due) <= now).length;
  const tomorrow = cards.filter((c) => {
    const t = Date.parse(c.due);
    return t > now && t <= now + 86_400_000;
  }).length;
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <SectionTitle className="mb-0">
          <span className="inline-flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5" /> Flashcards
          </span>
        </SectionTitle>
        <button onClick={() => setAdding(true)} className="rounded-md p-1 text-faint hover:bg-panel-hover hover:text-fg" aria-label="Add card">
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {cards.length ? (
        <>
          <div className="mb-3 flex items-baseline gap-2">
            <span className="text-[24px] font-semibold tabular-nums text-fg">{due}</span>
            <span className="text-[12.5px] text-muted">due now · {tomorrow} tomorrow · {cards.length} total</span>
          </div>
          <Button className="w-full" variant={due ? "primary" : "secondary"} onClick={onReview} disabled={!due}>
            <Brain className="h-4 w-4" /> {due ? "Review now" : "All caught up"}
          </Button>
        </>
      ) : (
        <p className="text-[12.5px] text-muted">
          Turn any entry into cards with <b>⋯ → Make flashcards</b>. Spaced repetition (FSRS) brings each card back right before you&apos;d forget it.
        </p>
      )}
      <AddCardDialog open={adding} onOpenChange={setAdding} />
    </Card>
  );
}
