import { handle, HttpError, requireUser } from "@/lib/auth";
import { pushConfigured, sendPushToUser } from "@/lib/notify/push";

export async function POST() {
  return handle(async () => {
    const { user } = await requireUser();
    if (!pushConfigured()) throw new HttpError(400, "Push is not configured on the server (VAPID keys missing).");
    const delivered = await sendPushToUser(user.id, {
      title: "✅ Notifications work",
      body: "You'll get reminders, end-of-day reviews and job alerts here.",
      url: "/settings",
      tag: "test",
    });
    if (!delivered) throw new HttpError(400, "No device received it. Enable notifications on this device first.");
    return { ok: true, delivered };
  });
}
