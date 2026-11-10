"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import CameraCapture from "./CameraCapture";
import { expandEmojiAtCursor } from "@/lib/chat/emoji";
import {
  EVERYONE_ALIAS,
  mentionToken,
  parseMentions,
} from "@/lib/chat/mentions";
import { parseMessage } from "@/lib/chat/parse";
import { type Message, type UserId } from "@/lib/chat/types";

interface Props {
  onSendText: (body: string) => void | Promise<void>;
  onSendImage: (file: File) => void | Promise<void>;
  onTyping: () => void;
  /** The message being answered, if any. */
  replyTo: Message | null;
  names: Record<UserId, string>;
  onCancelReply: () => void;
}

/** Roughly six lines before the textarea starts scrolling instead of growing. */
const MAX_HEIGHT_PX = 150;

export default function Composer({
  onSendText,
  onSendImage,
  onTyping,
  replyTo,
  names,
  onCancelReply,
}: Props) {
  const [value, setValue] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  /** Caret offset of the `@` currently being typed, or null. */
  const [mentionAt, setMentionAt] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraFileRef = useRef<HTMLInputElement>(null);
  const pendingCaretRef = useRef<number | null>(null);

  // Choosing to reply should put the caret where you are about to type. On
  // touch this also raises the keyboard, which is the whole point of the
  // gesture.
  useEffect(() => {
    if (replyTo) textareaRef.current?.focus();
  }, [replyTo]);

  /**
   * Hands the job to the OS when the browser will not open a stream itself.
   *
   * On a phone `capture` goes straight to the camera app, which is the same
   * outcome by a different route. On a laptop it is an ordinary file picker —
   * not ideal, but better than a dead button.
   */
  const onCameraUnavailable = useCallback(() => {
    setCameraOpen(false);
    cameraFileRef.current?.click();
  }, []);

  // Applied before paint so the caret never visibly jumps after an expansion.
  useLayoutEffect(() => {
    const caret = pendingCaretRef.current;
    if (caret === null) return;
    pendingCaretRef.current = null;
    textareaRef.current?.setSelectionRange(caret, caret);
  }, [value]);

  // `field-sizing: content` would do this natively but is not yet in Safari or
  // Firefox, and the composer is too central to leave to progressive support.
  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, []);

  const send = useCallback(async () => {
    const body = value.trim();
    if (!body) return;

    // Clear first so the field is ready for the next thought immediately; the
    // outbox has already taken ownership of delivery by the time this resolves.
    setValue("");
    setMentionAt(null);
    requestAnimationFrame(resize);
    await onSendText(body);
  }, [value, onSendText, resize]);

  /**
   * Finds an in-progress `@…` immediately behind the caret.
   *
   * Anchored to a word boundary so an email address never opens the picker,
   * and abandoned as soon as a space is typed — at which point whatever was
   * written either matched a name or did not.
   */
  const detectMention = (text: string, caret: number) => {
    const before = text.slice(0, caret);
    const match = /(?:^|\s)@([\p{L}\p{N}_]*)$/u.exec(before);
    setMentionAt(match ? caret - match[1].length - 1 : null);
  };

  const insertMention = (name: string) => {
    if (mentionAt === null) return;

    const el = textareaRef.current;
    const caret = el?.selectionStart ?? value.length;
    const token = `@${name} `;
    const next = value.slice(0, mentionAt) + token + value.slice(caret);

    setValue(next);
    setMentionAt(null);
    pendingCaretRef.current = mentionAt + token.length;
    requestAnimationFrame(() => {
      resize();
      el?.focus();
    });
  };

  const onChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const raw = event.target.value;
    const caret = event.target.selectionStart ?? raw.length;

    // Expand `:name:` the instant the closing colon lands, scoped to the caret
    // so nothing earlier in the line is rewritten under the typist.
    const expanded = expandEmojiAtCursor(raw, caret);
    setValue(expanded.text);

    if (expanded.text !== raw) {
      // React restores the caret to its own idea of position after a controlled
      // update, so the corrected offset has to be reapplied post-commit.
      pendingCaretRef.current = expanded.cursor;
    }

    detectMention(expanded.text, expanded.cursor);
    resize();
    if (expanded.text.trim()) onTyping();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionAt !== null) {
      if (event.key === "Escape") {
        event.preventDefault();
        setMentionAt(null);
        return;
      }
      // Enter completes the mention rather than sending a half-typed one.
      if (event.key === "Enter" && !event.shiftKey && candidates.length > 0) {
        event.preventDefault();
        insertMention(candidates[0].token);
        return;
      }
    }

    // Enter sends; Shift+Enter breaks the line. On touch keyboards Enter should
    // always insert a newline, since there is a dedicated send button there.
    if (event.key !== "Enter" || event.shiftKey) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    event.preventDefault();
    void send();
  };

  const onPickFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // Allow re-picking the same file.
    if (file) await onSendImage(file);
  };

  const onPaste = async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const image = Array.from(event.clipboardData.files).find((f) =>
      f.type.startsWith("image/"),
    );
    if (!image) return;
    event.preventDefault();
    await onSendImage(image);
  };

  /** Who the in-progress `@…` could still be referring to. */
  const candidates = useMemo(() => {
    if (mentionAt === null) return [];

    const typed = value
      .slice(mentionAt + 1)
      .split(/\s/)[0]
      .toLowerCase();
    const people = Object.keys(names).map((id) => ({
      id,
      label: names[id],
      token: mentionToken(names[id]),
    }));

    return [
      ...people,
      {
        id: null,
        label: Object.keys(names).length > 2 ? "Everyone" : "Both of us",
        token: EVERYONE_ALIAS,
      },
    ].filter((c) => c.token.toLowerCase().startsWith(typed));
  }, [mentionAt, value, names]);

  const canSend = value.trim().length > 0;
  /** Warns before sending that this one will interrupt them. */
  const willPing = parseMentions(value, names).length > 0;
  // Shows where a `save:` / `work:` message is about to be filed, so the
  // prefixes are discoverable instead of being invisible magic.
  const pendingKind = parseMessage(value).kind;

  return (
    <div
      className="shrink-0 border-t border-hairline bg-bg/85 px-3 pt-2.5 backdrop-blur-md sm:px-4"
      style={{ paddingBottom: "calc(0.625rem + env(safe-area-inset-bottom))" }}
    >
      {mentionAt !== null && candidates.length > 0 && (
        <div className="animate-slide-up mx-auto mb-2 flex max-w-2xl flex-wrap gap-1.5">
          {candidates.map((candidate) => (
            <button
              key={candidate.token}
              type="button"
              onMouseDown={(e) => {
                // Keeps focus in the textarea, so the caret survives the click.
                e.preventDefault();
                insertMention(candidate.token);
              }}
              className="flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-2.5 py-1 text-[0.8125rem] text-ink transition-colors hover:border-urgent hover:text-urgent"
            >
              <span aria-hidden className="text-[0.6875rem]">
                @
              </span>
              {candidate.label}
            </button>
          ))}
        </div>
      )}

      {willPing && (
        <div className="animate-fade-in mx-auto mb-1.5 flex max-w-2xl">
          <span className="flex items-center gap-1 rounded-full bg-urgent-soft px-2.5 py-1 text-[0.6875rem] font-medium tracking-wide text-urgent uppercase">
            <span aria-hidden>🔔</span> Sends an urgent ping
          </span>
        </div>
      )}

      {replyTo && (
        <div className="animate-slide-up mx-auto mb-2 flex max-w-2xl items-center gap-2 rounded-xl border-l-[3px] border-accent bg-accent-soft/60 px-2.5 py-1.5">
          <div className="min-w-0 flex-1">
            <p className="text-[0.6875rem] font-medium text-accent">
              Replying to {names[replyTo.sender]}
            </p>
            <p className="truncate font-serif text-[0.8125rem] text-muted">
              {replyTo.body?.trim() ||
                (replyTo.image_path || replyTo.localImageUrl ? "Photo" : "")}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            title="Cancel reply"
            aria-label="Cancel reply"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted transition-colors hover:text-accent"
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
              <path
                d="M3.5 3.5l7 7m0-7l-7 7"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      )}

      {pendingKind !== "normal" && (
        <div className="animate-fade-in mx-auto mb-1.5 flex max-w-2xl">
          <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[0.6875rem] font-medium tracking-wide text-accent uppercase">
            {pendingKind === "saved" ? "Filing to Saved" : "Filing to Work"}
          </span>
        </div>
      )}

      <div className="mx-auto flex max-w-2xl items-end gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          title="Send a photo"
          aria-label="Send a photo"
          className="mb-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-accent-soft hover:text-accent"
        >
          <svg width="19" height="19" viewBox="0 0 20 20" fill="none">
            <rect
              x="2.6"
              y="3.6"
              width="14.8"
              height="12.8"
              rx="2.6"
              stroke="currentColor"
              strokeWidth="1.4"
            />
            <circle
              cx="7.4"
              cy="8"
              r="1.5"
              stroke="currentColor"
              strokeWidth="1.4"
            />
            <path
              d="M3.4 13.4 7 10.2l3.2 2.8 2.6-2.2 3.6 3"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <button
          type="button"
          onClick={() => setCameraOpen(true)}
          title="Take a photo"
          aria-label="Take a photo"
          className="mb-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-accent-soft hover:text-accent"
        >
          <svg width="19" height="19" viewBox="0 0 20 20" fill="none">
            <path
              d="M2.6 6.9a1.8 1.8 0 0 1 1.8-1.8h1.3l.9-1.6h6.8l.9 1.6h1.3a1.8 1.8 0 0 1 1.8 1.8v7a1.8 1.8 0 0 1-1.8 1.8H4.4a1.8 1.8 0 0 1-1.8-1.8v-7Z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <circle
              cx="10"
              cy="10.4"
              r="2.9"
              stroke="currentColor"
              strokeWidth="1.4"
            />
          </svg>
        </button>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={onPickFile}
          className="hidden"
        />

        {/* Only ever reached when getUserMedia is refused or absent. */}
        <input
          ref={cameraFileRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onPickFile}
          className="hidden"
        />

        <label htmlFor="composer" className="sr-only">
          Message
        </label>
        <textarea
          id="composer"
          ref={textareaRef}
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          rows={1}
          placeholder="Message…"
          className="scroll-area max-h-[150px] min-h-[2.5rem] flex-1 resize-none rounded-[20px] border border-hairline bg-surface px-4 py-2.5 font-serif text-[0.9688rem] leading-[1.4] text-ink placeholder:font-sans placeholder:text-faint focus:border-accent focus:outline-none"
        />

        <button
          type="button"
          onClick={() => void send()}
          disabled={!canSend}
          title="Send"
          aria-label="Send"
          className="mb-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-accent-ink transition-all disabled:scale-90 disabled:opacity-0"
        >
          <svg width="17" height="17" viewBox="0 0 18 18" fill="none">
            <path
              d="M9 15V3.6M9 3.6 4.4 8.2M9 3.6l4.6 4.6"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {cameraOpen && (
        <CameraCapture
          onCapture={onSendImage}
          onClose={() => setCameraOpen(false)}
          onUnavailable={onCameraUnavailable}
        />
      )}
    </div>
  );
}
