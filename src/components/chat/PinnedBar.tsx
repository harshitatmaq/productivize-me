"use client";

import { useState } from "react";
import { ownerClasses } from "./board/shared";
import { formatDayDivider, formatTime } from "@/lib/chat/time";
import type { Pin, UserId } from "@/lib/chat/types";

interface Props {
  pins: Pin[];
  names: Record<UserId, string>;
  onJump: (clientId: string) => void;
  onUnpin: (pin: Pin) => void;
}

/**
 * A slim strip under the header carrying the most recent pin.
 *
 * Shows one line rather than a list: pins are for the handful of things worth
 * keeping at the top of the conversation, and a stack of them competing with
 * the chat would defeat the purpose. Tapping opens the full set.
 */
export default function PinnedBar({ pins, names, onJump, onUnpin }: Props) {
  const [listOpen, setListOpen] = useState(false);

  if (pins.length === 0) return null;

  const sorted = [...pins].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
  const latest = sorted[0];

  return (
    <>
      <div className="relative z-20 flex shrink-0 items-center gap-2 border-b border-hairline bg-surface/70 px-3 py-1.5 backdrop-blur-md sm:px-4">
        <span aria-hidden className="text-[0.75rem] leading-none">
          📌
        </span>

        <button
          type="button"
          onClick={() => onJump(latest.message_client_id)}
          className="min-w-0 flex-1 truncate text-left text-[0.8125rem] text-muted transition-colors hover:text-accent"
        >
          <span className={`font-medium ${ownerClasses(latest.author).text}`}>
            {names[latest.author]}
          </span>
          <span className="mx-1.5 text-faint">·</span>
          {latest.excerpt || "Photo"}
        </button>

        <button
          type="button"
          onClick={() => setListOpen(true)}
          className="shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] text-faint transition-colors hover:bg-accent-soft hover:text-accent"
        >
          {pins.length === 1 ? "1 pin" : `${pins.length} pins`}
        </button>
      </div>

      {listOpen && (
        <div className="animate-fade-in fixed inset-0 z-40 flex flex-col bg-bg">
          <header className="flex shrink-0 items-center gap-3 border-b border-hairline px-4 py-3">
            <button
              type="button"
              onClick={() => setListOpen(false)}
              title="Back"
              aria-label="Back"
              className="grid h-9 w-9 place-items-center rounded-full text-muted transition-colors hover:bg-accent-soft hover:text-accent"
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
            <div className="min-w-0">
              <h2 className="truncate text-[0.9375rem] font-medium text-ink">
                Pinned messages
              </h2>
              <p className="text-xs text-muted">
                {pins.length === 1 ? "1 message" : `${pins.length} messages`}
              </p>
            </div>
          </header>

          <div className="scroll-area min-h-0 flex-1 px-4 py-3">
            <ul className="mx-auto flex max-w-2xl flex-col gap-2 pb-6">
              {sorted.map((pin) => (
                <li
                  key={pin.message_id}
                  className="rounded-2xl border border-hairline bg-surface p-3.5"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setListOpen(false);
                      onJump(pin.message_client_id);
                    }}
                    className="block w-full text-left font-serif text-[0.9688rem] leading-[1.5] whitespace-pre-wrap text-ink"
                  >
                    {pin.excerpt || "Photo"}
                  </button>

                  <div className="mt-2 flex items-center gap-2 text-[0.6875rem] text-faint">
                    <span className={ownerClasses(pin.author).text}>
                      {names[pin.author]}
                    </span>
                    <span>·</span>
                    <span>{formatDayDivider(pin.created_at)}</span>
                    <span>{formatTime(pin.created_at)}</span>
                    <button
                      type="button"
                      onClick={() => onUnpin(pin)}
                      className="ml-auto font-medium text-muted underline underline-offset-2 transition-colors hover:text-accent"
                    >
                      Unpin
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
