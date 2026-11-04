"use client";

import { CalendarClock, CalendarDays, CalendarX2, Sofa, Sun, Sunrise } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/menu";
import { useToday } from "@/lib/hooks";
import { prettyDate, quickDates } from "./task-utils";

export function RescheduleMenu({ trigger, onPick }: { trigger: ReactNode; onPick: (date: string | null) => void }) {
  const today = useToday();
  const q = quickDates(today);
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Menu trigger={trigger}>
        <MenuLabel>Move to</MenuLabel>
        <MenuItem icon={<Sun className="h-3.5 w-3.5" />} onSelect={() => onPick(q.today)} shortcut={prettyDate(q.today, { weekday: "short" })}>
          Today
        </MenuItem>
        <MenuItem icon={<Sunrise className="h-3.5 w-3.5" />} onSelect={() => onPick(q.tomorrow)} shortcut={prettyDate(q.tomorrow, { weekday: "short" })}>
          Tomorrow
        </MenuItem>
        <MenuItem icon={<Sofa className="h-3.5 w-3.5" />} onSelect={() => onPick(q.weekend)} shortcut={prettyDate(q.weekend, { weekday: "short" })}>
          This weekend
        </MenuItem>
        <MenuItem icon={<CalendarDays className="h-3.5 w-3.5" />} onSelect={() => onPick(q.nextWeek)} shortcut={prettyDate(q.nextWeek, { weekday: "short", day: "numeric" })}>
          Next week
        </MenuItem>
        <MenuItem icon={<CalendarClock className="h-3.5 w-3.5" />} onSelect={() => setTimeout(() => input.current?.showPicker?.() ?? input.current?.click(), 50)}>
          Pick a date…
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<CalendarX2 className="h-3.5 w-3.5" />} onSelect={() => onPick(null)}>
          No date
        </MenuItem>
      </Menu>
      <input
        ref={input}
        type="date"
        className="pointer-events-none absolute h-0 w-0 opacity-0"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => e.target.value && onPick(e.target.value)}
      />
    </>
  );
}
