import type { UserId } from "./types";

/**
 * The shared workspace.
 *
 * Every surface — notes, tasks, discussion, shopping, meals, calendar — is the
 * same record with a different `kind`, so they all inherit realtime, RLS and
 * caching from one implementation.
 */

export type BoardKind = "note" | "task" | "discuss" | "shop" | "meal" | "event";

export interface BoardMeta {
  /** Meal plan: ISO date (YYYY-MM-DD) and which sitting. */
  date?: string;
  slot?: MealSlot;
  /** Shopping: free-text quantity ("2 kg", "a dozen"). */
  qty?: string;
}

export interface BoardItem {
  id: string;
  client_id: string;
  kind: BoardKind;
  author: UserId;
  updated_by: UserId | null;
  title: string;
  done: boolean;
  due_at: string | null;
  meta: BoardMeta;
  position: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export const MEAL_SLOTS = ["breakfast", "lunch", "dinner"] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

/**
 * Whose colour an item wears: the last person to touch it, falling back to its
 * creator. This is what makes "I edited your note" show up as mine.
 */
export function ownerOf(item: BoardItem): UserId {
  return item.updated_by ?? item.author;
}

export interface BoardTab {
  kind: BoardKind;
  label: string;
  icon: string;
  /** Placeholder for the add-item field. */
  prompt: string;
  empty: string;
}

export const BOARD_TABS: BoardTab[] = [
  {
    kind: "note",
    label: "Notes",
    icon: "◳",
    prompt: "Write a note…",
    empty: "No notes yet. Stick one up.",
  },
  {
    kind: "task",
    label: "Tasks",
    icon: "✓",
    prompt: "Add a task…",
    empty: "Nothing to do. Suspicious.",
  },
  {
    kind: "discuss",
    label: "Discuss",
    icon: "◇",
    prompt: "Something to talk about…",
    empty: "Nothing queued to discuss.",
  },
  {
    kind: "shop",
    label: "Shopping",
    icon: "◎",
    prompt: "Add to the list…",
    empty: "The list is empty.",
  },
  {
    kind: "meal",
    label: "Meals",
    icon: "◑",
    prompt: "What's cooking…",
    empty: "No meals planned.",
  },
  {
    kind: "event",
    label: "Calendar",
    icon: "▦",
    prompt: "Add something dated…",
    empty: "Nothing on the calendar.",
  },
];

/**
 * Chat quick-capture. Typing `todo: …` in the conversation files a task without
 * leaving the chat, which is what keeps the workspace from becoming a place you
 * have to remember to visit.
 */
export const CAPTURE_PREFIXES: [RegExp, BoardKind][] = [
  [/^\s*(?:todo|task|work)\s*:\s*/i, "task"],
  [/^\s*(?:note|save)\s*:\s*/i, "note"],
  [/^\s*(?:buy|shop)\s*:\s*/i, "shop"],
  [/^\s*(?:discuss|talk)\s*:\s*/i, "discuss"],
  [/^\s*(?:meal|cook)\s*:\s*/i, "meal"],
  [/^\s*(?:remind|event|plan)\s*:\s*/i, "event"],
];

export function detectCapture(
  input: string
): { kind: BoardKind; title: string } | null {
  for (const [pattern, kind] of CAPTURE_PREFIXES) {
    if (!pattern.test(input)) continue;
    const title = input.replace(pattern, "").trim();
    if (!title) return null;
    return { kind, title };
  }
  return null;
}

export function newBoardItem(
  kind: BoardKind,
  author: UserId,
  title: string,
  extra: Partial<Pick<BoardItem, "due_at" | "meta" | "position">> = {}
) {
  return {
    client_id: crypto.randomUUID(),
    kind,
    author,
    updated_by: author,
    title,
    done: false,
    due_at: extra.due_at ?? null,
    meta: extra.meta ?? {},
    position: extra.position ?? Date.now(),
  };
}

// --- dates ------------------------------------------------------------------

/** Local-calendar ISO day (YYYY-MM-DD). Avoids UTC shifting the date. */
export function isoDay(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function startOfWeek(date: Date): Date {
  const result = new Date(date);
  // Monday-first: Sunday (0) becomes the last day of the previous week.
  const offset = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - offset);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function weekDays(anchor: Date): Date[] {
  const start = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Six-week grid covering the anchor's month, Monday-first. */
export function monthGrid(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function shortDay(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: "short" });
}

export function isToday(date: Date): boolean {
  return isoDay(date) === isoDay(new Date());
}
