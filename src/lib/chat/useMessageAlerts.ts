"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Message, UserId } from "./types";

/**
 * "There is something new from them."
 *
 * Announced four ways, because a message can arrive with the app in four
 * different states and no single signal covers them all:
 *
 *   - a toast over the conversation, when the app is open but the message is
 *     not where you are looking;
 *   - a count in the tab title, for a background tab;
 *   - a dot on the favicon, which is the only one of these visible when the
 *     tab is narrow enough that the title is truncated away;
 *   - a system notification, when the app is not on screen at all.
 *
 * Nothing fires while you are sitting at the bottom of the chat with the
 * window in front of you — the message is already right there, and announcing
 * it would be noise.
 */

/** How long a toast stays up once it can actually be seen. */
const TOAST_WINDOW_MS = 7000;
/** A ping is meant to be answered, so it stays up long enough to be read. */
const URGENT_WINDOW_MS = 20000;
/** More than this at once is a wall, not a notification. */
const MAX_TOASTS = 3;
/** Enough of the message to know whether it needs answering now. */
const PREVIEW_LIMIT = 140;

export interface MessageAlert {
  id: string;
  clientId: string;
  sender: UserId;
  preview: string;
  /** Tagged at you. Louder everywhere, and it outlives an ordinary toast. */
  urgent: boolean;
  /** Epoch ms the toast's clock started. Reset when the app regains focus. */
  at: number;
}

interface UseMessageAlertsResult {
  alerts: MessageAlert[];
  unread: number;
  /** Raise everything for a newly arrived message from the other person. */
  announce: (message: Message, urgent?: boolean) => void;
  dismiss: (id: string) => void;
  /** The conversation is being read: stand everything down. */
  clear: () => void;
}

export function useMessageAlerts(): UseMessageAlertsResult {
  const [alerts, setAlerts] = useState<MessageAlert[]>([]);
  const [unread, setUnread] = useState(0);

  const announce = useCallback((message: Message, urgent = false) => {
    setUnread((count) => count + 1);

    // A short buzz for a ping, when the device can. This is the part that
    // reaches someone whose phone is face-down on the table next to them.
    if (urgent) {
      try {
        navigator.vibrate?.([90, 60, 90]);
      } catch {
        // Blocked without a prior user gesture on some browsers. Everything
        // else about the ping still fires.
      }
    }

    setAlerts((current) => {
      if (current.some((a) => a.clientId === message.client_id)) return current;
      const alert: MessageAlert = {
        id: message.client_id,
        clientId: message.client_id,
        sender: message.sender,
        preview: previewOf(message),
        urgent,
        at: Date.now(),
      };
      return [...current, alert].slice(-MAX_TOASTS);
    });
  }, []);

  const dismiss = useCallback((id: string) => {
    setAlerts((current) => current.filter((a) => a.id !== id));
  }, []);

  const clear = useCallback(() => {
    setUnread(0);
    // Returning the same array when there is nothing to drop is load-bearing.
    // This is called from the "conversation is being read" path, which re-runs
    // on essentially every render — handing back a fresh `[]` each time would
    // register as a state change and spin.
    setAlerts((current) => (current.length === 0 ? current : []));
  }, []);

  /**
   * Toasts expire only while the app is on screen.
   *
   * A message that arrives during a two-hour background stint would otherwise
   * have timed out long before anyone could read it, and coming back to a
   * silent chat is precisely the failure this is meant to prevent. So the
   * clock is restarted on the way back in, and does not run while away.
   */
  useEffect(() => {
    if (alerts.length === 0) return;

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      setAlerts((current) => current.map((a) => ({ ...a, at: Date.now() })));
    };
    document.addEventListener("visibilitychange", onVisible);

    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      setAlerts((current) =>
        current.filter(
          (a) => a.at > now - (a.urgent ? URGENT_WINDOW_MS : TOAST_WINDOW_MS)
        )
      );
    }, 1000);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [alerts.length]);

  useTitleBadge(unread);
  useFaviconBadge(unread);

  return { alerts, unread, announce, dismiss, clear };
}

/** Photos carry no text; name them rather than showing an empty line. */
function previewOf(message: Message): string {
  const body = message.body?.trim();
  if (body) return body.slice(0, PREVIEW_LIMIT);
  return message.image_path || message.localImageUrl ? "Photo" : "Message";
}

/** `(2) Chat` in the tab, so a background tab says so without being opened. */
function useTitleBadge(unread: number) {
  const baseRef = useRef<string | null>(null);

  useEffect(() => {
    // Captured once, after the framework has set the document title from the
    // route's metadata — reading it later would read our own badge back.
    if (baseRef.current === null) {
      baseRef.current = document.title.replace(/^\(\d+\)\s*/, "");
    }
    const base = baseRef.current;
    document.title = unread > 0 ? `(${unread > 9 ? "9+" : unread}) ${base}` : base;
  }, [unread]);

  useEffect(() => {
    return () => {
      if (baseRef.current) document.title = baseRef.current;
    };
  }, []);
}

const BADGE_LINK_ID = "unread-favicon";
const BADGE_SOURCE = "/icons/icon-192.png";

/**
 * Paints a dot onto the favicon while anything is unread.
 *
 * Appended as an extra `<link rel="icon">` rather than by rewriting the one
 * the framework emitted: the last icon link wins, so adding ours overrides it
 * and removing ours restores the original with nothing to put back by hand.
 */
function useFaviconBadge(unread: number) {
  useEffect(() => {
    if (typeof document === "undefined") return;

    const existing = document.getElementById(BADGE_LINK_ID);

    if (unread === 0) {
      existing?.remove();
      return;
    }
    // Already badged. The dot does not count, so it needs no repaint.
    if (existing) return;

    let cancelled = false;
    const image = new Image();
    image.src = BADGE_SOURCE;

    image.onload = () => {
      if (cancelled) return;

      const size = 64;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.drawImage(image, 0, 0, size, size);

      // Ringed in the page background so the dot stays legible whichever part
      // of the mark it lands on.
      const radius = size * 0.23;
      const cx = size - radius - 2;
      const cy = radius + 2;

      ctx.beginPath();
      ctx.arc(cx, cy, radius + size * 0.06, 0, Math.PI * 2);
      ctx.fillStyle = "#fafaf8";
      ctx.fill();

      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = "#d1462f";
      ctx.fill();

      const link = document.createElement("link");
      link.id = BADGE_LINK_ID;
      link.rel = "icon";
      link.type = "image/png";
      link.href = canvas.toDataURL("image/png");
      document.head.appendChild(link);
    };

    return () => {
      cancelled = true;
    };
  }, [unread]);

  useEffect(() => {
    return () => document.getElementById(BADGE_LINK_ID)?.remove();
  }, []);
}
