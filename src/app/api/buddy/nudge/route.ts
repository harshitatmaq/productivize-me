import { z } from "zod";
import { handle, HttpError, requireUser } from "@/lib/auth";
import { notify } from "@/lib/notify";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { localDateStr, safeTz } from "@/lib/time";

const Body = z.object({ to: z.string().uuid(), kind: z.enum(["cheer", "nudge"]) });

/** Send your buddy a cheer (👏) or a gentle nudge (⏰). Once per kind per day. */
export async function POST(request: Request) {
  return handle(async () => {
    const { user } = await requireUser();
    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new HttpError(400, "Invalid request");
    if (parsed.data.to === user.id) throw new HttpError(400, "That's you!");
    const admin = supabaseAdmin();
    const { data: people } = await admin.from("profiles").select("*").in("id", [user.id, parsed.data.to]);
    const me = people?.find((p) => p.id === user.id);
    const them = people?.find((p) => p.id === parsed.data.to);
    if (!me?.share_progress || !them?.share_progress) throw new HttpError(403, "Both of you need progress sharing turned on.");
    // Only between people who share a dashboard.
    const { data: mine } = await admin.from("space_members").select("space_id").eq("user_id", user.id);
    const { count } = await admin
      .from("space_members")
      .select("space_id", { count: "exact", head: true })
      .eq("user_id", parsed.data.to)
      .in("space_id", (mine ?? []).map((m) => m.space_id as string));
    if (!count) throw new HttpError(403, "You can only cheer people you share a dashboard with.");
    const name = (me.full_name || me.email || "Your buddy").split(" ")[0];
    const day = localDateStr(new Date(), safeTz(them.timezone));
    const r = await notify(them, {
      kind: "buddy",
      dedupeKey: `buddy:${user.id}:${parsed.data.kind}:${day}`,
      title: parsed.data.kind === "cheer" ? `👏 ${name} is cheering you on` : `⏰ ${name} nudged you`,
      body: parsed.data.kind === "cheer" ? "Nice progress this week — keep it going!" : "Quick check-in: what's the one task (or lesson) you'll finish today?",
      url: "/together",
      push: { tag: "buddy" },
    });
    if (!r.sent) throw new HttpError(429, `You already sent a ${parsed.data.kind} today.`);
    return { ok: true, channels: r.channels };
  });
}
