"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import CalendarBoard from "./board/CalendarBoard";
import Checklist from "./board/Checklist";
import MealPlan from "./board/MealPlan";
import StickyNotes from "./board/StickyNotes";
import { BOARD_TABS, type BoardKind } from "@/lib/chat/board";
import type { useBoard } from "@/lib/chat/useBoard";
import type { UserId } from "@/lib/chat/types";

interface Props {
  /**
   * The store is owned by the chat, not by this sheet. It has to keep running
   * while the sheet is closed for the unread badge and the toasts to work, and
   * a second subscription here would double every realtime event.
   */
  board: ReturnType<typeof useBoard>;
  me: UserId;
  names: Record<UserId, string>;
  initialTab?: BoardKind;
  onClose: () => void;
}

/**
 * The shared workspace, as a full-screen sheet over the conversation.
 *
 * Kept behind one button rather than sitting alongside the chat: the chat stays
 * a chat, and everything else is one tap away without competing for the same
 * screen.
 */
export default function Workspace({
  board,
  me,
  names,
  initialTab = "note",
  onClose,
}: Props) {
  const [tab, setTab] = useState<BoardKind>(initialTab);
  const tabsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const active = BOARD_TABS.find((t) => t.kind === tab) ?? BOARD_TABS[0];
  const items = useMemo(
    () => board.items.filter((i) => i.kind === tab),
    [board.items, tab],
  );

  const counts = useMemo(() => {
    const map = new Map<BoardKind, number>();
    for (const item of board.items) {
      // Open items only — a tally of finished chores is just noise.
      if (item.done) continue;
      map.set(item.kind, (map.get(item.kind) ?? 0) + 1);
    }
    return map;
  }, [board.items]);

  return (
    <div className="animate-fade-in flex min-h-0 flex-1 flex-col bg-bg">
      <header className="flex shrink-0 items-center gap-2 border-b border-hairline px-3 py-2.5 sm:px-4">
        <button
          type="button"
          onClick={onClose}
          title="Back to chat"
          aria-label="Back to chat"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-accent-soft hover:text-accent"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path
              d="M11 4 6 9l5 5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <h2 className="text-[1rem] font-semibold text-ink">Board</h2>
        <span className="ml-auto text-[0.6875rem] text-faint">
          everyone in this dashboard can edit · each item wears its
          author&apos;s colour
        </span>
      </header>

      <div
        ref={tabsRef}
        className="scroll-area flex shrink-0 gap-1 overflow-x-auto border-b border-hairline px-3 py-2 sm:px-4"
        style={{ scrollbarWidth: "none" }}
      >
        {BOARD_TABS.map((t) => {
          const count = counts.get(t.kind) ?? 0;
          const selected = t.kind === tab;
          return (
            <button
              key={t.kind}
              type="button"
              onClick={() => setTab(t.kind)}
              aria-pressed={selected}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.8125rem] transition-all ${
                selected
                  ? "bg-accent text-accent-ink"
                  : "text-muted hover:bg-accent-soft hover:text-accent"
              }`}
            >
              <span aria-hidden className="text-[0.75rem] opacity-80">
                {t.icon}
              </span>
              {t.label}
              {count > 0 && t.kind !== "meal" && t.kind !== "event" && (
                <span
                  className={`rounded-full px-1.5 text-[0.625rem] ${
                    selected
                      ? "bg-on-bubble-strong"
                      : "bg-accent-soft text-accent"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {board.error && (
        <p className="shrink-0 bg-accent-soft px-4 py-2 text-center text-[0.8125rem] text-accent">
          {board.error}
        </p>
      )}

      {board.pendingUndo && (
        <div className="animate-slide-up pointer-events-none absolute inset-x-0 bottom-5 z-50 flex justify-center px-4">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-hairline bg-surface px-4 py-2.5 shadow-[var(--shadow)]">
            <span className="text-[0.8125rem] text-ink">
              {board.pendingUndo.label}
            </span>
            <button
              type="button"
              onClick={() => void board.undo()}
              className="text-[0.8125rem] font-medium text-accent underline underline-offset-2"
            >
              Undo
            </button>
            <button
              type="button"
              onClick={board.dismissUndo}
              title="Dismiss"
              aria-label="Dismiss"
              className="grid h-6 w-6 place-items-center rounded-full text-faint transition-colors hover:text-accent"
            >
              <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
                <path
                  d="M3.5 3.5l7 7m0-7l-7 7"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </div>
      )}

      <div className="scroll-area min-h-0 flex-1">
        <div className="mx-auto max-w-3xl px-3 py-4 sm:px-4">
          {board.loading && board.items.length === 0 ? (
            <p className="py-24 text-center font-serif text-[0.9375rem] text-faint italic">
              Loading…
            </p>
          ) : tab === "note" ? (
            <StickyNotes
              items={items}
              me={me}
              names={names}
              tab={active}
              board={board}
            />
          ) : tab === "meal" ? (
            <MealPlan items={items} me={me} names={names} board={board} />
          ) : tab === "event" ? (
            <CalendarBoard items={items} me={me} names={names} board={board} />
          ) : (
            <Checklist
              items={items}
              me={me}
              names={names}
              tab={active}
              board={board}
            />
          )}
        </div>
      </div>
    </div>
  );
}
