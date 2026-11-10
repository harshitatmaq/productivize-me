"use client";

import { useState } from "react";
import { ownerClasses, tiltFor } from "./board/shared";
import { formatDayDivider } from "@/lib/chat/time";
import type { PromiseNote, UserId } from "@/lib/chat/types";

interface Props {
  promises: PromiseNote[];
  names: Record<UserId, string>;
  onJump: (clientId: string) => void;
  onToggleKept: (promise: PromiseNote, kept: boolean) => void;
  onRemove: (promise: PromiseNote) => void;
}

/**
 * Promises, pinned to the side of the conversation.
 *
 * Deliberately not another panel behind another button: the point of writing
 * "I'll do this" down is that it stays in view. On a wide screen the notes get
 * a column of their own beside the chat; on a narrow one there is no room for
 * that, so they collapse to a tab on the edge that opens the same notes over
 * the conversation.
 *
 * Kept promises stay on the board, crossed out, rather than disappearing.
 * Watching the list of things you said you would do actually get done is most
 * of the reward.
 */
export default function PromiseRail({
  promises,
  names,
  onJump,
  onToggleKept,
  onRemove,
}: Props) {
  const [open, setOpen] = useState(false);

  if (promises.length === 0) return null;

  const sorted = [...promises].sort((a, b) => {
    // Outstanding first — that is the half that still needs doing.
    if (a.kept !== b.kept) return a.kept ? 1 : -1;
    return b.created_at.localeCompare(a.created_at);
  });
  const outstanding = sorted.filter((p) => !p.kept).length;

  const notes = (
    <div className="flex flex-col gap-3">
      {sorted.map((promise) => (
        <Note
          key={promise.message_id}
          promise={promise}
          names={names}
          onJump={() => {
            onJump(promise.message_client_id);
            setOpen(false);
          }}
          onToggleKept={() => onToggleKept(promise, !promise.kept)}
          onRemove={() => onRemove(promise)}
        />
      ))}
    </div>
  );

  return (
    <>
      {/* Wide screens: a column of its own, always visible. */}
      <aside className="scroll-area hidden w-[15.5rem] shrink-0 border-l border-hairline px-3 py-4 lg:block">
        <Heading count={outstanding} />
        {notes}
      </aside>

      {/* Narrow screens: a tab on the edge, and the same notes over the chat. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Promises — ${outstanding} outstanding`}
        aria-label={`Promises — ${outstanding} outstanding`}
        className="absolute top-1/2 right-0 z-20 flex -translate-y-1/2 flex-col items-center gap-1 rounded-l-xl border border-r-0 border-hairline bg-surface py-2.5 pr-1.5 pl-2 shadow-[var(--shadow)] lg:hidden"
      >
        <span aria-hidden className="text-[0.9375rem] leading-none">
          🤞
        </span>
        {outstanding > 0 && (
          <span className="text-[0.625rem] font-medium text-accent">
            {outstanding}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            title="Close promises"
            aria-label="Close promises"
            onClick={() => setOpen(false)}
            className="absolute inset-0 cursor-default bg-black/35"
          />
          <div className="animate-slide-up scroll-area absolute inset-y-0 right-0 w-[17rem] max-w-[85vw] border-l border-hairline bg-bg px-3 py-4">
            <div className="mb-3 flex items-center justify-between">
              <Heading count={outstanding} />
              <button
                type="button"
                onClick={() => setOpen(false)}
                title="Close"
                aria-label="Close"
                className="grid h-8 w-8 place-items-center rounded-full text-muted transition-colors hover:text-accent"
              >
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                  <path
                    d="M3.5 3.5l7 7m0-7l-7 7"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
            {notes}
          </div>
        </div>
      )}
    </>
  );
}

function Heading({ count }: { count: number }) {
  return (
    <h2 className="mb-3 flex items-baseline gap-1.5 font-serif text-[0.9375rem] text-ink">
      Promises
      {count > 0 && (
        <span className="text-[0.6875rem] font-sans text-faint">
          {count} open
        </span>
      )}
    </h2>
  );
}

function Note({
  promise,
  names,
  onJump,
  onToggleKept,
  onRemove,
}: {
  promise: PromiseNote;
  names: Record<UserId, string>;
  onJump: () => void;
  onToggleKept: () => void;
  onRemove: () => void;
}) {
  const colors = ownerClasses(promise.promiser);

  return (
    <div
      className={`sticky-note group relative rounded-xl px-3 pt-4 pb-2.5 shadow-[var(--shadow)] ${
        colors.note
      } ${promise.kept ? "opacity-80" : ""}`}
      style={
        {
          "--tilt": tiltFor(promise.message_id),
        } as React.CSSProperties
      }
    >
      {/* A strip of tape across the top corner. Purely decorative. */}
      <span
        aria-hidden
        className="absolute -top-1.5 left-1/2 h-3.5 w-12 -translate-x-1/2 -rotate-2 rounded-[2px] bg-ink/10"
      />

      <button
        type="button"
        onClick={onRemove}
        title="Remove promise"
        aria-label="Remove promise"
        className="absolute top-1.5 right-1.5 grid h-6 w-6 place-items-center rounded-full text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-accent focus-visible:opacity-100"
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

      <button
        type="button"
        onClick={onJump}
        title="Go to the message"
        className={`block w-full text-left font-serif text-[0.8438rem] leading-[1.45] break-words whitespace-pre-wrap text-ink ${
          promise.kept ? "line-through decoration-1" : ""
        }`}
      >
        {promise.body}
      </button>

      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          role="checkbox"
          aria-checked={promise.kept}
          title={promise.kept ? "Kept — mark as not kept" : "Mark as kept"}
          aria-label={promise.kept ? "Kept — mark as not kept" : "Mark as kept"}
          onClick={onToggleKept}
          className={`grid h-[1.05rem] w-[1.05rem] shrink-0 place-items-center rounded-md border-2 transition-colors ${
            promise.kept
              ? `${colors.solid} ${colors.border}`
              : "border-ink/30 bg-bg/70"
          }`}
        >
          {promise.kept && (
            <svg
              className="animate-check"
              width="10"
              height="10"
              viewBox="0 0 12 12"
              fill="none"
            >
              <path
                d="M2.5 6.3 4.8 8.5 9.5 3.6"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>

        {/* An open note names its owner in their colour. A kept one drops to
            neutral ink: the identity hue sits on a note of the same hue, which
            at this size was never going to clear a contrast floor once the
            note is also faded. */}
        <span
          className={`truncate text-[0.625rem] ${
            promise.kept ? "text-ink/75" : colors.text
          }`}
        >
          {promise.kept
            ? `${names[promise.promiser]} kept it`
            : `${names[promise.promiser]} · ${formatDayDivider(promise.created_at)}`}
        </span>
      </div>
    </div>
  );
}
