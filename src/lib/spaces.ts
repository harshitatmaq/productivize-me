import "server-only";

import { notify, type NotifyProfile } from "@/lib/notify";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const KIND_LABEL: Record<string, string> = {
  task: "a task",
  job: "a job",
  learning: "a learning note",
  link: "a link",
  flashcards: "flashcards",
  interest: "an interest",
  note: "a note",
};

/** Push + in-app notification to everyone in the dashboard except `exceptUserId`. */
export async function notifyMembers(params: {
  spaceIds: string[];
  exceptUserId: string;
  onlyUserIds?: string[];
  title: (spaceName: string) => string;
  body?: string;
  url: (spaceId: string) => string;
  dedupe: (spaceId: string, userId: string) => string;
}) {
  const admin = supabaseAdmin();
  const { data: members } = await admin.from("space_members").select("space_id, user_id").in("space_id", params.spaceIds);
  const targets = (members ?? []).filter(
    (m) => m.user_id !== params.exceptUserId && (!params.onlyUserIds || params.onlyUserIds.includes(m.user_id as string)),
  );
  if (!targets.length) return;
  const [{ data: spaces }, { data: profiles }] = await Promise.all([
    admin.from("spaces").select("id, name").in("id", params.spaceIds),
    admin.from("profiles").select("id, email, notify_push, notify_email, email_alerts").in("id", [...new Set(targets.map((t) => t.user_id as string))]),
  ]);
  await Promise.all(
    targets.map(async (t) => {
      const p = (profiles ?? []).find((x) => x.id === t.user_id) as NotifyProfile | undefined;
      const s = (spaces ?? []).find((x) => x.id === t.space_id);
      if (!p || !s) return;
      await notify(p, {
        kind: "space",
        dedupeKey: params.dedupe(t.space_id as string, t.user_id as string),
        title: params.title(s.name as string),
        body: params.body,
        url: params.url(t.space_id as string),
        push: { tag: `space-${t.space_id}` },
      }).catch((e) => console.warn("[spaces] notify failed", (e as Error).message));
    }),
  );
}

export async function displayName(userId: string): Promise<string> {
  const { data } = await supabaseAdmin().from("profiles").select("full_name, email").eq("id", userId).maybeSingle();
  return ((data?.full_name as string) || (data?.email as string) || "Someone").split(" ")[0];
}
