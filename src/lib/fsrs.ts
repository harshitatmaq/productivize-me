import { createEmptyCard, fsrs, generatorParameters, Rating, type Card, type Grade } from "ts-fsrs";

/** FSRS card as stored in Postgres (jsonb): dates as ISO strings. */
export type StoredCard = Omit<Card, "due" | "last_review"> & { due: string; last_review?: string | null };

const scheduler = fsrs(generatorParameters({ enable_fuzz: true, maximum_interval: 365, request_retention: 0.9 }));

const toCard = (s: StoredCard | Record<string, never> | null | undefined, now: Date): Card => {
  if (!s || !("due" in s)) return createEmptyCard(now);
  return { ...s, due: new Date(s.due), last_review: s.last_review ? new Date(s.last_review) : undefined } as Card;
};

const toStored = (c: Card): StoredCard => ({
  ...c,
  due: c.due.toISOString(),
  last_review: c.last_review ? c.last_review.toISOString() : null,
});

export const GRADES = [
  { grade: Rating.Again as Grade, label: "Again", key: "1" },
  { grade: Rating.Hard as Grade, label: "Hard", key: "2" },
  { grade: Rating.Good as Grade, label: "Good", key: "3" },
  { grade: Rating.Easy as Grade, label: "Easy", key: "4" },
];

export function newCard(now = new Date()): StoredCard {
  return toStored(createEmptyCard(now));
}

/** A review can't happen before the previous one (guards against device clock skew). */
const safeNow = (card: Card, now: Date) => (card.last_review && now < card.last_review ? new Date(card.last_review) : now);

/** Applies a review and returns the columns to update. */
export function review(stored: StoredCard | null | undefined, grade: Grade, requested = new Date()) {
  const current = toCard(stored, requested);
  const now = safeNow(current, requested);
  const next = scheduler.next(current, now, grade).card;
  return {
    card: toStored(next),
    due: next.due.toISOString(),
    reps: next.reps,
    lapses: next.lapses,
    last_reviewed_at: now.toISOString(),
  };
}

/** Human labels for when each grade would schedule the card next ("10m", "3d"…). */
export function previewIntervals(stored: StoredCard | null | undefined, requested = new Date()): Record<number, string> {
  const card = toCard(stored, requested);
  const now = safeNow(card, requested);
  const out: Record<number, string> = {};
  for (const { grade } of GRADES) {
    const due = scheduler.next(card, now, grade).card.due;
    out[grade] = formatInterval(due.getTime() - now.getTime());
  }
  return out;
}

export function formatInterval(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 31) return `${d}d`;
  const mo = Math.round(d / 30);
  return mo < 12 ? `${mo}mo` : `${Math.round(d / 365)}y`;
}
