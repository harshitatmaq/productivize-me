import { after } from "next/server";
import { z } from "zod";
import { handle, HttpError, requireUser } from "@/lib/auth";
import { displayName, KIND_LABEL, notifyMembers } from "@/lib/spaces";

const Body = z.object({
  spaceIds: z.array(z.string().uuid()).min(1).max(10),
  kind: z.enum(["task", "job", "learning", "link", "flashcards", "interest", "note"]),
  title: z.string().trim().min(1).max(300),
  body: z.string().max(20000).nullish(),
  payload: z.record(z.string(), z.unknown()).default({}),
  note: z.string().trim().max(2000).optional(),
  sourceId: z.string().uuid().nullish(),
});

/** "Share to…": puts a copy into each chosen dashboard and tells the other members. */
export async function POST(request: Request) {
  return handle(async () => {
    const { user, supabase } = await requireUser();
    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new HttpError(400, "Nothing to share.");
    const v = parsed.data;
    if (JSON.stringify(v.payload).length > 60_000) throw new HttpError(413, "That's too big to share.");
    const rows = v.spaceIds.map((space_id) => ({
      space_id,
      kind: v.kind,
      title: v.title,
      body: v.body ?? null,
      payload: v.payload,
      note: v.note || null,
      source_id: v.sourceId ?? null,
      shared_by: user.id,
    }));
    // RLS: you can only share into dashboards you're a member of.
    const { data: items, error } = await supabase.from("space_items").insert(rows).select("*");
    if (error) throw new HttpError(403, error.message);

    after(async () => {
      const who = await displayName(user.id);
      await notifyMembers({
        spaceIds: v.spaceIds,
        exceptUserId: user.id,
        title: (space) => `${who} shared ${KIND_LABEL[v.kind]} in ${space}`,
        body: v.note ? `${v.title} — “${v.note.slice(0, 120)}”` : v.title,
        url: (spaceId) => `/together?space=${spaceId}`,
        dedupe: (spaceId, uid) => `share:${items?.find((i) => i.space_id === spaceId)?.id}:${uid}`,
      });
    });
    return { ok: true, items };
  });
}
