"use client";

import { useNow } from "@/lib/hooks";
import { useCallback, useEffect, useRef, useState } from "react";
import { snapshotLayout } from "@/lib/chat/boardLayout";

interface ProposalLine {
  text: string;
  label?: string;
}

type ProposalStatus =
  | "pending"
  | "working"
  | "done"
  | "cancelled"
  | "expired"
  | "error";

/**
 * Something the assistant wants to do that needs a yes or no.
 *
 * Nothing in it has run. `token` is what the Yes button hands back to the
 * server, which will only act on exactly what this card lists.
 */
interface Proposal {
  token: string;
  expiresAt: number;
  heading: string;
  deletes: ProposalLine[];
  creates: ProposalLine[];
  status: ProposalStatus;
  error?: string;
}

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  proposal?: Proposal;
}

interface Reminder {
  title: string;
  client_id: string;
}

interface AssistantReply {
  reply?: string;
  actions?: string[];
  problems?: string[];
  proposal?: Omit<Proposal, "status"> | null;
  reminders?: Reminder[];
  error?: string;
}

/** The person's own timezone, so "today" means their today and not the server's. */
function browserZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

function bullets(lines: string[]) {
  return lines.map((l) => `• ${l}`).join("\n");
}

/** Folds a reply and what it did into one message, plus its pending approval. */
function toMessage(id: number, data: AssistantReply): ChatMessage {
  let content = data.reply ?? "";
  if (data.actions?.length)
    content += `\n\n✅ *Done:*\n${bullets(data.actions)}`;
  if (data.problems?.length)
    content += `\n\n⚠️ *Couldn't do:*\n${bullets(data.problems)}`;

  return {
    id,
    role: "assistant",
    content: content.trim(),
    proposal: data.proposal
      ? { ...data.proposal, status: "pending" }
      : undefined,
  };
}

/**
 * Floating AI chatbot that has access to the entire workspace.
 *
 * It talks to `/api/chat`, which reads the board as the signed-in person and
 * carries out the safe changes. Anything that deletes comes back as an approval
 * card instead, and only runs when the Yes button is pressed.
 */
export default function AiChatbot({ spaceId }: { spaceId: string }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [hasCheckedReminders, setHasCheckedReminders] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);

  const newId = useCallback(() => nextId.current++, []);

  // Auto-scroll on new messages
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  const ask = useCallback(
    async (message: string, history: ChatMessage[]) => {
      const response = await fetch("/api/chat/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spaceId,
          message,
          history: history.map((m) => ({ role: m.role, content: m.content })),
          // How the boards look on this screen right now, so "row 3, column 2"
          // means the note you can see there.
          layout: snapshotLayout(),
          tz: browserZone(),
        }),
      });
      const data: AssistantReply = await response.json().catch(() => ({}));
      return { ok: response.ok, data };
    },
    [spaceId],
  );

  // Check for today's reminders when the chatbot is first opened.
  //
  // Asks the server for the rows only — no model call. The banner below already
  // lists them, and a model-written greeting here used up a large share of the
  // per-minute token budget before you had typed anything.
  useEffect(() => {
    if (!open || hasCheckedReminders) return;
    setHasCheckedReminders(true);

    (async () => {
      try {
        const response = await fetch("/api/chat/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            spaceId,
            remindersOnly: true,
            tz: browserZone(),
          }),
        });
        if (!response.ok) return;

        const data: AssistantReply = await response.json();
        if (data.reminders?.length) setReminders(data.reminders);
      } catch {
        // Silently fail
      }
    })();
  }, [open, hasCheckedReminders, spaceId]);

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    const userMsg: ChatMessage = {
      id: newId(),
      role: "user",
      content: trimmed,
    };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput("");
    setLoading(true);

    try {
      const { data } = await ask(trimmed, history);

      if (data.error) {
        setMessages((prev) => [
          ...prev,
          { id: newId(), role: "assistant", content: `⚠️ ${data.error}` },
        ]);
      } else {
        setMessages((prev) => [...prev, toMessage(newId(), data)]);
        if (data.reminders?.length) setReminders(data.reminders);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: newId(),
          role: "assistant",
          content: "⚠️ Couldn't reach the server. Please try again.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, messages, loading, ask, newId]);

  const patchProposal = useCallback((id: number, patch: Partial<Proposal>) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id && m.proposal
          ? { ...m, proposal: { ...m.proposal, ...patch } }
          : m,
      ),
    );
  }, []);

  const say = useCallback((content: string) => {
    setMessages((prev) => [
      ...prev,
      { id: nextId.current++, role: "assistant", content },
    ]);
  }, []);

  /**
   * The Yes / No buttons.
   *
   * No does nothing but record the decision — nothing was ever run, so there is
   * nothing to undo. Yes redeems the token on the server.
   */
  const decide = useCallback(
    async (id: number, token: string, approve: boolean) => {
      if (!approve) {
        patchProposal(id, { status: "cancelled" });
        say("Okay — I won't change anything.");
        return;
      }

      patchProposal(id, { status: "working", error: undefined });

      try {
        const response = await fetch("/api/chat/assistant/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, spaceId }),
        });
        const data: { done?: string[]; failed?: string[]; error?: string } =
          await response.json().catch(() => ({}));

        if (response.status === 410) {
          patchProposal(id, { status: "expired" });
          say("That request expired — ask me again if you still want it.");
          return;
        }

        const done = data.done ?? [];
        const failed = data.failed ?? [];

        // Nothing went through: leave the buttons so it can be tried again
        // (running it twice is safe — it will not duplicate anything).
        if (!response.ok || (done.length === 0 && failed.length > 0)) {
          patchProposal(id, {
            status: "error",
            error: data.error ?? failed[0] ?? "Something went wrong.",
          });
          return;
        }

        patchProposal(id, { status: "done" });
        say(
          `✅ *Done:*\n${bullets(done)}` +
            (failed.length > 0
              ? `\n\n⚠️ *Couldn't do:*\n${bullets(failed)}`
              : ""),
        );
      } catch {
        patchProposal(id, {
          status: "error",
          error: "Couldn't reach the server.",
        });
      }
    },
    [patchProposal, say, spaceId],
  );

  // Pulse the button when there are reminders
  const hasReminders = reminders.length > 0 && !open;

  return (
    <>
      {/* Floating toggle button */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={open ? "Close assistant" : "Open assistant"}
        aria-label={open ? "Close assistant" : "Open assistant"}
        className={`fixed right-4 bottom-[calc(9.5rem+env(safe-area-inset-bottom))] md:bottom-4 z-[60] grid h-14 w-14 place-items-center rounded-full shadow-lg transition-all hover:scale-105 active:scale-95 ${
          open ? "bg-ink/80 text-bg" : "bg-accent text-accent-ink"
        } ${hasReminders ? "animate-urgent" : ""}`}
      >
        {open ? (
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path
              d="M5 5l10 10M15 5L5 15"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 2C6.48 2 2 6.04 2 11c0 2.7 1.36 5.1 3.5 6.67V22l3.72-2.04c.92.24 1.84.38 2.78.38 5.52 0 10-4.04 10-9S17.52 2 12 2z"
              fill="currentColor"
            />
            <circle cx="8" cy="11" r="1.2" fill="var(--accent-ink)" />
            <circle cx="12" cy="11" r="1.2" fill="var(--accent-ink)" />
            <circle cx="16" cy="11" r="1.2" fill="var(--accent-ink)" />
          </svg>
        )}

        {/* Reminder badge */}
        {hasReminders && (
          <span className="absolute -top-1 -right-1 grid h-5 w-5 place-items-center rounded-full bg-urgent text-[0.625rem] font-bold text-white">
            {reminders.length}
          </span>
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="animate-slide-up fixed right-4 bottom-[calc(13.5rem+env(safe-area-inset-bottom))] md:bottom-20 z-[60] flex h-[min(30rem,calc(100dvh-18rem))] md:h-[30rem] w-[22rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-hairline bg-surface shadow-[var(--shadow)]">
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-hairline bg-accent px-4 py-3">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2C6.48 2 2 6.04 2 11c0 2.7 1.36 5.1 3.5 6.67V22l3.72-2.04c.92.24 1.84.38 2.78.38 5.52 0 10-4.04 10-9S17.52 2 12 2z"
                fill="currentColor"
                className="text-accent-ink"
              />
            </svg>
            <h3 className="flex-1 text-[0.875rem] font-semibold text-accent-ink">
              Workspace Assistant
            </h3>
            <span className="rounded-full bg-on-bubble-strong px-2 py-0.5 text-[0.625rem] text-accent-ink">
              AI
            </span>
          </div>

          {/* Reminders banner */}
          {reminders.length > 0 && (
            <div className="border-b border-hairline bg-accent-soft px-3 py-2">
              <p className="mb-1 text-[0.6875rem] font-semibold tracking-wider text-accent uppercase">
                🔔 Today&apos;s Reminders
              </p>
              {reminders.map((r) => (
                <p key={r.client_id} className="text-[0.8125rem] text-ink">
                  • {r.title}
                </p>
              ))}
            </div>
          )}

          {/* Messages */}
          <div ref={scrollRef} className="scroll-area flex-1 space-y-3 p-3">
            {messages.length === 0 && !loading && (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <span className="text-3xl">🤖</span>
                <p className="text-[0.8125rem] text-muted">
                  I can help manage your workspace!
                </p>
                <p className="text-[0.75rem] text-faint">
                  Try: &quot;Split the note in row 2, column 1 into one note per
                  point&quot;
                </p>
              </div>
            )}

            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col gap-2 ${
                  msg.role === "user" ? "items-end" : "items-start"
                }`}
              >
                {msg.content && (
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-[0.8125rem] leading-relaxed ${
                      msg.role === "user"
                        ? "bg-accent text-accent-ink"
                        : "border border-hairline bg-surface text-ink"
                    }`}
                  >
                    <ChatContent text={msg.content} />
                  </div>
                )}

                {msg.proposal && (
                  <ApprovalCard
                    proposal={msg.proposal}
                    onDecide={(approve) =>
                      void decide(msg.id, msg.proposal!.token, approve)
                    }
                  />
                )}
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="flex gap-1 rounded-2xl border border-hairline bg-surface px-4 py-3">
                  {[0, 200, 400].map((delay) => (
                    <span
                      key={delay}
                      className="h-2 w-2 rounded-full bg-faint"
                      style={{
                        animation: "pulse-dot 1.2s infinite",
                        animationDelay: `${delay}ms`,
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-hairline p-2">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendMessage();
                  }
                }}
                placeholder="Ask me anything…"
                disabled={loading}
                className="min-w-0 flex-1 rounded-xl border border-hairline bg-bg px-3 py-2 text-[0.8125rem] text-ink placeholder:text-faint focus:border-accent focus:outline-none disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => void sendMessage()}
                disabled={!input.trim() || loading}
                title="Send"
                aria-label="Send"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent text-accent-ink transition-all disabled:scale-90 disabled:opacity-50"
              >
                <svg width="15" height="15" viewBox="0 0 18 18" fill="none">
                  <path d="M3 15l12-6L3 3v5l8 1-8 1v5z" fill="currentColor" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * The yes / no prompt for a deletion.
 *
 * What it lists comes from the stored rows on the server rather than from the
 * model's own wording, and it states plainly that nothing has changed yet.
 */
function ApprovalCard({
  proposal,
  onDecide,
}: {
  proposal: Proposal;
  onDecide: (approve: boolean) => void;
}) {
  const { heading, deletes, creates, status, error } = proposal;
  const now = useNow(15_000);
  const expired =
    status === "expired" || (status === "pending" && now > proposal.expiresAt);
  const settled = status === "done" || status === "cancelled" || expired;
  const working = status === "working";
  const onlyDeletes = creates.length === 0;

  return (
    <div
      role="group"
      aria-label={heading}
      className="animate-pop w-full max-w-[95%] rounded-2xl border border-urgent/40 bg-urgent-soft p-3"
    >
      <p className="text-[0.8125rem] font-semibold text-ink">{heading}</p>

      {deletes.length > 0 && (
        <section className="mt-2">
          <p className="text-[0.625rem] font-semibold tracking-wider text-urgent uppercase">
            Will be deleted
          </p>
          <ul className="mt-1 space-y-1">
            {deletes.map((line, i) => (
              <ProposalRow key={i} line={line} tone="delete" />
            ))}
          </ul>
        </section>
      )}

      {creates.length > 0 && (
        <section className="mt-2">
          <p className="text-[0.625rem] font-semibold tracking-wider text-accent uppercase">
            Will be added
          </p>
          <ul className="mt-1 space-y-1">
            {creates.map((line, i) => (
              <ProposalRow key={i} line={line} tone="add" />
            ))}
          </ul>
        </section>
      )}

      {settled ? (
        <p className="mt-3 text-[0.75rem] text-muted">
          {status === "done"
            ? "✓ Approved"
            : status === "cancelled"
              ? "Cancelled — nothing was changed."
              : "Expired — ask me again."}
        </p>
      ) : (
        <>
          <p className="mt-3 text-[0.6875rem] text-muted">
            Nothing changes until you approve.
          </p>

          {status === "error" && error && (
            <p role="alert" className="mt-1 text-[0.75rem] text-urgent">
              {error}
            </p>
          )}

          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => onDecide(true)}
              disabled={working}
              className="h-9 flex-1 rounded-xl bg-urgent px-3 text-[0.8125rem] font-semibold text-white transition-all hover:opacity-90 active:scale-95 disabled:opacity-60"
            >
              {working
                ? "Working…"
                : status === "error"
                  ? "Try again"
                  : onlyDeletes
                    ? "Yes, delete"
                    : "Yes, apply"}
            </button>
            <button
              type="button"
              onClick={() => onDecide(false)}
              disabled={working}
              className="h-9 flex-1 rounded-xl border border-hairline bg-surface px-3 text-[0.8125rem] font-medium text-ink transition-all hover:border-accent active:scale-95 disabled:opacity-60"
            >
              No, cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ProposalRow({
  line,
  tone,
}: {
  line: ProposalLine;
  tone: "delete" | "add";
}) {
  return (
    <li
      className={`border-l-2 pl-2 text-[0.75rem] leading-snug text-ink ${
        tone === "delete" ? "border-urgent" : "border-accent"
      }`}
    >
      {line.label && (
        <span className="mr-1.5 rounded bg-surface px-1 py-px font-mono text-[0.625rem] text-muted">
          {line.label}
        </span>
      )}
      <span className="line-clamp-3 break-words">{line.text}</span>
    </li>
  );
}

/** *bold* and **bold**, as elements — never as markup. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
          return <strong key={i}>{part.slice(1, -1)}</strong>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

/**
 * Light formatting for chat messages: bold, line breaks and bullets.
 *
 * Built from React elements on purpose. The text here comes from a language
 * model and can quote your own notes back, so treating it as HTML would let a
 * note containing markup run in your browser.
 */
function ChatContent({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => {
        const trimmed = line.trim();
        if (trimmed === "") return <br key={i} />;

        const bullet = trimmed.startsWith("• ") || trimmed.startsWith("- ");
        return (
          <p key={i} className={bullet ? "ml-2" : undefined}>
            <Inline text={trimmed} />
          </p>
        );
      })}
    </>
  );
}
