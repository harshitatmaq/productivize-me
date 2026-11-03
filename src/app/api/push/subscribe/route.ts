import { z } from "zod";
import { handle, HttpError, requireUser } from "@/lib/auth";

const Body = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  deviceLabel: z.string().max(80).optional(),
});

/** Save this browser's push subscription. */
export async function POST(request: Request) {
  return handle(async () => {
    const { user, supabase } = await requireUser();
    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) throw new HttpError(400, "Invalid subscription");
    const { endpoint, keys, deviceLabel } = parsed.data;
    // An endpoint belongs to one browser; re-subscribing replaces any old owner row we can see.
    await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
    const { error } = await supabase.from("push_subscriptions").insert({
      user_id: user.id,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      user_agent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
      device_label: deviceLabel ?? null,
    });
    if (error) throw new HttpError(500, error.message);
    return { ok: true };
  });
}

export async function DELETE(request: Request) {
  return handle(async () => {
    const { supabase } = await requireUser();
    const { endpoint } = (await request.json().catch(() => ({}))) as { endpoint?: string };
    if (!endpoint) throw new HttpError(400, "endpoint required");
    await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
    return { ok: true };
  });
}
