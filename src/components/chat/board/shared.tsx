"use client";

import { useState, type FormEvent } from "react";
import { ownerOf, type BoardItem } from "@/lib/chat/board";
import { whoClass } from "@/lib/chat/colors";
import type { UserId } from "@/lib/chat/types";

/**
 * Identity colouring.
 *
 * Bound to the person, never the viewer: each person's chosen colour (unique in
 * the dashboard) looks the same on everyone's screen. Each class string carries
 * `who-<colour>`, which sets the --who* variables on that element.
 */
export function ownerClasses(owner: UserId) {
  const who = whoClass(owner);
  return {
    solid: `${who} bg-who text-who-ink`,
    soft: `${who} bg-who-soft text-who`,
    text: `${who} text-who`,
    border: `${who} border-who`,
    note: `${who} bg-who-note`,
  };
}

export function itemClasses(item: BoardItem) {
  return ownerClasses(ownerOf(item));
}

/** Small "who touched this last" line. */
export function Attribution({
  item,
  names,
}: {
  item: BoardItem;
  names: Record<UserId, string>;
}) {
  const owner = ownerOf(item);
  const edited = item.updated_by !== null && item.updated_by !== item.author;

  return (
    <span className={`text-[0.625rem] ${itemClasses(item).text} opacity-80`}>
      {edited ? `edited by ${names[owner]}` : names[owner]}
    </span>
  );
}

/** The add-a-thing field used by every surface. */
export function AddField({
  placeholder,
  onAdd,
}: {
  placeholder: string;
  onAdd: (value: string) => void | Promise<void>;
}) {
  const [value, setValue] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    setValue("");
    await onAdd(trimmed);
  };

  return (
    <form onSubmit={submit} className="mb-4 flex gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 rounded-2xl border border-hairline bg-surface px-4 py-2.5 text-[0.9375rem] text-ink placeholder:text-faint focus:border-accent focus:outline-none"
      />
      <button
        type="submit"
        disabled={!value.trim()}
        title="Add"
        aria-label="Add"
        className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-accent text-accent-ink transition-all disabled:scale-90 disabled:opacity-0"
      >
        <svg width="17" height="17" viewBox="0 0 18 18" fill="none">
          <path
            d="M9 3.5v11M3.5 9h11"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </form>
  );
}

export function EmptyBoard({ children }: { children: React.ReactNode }) {
  return (
    <p className="animate-fade-in py-20 text-center font-serif text-[0.9375rem] text-faint italic">
      {children}
    </p>
  );
}

/** Checkbox with a springy tick. */
export function Check({
  done,
  owner,
  onToggle,
}: {
  done: boolean;
  owner: UserId;
  onToggle: () => void;
}) {
  const colors = ownerClasses(owner);

  return (
    <button
      type="button"
      onClick={onToggle}
      role="checkbox"
      aria-checked={done}
      title={done ? "Done — mark as not done" : "Mark as done"}
      aria-label={done ? "Done — mark as not done" : "Mark as done"}
      className={`mt-0.5 grid h-[1.15rem] w-[1.15rem] shrink-0 place-items-center rounded-md border-2 transition-colors ${
        done ? `${colors.solid} ${colors.border}` : "border-hairline bg-surface"
      }`}
    >
      {done && (
        <svg
          className="animate-check"
          width="11"
          height="11"
          viewBox="0 0 12 12"
          fill="none"
        >
          <path
            d="M2.5 6.3 4.8 8.5 9.5 3.6"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}

export function DeleteButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Delete"
      aria-label="Delete"
      className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-faint opacity-0 transition-all group-hover:opacity-100 hover:bg-accent-soft hover:text-accent focus-visible:opacity-100"
    >
      <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
        <path
          d="M3.5 3.5l7 7m0-7l-7 7"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}

/**
 * Stable pseudo-random tilt for a sticky note.
 *
 * Derived from the id so a note keeps its angle across renders and reloads — a
 * tilt that changed on every keystroke would be unbearable.
 */
export function tiltFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  const degrees = ((Math.abs(hash) % 500) / 100 - 2.5).toFixed(2);
  return `${degrees}deg`;
}
