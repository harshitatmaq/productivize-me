import "server-only";

import webpush from "web-push";
import { env } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type PushPayload = {
  title: string;
  body?: string;
  url?: string;
  tag?: string;
  /** Notification action buttons (Android/desktop; iOS ignores them). */
  actions?: { action: string; title: string }[];
  data?: Record<string, unknown>;
  requireInteraction?: boolean;
};

let configured: boolean | null = null;

export function pushConfigured(): boolean {
  if (configured !== null) return configured;
  const pub = env("NEXT_PUBLIC_VAPID_PUBLIC_KEY");
  const priv = env("VAPID_PRIVATE_KEY");
  if (!pub || !priv) return (configured = false);
  webpush.setVapidDetails(env("VAPID_SUBJECT") ?? "mailto:admin@example.com", pub, priv);
  return (configured = true);
}

/** Sends to every registered device of the user. Dead subscriptions are removed. */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  if (!pushConfigured()) return 0;
  const admin = supabaseAdmin();
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);
  if (!subs?.length) return 0;

  let delivered = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          { TTL: 60 * 60 * 12, urgency: "normal", topic: payload.tag?.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) },
        );
        delivered++;
        await admin.from("push_subscriptions").update({ last_success_at: new Date().toISOString() }).eq("id", s.id);
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await admin.from("push_subscriptions").delete().eq("id", s.id);
        } else {
          console.warn(`[push] send failed (${status}):`, (e as Error).message);
        }
      }
    }),
  );
  return delivered;
}
