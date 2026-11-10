import {
  BellRing,
  Briefcase,
  CalendarDays,
  CalendarRange,
  Flame,
  GraduationCap,
  HeartHandshake,
  HeartPulse,
  Lightbulb,
  type LucideIcon,
  Settings,
  Sun,
  UserRound,
} from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon; group: "plan" | "grow" | "system"; key?: string };

export const NAV: NavItem[] = [
  { href: "/", label: "Today", icon: Sun, group: "plan", key: "today" },
  { href: "/upcoming", label: "Upcoming", icon: CalendarRange, group: "plan" },
  { href: "/calendar", label: "Calendar", icon: CalendarDays, group: "plan" },
  { href: "/habits", label: "Habits", icon: Flame, group: "plan" },
  { href: "/reminders", label: "Reminders", icon: BellRing, group: "plan" },
  { href: "/jobs", label: "Jobs", icon: Briefcase, group: "grow", key: "jobs" },
  { href: "/learning", label: "Learning", icon: GraduationCap, group: "grow", key: "learning" },
  { href: "/health", label: "Health", icon: HeartPulse, group: "grow", key: "health" },
  { href: "/interests", label: "Interests", icon: Lightbulb, group: "grow", key: "interests" },
  { href: "/portfolio", label: "Portfolio", icon: UserRound, group: "grow" },
  { href: "/together", label: "Together", icon: HeartHandshake, group: "grow", key: "together" },
  { href: "/settings", label: "Settings", icon: Settings, group: "system" },
];

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
