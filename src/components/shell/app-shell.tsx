"use client";

import { useQuery } from "@tanstack/react-query";
import { LogOut, Menu as MenuIcon, Moon, Plus, Search, Sun, X } from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { CarryReview } from "@/components/tasks/carry-review";
import { QuickAddDialog } from "@/components/tasks/quick-add-dialog";
import { TaskEditor } from "@/components/tasks/task-editor";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/menu";
import { useHotkey, useMounted, useToday } from "@/lib/hooks";
import { sb } from "@/lib/queries/client";
import { useProfile, useUpdateProfile, useUser } from "@/lib/queries/profile";
import { useTasks } from "@/lib/queries/tasks";
import { browserTimeZone } from "@/lib/time";
import { cn, initials } from "@/lib/utils";
import { CommandPalette } from "./command-palette";
import { LogoMark } from "./logo";
import { isActive, NAV, type NavItem } from "./nav";
import { NotificationBell } from "./notification-bell";
import { UiProvider, useUi } from "./ui-store";

function useBadges() {
  const today = useToday();
  const { data: tasks = [] } = useTasks();
  const { data: profile } = useProfile();
  const todayCount = useMemo(
    () => tasks.filter((t) => t.status === "todo" && t.due_date && t.due_date <= today).length,
    [tasks, today],
  );
  const { data: jobCount = 0 } = useQuery({
    queryKey: ["badge-jobs", profile?.job_alert_min_score],
    enabled: !!profile,
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const { count } = await sb()
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("status", "new")
        .is("seen_at", null)
        .gte("score", profile?.job_alert_min_score ?? 75);
      return count ?? 0;
    },
  });
  const { data: learnedToday = true } = useQuery({
    queryKey: ["badge-learning", today],
    queryFn: async () => {
      const { count } = await sb().from("learning_entries").select("id", { count: "exact", head: true }).eq("entry_date", today);
      return (count ?? 0) > 0;
    },
  });
  return { today: todayCount, jobs: jobCount, learning: !learnedToday };
}

function NavLink({ item, badge, dot, onClick }: { item: NavItem; badge?: number; dot?: boolean; onClick?: () => void }) {
  const pathname = usePathname();
  const active = isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={cn(
        "group flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors",
        active ? "bg-panel-hover font-medium text-fg" : "text-muted hover:bg-panel-hover/60 hover:text-fg",
      )}
    >
      <item.icon className={cn("h-4 w-4", active ? "text-accent" : "text-muted group-hover:text-fg-2")} />
      <span className="flex-1">{item.label}</span>
      {badge ? <span className="text-[11.5px] tabular-nums text-faint">{badge}</span> : null}
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-warning" /> : null}
    </Link>
  );
}

function UserMenu({ compact }: { compact?: boolean }) {
  const { data: profile } = useProfile();
  const { data: user } = useUser();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const name = profile?.full_name || user?.email?.split("@")[0] || "You";
  return (
    <Menu
      align="start"
      trigger={
        <button className="flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-panel-hover">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-[#8b93f5] to-[#5e6ad2] text-[10.5px] font-semibold text-white">
            {initials(name)}
          </span>
          {!compact ? <span className="truncate text-[13px] font-medium text-fg">{name}</span> : null}
        </button>
      }
    >
      <MenuLabel>{user?.email}</MenuLabel>
      <MenuItem onSelect={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")} icon={resolvedTheme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}>
        {resolvedTheme === "dark" ? "Light" : "Dark"} theme
      </MenuItem>
      <MenuItem onSelect={() => router.push("/settings")}>Settings</MenuItem>
      <MenuSeparator />
      <MenuItem
        danger
        icon={<LogOut className="h-3.5 w-3.5" />}
        onSelect={async () => {
          await sb().auth.signOut();
          // Full reload on purpose: clears every cached query from the previous session.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.assign("/login");
        }}
      >
        Sign out
      </MenuItem>
    </Menu>
  );
}

function Sidebar() {
  const { setCommandOpen, openQuickAdd } = useUi();
  const badges = useBadges();
  const groups: { id: NavItem["group"]; label?: string }[] = [
    { id: "plan", label: "Plan" },
    { id: "grow", label: "Grow" },
  ];
  return (
    <aside className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col border-r border-line bg-elev px-3 pb-3 pt-3 md:flex">
      <div className="mb-3 flex items-center justify-between gap-1">
        <UserMenu />
        <NotificationBell />
      </div>
      <div className="mb-4 flex gap-1.5">
        <button
          onClick={() => setCommandOpen(true)}
          className="flex h-8 flex-1 items-center gap-2 rounded-lg border border-line bg-panel px-2.5 text-[12.5px] text-faint transition-colors hover:border-line-strong hover:text-muted"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">Search</span>
          <kbd className="kbd">⌘K</kbd>
        </button>
        <button
          onClick={() => openQuickAdd()}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-panel text-muted transition-colors hover:border-line-strong hover:text-fg"
          title="New task (C)"
          aria-label="New task"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto">
        {groups.map((g) => (
          <div key={g.id}>
            {g.label ? <div className="mb-1 px-2.5 text-[11px] font-medium text-faint">{g.label}</div> : null}
            <div className="space-y-0.5">
              {NAV.filter((n) => n.group === g.id).map((n) => (
                <NavLink
                  key={n.href}
                  item={n}
                  badge={n.key === "today" ? badges.today : n.key === "jobs" ? badges.jobs : undefined}
                  dot={n.key === "learning" ? badges.learning : undefined}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="space-y-0.5 border-t border-line pt-3">
        {NAV.filter((n) => n.group === "system").map((n) => (
          <NavLink key={n.href} item={n} />
        ))}
        <div className="flex items-center gap-2 px-2.5 pt-2 text-[11px] text-faint">
          <LogoMark className="h-3.5 w-3.5" /> Productivize
        </div>
      </div>
    </aside>
  );
}

function MobileBar() {
  const pathname = usePathname();
  const badges = useBadges();
  const { openQuickAdd } = useUi();
  const [more, setMore] = useState(false);
  const primary = ["/", "/calendar", "/jobs", "/learning"];
  const onMorePage = !primary.some((p) => isActive(pathname, p));

  return (
    <>
      {/* top bar */}
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-bg/85 px-4 pb-2 pt-[max(env(safe-area-inset-top),8px)] backdrop-blur-xl md:hidden">
        <LogoMark className="h-5 w-5" />
        <span className="flex-1 text-[14px] font-semibold tracking-[-0.01em] text-fg">Productivize</span>
        <NotificationBell />
        <UserMenu compact />
      </header>

      {/* floating add button */}
      {["/", "/upcoming", "/calendar"].some((p) => isActive(pathname, p)) ? (
        <button
          onClick={() => openQuickAdd()}
          aria-label="New task"
          className="fixed bottom-[calc(env(safe-area-inset-bottom)+72px)] right-4 z-30 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-white shadow-[0_8px_24px_rgba(94,106,210,0.45)] active:scale-95 md:hidden"
        >
          <Plus className="h-5 w-5" />
        </button>
      ) : null}

      {/* bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/90 backdrop-blur-xl safe-bottom md:hidden">
        <div className="grid h-[60px] grid-cols-5">
          {primary.map((href) => {
            const item = NAV.find((n) => n.href === href)!;
            const active = isActive(pathname, href);
            const badge = item.key === "today" ? badges.today : item.key === "jobs" ? badges.jobs : 0;
            return (
              <Link key={href} href={href} className="relative flex flex-col items-center justify-center gap-0.5">
                <item.icon className={cn("h-[19px] w-[19px]", active ? "text-accent" : "text-muted")} />
                <span className={cn("text-[10.5px]", active ? "font-medium text-fg" : "text-muted")}>{item.label}</span>
                {badge ? (
                  <span className="absolute right-[calc(50%-18px)] top-1.5 min-w-4 rounded-full bg-accent px-1 text-center text-[9.5px] font-semibold leading-4 text-white">
                    {badge > 99 ? "99+" : badge}
                  </span>
                ) : null}
                {item.key === "learning" && badges.learning ? (
                  <span className="absolute right-[calc(50%-14px)] top-2 h-1.5 w-1.5 rounded-full bg-warning" />
                ) : null}
              </Link>
            );
          })}
          <button onClick={() => setMore(true)} className="flex flex-col items-center justify-center gap-0.5">
            <MenuIcon className={cn("h-[19px] w-[19px]", onMorePage ? "text-accent" : "text-muted")} />
            <span className={cn("text-[10.5px]", onMorePage ? "font-medium text-fg" : "text-muted")}>More</span>
          </button>
        </div>
      </nav>

      {more ? (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setMore(false)}>
          <div className="absolute inset-0 bg-black/50 animate-fade-in" />
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-line-strong bg-panel p-3 safe-bottom animate-[sheet-in_.22s_ease-out]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between px-2">
              <span className="text-[13px] font-medium text-muted">More</span>
              <button onClick={() => setMore(false)} className="rounded-md p-1 text-muted" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 pb-2">
              {NAV.filter((n) => !primary.includes(n.href)).map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  onClick={() => setMore(false)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-xl border border-line bg-panel-2 px-3 py-3 text-[13.5px]",
                    isActive(pathname, n.href) ? "text-fg" : "text-fg-2",
                  )}
                >
                  <n.icon className="h-4 w-4 text-accent" />
                  {n.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** Keeps the profile's time zone in sync with the device so server-side reminders fire at local times. */
function TimezoneSync() {
  const { data: profile } = useProfile();
  const update = useUpdateProfile();
  useEffect(() => {
    if (!profile) return;
    const tz = browserTimeZone();
    if (tz && tz !== "UTC" && profile.timezone !== tz) update.mutate({ timezone: tz });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.timezone]);
  return null;
}

function Hotkeys() {
  const { openQuickAdd } = useUi();
  useHotkey("c", useCallback(() => openQuickAdd(), [openQuickAdd]));
  return null;
}

function ShellSkeleton() {
  return (
    <div className="flex min-h-dvh">
      <aside className="hidden w-[232px] shrink-0 border-r border-line bg-elev p-3 md:block">
        <div className="mb-4 flex items-center gap-2">
          <div className="skeleton h-6 w-6 rounded-md" />
          <div className="skeleton h-3.5 w-24" />
        </div>
        <div className="skeleton mb-5 h-8 w-full rounded-lg" />
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="mb-2 flex items-center gap-2.5 px-2.5 py-1.5">
            <div className="skeleton h-4 w-4 rounded" />
            <div className="skeleton h-3 w-20" />
          </div>
        ))}
      </aside>
      <div className="flex-1 px-4 pt-6 md:px-8 md:pt-10">
        <div className="mx-auto max-w-[760px]">
          <div className="skeleton mb-2 h-3 w-28" />
          <div className="skeleton mb-8 h-7 w-40" />
          <div className="skeleton mb-6 h-11 w-full rounded-xl" />
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="mb-4 flex items-center gap-3 px-2">
              <div className="skeleton h-[18px] w-[18px] rounded-full" />
              <div className="skeleton h-3.5 flex-1" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  // The signed-in app is personal, live and time-of-day dependent, so it renders in the
  // browser (local time zone) behind a static skeleton that prerenders instantly.
  const mounted = useMounted();
  if (!mounted) return <ShellSkeleton />;
  return (
    <UiProvider>
      <div className="flex min-h-dvh">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <MobileBar />
          <main className="flex-1 pb-[calc(env(safe-area-inset-bottom)+84px)] md:pb-10">{children}</main>
        </div>
      </div>
      <CommandPalette />
      <QuickAddDialog />
      <TaskEditor />
      <CarryReview />
      <TimezoneSync />
      <Hotkeys />
    </UiProvider>
  );
}
