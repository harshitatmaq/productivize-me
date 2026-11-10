import type { BoardKind } from "./board";

/**
 * What the board on screen looks like right now, for the assistant to read.
 *
 * "The note on the 3rd row, 2nd column" only means something relative to how the
 * notes are arranged on the person's screen — which depends on their sort
 * choice and on how wide the screen is. The boards publish the order they are
 * showing, and the assistant's request carries it along, so the server numbers
 * rows and columns the way the person sees them.
 *
 * Deliberately a plain module-level registry rather than React state: it is
 * read once, at the moment a message is sent, and nothing should re-render
 * because the assistant glanced at it.
 */

const orders = new Map<BoardKind, string[]>();

/** Called by a board while it is on screen. */
export function publishOrder(kind: BoardKind, ids: string[]) {
  orders.set(kind, ids);
}

/** Called when that board leaves the screen, so a stale order is never reported. */
export function clearOrder(kind: BoardKind) {
  orders.delete(kind);
}

/**
 * Columns in the notes grid at this screen width.
 *
 * Mirrors `grid-cols-2 sm:grid-cols-3` on the grid in StickyNotes.tsx —
 * Tailwind's `sm` breakpoint is 40rem. Keep the two in step.
 */
export function noteColumns(): number {
  if (typeof window === "undefined") return 3;
  return window.matchMedia("(min-width: 40rem)").matches ? 3 : 2;
}

export interface LayoutSnapshot {
  noteColumns: number;
  order: Partial<Record<BoardKind, string[]>>;
}

export function snapshotLayout(): LayoutSnapshot {
  return {
    noteColumns: noteColumns(),
    order: Object.fromEntries(orders) as LayoutSnapshot["order"],
  };
}
