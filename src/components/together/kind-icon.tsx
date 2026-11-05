import { Briefcase, CheckSquare, GraduationCap, Layers, Lightbulb, Link2, StickyNote } from "lucide-react";
import type { ShareKind } from "@/lib/types";
import { cn } from "@/lib/utils";

export const KIND_NAMES: Record<ShareKind, string> = {
  task: "Task",
  job: "Job",
  learning: "Learning note",
  link: "Link",
  flashcards: "Flashcards",
  interest: "Interest",
  note: "Note",
};

const ICONS = { task: CheckSquare, job: Briefcase, learning: GraduationCap, link: Link2, flashcards: Layers, interest: Lightbulb, note: StickyNote };
const TONES: Record<ShareKind, string> = {
  task: "text-accent bg-accent/10",
  job: "text-success bg-success/10",
  learning: "text-warning bg-warning/10",
  link: "text-fg-2 bg-panel-hover",
  flashcards: "text-warning bg-warning/10",
  interest: "text-accent bg-accent/10",
  note: "text-fg-2 bg-panel-hover",
};

export function KindIcon({ kind, className }: { kind: ShareKind; className?: string }) {
  const Icon = ICONS[kind];
  return (
    <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", TONES[kind], className)} aria-hidden>
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}
