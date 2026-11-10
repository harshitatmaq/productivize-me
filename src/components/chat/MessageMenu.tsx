"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { REACTION_CHOICES } from "@/lib/chat/types";

export interface MenuAnchor {
  x: number;
  y: number;
}

interface Props {
  anchor: MenuAnchor;
  /** Emoji this person has already put on the message. */
  active: string[];
  canReact: boolean;
  pinned: boolean;
  promised: boolean;
  canCopy: boolean;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onTogglePin: () => void;
  onTogglePromise: () => void;
  onCopy: () => void;
  onClose: () => void;
}

/** Kept clear of the screen edges so a menu never opens half off-screen. */
const MARGIN = 8;

/**
 * The per-message menu: right-click on a pointer device, long-press on touch.
 *
 * Positioned against the viewport rather than the bubble. A message near the
 * bottom of a long conversation has no room beneath it, and anchoring inside
 * the scrolling list would let the menu clip against it.
 */
export default function MessageMenu({
  anchor,
  active,
  canReact,
  pinned,
  promised,
  canCopy,
  onReact,
  onReply,
  onTogglePin,
  onTogglePromise,
  onCopy,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);

  // Measured before paint: the menu is sized by its content, so where it fits
  // is not knowable until it exists.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const { width, height } = el.getBoundingClientRect();
    const left = clamp(
      anchor.x - width / 2,
      MARGIN,
      window.innerWidth - width - MARGIN,
    );
    // Prefer above the tap point, the way a touch menu should sit clear of the
    // finger; drop below only when there is genuinely no room up there.
    const above = anchor.y - height - 10;
    const top =
      above >= MARGIN
        ? above
        : Math.min(anchor.y + 14, window.innerHeight - height - MARGIN);

    setPosition({ left, top: Math.max(MARGIN, top) });
  }, [anchor.x, anchor.y]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const item =
    "flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[0.875rem] text-ink transition-colors hover:bg-accent-soft hover:text-accent";

  return (
    <>
      {/* Catches the dismissing tap, and stops a long-press from also
          scrolling the list underneath while the menu is up. */}
      <button
        type="button"
        title="Close menu"
        aria-label="Close menu"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
        className="fixed inset-0 z-40 cursor-default"
      />

      <div
        ref={ref}
        role="menu"
        className="animate-rise fixed z-50 w-[13.5rem] overflow-hidden rounded-2xl border border-hairline bg-surface py-1 shadow-[var(--shadow)]"
        style={{
          left: position?.left ?? -9999,
          top: position?.top ?? -9999,
          // Hidden until measured, or the first frame flashes in the corner.
          visibility: position ? "visible" : "hidden",
        }}
      >
        {canReact && (
          <>
            <div className="flex justify-between gap-0.5 px-2 py-1.5">
              {REACTION_CHOICES.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onReact(emoji)}
                  title={`React ${emoji}`}
                  aria-label={`React ${emoji}`}
                  className={`grid h-8 w-8 place-items-center rounded-full text-base transition-transform hover:scale-115 ${
                    active.includes(emoji) ? "bg-accent-soft" : ""
                  }`}
                >
                  {emoji}
                </button>
              ))}
            </div>
            <div className="my-1 h-px bg-hairline" />
          </>
        )}

        <button
          type="button"
          role="menuitem"
          onClick={onReply}
          className={item}
        >
          <ReplyIcon />
          Reply
        </button>

        {canReact && (
          <>
            <button
              type="button"
              role="menuitem"
              onClick={onTogglePin}
              className={item}
            >
              <PinIcon />
              {pinned ? "Unpin message" : "Pin message"}
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={onTogglePromise}
              className={item}
            >
              <PromiseIcon />
              {promised ? "Not a promise" : "Mark as a promise"}
            </button>
          </>
        )}

        {canCopy && (
          <>
            <div className="my-1 h-px bg-hairline" />
            <button
              type="button"
              role="menuitem"
              onClick={onCopy}
              className={item}
            >
              <CopyIcon />
              Copy text
            </button>
          </>
        )}
      </div>
    </>
  );
}

function clamp(value: number, min: number, max: number): number {
  // `max` can fall below `min` on a very narrow screen; min wins there.
  return Math.max(min, Math.min(value, Math.max(min, max)));
}

function ReplyIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M6.4 3.2 2.4 6.9l4 3.7"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2.9 6.9h5.4a4.3 4.3 0 0 1 4.3 4.3v1.6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M9.7 1.9 14.1 6.3M11 5 6.6 3.4 3.3 6.7l6 6 3.3-3.3L11 5Z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
      <path
        d="m6.1 9.9-4 4"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PromiseIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2.4 3.3h11.2v7.4l-3 3v-3h-8.2V3.3Z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
      <path
        d="m5.6 6.9 1.6 1.6 3-3.2"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect
        x="5.4"
        y="5.4"
        width="8.2"
        height="8.2"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.35"
      />
      <path
        d="M10.6 5.4V4.4a2 2 0 0 0-2-2H4.4a2 2 0 0 0-2 2v4.2a2 2 0 0 0 2 2h1"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
    </svg>
  );
}
