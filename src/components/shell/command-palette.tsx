"use client";

import { Command } from "cmdk";
import { Dumbbell, HeartHandshake, Lightbulb, Moon, Plus, Scale, Search, Share2, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { useHotkey } from "@/lib/hooks";
import { useTasks } from "@/lib/queries/tasks";
import { openShare, shareNote } from "@/lib/share";
import { NAV } from "./nav";
import { useUi } from "./ui-store";

const item =
  "flex cursor-default select-none items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-fg-2 data-[selected=true]:bg-panel-hover data-[selected=true]:text-fg";

export function CommandPalette() {
  const { commandOpen, setCommandOpen, openQuickAdd, editTask } = useUi();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const { data: tasks = [] } = useTasks();
  const [q, setQ] = useState("");

  useHotkey("k", useCallback(() => setCommandOpen(!commandOpen), [commandOpen, setCommandOpen]), { meta: true });

  const go = (fn: () => void) => {
    setCommandOpen(false);
    setQ("");
    fn();
  };

  const matches = useMemo(() => {
    if (q.trim().length < 2) return [];
    const s = q.toLowerCase();
    return tasks.filter((t) => t.status === "todo" && t.title.toLowerCase().includes(s)).slice(0, 8);
  }, [q, tasks]);

  return (
    <Command.Dialog
      open={commandOpen}
      onOpenChange={setCommandOpen}
      label="Command menu"
      shouldFilter
      overlayClassName="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]"
      contentClassName="fixed left-1/2 top-[12vh] z-50 w-[min(94vw,580px)] -translate-x-1/2 overflow-hidden rounded-2xl border border-line-strong bg-panel shadow-pop animate-fade-in"
    >
      <div className="flex items-center gap-2.5 border-b border-line px-4">
        <Search className="h-4 w-4 text-faint" />
        <Command.Input
          value={q}
          onValueChange={setQ}
          placeholder="Search tasks, jump to a page, or run a command…"
          className="h-12 flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-faint"
        />
        <kbd className="kbd">esc</kbd>
      </div>
      <Command.List className="max-h-[56vh] overflow-y-auto p-1.5">
        <Command.Empty className="px-3 py-8 text-center text-[13px] text-muted">No results.</Command.Empty>
        {matches.length ? (
          <Command.Group heading="Tasks" className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:text-faint">
            {matches.map((t) => (
              <Command.Item key={t.id} value={`task ${t.title} ${t.id}`} className={item} onSelect={() => go(() => editTask(t))}>
                <span className="h-3.5 w-3.5 rounded-full border border-faint" />
                <span className="truncate">{t.title}</span>
                {t.due_date ? <span className="ml-auto text-[11px] text-faint">{t.due_date}</span> : null}
              </Command.Item>
            ))}
          </Command.Group>
        ) : null}
        <Command.Group heading="Actions" className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:text-faint">
          <Command.Item value="new task add create" className={item} onSelect={() => go(() => openQuickAdd({ text: q }))}>
            <Plus className="h-4 w-4 text-muted" /> New task
            <kbd className="kbd ml-auto">C</kbd>
          </Command.Item>
          <Command.Item value="log learning today" className={item} onSelect={() => go(() => router.push("/learning?new=1"))}>
            <Plus className="h-4 w-4 text-muted" /> Log today&apos;s learning
          </Command.Item>
          <Command.Item
            value={`share send note dashboard together ${q}`}
            className={item}
            onSelect={() => {
              const text = q.trim();
              go(() => (text ? openShare(shareNote(text)) : router.push("/together")));
            }}
          >
            <Share2 className="h-4 w-4 text-muted" />
            <span className="truncate">{q.trim() ? `Share “${q.trim()}” to a shared dashboard` : "Share a note to a shared dashboard…"}</span>
          </Command.Item>
          <Command.Item
            value={`interest add hobby skill ${q}`}
            className={item}
            onSelect={() => go(() => router.push(q.trim() ? `/interests?add=${encodeURIComponent(q.trim())}` : "/interests?add="))}
          >
            <Lightbulb className="h-4 w-4 text-muted" />
            <span className="truncate">{q.trim() ? `Add “${q.trim()}” to interests` : "Add an interest"}</span>
          </Command.Item>
          <Command.Item value="new shared dashboard invite together" className={item} onSelect={() => go(() => router.push("/together?new=1"))}>
            <HeartHandshake className="h-4 w-4 text-muted" /> New shared dashboard &amp; invite
          </Command.Item>
          <Command.Item value="log workout gym health push pull legs core" className={item} onSelect={() => go(() => router.push("/health"))}>
            <Dumbbell className="h-4 w-4 text-muted" /> Log today&apos;s workout
          </Command.Item>
          <Command.Item value="log weight body scale health" className={item} onSelect={() => go(() => router.push("/health?tab=weight"))}>
            <Scale className="h-4 w-4 text-muted" /> Log weight
          </Command.Item>
          <Command.Item value="planning preferences routine bedtime" className={item} onSelect={() => go(() => router.push("/settings#planning"))}>
            <Plus className="h-4 w-4 text-muted" /> Planning preferences (routines, bedtime)
          </Command.Item>
          <Command.Item value="new reminder" className={item} onSelect={() => go(() => router.push("/reminders?new=1"))}>
            <Plus className="h-4 w-4 text-muted" /> New reminder
          </Command.Item>
          <Command.Item
            value="toggle theme dark light"
            className={item}
            onSelect={() => go(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))}
          >
            {resolvedTheme === "dark" ? <Sun className="h-4 w-4 text-muted" /> : <Moon className="h-4 w-4 text-muted" />}
            Switch to {resolvedTheme === "dark" ? "light" : "dark"} theme
          </Command.Item>
        </Command.Group>
        <Command.Group heading="Go to" className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:text-faint">
          {NAV.map((n) => (
            <Command.Item key={n.href} value={`go ${n.label}`} className={item} onSelect={() => go(() => router.push(n.href))}>
              <n.icon className="h-4 w-4 text-muted" /> {n.label}
            </Command.Item>
          ))}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
