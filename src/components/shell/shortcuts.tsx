"use client";

import { Keyboard } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import {
  DIALOG_SHORTCUTS,
  dialogOpen,
  GLOBAL_SHORTCUTS,
  GO_TO,
  isTyping,
  keyLabel,
  pageShortcutGroups,
  usePageShortcutGroups,
  useIsMac,
  WRITING_SHORTCUTS,
  type Shortcut,
} from "@/lib/shortcuts";
import { NAV } from "./nav";
import { useUi } from "./ui-store";

function Keys({ keys, mac }: { keys: string[]; mac: boolean }) {
  return (
    <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
      {keys.map((k, i) =>
        k.startsWith("then") ? (
          <span key={i} className="text-[11px] text-faint">
            {k}
          </span>
        ) : (
          <kbd key={i} className="kbd">
            {keyLabel(k, mac)}
          </kbd>
        ),
      )}
    </span>
  );
}

function Section({ title, items, mac }: { title: string; items: Shortcut[]; mac: boolean }) {
  if (!items.length) return null;
  return (
    <section>
      <h4 className="mb-1.5 text-[11.5px] font-medium uppercase tracking-wide text-muted">{title}</h4>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {items.map((s, i) => (
          <li key={i} className="flex items-center justify-between gap-3 px-3 py-1.5 text-[13px] text-fg-2">
            <span className="min-w-0">{s.label}</span>
            <Keys keys={s.keys} mac={mac} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Global keyboard handling: Ctrl/⌘+/ (or ?) shows every shortcut, "G then a letter" jumps
 * to a page, and single-key shortcuts registered by the current page run here.
 */
export function Shortcuts() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const mac = useIsMac();
  const groups = usePageShortcutGroups();
  const goPending = useRef(0);
  const { openQuickAdd } = useUi();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return;
      const mod = e.ctrlKey || e.metaKey;
      const slash = e.key === "/" || e.code === "Slash";
      // Ctrl/⌘+/ or ? : the shortcut sheet (not while writing in a field or with a dialog open).
      if ((mod && slash && !e.altKey) || (e.key === "?" && !mod && !e.altKey)) {
        if (isTyping(e.target)) return;
        if (dialogOpen() && !open) return;
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (mod || e.altKey || isTyping(e.target) || dialogOpen()) return;
      const key = e.key.toLowerCase();
      // G then a letter: go to a page.
      if (Date.now() - goPending.current < 1500) {
        goPending.current = 0;
        const target = GO_TO.find((g) => g.key === key);
        if (target) {
          e.preventDefault();
          router.push(target.href);
        }
        return;
      }
      if (key === "g" && !e.shiftKey) {
        goPending.current = Date.now();
        return;
      }
      if (e.shiftKey) return;
      if (key === "c") {
        e.preventDefault();
        openQuickAdd();
        return;
      }
      for (const g of pageShortcutGroups()) {
        const hit = g.items.find((s) => s.key === key && s.run);
        if (hit) {
          e.preventDefault();
          hit.run!();
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, open, openQuickAdd]);

  const page = NAV.find((n) => (n.href === "/" ? pathname === "/" : pathname.startsWith(n.href)));
  const pageItems: Shortcut[] = groups.flatMap((g) => g.items.map((s) => ({ keys: s.keys ?? (s.key ? [s.key.toUpperCase()] : []), label: s.label })));

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      size="lg"
      title={
        <span className="inline-flex items-center gap-2">
          <Keyboard className="h-4 w-4 text-accent" /> Keyboard shortcuts
        </span>
      }
      description="Single-key shortcuts work when you're not typing in a field."
    >
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-5">
          <Section title={page ? `On ${page.label}` : "On this page"} items={pageItems.length ? pageItems : [{ keys: [], label: "No shortcuts specific to this page" }]} mac={mac} />
          <Section title="Everywhere" items={GLOBAL_SHORTCUTS} mac={mac} />
          <Section title="Go to (press G, then…)" items={GO_TO.map((g) => ({ keys: [g.key.toUpperCase()], label: g.label }))} mac={mac} />
        </div>
        <div className="space-y-5">
          <Section title="Writing (notes, learning entries, flashcards)" items={WRITING_SHORTCUTS} mac={mac} />
          <Section title="In dialogs" items={DIALOG_SHORTCUTS} mac={mac} />
        </div>
      </div>
    </Dialog>
  );
}
