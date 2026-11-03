import { z } from "zod";
import { handle, HttpError, requireUser } from "@/lib/auth";

const Body = z.object({ id: z.string().uuid(), action: z.enum(["done", "snooze"]), minutes: z.number().int().min(5).max(1440).optional() });

/** Used by notification action buttons (service worker). */
export async function POST(request: Request) {
  return handle(async () => {
    const { supabase } = await requireUser();
    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new HttpError(400, "Invalid request");
    const { id, action, minutes } = parsed.data;
    const patch =
      action === "done"
        ? { status: "done" }
        : { reminder_at: new Date(Date.now() + (minutes ?? 60) * 60_000).toISOString(), reminder_sent_at: null };
    const { error } = await supabase.from("tasks").update(patch).eq("id", id);
    if (error) throw new HttpError(500, error.message);
    return { ok: true };
  });
}
