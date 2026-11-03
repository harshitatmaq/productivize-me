"use client";

import { Check, Timer, X } from "lucide-react";
import { useEffect } from "react";
import { ProgressRing } from "@/components/ui/misc";
import { useNow } from "@/lib/hooks";
import { useFocus } from "./focus-store";

const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(sec).padStart(2, "0")}`;
};

/** Floating timer shown while a focus session runs. */
export function FocusPill() {
  const { run, finish, cancel } = useFocus();
  const now = useNow(1000);
  const elapsed = run ? now - run.startedAt : 0;
  const target = run?.targetMin ? run.targetMin * 60_000 : null;
  const done = !!target && elapsed >= target;

  useEffect(() => {
    if (run && done) finish({ auto: true });
  }, [run, done, finish]);

  useEffect(() => {
    if (!run) return;
    const prev = document.title;
    document.title = `${target ? mmss(target - elapsed) : mmss(elapsed)} · ${run.title}`;
    return () => {
      document.title = prev;
    };
  });

  if (!run) return null;
  return (
    <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+76px)] left-4 z-40 flex max-w-[calc(100vw-96px)] items-center gap-2.5 rounded-2xl border border-line-strong bg-panel/95 py-1.5 pl-2 pr-1.5 shadow-pop backdrop-blur animate-fade-in md:bottom-5 md:left-[252px]">
      <ProgressRing value={target ? elapsed / target : (elapsed % 3_600_000) / 3_600_000} size={30} stroke={3}>
        <Timer className="h-3 w-3 text-accent" />
      </ProgressRing>
      <div className="min-w-0">
        <div className="font-mono text-[13px] font-semibold tabular-nums text-fg">{target ? mmss(target - elapsed) : mmss(elapsed)}</div>
        <div className="max-w-[180px] truncate text-[11px] text-muted">{run.title}</div>
      </div>
      <button onClick={() => finish()} className="ml-1 rounded-lg p-1.5 text-success hover:bg-success/10" title="Finish & log time" aria-label="Finish focus session">
        <Check className="h-4 w-4" />
      </button>
      <button onClick={cancel} className="rounded-lg p-1.5 text-faint hover:bg-panel-hover hover:text-fg" title="Discard" aria-label="Discard focus session">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
