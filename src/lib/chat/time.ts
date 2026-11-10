import type { Message } from "./types";

/** Messages from the same sender within this window render as one cluster. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDayDivider(iso: string): string {
  const date = new Date(iso);
  const today = startOfDay(new Date());
  const that = startOfDay(date);
  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.round((today.getTime() - that.getTime()) / dayMs);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) {
    return date.toLocaleDateString(undefined, { weekday: "long" });
  }
  return date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  });
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isSameDay(a: string, b: string): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
}

/**
 * Per-message layout hints derived from its neighbours: where to draw the day
 * divider, which corner loses its radius to form the tail, and whether the
 * timestamp shows. Computed once for the whole list rather than per bubble.
 */
export interface MessageLayout {
  showDayDivider: boolean;
  /** First of a same-sender cluster — gets the avatar-side top corner. */
  startsGroup: boolean;
  /** Last of a cluster — gets the tail and the timestamp. */
  endsGroup: boolean;
}

export function computeLayout(messages: Message[]): MessageLayout[] {
  return messages.map((message, i) => {
    const prev = i > 0 ? messages[i - 1] : null;
    const next = i < messages.length - 1 ? messages[i + 1] : null;

    const showDayDivider =
      !prev || !isSameDay(prev.created_at, message.created_at);

    const withinWindow = (a: Message, b: Message) =>
      Math.abs(
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      ) < GROUP_WINDOW_MS;

    const startsGroup =
      showDayDivider ||
      !prev ||
      prev.sender !== message.sender ||
      !withinWindow(prev, message);

    const endsGroup =
      !next ||
      next.sender !== message.sender ||
      !withinWindow(message, next) ||
      !isSameDay(message.created_at, next.created_at);

    return { showDayDivider, startsGroup, endsGroup };
  });
}

/** Newest-last ordering, with a stable tiebreak so renders never jitter. */
export function byCreatedAt(a: Message, b: Message): number {
  const delta =
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  return delta !== 0 ? delta : a.client_id.localeCompare(b.client_id);
}
