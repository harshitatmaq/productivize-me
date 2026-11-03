import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Badge({
  children,
  tone = "neutral",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "accent" | "success" | "warning" | "danger" | "outline" }) {
  const tones = {
    neutral: "bg-panel-2 text-muted border-line",
    outline: "bg-transparent text-muted border-line-strong",
    accent: "bg-accent-soft text-accent border-transparent",
    success: "bg-success/12 text-success border-transparent",
    warning: "bg-warning/12 text-warning border-transparent",
    danger: "bg-danger/12 text-danger border-transparent",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-md border px-1.5 text-[11px] font-medium",
        tones[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("card", className)} {...props} />;
}

export function SectionTitle({ children, right, className }: { children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-2 flex items-center justify-between gap-2", className)}>
      <h2 className="text-[12px] font-medium uppercase tracking-[0.06em] text-muted">{children}</h2>
      {right}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-xl border border-dashed border-line-strong px-6 py-12 text-center", className)}>
      {icon ? <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-panel-2 text-muted">{icon}</div> : null}
      <div className="text-[14px] font-medium text-fg">{title}</div>
      {children ? <div className="mt-1 max-w-sm text-[13px] text-muted">{children}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton h-4", className)} />;
}

export function ProgressRing({
  value,
  size = 36,
  stroke = 3.5,
  className,
  children,
  color = "var(--accent)",
}: {
  value: number;
  size?: number;
  stroke?: number;
  className?: string;
  children?: ReactNode;
  color?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className={cn("relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line-strong)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          style={{ transition: "stroke-dashoffset .5s cubic-bezier(.2,.8,.2,1)" }}
        />
      </svg>
      {children ? <div className="absolute inset-0 flex items-center justify-center">{children}</div> : null}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  icon,
  right,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-6 flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          {icon ? <span className="text-muted">{icon}</span> : null}
          <h1 className="truncate text-[22px] font-semibold tracking-[-0.015em] text-fg">{title}</h1>
        </div>
        {subtitle ? <p className="mt-1 text-[13px] text-muted">{subtitle}</p> : null}
      </div>
      {right ? <div className="flex flex-wrap items-center gap-2">{right}</div> : null}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; count?: number }[];
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div className={cn("inline-flex rounded-lg border border-line bg-panel-2 p-0.5", className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md font-medium transition-colors",
            size === "sm" ? "h-6 px-2 text-xs" : "h-7 px-2.5 text-[12.5px]",
            value === o.value ? "bg-panel text-fg shadow-[0_1px_2px_rgba(0,0,0,0.15)] ring-1 ring-line" : "text-muted hover:text-fg",
          )}
        >
          {o.label}
          {o.count !== undefined ? <span className="text-faint">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
