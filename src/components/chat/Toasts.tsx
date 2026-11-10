"use client";

import { useEffect, useRef } from "react";
import { ownerClasses } from "./board/shared";
import type { UserId } from "@/lib/chat/types";

/**
 * One toast, whatever raised it.
 *
 * Messages and workspace changes share a shape and a stack deliberately. They
 * compete for the same corner of the screen and the same moment of attention,
 * and two independent stacks would sooner or later render on top of each
 * other.
 */
export interface Toast {
  id: string;
  /** Whose colour it wears, and whose initial is on the chip. */
  author: UserId;
  /** Single letter on the avatar chip. */
  initial: string;
  headline: React.ReactNode;
  preview: string;
  /** Plain-text headline for the OS notification, which cannot take nodes. */
  notificationTitle: string;
  /** Where tapping the OS notification should land when the app is closed. */
  notificationUrl: string;
  /** Tagged at you: louder styling, and a notification that waits to be seen. */
  urgent?: boolean;
  onOpen: () => void;
}

interface Props {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

export default function Toasts({ toasts, onDismiss }: Props) {
  const notifiedRef = useRef<Set<string>>(new Set());

  /**
   * Mirrors anything new to the OS while the app is not on screen.
   *
   * Only when permission has already been granted — asking on an event nobody
   * invited is how you get a permanently denied prompt. The ask lives in the
   * options menu.
   *
   * Routed through the service worker registration first: Android Chrome
   * refuses `new Notification()` outright and throws, and Android is the
   * platform this matters most on. The constructor is the desktop fallback.
   */
  useEffect(() => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    if (document.visibilityState === "visible") return;

    const pending = toasts.filter((t) => !notifiedRef.current.has(t.id));
    if (pending.length === 0) return;
    pending.forEach((t) => notifiedRef.current.add(t.id));

    void (async () => {
      const registration = await navigator.serviceWorker?.ready.catch(
        () => null,
      );

      for (const toast of pending) {
        const options: NotificationOptions & {
          vibrate?: number[];
          renotify?: boolean;
        } = {
          body: toast.preview,
          tag: toast.id,
          icon: "/icons/icon-192.png",
          badge: "/icons/icon-192.png",
          data: { url: toast.notificationUrl },
          // A ping stays on screen until it is dealt with, instead of fading
          // after a few seconds like an ordinary message.
          requireInteraction: toast.urgent,
          vibrate: toast.urgent ? [90, 60, 90] : undefined,
        };

        try {
          if (registration) {
            await registration.showNotification(
              toast.notificationTitle,
              options,
            );
          } else {
            new Notification(toast.notificationTitle, options);
          }
        } catch {
          // The in-app toast is still queued, which is the part that matters.
        }
      }
    })();
  }, [toasts]);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-2 z-30 flex flex-col items-center gap-2 px-3">
      {toasts.map((toast) => {
        const colors = ownerClasses(toast.author);
        return (
          <div
            key={toast.id}
            className={`animate-slide-up pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-2xl border bg-surface px-3 py-2.5 shadow-[var(--shadow)] ${
              toast.urgent ? "animate-urgent border-urgent" : "border-hairline"
            }`}
          >
            <span
              aria-hidden
              className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full font-serif text-[0.6875rem] ${
                toast.urgent ? "bg-urgent-soft text-urgent" : colors.soft
              }`}
            >
              {toast.urgent ? "🔔" : toast.initial}
            </span>

            <button
              type="button"
              onClick={() => toast.onOpen()}
              className="min-w-0 flex-1 text-left"
            >
              <p className="text-[0.8125rem] text-ink">{toast.headline}</p>
              <p className="truncate font-serif text-[0.8125rem] text-muted">
                {toast.preview}
              </p>
            </button>

            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              title="Dismiss"
              aria-label="Dismiss"
              className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-faint transition-colors hover:text-accent"
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
        );
      })}
    </div>
  );
}
