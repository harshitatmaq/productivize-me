"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ownerClasses } from "./board/shared";
import { formatDayDivider, formatTime } from "@/lib/chat/time";
import type { MessageRow, UserId } from "@/lib/chat/types";

interface Props {
  supabase: SupabaseClient | null;
  names: Record<UserId, string>;
  /** Hides messages you have cleared, matching what the conversation shows. */
  clearedBefore: string | null;
  onJump: (message: MessageRow) => void;
  onClose: () => void;
}

const DEBOUNCE_MS = 250;
const LIMIT = 60;

/**
 * Full-text search over the conversation.
 *
 * Runs as `websearch_to_tsquery` against the generated `search_vector` column,
 * so quoted phrases and `-excluded` terms work the way they do in a search
 * engine rather than needing tsquery syntax.
 */
export default function SearchPanel({
  supabase,
  names,
  clearedBefore,
  onJump,
  onClose,
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MessageRow[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || !supabase) {
      setResults(null);
      setSearching(false);
      return;
    }

    setSearching(true);
    let cancelled = false;

    const timer = setTimeout(async () => {
      let request = supabase
        .from("messages")
        .select("*")
        .textSearch("search_vector", trimmed, {
          type: "websearch",
          config: "english",
        })
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(LIMIT);

      // Consistent with the conversation: what you cleared stays hidden.
      if (clearedBefore) request = request.gt("created_at", clearedBefore);

      const { data, error: searchError } = await request;
      if (cancelled) return;

      setError(searchError?.message ?? null);
      setResults((data ?? []) as MessageRow[]);
      setSearching(false);
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, supabase, clearedBefore]);

  const terms = useMemo(
    () =>
      query
        .toLowerCase()
        .replace(/["'-]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length > 1),
    [query],
  );

  return (
    <div className="animate-fade-in fixed inset-0 z-40 flex flex-col bg-bg">
      <header className="flex shrink-0 items-center gap-2 border-b border-hairline px-3 py-2.5 sm:px-4">
        <button
          type="button"
          onClick={onClose}
          title="Back to chat"
          aria-label="Back to chat"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-accent-soft hover:text-accent"
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

        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search messages…"
          className="min-w-0 flex-1 rounded-2xl border border-hairline bg-surface px-4 py-2 text-[0.9375rem] text-ink placeholder:text-faint focus:border-accent focus:outline-none"
        />
      </header>

      <div className="scroll-area min-h-0 flex-1 px-3 py-3 sm:px-4">
        <div className="mx-auto max-w-2xl">
          {error && (
            <p className="rounded-xl bg-accent-soft px-3 py-2 text-[0.8125rem] text-accent">
              {error}
            </p>
          )}

          {!query.trim() && (
            <Note>
              Search the whole conversation.
              <br />
              <span className="text-[0.75rem]">
                Quote a &ldquo;phrase&rdquo;, or exclude with -word.
              </span>
            </Note>
          )}

          {query.trim() && searching && results === null && (
            <Note>Searching…</Note>
          )}

          {results !== null && results.length === 0 && !searching && (
            <Note>Nothing matches that.</Note>
          )}

          {results !== null && results.length > 0 && (
            <>
              <p className="mb-2 text-[0.6875rem] tracking-wider text-faint uppercase">
                {results.length}
                {results.length === LIMIT ? "+" : ""} result
                {results.length === 1 ? "" : "s"}
              </p>

              <ul className="flex flex-col gap-1.5 pb-8">
                {results.map((message, index) => (
                  <li key={message.client_id}>
                    <button
                      type="button"
                      onClick={() => onJump(message)}
                      className="animate-slide-up w-full rounded-xl border border-hairline bg-surface px-3 py-2.5 text-left transition-colors hover:border-accent"
                      style={{
                        animationDelay: `${Math.min(index * 20, 200)}ms`,
                      }}
                    >
                      <div className="mb-1 flex items-center gap-2">
                        <span
                          aria-hidden
                          className={`h-1.5 w-1.5 rounded-full ${
                            ownerClasses(message.sender).solid
                          }`}
                        />
                        <span
                          className={`text-[0.6875rem] font-medium ${
                            ownerClasses(message.sender).text
                          }`}
                        >
                          {names[message.sender]}
                        </span>
                        <span className="ml-auto text-[0.6875rem] text-faint">
                          {formatDayDivider(message.created_at)}{" "}
                          {formatTime(message.created_at)}
                        </span>
                      </div>

                      <p className="line-clamp-3 font-serif text-[0.875rem] leading-snug text-ink">
                        <Highlighted text={message.body ?? ""} terms={terms} />
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Marks matched words so the reason a result matched is obvious at a glance. */
function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  if (terms.length === 0) return <>{text}</>;

  // Escaped so a term like "c++" cannot break the pattern.
  const pattern = new RegExp(
    `(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "gi",
  );

  return (
    <>
      {text.split(pattern).map((part, i) =>
        terms.some((t) => t === part.toLowerCase()) ? (
          <mark key={i} className="rounded bg-accent-soft px-0.5 text-accent">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-20 text-center font-serif text-[0.9375rem] text-faint italic">
      {children}
    </p>
  );
}
