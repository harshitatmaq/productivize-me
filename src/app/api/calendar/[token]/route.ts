import { connection } from "next/server";
import { buildCalendar, toRrule, type IcsEvent } from "@/lib/ics";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { addDays, localDateStr, safeTz } from "@/lib/time";

/**
 * Private, read-only iCalendar feed (subscribe from Google / Apple / Outlook).
 * The token in the URL is the only credential — rotate it in Settings if it leaks.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await ctx.params;
  const clean = token.replace(/\.ics$/, "");
  if (!/^[A-Za-z0-9_-]{24,}$/.test(clean)) return new Response("Not found", { status: 404 });
  const admin = supabaseAdmin();
  const { data: profile } = await admin.from("profiles").select("id, timezone, full_name").eq("calendar_token", clean).maybeSingle();
  if (!profile) return new Response("Not found", { status: 404 });
  const tz = safeTz(profile.timezone, "Asia/Kolkata");
  const today = localDateStr(new Date(), tz);

  const [{ data: tasks }, { data: reminders }] = await Promise.all([
    admin
      .from("tasks")
      .select("id, title, notes, due_date, due_time, estimate_minutes, status, priority, tags, completed_at")
      .eq("user_id", profile.id)
      .not("due_date", "is", null)
      .gte("due_date", addDays(today, -14))
      .lte("due_date", addDays(today, 120))
      .neq("status", "dropped")
      .limit(1500),
    admin.from("reminders").select("*").eq("user_id", profile.id).eq("active", true).limit(200),
  ]);

  const events: IcsEvent[] = [];
  for (const t of tasks ?? []) {
    events.push({
      uid: `task-${t.id}@productivize`,
      summary: `${t.status === "done" ? "✓ " : t.priority === 1 ? "‼ " : ""}${t.title}`,
      description: t.notes ?? undefined,
      date: t.due_date!,
      time: t.due_time,
      durationMin: t.estimate_minutes ?? 30,
      categories: t.tags,
    });
  }
  for (const r of reminders ?? []) {
    events.push({
      uid: `reminder-${r.id}@productivize`,
      summary: `🔔 ${r.title}`,
      description: r.notes ?? undefined,
      date: r.frequency === "once" ? r.start_date : r.start_date,
      time: r.time_of_day,
      durationMin: 15,
      rrule: toRrule(r),
    });
  }

  const body = buildCalendar({ name: `Productivize${profile.full_name ? ` · ${profile.full_name.split(" ")[0]}` : ""}`, tz, events });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="productivize.ics"',
      "Cache-Control": "private, max-age=300",
    },
  });
}
