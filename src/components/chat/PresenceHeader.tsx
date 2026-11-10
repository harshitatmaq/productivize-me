"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Tip } from "@/components/ui/menu";
import type { PanelKind } from "./Panels";
import { ownerClasses } from "./board/shared";
import type { ConnectionState, Person, UserId } from "@/lib/chat/types";

interface Props {
  title: string;
  people: Person[];
  me: UserId;
  onlineIds: UserId[];
  typingIds: UserId[];
  view: "chat" | "board";
  connection: ConnectionState;
  onOpenPanel: (panel: PanelKind) => void;
  onOpenWorkspace: () => void;
  onOpenSearch: () => void;
  onClearChat: () => void;
  /** Board changes others have made since you last looked. */
  workspaceUnseen: number;
}

export default function PresenceHeader({
  title,
  people,
  me,
  onlineIds,
  typingIds,
  view,
  connection,
  onOpenPanel,
  onOpenWorkspace,
  onOpenSearch,
  onClearChat,
  workspaceUnseen,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const others = people.filter((p) => p.id !== me);
  const nameOf = (id: UserId) =>
    people.find((p) => p.id === id)?.name.split(" ")[0] ?? "Someone";
  const typing = typingIds.map(nameOf);
  const onlineCount = others.filter((p) => onlineIds.includes(p.id)).length;

  const status = typing.length
    ? `${typing.length === 1 ? typing[0] : `${typing.slice(0, -1).join(", ")} and ${typing.at(-1)}`} ${typing.length === 1 ? "is" : "are"} typing…`
    : connection !== "online"
      ? "reconnecting…"
      : !others.length
        ? "Invite someone to start chatting"
        : others.length === 1
          ? onlineCount
            ? "online"
            : "offline"
          : onlineCount
            ? `${onlineCount} of ${others.length} online`
            : `${others.length + 1} people · nobody else online`;

  const iconButton =
    "grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted transition-all hover:scale-105 hover:bg-accent-soft hover:text-accent";

  return (
    <header className="relative z-30 flex shrink-0 items-center gap-3 border-b border-hairline bg-bg/85 px-4 py-3 backdrop-blur-md">
      <div className="flex shrink-0 -space-x-2" aria-hidden>
        {(others.length ? others : people).slice(0, 4).map((p) => {
          const c = ownerClasses(p.id);
          const online = onlineIds.includes(p.id) && connection === "online";
          return (
            <div
              key={p.id}
              className={`relative grid h-9 w-9 place-items-center rounded-full text-[0.875rem] font-semibold ring-2 ring-bg ${c.soft}`}
            >
              {p.name.charAt(0).toUpperCase()}
              <span
                className={`absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-bg transition-colors ${online ? c.solid : "bg-faint"}`}
              />
            </div>
          );
        })}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[0.9375rem] font-medium text-ink">
          {others.length === 1 ? others[0].name : title}
        </p>
        <p className="flex items-center gap-1 truncate text-xs text-muted">
          {typing.length ? <TypingDots /> : null}
          <span className="truncate">{status}</span>
        </p>
      </div>

      <Tip content="Search messages">
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label="Search messages"
          className={iconButton}
        >
          <svg width="17" height="17" viewBox="0 0 18 18" fill="none">
            <circle
              cx="8"
              cy="8"
              r="5.2"
              stroke="currentColor"
              strokeWidth="1.6"
            />
            <path
              d="M11.9 11.9 15.5 15.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </Tip>

      {view === "chat" ? (
        <Tip
          content={
            workspaceUnseen > 0
              ? `Board — ${workspaceUnseen} new change${workspaceUnseen === 1 ? "" : "s"}`
              : "Board — notes, tasks, shopping, meals, calendar"
          }
        >
          <button
            type="button"
            onClick={onOpenWorkspace}
            aria-label={
              workspaceUnseen > 0
                ? `Open board — ${workspaceUnseen} update${workspaceUnseen === 1 ? "" : "s"}`
                : "Open board"
            }
            className={`relative ${iconButton}`}
          >
            <svg width="17" height="17" viewBox="0 0 18 18" fill="none">
              <rect
                x="2.4"
                y="2.4"
                width="5.7"
                height="5.7"
                rx="1.6"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <rect
                x="9.9"
                y="2.4"
                width="5.7"
                height="5.7"
                rx="1.6"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <rect
                x="2.4"
                y="9.9"
                width="5.7"
                height="5.7"
                rx="1.6"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <rect
                x="9.9"
                y="9.9"
                width="5.7"
                height="5.7"
                rx="1.6"
                stroke="currentColor"
                strokeWidth="1.5"
              />
            </svg>
            {workspaceUnseen > 0 && (
              <span className="animate-pop absolute -top-0.5 -right-0.5 grid min-w-[1.05rem] place-items-center rounded-full border-2 border-bg bg-accent px-1 text-[0.5938rem] font-semibold leading-[0.95rem] text-accent-ink">
                {workspaceUnseen > 9 ? "9+" : workspaceUnseen}
              </span>
            )}
          </button>
        </Tip>
      ) : null}

      <div ref={menuRef} className="relative">
        <Tip content="More — saved messages, work items, emoji shortcuts, clear chat">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="More options"
            aria-expanded={menuOpen}
            className="grid h-9 w-9 place-items-center rounded-full text-muted transition-colors hover:bg-accent-soft hover:text-accent"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <circle cx="8" cy="3" r="1.4" />
              <circle cx="8" cy="8" r="1.4" />
              <circle cx="8" cy="13" r="1.4" />
            </svg>
          </button>
        </Tip>

        {menuOpen && (
          <OptionsMenu
            onClose={() => setMenuOpen(false)}
            onOpenPanel={onOpenPanel}
            onClearChat={onClearChat}
          />
        )}
      </div>
    </header>
  );
}

function OptionsMenu({
  onClose,
  onOpenPanel,
  onClearChat,
}: {
  onClose: () => void;
  onOpenPanel: (panel: PanelKind) => void;
  onClearChat: () => void;
}) {
  const [confirmingClear, setConfirmingClear] = useState(false);
  const item =
    "w-full px-3.5 py-2 text-left text-[0.875rem] transition-colors hover:bg-accent-soft";

  return (
    <div className="animate-fade-in absolute top-11 right-0 z-20 w-56 overflow-hidden rounded-xl border border-hairline bg-surface py-1 shadow-[var(--shadow)]">
      <button
        type="button"
        onClick={() => {
          onOpenPanel("saved");
          onClose();
        }}
        className={`${item} text-ink`}
      >
        Saved messages
      </button>
      <button
        type="button"
        onClick={() => {
          onOpenPanel("work");
          onClose();
        }}
        className={`${item} text-ink`}
      >
        Work items
      </button>
      <button
        type="button"
        onClick={() => {
          onOpenPanel("emoji");
          onClose();
        }}
        className={`${item} text-ink`}
      >
        Emoji shortcuts
      </button>
      <div className="my-1 h-px bg-hairline" />
      <Link
        href="/settings#notifications"
        onClick={onClose}
        className={`${item} block text-ink`}
      >
        Notification settings
      </Link>
      {/* Two-step: hides the history for you only (nothing is deleted). */}
      {confirmingClear ? (
        <button
          type="button"
          onClick={() => {
            onClearChat();
            onClose();
          }}
          className={`${item} font-medium text-accent`}
        >
          Really clear for me? Tap again
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmingClear(true)}
          className={`${item} text-ink`}
        >
          Clear chat (for me)
        </button>
      )}
    </div>
  );
}

function TypingDots() {
  return (
    <span aria-hidden className="inline-flex items-center gap-[3px] pr-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1 w-1 rounded-full bg-accent"
          style={{
            animation: "pulse-dot 1.2s ease-in-out infinite",
            animationDelay: `${i * 0.15}s`,
          }}
        />
      ))}
    </span>
  );
}
