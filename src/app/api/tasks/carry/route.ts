import { z } from "zod";
import { handle, HttpError, requireUser } from "@/lib/auth";
import { addDays, localDateStr, safeTz } from "@/lib/time";

const Body = z
  .object({
    to: z.union([z.literal("today"), z.literal("tomorrow"), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional(),
    ids: z.array(z.string().uuid()).max(500).optional(),
    until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .default({});

/**
 * Carries unfinished tasks forward. With no body: everything unfinished up to
 * today moves to tomorrow (this is what the notification button does).
 */
export async function POST(request: Request) {
  return handle(async () => {
    const { user, supabase } = await requireUser();
    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new HttpError(400, "Invalid request");
    const { data: profile } = await supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle();
    const today = localDateStr(new Date(), safeTz(profile?.timezone, "Asia/Kolkata"));
    const toRaw = parsed.data.to ?? "tomorrow";
    const to = toRaw === "today" ? today : toRaw === "tomorrow" ? addDays(today, 1) : toRaw;
    const { data, error } = await supabase.rpc("carry_tasks", {
      p_to: to,
      p_ids: parsed.data.ids ?? null,
      p_until: parsed.data.ids ? null : (parsed.data.until ?? (to > today ? today : addDays(today, -1))),
      p_user: user.id,
    });
    if (error) throw new HttpError(500, error.message);
    return { ok: true, moved: data ?? 0, to };
  });
}
