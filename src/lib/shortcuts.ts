"use client";

/**
 * Keyboard shortcuts: the global list, writing shortcuts, and shortcuts each page
 * registers while it's on screen (so the Ctrl+/ sheet always shows what works here).
 */
import { useEffect, useRef, useSyncExternalStore } from "react";

export type Shortcut = { keys: string[]; label: string };
/** A page shortcut: a single key (no modifiers) that runs `run`; without `run` it's only listed. */
export type PageShortcut = { key?: string; keys?: string[]; label: string; run?: () => void };

/** "G then T" style navigation. */
export const GO_TO: { key: string; href: string; label: string }[] = [
  { key: "t", href: "/", label: "Today" },
  { key: "u", href: "/upcoming", label: "Upcoming" },
  { key: "c", href: "/calendar", label: "Calendar" },
  { key: "h", href: "/habits", label: "Habits" },
  { key: "r", href: "/reminders", label: "Reminders" },
  { key: "j", href: "/jobs", label: "Jobs" },
  { key: "l", href: "/learning", label: "Learning" },
  { key: "e", href: "/health", label: "Health" },
  { key: "i", href: "/interests", label: "Interests" },
  { key: "p", href: "/portfolio", label: "Portfolio" },
  { key: "o", href: "/together", label: "Together" },
  { key: "s", href: "/settings", label: "Settings" },
];

export const GLOBAL_SHORTCUTS: Shortcut[] = [
  { keys: ["Mod", "K"], label: "Command menu: search tasks, jump to a page" },
  { keys: ["C"], label: "New task" },
  { keys: ["G", "then a letter"], label: "Go to a page (see below)" },
  { keys: ["Mod", "/"], label: "Show these shortcuts (also ?)" },
];

export const WRITING_SHORTCUTS: Shortcut[] = [
  { keys: ["Mod", "B"], label: "Bold" },
  { keys: ["Mod", "I"], label: "Italic" },
  { keys: ["Mod", "E"], label: "Inline code" },
  { keys: ["Mod", "K"], label: "Link" },
  { keys: ["Mod", "Shift", "X"], label: "Strikethrough" },
  { keys: ["Mod", "Shift", "8"], label: "Bulleted list" },
  { keys: ["Mod", "Shift", "7"], label: "Numbered list" },
  { keys: ["Mod", "Shift", "9"], label: "Checklist" },
  { keys: ["Mod", "Shift", "."], label: "Quote" },
  { keys: ["Mod", "Alt", "1–3"], label: "Heading 1–3" },
  { keys: ["Enter"], label: "Next list item (on an empty item: end the list)" },
  { keys: ["Tab"], label: "Indent list item (Shift+Tab: outdent)" },
  { keys: ["Mod", "Z"], label: "Undo (formatting included)" },
];

export const DIALOG_SHORTCUTS: Shortcut[] = [
  { keys: ["Mod", "Enter"], label: "Save" },
  { keys: ["Esc"], label: "Close" },
];

type Group = { id: string; title: string; items: PageShortcut[] };
let groups: Group[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Registers shortcuts for as long as the calling component is mounted (handlers always see the latest state). */
export function usePageShortcuts(id: string, title: string, items: PageShortcut[]) {
  const latest = useRef(items);
  useEffect(() => {
    latest.current = items;
  });
  const signature = items.map((i) => `${i.key ?? ""}:${(i.keys ?? []).join("+")}:${i.label}:${i.run ? 1 : 0}`).join("|");
  useEffect(() => {
    const stable = latest.current.map((it, idx) => ({ ...it, run: it.run ? () => latest.current[idx]?.run?.() : undefined }));
    groups = [...groups.filter((g) => g.id !== id), { id, title, items: stable }];
    emit();
    return () => {
      groups = groups.filter((g) => g.id !== id);
      emit();
    };
  }, [id, title, signature]);
}

export function pageShortcutGroups(): Group[] {
  return groups;
}

export function usePageShortcutGroups(): Group[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => groups,
    () => groups,
  );
}

/** ⌘ on Apple devices, Ctrl elsewhere. */
export function useIsMac(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent),
    () => false,
  );
}

export function keyLabel(k: string, mac: boolean): string {
  if (k === "Mod") return mac ? "⌘" : "Ctrl";
  if (k === "Alt") return mac ? "⌥" : "Alt";
  if (k === "Shift") return mac ? "⇧" : "Shift";
  return k;
}

/** Is the user typing in a field (where single-key shortcuts must not fire)? */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

/** Is a dialog / menu open (where page shortcuts must not fire)? */
export function dialogOpen(): boolean {
  return !!document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]');
}
