"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import MessageBubble from "./MessageBubble";
import type { LightboxImage } from "./ImageLightbox";
import { computeLayout, formatDayDivider } from "@/lib/chat/time";
import type { Message, Reaction, UserId } from "@/lib/chat/types";

interface Props {
  messages: Message[];
  me: UserId;
  names: Record<UserId, string>;
  /** Every message in memory, for resolving what a reply is answering. */
  messagesByClientId: Record<string, Message>;
  reactionsByMessage: Map<string, Reaction[]>;
  pinnedIds: Set<string>;
  promisedIds: Set<string>;
  partnerTyping: boolean;
  canLoadOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onVisible: () => void;
  /** Reports whether the newest message is on screen. */
  onPinnedChange: (pinned: boolean) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onRetry: (clientId: string) => void;
  onOpenImage: (image: LightboxImage) => void;
  onReply: (message: Message) => void;
  onTogglePin: (message: Message) => void;
  onTogglePromise: (message: Message) => void;
  onJumpTo: (clientId: string) => void;
  /** Null until the client has been constructed in the browser. */
  supabase: SupabaseClient | null;
  /** client_id to scroll to and highlight, set when a search result is opened. */
  jumpTo: string | null;
  onJumpComplete: () => void;
}

/** Distance from the bottom within which we consider the view "pinned". */
const PIN_THRESHOLD_PX = 80;
/** Scrolling within this of the top pulls in the previous page. */
const LOAD_TRIGGER_PX = 200;

export default function MessageList({
  messages,
  me,
  names,
  messagesByClientId,
  reactionsByMessage,
  pinnedIds,
  promisedIds,
  partnerTyping,
  canLoadOlder,
  loadingOlder,
  onLoadOlder,
  onVisible,
  onPinnedChange,
  onToggleReaction,
  onRetry,
  onOpenImage,
  onReply,
  onTogglePin,
  onTogglePromise,
  onJumpTo,
  supabase,
  jumpTo,
  onJumpComplete,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const [unseenCount, setUnseenCount] = useState(0);
  const [flashing, setFlashing] = useState<string | null>(null);

  const previousCountRef = useRef(messages.length);
  const didInitialScrollRef = useRef(false);
  // Scroll height captured before older messages splice in, so the viewport can
  // be restored to the same visual position afterwards.
  const restoreRef = useRef<number | null>(null);

  const layout = computeLayout(messages);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    setUnseenCount(0);
  }, []);

  // First paint lands at the newest message with no visible animation.
  useLayoutEffect(() => {
    if (didInitialScrollRef.current || messages.length === 0) return;
    didInitialScrollRef.current = true;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // Prepending history would otherwise jump the view; anchor it instead.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || restoreRef.current === null) return;
    el.scrollTop = el.scrollHeight - restoreRef.current;
    restoreRef.current = null;
  }, [messages.length]);

  useEffect(() => {
    const grew = messages.length > previousCountRef.current;
    const newest = messages[messages.length - 1];
    previousCountRef.current = messages.length;

    if (!grew || !didInitialScrollRef.current) return;

    // Always follow your own message down. Only follow theirs if you were
    // already at the bottom — otherwise you would be yanked out of the history
    // you were reading.
    if (pinned || newest?.sender === me) {
      scrollToBottom();
    } else {
      setUnseenCount((count) => count + 1);
    }
  }, [messages, pinned, me, scrollToBottom]);

  // Whether you are at the bottom decides whether an arriving message needs
  // announcing at all, and that is decided up in the chat, not here.
  useEffect(() => {
    onPinnedChange(pinned);
  }, [pinned, onPinnedChange]);

  // Report the conversation as read whenever it is genuinely being looked at.
  useEffect(() => {
    if (!pinned || document.visibilityState !== "visible") return;
    onVisible();
  }, [messages, pinned, onVisible]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && pinned) onVisible();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [pinned, onVisible]);

  /**
   * Scrolls to a searched-for message and flashes it.
   *
   * Runs after the surrounding window has been merged into `messages`, so the
   * element exists by the time this fires. The flash matters: dropping someone
   * into the middle of months-old history with no marker leaves them hunting
   * for the line they clicked.
   */
  useEffect(() => {
    if (!jumpTo) return;

    const el = scrollRef.current?.querySelector<HTMLElement>(
      `[data-client-id="${CSS.escape(jumpTo)}"]`,
    );
    if (!el) {
      onJumpComplete();
      return;
    }

    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashing(jumpTo);
    onJumpComplete();

    const timer = setTimeout(() => setFlashing(null), 2200);
    return () => clearTimeout(timer);
  }, [jumpTo, messages.length, onJumpComplete]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nowPinned = distanceFromBottom < PIN_THRESHOLD_PX;

    setPinned(nowPinned);
    if (nowPinned) setUnseenCount(0);

    if (el.scrollTop < LOAD_TRIGGER_PX && canLoadOlder && !loadingOlder) {
      restoreRef.current = el.scrollHeight - el.scrollTop;
      onLoadOlder();
    }
  }, [canLoadOlder, loadingOlder, onLoadOlder]);

  return (
    <div className="relative min-h-0 min-w-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="scroll-area h-full px-3 pt-2 pb-4 sm:px-4"
      >
        <div className="mx-auto flex max-w-2xl flex-col">
          {loadingOlder && (
            <p className="py-3 text-center text-xs text-faint">Loading…</p>
          )}
          {!canLoadOlder && messages.length > 0 && (
            <p className="py-6 text-center font-serif text-sm text-faint italic">
              the beginning
            </p>
          )}

          {messages.length === 0 && <EmptyState />}

          {messages.map((message, i) => (
            <div
              key={message.client_id}
              data-client-id={message.client_id}
              className={
                flashing === message.client_id
                  ? "-mx-2 rounded-2xl bg-accent-soft px-2 transition-colors duration-500"
                  : "-mx-2 rounded-2xl px-2 transition-colors duration-1000"
              }
            >
              {layout[i].showDayDivider && (
                <DayDivider iso={message.created_at} />
              )}
              <MessageBubble
                message={message}
                mine={message.sender === me}
                layout={layout[i]}
                reactions={reactionsByMessage.get(message.id) ?? []}
                me={me}
                names={names}
                repliedTo={
                  message.reply_to
                    ? (messagesByClientId[message.reply_to] ?? null)
                    : null
                }
                pinned={pinnedIds.has(message.id)}
                promised={promisedIds.has(message.id)}
                onToggleReaction={onToggleReaction}
                onRetry={onRetry}
                onOpenImage={onOpenImage}
                onReply={onReply}
                onTogglePin={onTogglePin}
                onTogglePromise={onTogglePromise}
                onJumpTo={onJumpTo}
                supabase={supabase}
              />
            </div>
          ))}

          {partnerTyping && <TypingBubble />}
        </div>
      </div>

      {unseenCount > 0 && (
        <button
          type="button"
          onClick={() => scrollToBottom()}
          className="animate-rise absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full bg-accent px-4 py-2 text-[0.8125rem] font-medium text-accent-ink shadow-[var(--shadow)]"
        >
          {unseenCount} new {unseenCount === 1 ? "message" : "messages"} ↓
        </button>
      )}
    </div>
  );
}

function DayDivider({ iso }: { iso: string }) {
  return (
    <div className="flex items-center gap-3 py-5">
      <span className="h-px flex-1 bg-hairline" />
      <span className="text-[0.6875rem] tracking-wider text-faint uppercase">
        {formatDayDivider(iso)}
      </span>
      <span className="h-px flex-1 bg-hairline" />
    </div>
  );
}

function TypingBubble() {
  return (
    <div className="animate-fade-in mt-1 flex justify-start">
      <div className="flex items-center gap-1.5 rounded-[18px] rounded-bl-[4px] border border-hairline bg-surface px-4 py-3">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-faint"
            style={{
              animation: "pulse-dot 1.2s ease-in-out infinite",
              animationDelay: `${i * 0.15}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <p className="font-serif text-4xl text-accent italic select-none">
        &amp;
      </p>
      <p className="mt-4 font-serif text-base text-muted">Nothing here yet</p>
      <p className="mt-1 text-[0.8125rem] text-faint">Say something.</p>
    </div>
  );
}
