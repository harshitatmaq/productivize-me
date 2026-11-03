import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { emailConfigured, sendEmail } from "./email";
import { sendPushToUser, type PushPayload } from "./push";

export type NotifyProfile = {
  id: string;
  email: string | null;
  notify_push: boolean;
  notify_email: boolean;
  email_alerts?: boolean;
};

export type NotifyInput = {
  kind: string;
  /** Same key twice = sent once. Use e.g. `eod:2026-11-03`. */
  dedupeKey?: string;
  title: string;
  body?: string;
  url?: string;
  push?: Partial<PushPayload>;
  /** Send this email too (respecting the user's email settings). */
  email?: { subject: string; html: string; text?: string; force?: boolean };
  data?: Record<string, unknown>;
};

/**
 * Records an in-app notification (idempotent on dedupeKey) and fans it out
 * to push and/or email. Returns false when it was already sent before.
 */
export async function notify(profile: NotifyProfile, input: NotifyInput): Promise<{ sent: boolean; channels: string[] }> {
  const admin = supabaseAdmin();
  const row = {
    user_id: profile.id,
    kind: input.kind,
    title: input.title,
    body: input.body ?? null,
    url: input.url ?? null,
    data: input.data ?? {},
    ...(input.dedupeKey ? { dedupe_key: input.dedupeKey } : {}),
  };
  const { data: inserted, error } = await admin
    .from("notifications")
    .upsert(row, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true })
    .select("id");
  if (error) {
    console.warn("[notify] could not record notification:", error.message);
    return { sent: false, channels: [] };
  }
  if (!inserted?.length) return { sent: false, channels: [] };

  const channels: string[] = ["in-app"];
  if (profile.notify_push) {
    const n = await sendPushToUser(profile.id, {
      title: input.title,
      body: input.body,
      url: input.url ?? "/",
      tag: input.push?.tag ?? input.kind,
      actions: input.push?.actions,
      requireInteraction: input.push?.requireInteraction,
      data: { ...(input.push?.data ?? {}), notificationId: inserted[0].id },
    });
    if (n > 0) channels.push("push");
  }
  if (input.email && profile.email && emailConfigured() && profile.notify_email) {
    if (input.email.force || profile.email_alerts !== false) {
      const ok = await sendEmail({ to: profile.email, ...input.email });
      if (ok) channels.push("email");
    }
  }
  await admin.from("notifications").update({ channels }).eq("id", inserted[0].id);
  return { sent: true, channels };
}
