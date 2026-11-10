"use client";

import type { ConnectionState } from "@/lib/chat/types";

interface Props {
  connection: ConnectionState;
  error: string | null;
  onDismissError: () => void;
}

/**
 * A quiet strip under the header. Errors take precedence over connection state,
 * since a failed send is actionable and a brief reconnect is not.
 */
export default function ConnectionBanner({
  connection,
  error,
  onDismissError,
}: Props) {
  if (error) {
    return (
      <div className="animate-fade-in flex shrink-0 items-center gap-2 bg-accent-soft px-4 py-2 text-[0.8125rem] text-accent">
        <span className="min-w-0 flex-1 truncate">{error}</span>
        <button
          type="button"
          onClick={onDismissError}
          className="shrink-0 font-medium underline underline-offset-2"
        >
          Dismiss
        </button>
      </div>
    );
  }

  if (connection === "online") return null;

  return (
    <div className="animate-fade-in shrink-0 bg-accent-soft px-4 py-2 text-center text-[0.8125rem] text-muted">
      {connection === "offline"
        ? "Offline — messages will send when you're back."
        : "Reconnecting…"}
    </div>
  );
}
