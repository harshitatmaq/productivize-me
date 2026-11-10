"use client";

import { whoClass } from "@/lib/chat/colors";
import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LightboxImage } from "./ImageLightbox";
import MessageMenu, { type MenuAnchor } from "./MessageMenu";
import { LinkPreview, MessageText } from "./MessageText";
import { getSignedImageUrl } from "@/lib/chat/imageUrls";
import { firstUrl } from "@/lib/chat/links";
import { mentionsMe } from "@/lib/chat/mentions";
import type { MessageLayout } from "@/lib/chat/time";
import { formatTime } from "@/lib/chat/time";
import type { Message, Reaction, UserId } from "@/lib/chat/types";

interface Props {
  message: Message;
  mine: boolean;
  layout: MessageLayout;
  reactions: Reaction[];
  me: UserId;
  names: Record<UserId, string>;
  /** The message this one answers, when it is loaded. */
  repliedTo: Message | null;
  pinned: boolean;
  promised: boolean;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onRetry: (clientId: string) => void;
  onOpenImage: (image: LightboxImage) => void;
  onReply: (message: Message) => void;
  onTogglePin: (message: Message) => void;
  onTogglePromise: (message: Message) => void;
  onJumpTo: (clientId: string) => void;
  supabase: SupabaseClient | null;
}

const LONG_PRESS_MS = 450;
/** How far the bubble travels at most while being swiped. */
const SWIPE_MAX_PX = 72;
/** Past this the release fires a reply. */
const SWIPE_TRIGGER_PX = 52;
/** Below this the gesture is still ambiguous and the list keeps the scroll. */
const SWIPE_ENGAGE_PX = 12;

export default function MessageBubble({
  message,
  mine,
  layout,
  reactions,
  me,
  names,
  repliedTo,
  pinned,
  promised,
  onToggleReaction,
  onRetry,
  onOpenImage,
  onReply,
  onTogglePin,
  onTogglePromise,
  onJumpTo,
  supabase,
}: Props) {
  const [menuAt, setMenuAt] = useState<MenuAnchor | null>(null);
  const [swipe, setSwipe] = useState(0);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<{
    x: number;
    y: number;
    axis: "none" | "horizontal" | "vertical";
  } | null>(null);

  // Reactions, pins and promises can only attach to a row the database has.
  const settled = message.status !== "pending" && message.status !== "failed";

  const openMenu = (x: number, y: number) => setMenuAt({ x, y });

  const startPress = (event: React.TouchEvent) => {
    const touch = event.touches[0];
    if (!touch) return;

    gestureRef.current = { x: touch.clientX, y: touch.clientY, axis: "none" };
    pressTimer.current = setTimeout(() => {
      // Long-press and swipe are the same finger; whichever resolves first
      // cancels the other.
      gestureRef.current = null;
      setSwipe(0);
      openMenu(touch.clientX, touch.clientY);
    }, LONG_PRESS_MS);
  };

  const cancelPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };

  /**
   * Swipe-to-reply.
   *
   * The axis is decided once, on the first movement past the engage threshold,
   * and then held. Without that lock a drifting finger flips between scrolling
   * the list and dragging the bubble mid-gesture, which feels broken on every
   * near-diagonal swipe.
   */
  const onTouchMove = (event: React.TouchEvent) => {
    const touch = event.touches[0];
    const gesture = gestureRef.current;
    if (!touch || !gesture) return;

    const dx = touch.clientX - gesture.x;
    const dy = touch.clientY - gesture.y;

    if (gesture.axis === "none") {
      if (Math.abs(dx) < SWIPE_ENGAGE_PX && Math.abs(dy) < SWIPE_ENGAGE_PX) {
        return;
      }
      gesture.axis = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
      if (gesture.axis === "horizontal") cancelPress();
    }

    if (gesture.axis !== "horizontal") {
      cancelPress();
      return;
    }

    // Rightwards only, and resisted at the end of the travel so the bubble
    // never slides away from under the finger.
    const travel = Math.max(0, Math.min(dx, SWIPE_MAX_PX));
    setSwipe(travel);
  };

  const onTouchEnd = () => {
    cancelPress();
    const travelled = swipe;
    gestureRef.current = null;
    setSwipe(0);
    if (travelled >= SWIPE_TRIGGER_PX) onReply(message);
  };

  const grouped = groupReactions(reactions, me);
  const hasImage = Boolean(message.image_path || message.localImageUrl);
  const linkUrl = firstUrl(message.body);
  const canCopy = Boolean(message.body);
  // Tagged at me, by them. My own `@them` is not urgent to me.
  const urgent = !mine && mentionsMe(message.mentions, me);
  const hasFooterRow = grouped.length > 0 || pinned || promised;

  return (
    <div
      ref={rootRef}
      className={`group relative flex flex-col ${
        mine ? "items-end" : "items-start"
      } ${layout.startsGroup ? "mt-3" : "mt-0.5"}`}
    >
      {/* Revealed from underneath as the bubble slides right. */}
      {swipe > 0 && (
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-0 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full bg-accent-soft text-accent"
          style={{ opacity: Math.min(1, swipe / SWIPE_TRIGGER_PX) }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path
              d="M6.4 3.2 2.4 6.9l4 3.7"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M2.9 6.9h5.4a4.3 4.3 0 0 1 4.3 4.3v1.6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </span>
      )}

      <div
        className={`flex max-w-[85%] items-end gap-1.5 sm:max-w-[75%] ${
          mine ? "flex-row" : "flex-row-reverse"
        }`}
        style={{
          transform: swipe > 0 ? `translateX(${swipe}px)` : undefined,
          transition: swipe > 0 ? "none" : "transform 180ms ease-out",
        }}
      >
        {settled && (
          <button
            type="button"
            onClick={(event) =>
              openMenu(
                event.clientX,
                event.currentTarget.getBoundingClientRect().top,
              )
            }
            title="Message actions"
            aria-label="Message actions"
            className="mb-1 hidden h-7 w-7 shrink-0 place-items-center rounded-full text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-accent focus-visible:opacity-100 sm:grid"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <circle
                cx="8"
                cy="8"
                r="6.2"
                stroke="currentColor"
                strokeWidth="1.3"
              />
              <path
                d="M5.6 9.2a2.8 2.8 0 0 0 4.8 0"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
              <circle cx="6" cy="6.4" r="0.8" fill="currentColor" />
              <circle cx="10" cy="6.4" r="0.8" fill="currentColor" />
            </svg>
          </button>
        )}

        <div
          onTouchStart={startPress}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={() => {
            cancelPress();
            gestureRef.current = null;
            setSwipe(0);
          }}
          // Double-click is the pointer-device equivalent of the swipe. Text
          // selection is left alone: a double-click that lands on a word still
          // selects it, and the reply is additive.
          onDoubleClick={() => onReply(message)}
          onContextMenu={(event) => {
            event.preventDefault();
            // Android raises this on long-press as well, after the timer has
            // already opened the menu. Re-anchoring it there would make it
            // jump under the finger.
            if (menuAt) return;
            openMenu(event.clientX, event.clientY);
          }}
          className={`bubble animate-rise min-w-0 overflow-hidden ${
            hasImage ? "p-0" : "px-3.5 py-2"
          } ${
            // Colour follows the author, not the viewer, so a message reads the
            // same on both screens. Side still follows the viewer.
            `${whoClass(message.sender)} bg-who text-who-ink`
          } ${
            message.status === "pending" || message.status === "failed"
              ? "opacity-65"
              : ""
          } rounded-[18px] ${
            mine
              ? layout.endsGroup
                ? "rounded-br-[5px]"
                : ""
              : layout.endsGroup
                ? "rounded-bl-[5px]"
                : ""
          } ${
            // A message addressed at you is the one thing in the list that
            // should be findable while scrolling past at speed.
            urgent ? "ring-2 ring-urgent ring-offset-1 ring-offset-bg" : ""
          }`}
        >
          {message.reply_to && (
            <QuotedReply
              parent={repliedTo}
              names={names}
              inset={hasImage}
              onJump={() => message.reply_to && onJumpTo(message.reply_to)}
            />
          )}

          {hasImage && (
            <ChatImage
              message={message}
              supabase={supabase}
              onOpen={onOpenImage}
            />
          )}

          {urgent && (
            <span
              className={`mb-1 flex items-center gap-1 text-[0.625rem] font-semibold tracking-wider uppercase ${
                hasImage ? "mx-3.5 mt-2" : ""
              }`}
            >
              <span aria-hidden>🔔</span> For you
            </span>
          )}

          {message.kind !== "normal" && (
            <span
              className={`mb-1 inline-flex items-center gap-1 text-[0.625rem] font-medium tracking-wider uppercase opacity-75 ${
                hasImage ? "mx-3.5 mt-2" : ""
              }`}
            >
              {message.kind === "saved" ? "★ Saved" : "▪ Work"}
            </span>
          )}

          {message.body && (
            <div className={hasImage ? "px-3.5 pt-2 pb-2" : ""}>
              <p className="font-serif text-[0.9688rem] leading-[1.5] break-words whitespace-pre-wrap">
                <MessageText body={message.body} names={names} />
              </p>

              {/* Only when the message is a link and nothing else is competing
                  for the space. */}
              {linkUrl && !hasImage && (
                <LinkPreview url={linkUrl} mine={mine} />
              )}
            </div>
          )}
        </div>
      </div>

      {menuAt && (
        <MessageMenu
          anchor={menuAt}
          active={reactions.filter((r) => r.sender === me).map((r) => r.emoji)}
          canReact={settled}
          pinned={pinned}
          promised={promised}
          canCopy={canCopy}
          onReact={(emoji) => {
            onToggleReaction(message.id, emoji);
            setMenuAt(null);
          }}
          onReply={() => {
            onReply(message);
            setMenuAt(null);
          }}
          onTogglePin={() => {
            onTogglePin(message);
            setMenuAt(null);
          }}
          onTogglePromise={() => {
            onTogglePromise(message);
            setMenuAt(null);
          }}
          onCopy={() => {
            void navigator.clipboard?.writeText(message.body ?? "");
            setMenuAt(null);
          }}
          onClose={() => setMenuAt(null)}
        />
      )}

      {hasFooterRow && (
        <div
          className={`-mt-1.5 flex flex-wrap items-center gap-1 ${
            mine ? "mr-1 justify-end" : "ml-1"
          }`}
        >
          {pinned && <Mark label="Pinned">📌</Mark>}
          {promised && <Mark label="A promise">🤞</Mark>}

          {grouped.map(({ emoji, count, includesMe }) => (
            <button
              key={emoji}
              type="button"
              onClick={() => onToggleReaction(message.id, emoji)}
              className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[0.6875rem] transition-colors ${
                includesMe
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-hairline bg-surface text-muted"
              }`}
            >
              <span className="text-[0.8125rem] leading-none">{emoji}</span>
              {count > 1 && <span>{count}</span>}
            </button>
          ))}
        </div>
      )}

      {layout.endsGroup && (
        <div
          className={`mt-1 flex items-center gap-1 px-1 text-[0.6875rem] text-faint ${
            mine ? "flex-row" : "flex-row-reverse"
          }`}
        >
          {message.status === "failed" ? (
            <button
              type="button"
              onClick={() => onRetry(message.client_id)}
              className="font-medium text-accent underline underline-offset-2"
            >
              Not sent — retry
            </button>
          ) : (
            <>
              {mine && <StatusIcon status={message.status} />}
              <time dateTime={message.created_at} suppressHydrationWarning>
                {formatTime(message.created_at)}
              </time>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Mark({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={label}
      className="flex items-center rounded-full border border-hairline bg-surface px-1.5 py-0.5 text-[0.6875rem] leading-none"
    >
      <span aria-hidden>{children}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * The quoted line above a reply.
 *
 * `parent` is null when the message being answered has not been loaded — deep
 * in the history, or hidden by a chat clear. The quote still renders, because
 * the fact that this *is* a reply is itself information; only the text is
 * missing.
 */
function QuotedReply({
  parent,
  names,
  inset,
  onJump,
}: {
  parent: Message | null;
  names: Record<UserId, string>;
  inset: boolean;
  onJump: () => void;
}) {
  const preview = parent
    ? parent.body?.trim() ||
      (parent.image_path || parent.localImageUrl ? "Photo" : "")
    : "";

  return (
    // The wrapper carries the inset so the quote lines up with the caption of
    // an image message, where the bubble itself has no padding of its own.
    <div className={inset ? "px-3.5 pt-2.5" : ""}>
      <button
        type="button"
        onClick={onJump}
        disabled={!parent}
        className="mb-1.5 block w-full overflow-hidden rounded-lg border-l-[3px] border-on-bubble-line bg-on-bubble px-2 py-1 text-left disabled:cursor-default"
      >
        <span className="block text-[0.6875rem] font-medium opacity-85">
          {parent ? names[parent.sender] : "Replying to"}
        </span>
        <span className="block truncate font-serif text-[0.8125rem] opacity-75">
          {preview || "Earlier message"}
        </span>
      </button>
    </div>
  );
}

function ChatImage({
  message,
  supabase,
  onOpen,
}: {
  message: Message;
  supabase: SupabaseClient | null;
  onOpen: (image: LightboxImage) => void;
}) {
  const [url, setUrl] = useState<string | null>(message.localImageUrl ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!supabase || message.localImageUrl || !message.image_path) return;
    let cancelled = false;

    getSignedImageUrl(supabase, message.image_path).then((signed) => {
      if (cancelled) return;
      if (signed) setUrl(signed);
      else setFailed(true);
    });

    return () => {
      cancelled = true;
    };
  }, [supabase, message.image_path, message.localImageUrl]);

  // Reserve the exact box the image will occupy so nothing reflows when it
  // arrives — the single biggest source of scroll jump in a chat list.
  const width = message.image_width ?? 4;
  const height = message.image_height ?? 3;

  return (
    <button
      type="button"
      disabled={!url}
      onClick={() => url && onOpen({ url, width, height })}
      className="block w-full max-w-[19rem] cursor-zoom-in"
      title="Open image"
      aria-label="Open image"
    >
      <div
        className="relative w-full overflow-hidden bg-accent-soft"
        style={{ aspectRatio: `${width} / ${height}` }}
      >
        {url && !failed ? (
          <img
            src={url}
            alt=""
            width={width}
            height={height}
            onError={() => setFailed(true)}
            className="animate-fade-in h-full w-full object-cover"
          />
        ) : (
          <span className="absolute inset-0 grid place-items-center text-[0.75rem] text-muted">
            {failed ? "Image unavailable" : ""}
          </span>
        )}
      </div>
    </button>
  );
}

function StatusIcon({ status }: { status: Message["status"] }) {
  if (status === "pending") {
    return (
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        aria-label="Sending"
      >
        <circle cx="6" cy="6" r="4.6" stroke="currentColor" strokeWidth="1.1" />
        <path
          d="M6 3.6V6l1.7 1"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  const read = status === "read";
  return (
    <svg
      width="15"
      height="12"
      viewBox="0 0 15 12"
      fill="none"
      className={read ? "text-accent" : undefined}
      aria-label={read ? "Seen" : "Sent"}
    >
      <path
        d="M1 6.4 3.5 9 8.6 3.2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {read && (
        <path
          d="M6.2 8.4 6.9 9l5.1-5.8"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

function groupReactions(reactions: Reaction[], me: UserId) {
  const counts = new Map<string, { count: number; includesMe: boolean }>();
  for (const reaction of reactions) {
    const entry = counts.get(reaction.emoji) ?? { count: 0, includesMe: false };
    entry.count += 1;
    entry.includesMe = entry.includesMe || reaction.sender === me;
    counts.set(reaction.emoji, entry);
  }
  return Array.from(counts, ([emoji, entry]) => ({ emoji, ...entry }));
}
