import { after } from "next/server";
import { z } from "zod";
import { handle, HttpError } from "@/lib/auth";
import { requireMember } from "@/lib/chat/server";
import { notify, type NotifyProfile } from "@/lib/notify";
import { sendPushToUser } from "@/lib/notify/push";
import { supabaseAdmin } from "@/lib/supabase/admin";

const Body = z.object({
  spaceId: z.string().uuid(),
  messageId: z.string().uuid(),
  /** People who have the chat open right now (presence) — they see it already. */
  skip: z.array(z.string().uuid()).max(50).default([]),
});

/**
 * Called by the sender's app once a chat message is delivered: push it to the
 * others in the dashboard who aren't looking at the chat. Ordinary messages are
 * push-only (one replaceable notification per dashboard); @mentions are pings —
 * recorded in the inbox and kept on screen until dismissed.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new HttpError(400, "Invalid request");
    const { spaceId, messageId, skip } = parsed.data;
    const { user, supabase, name } = await requireMember(spaceId);

    const { data: msg } = await supabase.from("chat_messages").select("id, sender, body, image_path, mentions, created_at, space_id").eq("id", messageId).maybeSingle();
    if (!msg || msg.sender !== user.id || msg.space_id !== spaceId) throw new HttpError(404, "Message not found");
    if (Date.now() - Date.parse(msg.created_at) > 10 * 60_000) return { ok: true, sent: 0 };

    after(async () => {
      const admin = supabaseAdmin();
      const [{ data: space }, { data: members }] = await Promise.all([
        admin.from("spaces").select("name").eq("id", spaceId).maybeSingle(),
        admin.from("space_members").select("user_id").eq("space_id", spaceId),
      ]);
      const targets = (members ?? []).map((m) => m.user_id as string).filter((id) => id !== user.id);
      if (!targets.length) return;
      const { data: profiles } = await admin.from("profiles").select("id, email, notify_push, notify_email, email_alerts").in("id", targets);
      const text = (msg.body as string | null)?.trim() || (msg.image_path ? "📷 Photo" : "New message");
      const url = `/together?space=${spaceId}&tab=chat`;
      const mentions = (msg.mentions as string[]) ?? [];
      await Promise.all(
        ((profiles ?? []) as NotifyProfile[]).map(async (p) => {
          const pinged = mentions.includes(p.id);
          if (pinged) {
            // A ping interrupts even if they're in the chat.
            await notify(p, {
              kind: "chat",
              dedupeKey: `chat-ping:${messageId}:${p.id}`,
              title: `🔔 ${name} needs you · ${space?.name ?? "Chat"}`,
              body: text.slice(0, 200),
              url,
              push: { tag: `chat-ping-${messageId}`, requireInteraction: true },
            });
            return;
          }
          if (skip.includes(p.id) || !p.notify_push) return;
          await sendPushToUser(p.id, { title: `${name} · ${space?.name ?? "Chat"}`, body: text.slice(0, 200), url, tag: `chat-${spaceId}` });
        }),
      );
    });
    return { ok: true };
  });
}
