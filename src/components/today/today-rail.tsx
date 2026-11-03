"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, BellRing, Briefcase, Flame, GraduationCap } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { ProgressRing } from "@/components/ui/misc";
import { useToday } from "@/lib/hooks";
import { sb } from "@/lib/queries/client";
import { useProfile } from "@/lib/queries/profile";
import { useReminders } from "@/lib/queries/reminders";
import { useTasks } from "@/lib/queries/tasks";
import { addDays, startOfWeek, todayStr } from "@/lib/time";
import type { Job } from "@/lib/types";
import { cn } from "@/lib/utils";

function Widget({ title, icon, href, children }: { title: string; icon: React.ReactNode; href?: string; children: React.ReactNode }) {
  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-[12.5px] font-medium text-muted">
          {icon}
          {title}
        </h3>
        {href ? (
          <Link href={href} className="text-faint hover:text-fg" aria-label={`Open ${title}`}>
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function TodayRail() {
  const today = useToday();
  const { data: tasks = [] } = useTasks();
  const { data: profile } = useProfile();
  const { data: reminders = [] } = useReminders();
  const weekStart = startOfWeek(today, profile?.week_starts_on ?? 1);

  const { week, streak } = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const t of tasks) {
      if (t.status !== "done" || !t.completed_at) continue;
      const d = todayStr(new Date(t.completed_at));
      byDay.set(d, (byDay.get(d) ?? 0) + 1);
    }
    const week = Array.from({ length: 7 }, (_, i) => {
      const d = addDays(weekStart, i);
      return { d, n: byDay.get(d) ?? 0 };
    });
    let streak = 0;
    let cursor = byDay.get(today) ? today : addDays(today, -1);
    while (byDay.get(cursor)) {
      streak++;
      cursor = addDays(cursor, -1);
    }
    return { week, streak };
  }, [tasks, weekStart, today]);
  const max = Math.max(1, ...week.map((w) => w.n));

  const { data: learning = [] } = useQuery({
    queryKey: ["rail-learning", weekStart],
    queryFn: async () => {
      const { data } = await sb().from("learning_entries").select("entry_date").gte("entry_date", weekStart);
      return (data ?? []).map((r) => r.entry_date as string);
    },
  });
  const learnDays = new Set(learning).size;
  const learnedToday = learning.includes(today);
  const goal = profile?.learning_goal_per_week ?? 5;

  const { data: jobs = [] } = useQuery({
    queryKey: ["rail-jobs"],
    queryFn: async () => {
      const { data } = await sb()
        .from("jobs")
        .select("id, title, company, score, company_domain")
        .eq("status", "new")
        .order("created_at", { ascending: false })
        .order("score", { ascending: false })
        .limit(30);
      return ((data ?? []) as Pick<Job, "id" | "title" | "company" | "score" | "company_domain">[])
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, 3);
    },
  });

  const nextReminders = reminders.filter((r) => r.active && r.next_fire_at).slice(0, 3);
  const labels = ["M", "T", "W", "T", "F", "S", "S"];
  const dayLetter = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: "narrow" });

  return (
    <aside className="space-y-4 xl:sticky xl:top-10 xl:self-start">
      <Widget title="This week" icon={<Flame className="h-3.5 w-3.5 text-p2" />}>
        <div className="flex items-end justify-between gap-1.5">
          {week.map((w, i) => (
            <div key={w.d} className="flex flex-1 flex-col items-center gap-1.5">
              <div className="flex h-16 w-full items-end">
                <div
                  className={cn("w-full rounded-[4px] transition-all", w.d === today ? "bg-accent" : w.n ? "bg-accent/45" : "bg-panel-2")}
                  style={{ height: `${Math.max(8, (w.n / max) * 100)}%` }}
                  title={`${w.n} done`}
                />
              </div>
              <span className={cn("text-[10.5px]", w.d === today ? "font-medium text-fg" : "text-faint")}>{dayLetter(w.d) || labels[i]}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between text-[12px] text-muted">
          <span>{week.reduce((s, w) => s + w.n, 0)} tasks done</span>
          <span className="inline-flex items-center gap-1">
            <Flame className="h-3 w-3 text-p2" />
            {streak}-day streak
          </span>
        </div>
      </Widget>

      <Widget title="Learning" icon={<GraduationCap className="h-3.5 w-3.5 text-accent" />} href="/learning">
        <div className="flex items-center gap-3">
          <ProgressRing value={learnDays / goal} size={44} stroke={4} color={learnDays >= goal ? "var(--success)" : "var(--accent)"}>
            <span className="text-[11px] font-semibold tabular-nums text-fg">
              {learnDays}/{goal}
            </span>
          </ProgressRing>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] text-fg">{learnedToday ? "Logged today ✓" : "Not logged today"}</div>
            <div className="text-[12px] text-muted">{learnDays >= goal ? "Weekly goal reached" : `${goal - learnDays} more this week`}</div>
          </div>
        </div>
        {!learnedToday ? (
          <Link href="/learning?new=1" className="mt-3 block rounded-lg border border-line bg-panel-2 px-3 py-2 text-center text-[12.5px] text-fg-2 hover:border-line-strong hover:text-fg">
            What did you learn today?
          </Link>
        ) : null}
      </Widget>

      <Widget title="Top job matches" icon={<Briefcase className="h-3.5 w-3.5 text-success" />} href="/jobs">
        {jobs.length ? (
          <ul className="space-y-2.5">
            {jobs.map((j) => (
              <li key={j.id}>
                <Link href={`/jobs?job=${j.id}`} className="flex items-center gap-2.5">
                  <span
                    className={cn(
                      "flex h-7 w-9 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold tabular-nums",
                      (j.score ?? 0) >= 80 ? "bg-success/12 text-success" : (j.score ?? 0) >= 65 ? "bg-accent-soft text-accent" : "bg-panel-2 text-muted",
                    )}
                  >
                    {j.score}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] text-fg">{j.title}</span>
                    <span className="block truncate text-[11.5px] text-muted">{j.company}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-muted">New matches appear here after the hourly search runs.</p>
        )}
      </Widget>

      {nextReminders.length ? (
        <Widget title="Coming up" icon={<BellRing className="h-3.5 w-3.5 text-warning" />} href="/reminders">
          <ul className="space-y-2">
            {nextReminders.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 text-[13px]">
                <span className="truncate text-fg-2">{r.title}</span>
                <span className="shrink-0 text-[11.5px] text-muted">
                  {new Date(r.next_fire_at!).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}
                </span>
              </li>
            ))}
          </ul>
        </Widget>
      ) : null}
    </aside>
  );
}
