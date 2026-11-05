import { after } from "next/server";
import { z } from "zod";
import { handle, HttpError, requireUser } from "@/lib/auth";
import { displayName, notifyMembers } from "@/lib/spaces";

const Body = z.object({ itemId: z.string().uuid(), body: z.string().trim().min(1).max(2000) });

/** Comment on a shared item; the person who shared it (and earlier commenters) get notified. */
export async function POST(request: Request) {
  return handle(async () => {
    const { user, supabase } = await requireUser();
    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new HttpError(400, "Write a comment first.");
    const { data: item } = await supabase.from("space_items").select("id, space_id, title, shared_by").eq("id", parsed.data.itemId).maybeSingle();
    if (!item) throw new HttpError(404, "That item is gone.");
    const { data: comment, error } = await supabase
      .from("space_comments")
      .insert({ item_id: item.id, space_id: item.space_id, body: parsed.data.body, user_id: user.id })
      .select("*")
      .single();
    if (error) throw new HttpError(403, error.message);

    after(async () => {
      const { data: earlier } = await supabase.from("space_comments").select("user_id").eq("item_id", item.id);
      const who = await displayName(user.id);
      await notifyMembers({
        spaceIds: [item.space_id],
        exceptUserId: user.id,
        onlyUserIds: [...new Set([item.shared_by, ...(earlier ?? []).map((c) => c.user_id)].filter(Boolean) as string[])],
        title: () => `${who} commented on “${item.title.slice(0, 60)}”`,
        body: parsed.data.body.slice(0, 160),
        url: (spaceId) => `/together?space=${spaceId}&item=${item.id}`,
        dedupe: (_s, uid) => `comment:${comment.id}:${uid}`,
      });
    });
    return { ok: true, comment };
  });
}
