"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EMOJI_COUNT, EMOJI_GROUPS } from "@/lib/chat/emoji";
import { formatDayDivider, formatTime } from "@/lib/chat/time";
import type {
  Message,
  MessageKind,
  MessageRow,
  UserId,
} from "@/lib/chat/types";

export type PanelKind = "saved" | "work" | "emoji";

/** Shared chrome: a full-height sheet sliding over the conversation. */
function PanelShell({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="animate-fade-in fixed inset-0 z-40 flex flex-col bg-bg">
      <header className="flex shrink-0 items-center gap-3 border-b border-hairline px-4 py-3">
        <button
          type="button"
          onClick={onClose}
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
            {title}
          </h2>
          {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
        </div>
      </header>

      <div className="scroll-area min-h-0 flex-1 px-4 py-3">
        <div className="mx-auto max-w-2xl">{children}</div>
      </div>
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-20 text-center font-serif text-[0.9375rem] text-faint italic">
      {children}
    </p>
  );
}

/**
 * Saved messages / work items.
 *
 * Queried fresh from Postgres on open rather than filtered out of what the chat
 * happens to have loaded — the list must cover the whole history, not just the
 * most recent page. Falls back to whatever is already in memory when offline.
 */
export function FiledPanel({
  kind,
  supabase,
  fallback,
  me,
  names,
  onClose,
  onUnfile,
}: {
  kind: Exclude<PanelKind, "emoji">;
  supabase: SupabaseClient | null;
  fallback: Message[];
  me: UserId;
  names: Record<UserId, string>;
  onClose: () => void;
  onUnfile: (message: Message) => void;
}) {
  const [items, setItems] = useState<MessageRow[]>(() =>
    fallback.filter((m) => m.kind === kind),
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    (async () => {
      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq("kind", kind)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(500);

      if (cancelled) return;
      if (data) setItems(data as MessageRow[]);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [supabase, kind]);

  const title = kind === "saved" ? "Saved messages" : "Work items";
  const hint =
    kind === "saved"
      ? "Start a message with save: to file it here"
      : "Start a message with work: to file it here";

  return (
    <PanelShell
      title={title}
      subtitle={
        items.length > 0
          ? `${items.length} item${items.length === 1 ? "" : "s"}`
          : hint
      }
      onClose={onClose}
    >
      {loading && items.length === 0 && <EmptyNote>Loading…</EmptyNote>}

      {!loading && items.length === 0 && <EmptyNote>{hint}</EmptyNote>}

      <ul className="flex flex-col gap-2 pb-6">
        {items.map((item) => (
          <li
            key={item.client_id}
            className="rounded-2xl border border-hairline bg-surface p-3.5"
          >
            <p className="font-serif text-[0.9688rem] leading-[1.5] whitespace-pre-wrap text-ink">
              {item.body}
            </p>
            <div className="mt-2 flex items-center gap-2 text-[0.6875rem] text-faint">
              <span>{names[item.sender]}</span>
              <span>·</span>
              <span>{formatDayDivider(item.created_at)}</span>
              <span>{formatTime(item.created_at)}</span>

              {/* RLS only permits editing your own rows, so unfiling is offered
                  only where it will actually succeed. */}
              {item.sender === me && (
                <button
                  type="button"
                  onClick={() => {
                    setItems((current) =>
                      current.filter((m) => m.client_id !== item.client_id),
                    );
                    onUnfile(item as Message);
                  }}
                  className="ml-auto font-medium text-muted underline underline-offset-2 transition-colors hover:text-accent"
                >
                  Remove
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </PanelShell>
  );
}

/** The shortcode reference — the vocabulary, browsable in-app. */
export function EmojiGuidePanel({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();

  const groups = EMOJI_GROUPS.map((group) => ({
    ...group,
    entries: needle
      ? group.entries.filter(([name]) => name.includes(needle))
      : group.entries,
  })).filter((group) => group.entries.length > 0);

  return (
    <PanelShell
      title="Emoji shortcuts"
      subtitle={`Type :name: — ${EMOJI_COUNT} available`}
      onClose={onClose}
    >
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search shortcuts…"
        className="mb-4 w-full rounded-2xl border border-hairline bg-surface px-4 py-2.5 text-[0.9375rem] text-ink placeholder:text-faint focus:border-accent focus:outline-none"
      />

      {groups.length === 0 && <EmptyNote>Nothing matches that.</EmptyNote>}

      <div className="flex flex-col gap-6 pb-6">
        {groups.map((group) => (
          <section key={group.name}>
            <h3 className="mb-2 text-[0.6875rem] tracking-wider text-faint uppercase">
              {group.name}
            </h3>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3">
              {group.entries.map(([name, emoji]) => (
                <div
                  key={name}
                  className="flex items-center gap-2 rounded-lg px-1.5 py-1"
                >
                  <span className="text-base leading-none">{emoji}</span>
                  <code className="truncate font-mono text-[0.75rem] text-muted">
                    :{name}:
                  </code>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </PanelShell>
  );
}

export type { MessageKind };
