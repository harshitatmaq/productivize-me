import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { notify, type NotifyProfile } from "@/lib/notify";
import { renderEmail } from "@/lib/notify/templates";
import { computeNextFire, formatTime12, type ReminderRule } from "@/lib/recurrence";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  addDays,
  diffDays,
  localDateStr,
  localTimeStr,
  minutesOf,
  safeTz,
  startOfWeek,
  timeGte,
  zonedToUtc,
} from "@/lib/time";

export type Profile = NotifyProfile & {
  full_name: string | null;
  timezone: string;
  week_starts_on: number;
  morning_brief_enabled: boolean;
  day_start_time: string;
  eod_review_enabled: boolean;
  day_end_time: string;
  learning_reminder_enabled: boolean;
  learning_reminder_time: string;
  learning_goal_per_week: number;
  learning_skip_when_goal_met: boolean;
  weekly_review_enabled: boolean;
  monthly_review_enabled: boolean;
  auto_carry_forward: boolean;
  email_daily_digest: boolean;
  email_weekly_review: boolean;
  email_alerts: boolean;
  job_search_enabled: boolean;
  job_alert_min_score: number;
};

type TaskRow = {
  id: string;
  title: string;
  due_date: string | null;
  due_time: string | null;
  priority: number;
  reminder_at: string | null;
  status: string;
  completed_at: string | null;
  carry_count: number;
};

const firstName = (p: Profile) => (p.full_name ?? p.email ?? "").split(/[\s@]/)[0] || "there";
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export async function runTick(now = new Date()) {
  const admin = supabaseAdmin();
  const { data: profiles, error } = await admin.from("profiles").select("*");
  if (error) throw new Error(error.message);
  const results: Record<string, string[]> = {};
  for (const p of (profiles ?? []) as Profile[]) {
    const done: string[] = [];
    try {
      await tickUser(admin, p, now, done);
    } catch (e) {
      done.push(`error: ${(e as Error).message}`);
      console.error(`[tick] ${p.id}`, e);
    }
    results[p.email ?? p.id] = done;
  }
  // Housekeeping: keep the in-app inbox small.
  await admin
    .from("notifications")
    .delete()
    .lt("created_at", new Date(now.getTime() - 60 * 86_400_000).toISOString());
  return results;
}

async function tickUser(admin: SupabaseClient, p: Profile, now: Date, done: string[]) {
  const tz = safeTz(p.timezone, "Asia/Kolkata");
  const date = localDateStr(now, tz);
  const time = localTimeStr(now, tz);
  const nowIso = now.toISOString();

  // 1. Task reminders -------------------------------------------------------
  const { data: dueTasks } = await admin
    .from("tasks")
    .select("id, title, due_date, due_time, reminder_at, priority")
    .eq("user_id", p.id)
    .eq("status", "todo")
    .is("reminder_sent_at", null)
    .lte("reminder_at", nowIso)
    .limit(25);
  for (const t of (dueTasks ?? []) as TaskRow[]) {
    const r = await notify(p, {
      kind: "task_reminder",
      dedupeKey: `task:${t.id}:${t.reminder_at}`,
      title: `⏰ ${t.title}`,
      body: t.due_time ? `Due ${formatTime12(t.due_time)}${t.due_date && t.due_date !== date ? ` · ${t.due_date}` : ""}` : "Reminder",
      url: `/?task=${t.id}`,
      push: {
        tag: `task-${t.id}`,
        requireInteraction: t.priority <= 2,
        actions: [
          { action: "done", title: "✓ Done" },
          { action: "snooze", title: "Snooze 1h" },
        ],
        data: { taskId: t.id },
      },
    });
    await admin.from("tasks").update({ reminder_sent_at: nowIso }).eq("id", t.id);
    if (r.sent) done.push(`task reminder: ${t.title}`);
  }

  // 2. Custom reminders -----------------------------------------------------
  const { data: rems } = await admin
    .from("reminders")
    .select("*")
    .eq("user_id", p.id)
    .eq("active", true)
    .or(`next_fire_at.is.null,next_fire_at.lte.${nowIso}`)
    .limit(50);
  for (const r of rems ?? []) {
    const rule = r as ReminderRule & { id: string; title: string; notes: string | null; next_fire_at: string | null; url: string | null };
    const due = !!rule.next_fire_at && Date.parse(rule.next_fire_at) <= now.getTime();
    if (rule.next_fire_at && !due) continue; // not due yet (defensive; the query already filters)
    if (due) {
      const res = await notify(p, {
        kind: "reminder",
        dedupeKey: `rem:${rule.id}:${rule.next_fire_at}`,
        title: `🔔 ${rule.title}`,
        body: rule.notes ?? undefined,
        url: rule.url || "/reminders",
        push: { tag: `rem-${rule.id}`, requireInteraction: true },
      });
      if (res.sent) done.push(`reminder: ${rule.title}`);
    }
    const next = computeNextFire(rule, tz, now);
    await admin
      .from("reminders")
      .update({
        next_fire_at: next?.toISOString() ?? null,
        last_fired_at: due ? nowIso : undefined,
        active: next !== null,
      })
      .eq("id", rule.id);
  }

  // 3. Morning brief ----------------------------------------------------------
  const startT = p.day_start_time.slice(0, 5);
  if (p.morning_brief_enabled && timeGte(time, startT) && minutesOf(time) - minutesOf(startT) <= 180) {
    await morningBrief(admin, p, date, done);
  }

  // 4. End-of-day review & carry forward -------------------------------------
  if (p.eod_review_enabled && timeGte(time, p.day_end_time)) {
    await endOfDay(admin, p, date, done);
  }

  // 5. Learning nudge --------------------------------------------------------
  if (p.learning_reminder_enabled && timeGte(time, p.learning_reminder_time)) {
    await learningNudge(admin, p, date, done);
  }

  // 6. Weekly review (last day of the week, 6pm+) ----------------------------
  const weekStart = startOfWeek(date, p.week_starts_on);
  if (p.weekly_review_enabled && date === addDays(weekStart, 6) && timeGte(time, "18:00")) {
    await periodReview(admin, p, "week", weekStart, date, done);
  }

  // 7. Monthly review (1st of the month, after the morning brief) -----------
  if (p.monthly_review_enabled && date.endsWith("-01") && timeGte(time, startT)) {
    const prevMonthEnd = addDays(date, -1);
    await periodReview(admin, p, "month", `${prevMonthEnd.slice(0, 7)}-01`, prevMonthEnd, done);
  }
}

async function morningBrief(admin: SupabaseClient, p: Profile, date: string, done: string[]) {
  const key = `brief:${date}`;
  const { data: existing } = await admin.from("notifications").select("id").eq("user_id", p.id).eq("dedupe_key", key).maybeSingle();
  if (existing) return;

  const [{ data: today }, { count: overdue }, { data: jobs }, { data: learning }] = await Promise.all([
    admin
      .from("tasks")
      .select("title, due_time, priority")
      .eq("user_id", p.id)
      .eq("status", "todo")
      .eq("due_date", date)
      .order("priority")
      .order("due_time", { nullsFirst: false })
      .limit(20),
    admin.from("tasks").select("id", { count: "exact", head: true }).eq("user_id", p.id).eq("status", "todo").lt("due_date", date),
    admin
      .from("jobs")
      .select("title, company, score, url")
      .eq("user_id", p.id)
      .eq("status", "new")
      .gte("score", p.job_alert_min_score)
      .gte("created_at", new Date(Date.now() - 86_400_000).toISOString())
      .order("score", { ascending: false })
      .limit(5),
    admin
      .from("learning_entries")
      .select("entry_date")
      .eq("user_id", p.id)
      .gte("entry_date", startOfWeek(date, p.week_starts_on)),
  ]);

  const tasks = today ?? [];
  const learnDays = new Set((learning ?? []).map((l) => l.entry_date)).size;
  const bits = [
    tasks.length ? `Top: ${tasks.slice(0, 3).map((t) => t.title).join(", ")}` : "No tasks planned yet — add a few",
    overdue ? `${overdue} overdue` : null,
    jobs?.length ? `${plural(jobs.length, "new job match")}` : null,
    `Learning ${learnDays}/${p.learning_goal_per_week} this week`,
  ].filter(Boolean);

  const email =
    p.email_daily_digest && p.notify_email
      ? {
          subject: `Your day · ${plural(tasks.length, "task")}${overdue ? `, ${overdue} overdue` : ""}`,
          force: true,
          html: renderEmail({
            preheader: bits.join(" · "),
            title: `Good morning, ${firstName(p)}`,
            subtitle: new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
            sections: [
              {
                heading: `Today · ${plural(tasks.length, "task")}`,
                items: tasks.map((t) => ({ text: t.title, meta: [t.due_time ? formatTime12(t.due_time) : null, t.priority < 4 ? `P${t.priority}` : null].filter(Boolean).join(" · ") || undefined })),
                empty: "Nothing scheduled — a great day to plan.",
              },
              ...(overdue ? [{ heading: "Overdue", paragraph: `${plural(overdue, "task")} from earlier days are still open. Carry them forward or close them.` }] : []),
              ...(jobs?.length
                ? [{ heading: "New job matches", items: jobs.map((j) => ({ text: `${j.title}${j.company ? ` · ${j.company}` : ""}`, meta: `${j.score}% match`, href: "/jobs" })) }]
                : []),
              { heading: "Learning", paragraph: `${learnDays}/${p.learning_goal_per_week} days logged this week.` },
            ],
            cta: { label: "Open today", href: "/" },
          }),
        }
      : undefined;

  const r = await notify(p, {
    kind: "brief",
    dedupeKey: key,
    title: `☀️ ${plural(tasks.length, "task")} today`,
    body: bits.join(" · "),
    url: "/",
    push: { tag: "brief" },
    email,
  });
  if (r.sent) done.push(`morning brief (${r.channels.join("+")})`);
}

async function endOfDay(admin: SupabaseClient, p: Profile, date: string, done: string[]) {
  const key = `eod:${date}`;
  const { data: existing } = await admin.from("notifications").select("id").eq("user_id", p.id).eq("dedupe_key", key).maybeSingle();
  if (existing) return;

  const { data: open } = await admin
    .from("tasks")
    .select("id, title, due_date")
    .eq("user_id", p.id)
    .eq("status", "todo")
    .lte("due_date", date)
    .order("priority")
    .limit(50);
  const unfinished = open ?? [];

  if (unfinished.length === 0) {
    const { count } = await admin
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", p.id)
      .eq("status", "done")
      .gte("completed_at", zonedToUtc(date, "00:00", p.timezone).toISOString());
    if (count && count > 0) {
      await notify(p, {
        kind: "eod",
        dedupeKey: key,
        title: `🎉 All done — ${plural(count, "task")} finished today`,
        body: "Nice work. Plan tomorrow while it's fresh?",
        url: "/upcoming",
        push: { tag: "eod" },
      });
      done.push("eod: all done");
    }
    return;
  }

  const tomorrow = addDays(date, 1);
  const list = unfinished.slice(0, 4).map((t) => `• ${t.title}`).join("\n") + (unfinished.length > 4 ? `\n+${unfinished.length - 4} more` : "");

  if (p.auto_carry_forward) {
    const { data: moved } = await admin.rpc("carry_tasks", { p_to: tomorrow, p_ids: null, p_until: date, p_user: p.id });
    await notify(p, {
      kind: "eod",
      dedupeKey: key,
      title: `🌙 Moved ${plural(Number(moved ?? unfinished.length), "unfinished task")} to tomorrow`,
      body: list,
      url: "/upcoming",
      push: { tag: "eod" },
    });
    done.push(`eod: auto-carried ${moved}`);
    return;
  }

  const r = await notify(p, {
    kind: "eod",
    dedupeKey: key,
    title: `🌙 ${plural(unfinished.length, "task")} not finished today`,
    body: `Carry ${unfinished.length === 1 ? "it" : "them"} forward to tomorrow?\n${list}`,
    url: "/?review=1",
    data: { date, ids: unfinished.map((t) => t.id) },
    push: {
      tag: "eod",
      requireInteraction: true,
      actions: [
        { action: "carry", title: "Carry all to tomorrow" },
        { action: "review", title: "Review" },
      ],
      data: { date },
    },
    email: {
      subject: `${plural(unfinished.length, "task")} left from today`,
      html: renderEmail({
        preheader: "Carry them forward or close them out.",
        title: `${plural(unfinished.length, "task")} still open`,
        subtitle: "Carry them to tomorrow, reschedule, or let them go.",
        sections: [{ heading: "Unfinished", items: unfinished.map((t) => ({ text: t.title, meta: t.due_date !== date ? `from ${t.due_date}` : undefined })) }],
        cta: { label: "Review & carry forward", href: "/?review=1" },
      }),
    },
  });
  if (r.sent) done.push(`eod prompt: ${unfinished.length} open`);
}

async function learningNudge(admin: SupabaseClient, p: Profile, date: string, done: string[]) {
  const key = `learn:${date}`;
  const weekStart = startOfWeek(date, p.week_starts_on);
  const { data: entries } = await admin
    .from("learning_entries")
    .select("entry_date")
    .eq("user_id", p.id)
    .gte("entry_date", weekStart)
    .lte("entry_date", date);
  const dates = new Set((entries ?? []).map((e) => e.entry_date));
  if (dates.has(date)) return;

  const goal = p.learning_goal_per_week;
  const logged = dates.size;
  const needed = goal - logged;
  if (needed <= 0 && p.learning_skip_when_goal_met) return;
  const daysLeft = 7 - diffDays(date, weekStart); // including today
  const body =
    needed <= 0
      ? `Weekly goal reached (${logged}/${goal}). One line keeps the streak going.`
      : needed > daysLeft
        ? `${logged}/${goal} days this week — the goal is out of reach, but today still counts.`
        : needed === daysLeft
          ? `${logged}/${goal} this week — you need every remaining day. Log today!`
          : `${logged}/${goal} days this week. What did you learn today?`;

  const r = await notify(p, {
    kind: "learning",
    dedupeKey: key,
    title: "📚 What did you learn today?",
    body,
    url: "/learning?new=1",
    push: { tag: "learning", actions: [{ action: "log", title: "Log now" }] },
    email: {
      subject: "What did you learn today?",
      html: renderEmail({
        preheader: body,
        title: "What did you learn today?",
        subtitle: body,
        sections: [{ heading: "Tip", paragraph: "Two sentences is enough. Future-you will thank you when it's revision time." }],
        cta: { label: "Log today's learning", href: "/learning?new=1" },
      }),
    },
  });
  if (r.sent) done.push("learning nudge");
}

async function periodReview(
  admin: SupabaseClient,
  p: Profile,
  kind: "week" | "month",
  from: string,
  to: string,
  done: string[],
) {
  const key = kind === "week" ? `weekly:${from}` : `monthly:${from.slice(0, 7)}`;
  const { data: existing } = await admin.from("notifications").select("id").eq("user_id", p.id).eq("dedupe_key", key).maybeSingle();
  if (existing) return;

  const fromIso = zonedToUtc(from, "00:00", p.timezone).toISOString();
  const toIso = zonedToUtc(addDays(to, 1), "00:00", p.timezone).toISOString();
  const [{ count: completed }, { count: openInPeriod }, { count: carried }, { data: learning }, { count: applied }, { count: matches }] =
    await Promise.all([
      admin.from("tasks").select("id", { count: "exact", head: true }).eq("user_id", p.id).eq("status", "done").gte("completed_at", fromIso).lt("completed_at", toIso),
      admin.from("tasks").select("id", { count: "exact", head: true }).eq("user_id", p.id).eq("status", "todo").gte("due_date", from).lte("due_date", to),
      admin.from("tasks").select("id", { count: "exact", head: true }).eq("user_id", p.id).gte("last_carried_at", fromIso).lt("last_carried_at", toIso),
      admin.from("learning_entries").select("entry_date, title, tags, minutes").eq("user_id", p.id).gte("entry_date", from).lte("entry_date", to),
      admin.from("jobs").select("id", { count: "exact", head: true }).eq("user_id", p.id).gte("applied_at", fromIso).lt("applied_at", toIso),
      admin.from("jobs").select("id", { count: "exact", head: true }).eq("user_id", p.id).gte("created_at", fromIso).lt("created_at", toIso).gte("score", p.job_alert_min_score),
    ]);

  const days = new Set((learning ?? []).map((l) => l.entry_date)).size;
  const minutes = (learning ?? []).reduce((s, l) => s + (l.minutes ?? 0), 0);
  const tagCounts = new Map<string, number>();
  (learning ?? []).forEach((l) => (l.tags ?? []).forEach((t: string) => tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1)));
  const topTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => `#${t}`);
  const total = (completed ?? 0) + (openInPeriod ?? 0);
  const rate = total ? Math.round(((completed ?? 0) / total) * 100) : 0;
  const label = kind === "week" ? "week" : new Date(`${from}T12:00:00Z`).toLocaleDateString("en-US", { month: "long" });
  const summary = `${completed ?? 0} tasks done (${rate}%) · learned on ${days} day${days === 1 ? "" : "s"} · ${applied ?? 0} applications`;

  const wantsEmail = p.email_weekly_review && p.notify_email;
  const r = await notify(p, {
    kind: kind === "week" ? "weekly" : "monthly",
    dedupeKey: key,
    title: kind === "week" ? "🗓️ Your week in review" : `🗓️ ${label} in review`,
    body: `${summary}. ${kind === "week" ? "Plan next week?" : "Set goals for this month?"}`,
    url: kind === "week" ? "/upcoming" : "/calendar",
    push: { tag: key },
    email: wantsEmail
      ? {
          subject: kind === "week" ? `Your week: ${summary}` : `${label} in review`,
          force: true,
          html: renderEmail({
            preheader: summary,
            title: kind === "week" ? "Your week in review" : `${label} in review`,
            subtitle: `${from} → ${to}`,
            sections: [
              {
                heading: "Tasks",
                items: [
                  { text: `${completed ?? 0} completed`, meta: `${rate}% of what was planned` },
                  { text: `${openInPeriod ?? 0} still open` },
                  { text: `${carried ?? 0} carried forward` },
                ],
              },
              {
                heading: "Learning",
                items: [
                  { text: `${days} days logged`, meta: `goal ${p.learning_goal_per_week}/week` },
                  ...(minutes ? [{ text: `${Math.round(minutes / 6) / 10} hours` }] : []),
                  ...(topTags.length ? [{ text: topTags.join("  ") }] : []),
                ],
              },
              { heading: "Job search", items: [{ text: `${matches ?? 0} strong matches found` }, { text: `${applied ?? 0} applications sent` }] },
            ],
            cta: { label: kind === "week" ? "Plan next week" : "Open calendar", href: kind === "week" ? "/upcoming" : "/calendar" },
          }),
        }
      : undefined,
  });
  if (r.sent) done.push(`${kind} review`);
}
