"use client";

import { useMemo, useState } from "react";

type Pt = { date: string; value: number };
export type Series = { name: string; points: Pt[]; color: string; dashed?: boolean; dots?: boolean; width?: number };

const W = 640;
const H = 200;
const PAD = { l: 44, r: 12, t: 12, b: 26 };

const t = (d: string) => new Date(`${d}T12:00:00`).getTime();
const short = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const start = Math.floor(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 0.001; v += step) out.push(Math.round(v * 100) / 100);
  if (out[out.length - 1] < max) out.push(Math.round((out[out.length - 1] + step) * 100) / 100);
  return out;
}

/** Time-scaled line chart in theme colours, with a hover readout. */
export function LineChart({ series, unit, height = H, goal }: { series: Series[]; unit?: string; height?: number; goal?: number | null }) {
  const [hover, setHover] = useState<number | null>(null);
  const all = series.flatMap((s) => s.points);
  const geo = useMemo(() => {
    if (!all.length) return null;
    const xs = all.map((p) => t(p.date));
    const values = [...all.map((p) => p.value), ...(goal ? [goal] : [])];
    const ticks = niceTicks(Math.min(...values), Math.max(...values));
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs) === x0 ? x0 + 86_400_000 : Math.max(...xs);
    const y0 = ticks[0];
    const y1 = ticks[ticks.length - 1];
    const sx = (d: string) => PAD.l + ((t(d) - x0) / (x1 - x0)) * (W - PAD.l - PAD.r);
    const sy = (v: number) => height - PAD.b - ((v - y0) / (y1 - y0 || 1)) * (height - PAD.t - PAD.b);
    return { sx, sy, ticks, x0, x1 };
  }, [all, goal, height]);

  if (!geo) return <div className="flex h-[120px] items-center justify-center rounded-lg border border-dashed border-line text-[12.5px] text-muted">No data yet</div>;
  const main = series[0];
  const hovered = hover !== null ? main.points[hover] : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="h-auto w-full touch-none select-none"
        role="img"
        aria-label={`${main.name} chart`}
        onPointerMove={(e) => {
          const box = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const x = ((e.clientX - box.left) / box.width) * W;
          let best = 0;
          main.points.forEach((p, i) => {
            if (Math.abs(geo.sx(p.date) - x) < Math.abs(geo.sx(main.points[best].date) - x)) best = i;
          });
          setHover(best);
        }}
        onPointerLeave={() => setHover(null)}
      >
        {geo.ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={geo.sy(v)} y2={geo.sy(v)} stroke="var(--line)" strokeWidth={1} />
            <text x={PAD.l - 6} y={geo.sy(v) + 4} textAnchor="end" fontSize={10} fill="var(--faint)" style={{ fontVariantNumeric: "tabular-nums" }}>
              {v}
            </text>
          </g>
        ))}
        {goal ? (
          <g>
            <line x1={PAD.l} x2={W - PAD.r} y1={geo.sy(goal)} y2={geo.sy(goal)} stroke="var(--success)" strokeDasharray="4 4" strokeWidth={1.2} />
            <text x={W - PAD.r} y={geo.sy(goal) - 4} textAnchor="end" fontSize={10} fill="var(--success)">
              goal {goal}
            </text>
          </g>
        ) : null}
        <text x={PAD.l} y={height - 6} fontSize={10} fill="var(--faint)">
          {short(new Date(geo.x0).toISOString().slice(0, 10))}
        </text>
        <text x={W - PAD.r} y={height - 6} textAnchor="end" fontSize={10} fill="var(--faint)">
          {short(new Date(geo.x1).toISOString().slice(0, 10))}
        </text>
        {series.map((s) => {
          const pts = [...s.points].sort((a, b) => a.date.localeCompare(b.date));
          const d = pts.map((p, i) => `${i ? "L" : "M"}${geo.sx(p.date).toFixed(1)},${geo.sy(p.value).toFixed(1)}`).join(" ");
          return (
            <g key={s.name}>
              {pts.length > 1 ? <path d={d} fill="none" stroke={s.color} strokeWidth={s.width ?? 2} strokeDasharray={s.dashed ? "5 4" : undefined} strokeLinejoin="round" strokeLinecap="round" /> : null}
              {s.dots !== false
                ? pts.map((p) => <circle key={p.date} cx={geo.sx(p.date)} cy={geo.sy(p.value)} r={pts.length > 40 ? 1.8 : 3} fill={s.color} />)
                : null}
            </g>
          );
        })}
        {hovered ? (
          <g>
            <line x1={geo.sx(hovered.date)} x2={geo.sx(hovered.date)} y1={PAD.t} y2={height - PAD.b} stroke="var(--line-strong)" />
            <circle cx={geo.sx(hovered.date)} cy={geo.sy(hovered.value)} r={5} fill="var(--panel)" stroke={main.color} strokeWidth={2} />
          </g>
        ) : null}
      </svg>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-muted">
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: s.color, opacity: s.dashed ? 0.7 : 1 }} />
            {s.name}
          </span>
        ))}
        {hovered ? (
          <span className="ml-auto tabular-nums text-fg-2">
            {short(hovered.date)} · {hovered.value}
            {unit ? ` ${unit}` : ""}
          </span>
        ) : null}
      </div>
    </div>
  );
}
