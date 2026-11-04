"use client";

import { addDays, startOfWeek } from "@/lib/time";
import { Tip } from "@/components/ui/menu";

export function Heatmap({ counts, today, weeks = 20, weekStartsOn = 1 }: { counts: Map<string, number>; today: string; weeks?: number; weekStartsOn?: number }) {
  const start = addDays(startOfWeek(today, weekStartsOn), -(weeks - 1) * 7);
  const cols = Array.from({ length: weeks }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)));
  const level = (n: number) => (n === 0 ? 0 : n === 1 ? 1 : n === 2 ? 2 : 3);
  const bg = ["var(--panel-2)", "color-mix(in srgb, var(--accent) 35%, transparent)", "color-mix(in srgb, var(--accent) 65%, transparent)", "var(--accent)"];
  const months: { idx: number; label: string }[] = [];
  cols.forEach((c, i) => {
    const firstOfMonth = c.find((d) => d.endsWith("-01"));
    if (firstOfMonth) months.push({ idx: i, label: new Date(`${firstOfMonth}T12:00:00`).toLocaleDateString(undefined, { month: "short" }) });
  });
  // Label the first column too, unless a month label follows too closely to fit.
  if (!months.length || months[0].idx >= 3) {
    months.unshift({ idx: 0, label: new Date(`${cols[0][0]}T12:00:00`).toLocaleDateString(undefined, { month: "short" }) });
  }
  return (
    <div className="overflow-x-auto no-scrollbar">
      <div className="inline-block">
        <div className="relative mb-1 h-4 text-[10.5px] text-faint">
          {months.map((m) => (
            <span key={m.idx} className="absolute" style={{ left: m.idx * 15 }}>
              {m.label}
            </span>
          ))}
        </div>
        <div className="flex gap-[3px]">
          {cols.map((c, i) => (
            <div key={i} className="flex flex-col gap-[3px]">
              {c.map((d) => {
                const n = counts.get(d) ?? 0;
                const future = d > today;
                return (
                  <Tip key={d} content={`${new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} · ${n} entr${n === 1 ? "y" : "ies"}`}>
                    <span
                      className="block h-3 w-3 rounded-[3px] transition-colors"
                      style={{ background: future ? "transparent" : bg[level(n)], outline: d === today ? "1px solid var(--accent)" : undefined }}
                    />
                  </Tip>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
