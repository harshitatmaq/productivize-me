"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { PRIORITY_COLOR } from "./task-utils";

export function TaskCheckbox({
  checked,
  priority,
  onToggle,
  size = 18,
}: {
  checked: boolean;
  priority: number;
  onToggle: () => void;
  size?: number;
}) {
  const color = PRIORITY_COLOR[priority] ?? PRIORITY_COLOR[4];
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={checked ? "Mark as not done" : "Mark as done"}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        "group/check relative flex shrink-0 items-center justify-center rounded-full border-[1.5px] transition-all duration-150",
        checked ? "animate-check" : "hover:scale-105",
      )}
      style={{
        width: size,
        height: size,
        borderColor: color,
        background: checked ? color : priority < 4 ? `color-mix(in srgb, ${color} 12%, transparent)` : "transparent",
      }}
    >
      <Check
        className={cn("h-[11px] w-[11px] transition-opacity", checked ? "text-white opacity-100" : "opacity-0 group-hover/check:opacity-60")}
        style={{ color: checked ? "#fff" : color }}
        strokeWidth={3}
      />
    </button>
  );
}
