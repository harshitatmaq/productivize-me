import {
  BellRing,
  Briefcase,
  CalendarDays,
  CalendarRange,
  GraduationCap,
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
  { href: "/reminders", label: "Reminders", icon: BellRing, group: "plan" },
  { href: "/jobs", label: "Jobs", icon: Briefcase, group: "grow", key: "jobs" },
  { href: "/learning", label: "Learning", icon: GraduationCap, group: "grow", key: "learning" },
  { href: "/portfolio", label: "Portfolio", icon: UserRound, group: "grow" },
  { href: "/settings", label: "Settings", icon: Settings, group: "system" },
];

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
