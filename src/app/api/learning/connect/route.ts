import { z } from "zod";
import { chatJson } from "@/lib/ai/llm";
import { handle, HttpError, requireUser } from "@/lib/auth";

export const maxDuration = 90;

const Body = z.object({ entryIds: z.array(z.string().uuid()).min(1).max(6) });

type Out = { topics: string[]; builds_on: { topic: string; why?: string }[]; leads_to: { topic: string; why?: string }[] };
const clean = (t: unknown) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, 60);

/** Learning map: which topics an entry is about, and what it builds on / leads to (one small AI call each). */
export async function POST(request: Request) {
  return handle(async () => {
    const { user, supabase } = await requireUser();
    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new HttpError(400, "Invalid request");
    const [{ data: entries }, { data: recent }, { data: interests }] = await Promise.all([
      supabase.from("learning_entries").select("id, title, content, tags").in("id", parsed.data.entryIds),
      supabase.from("learning_entries").select("title, topics").order("entry_date", { ascending: false }).limit(40),
      supabase.from("interests").select("name").neq("status", "not_interested").limit(60),
    ]);
    const known = [...new Set([...(recent ?? []).flatMap((r) => (r.topics as string[] | null) ?? []), ...(interests ?? []).map((i) => i.name as string)])].slice(0, 120);
    let done = 0;
    for (const e of entries ?? []) {
      try {
        const { data } = await chatJson<Out>(
          {
            purpose: "learning-connect",
            temperature: 0.1,
            maxTokens: 500,
            deadlineMs: 30_000,
            messages: [
              {
                role: "system",
                content: `You map what someone learned into topics and how topics connect, for their learning map.
Return ONLY JSON: {"topics":["1-3 topic names, 1-4 words, Title Case — reuse an existing topic name when it's the same concept"],"builds_on":[{"topic":"a prerequisite this relies on (prefer existing topics)","why":"max 12 words"}],"leads_to":[{"topic":"a natural next topic","why":"max 12 words"}]}
At most 3 builds_on and 3 leads_to. Be concrete (e.g. "SQL Joins", "Query Optimization", "Kafka Consumer Groups"), not vague ("Programming").`,
              },
              {
                role: "user",
                content: `Existing topics: ${known.join(", ") || "none yet"}\n\nRecent entries:\n${(recent ?? [])
                  .slice(0, 12)
                  .map((r) => `- ${r.title}${(r.topics as string[] | null)?.length ? ` → ${(r.topics as string[]).join(", ")}` : ""}`)
                  .join("\n")}\n\nThis entry:\n${e.title}\nTags: ${((e.tags as string[]) ?? []).join(", ")}\n${String(e.content ?? "").slice(0, 2000)}`,
              },
            ],
          },
          (v) => {
            const o = v as Partial<Out>;
            if (!Array.isArray(o.topics) || !o.topics.length) throw new Error("no topics");
            return o as Out;
          },
        );
        const topics = [...new Set(data.topics.map(clean).filter((t) => t.length > 1))].slice(0, 3);
        const builds = (data.builds_on ?? []).map((b) => ({ topic: clean(b.topic), why: clean(b.why) })).filter((b) => b.topic.length > 1 && !topics.includes(b.topic)).slice(0, 3);
        const leads = (data.leads_to ?? []).map((b) => ({ topic: clean(b.topic), why: clean(b.why) })).filter((b) => b.topic.length > 1 && !topics.includes(b.topic)).slice(0, 3);
        await supabase
          .from("learning_entries")
          .update({ topics, connections: [...builds.map((b) => ({ kind: "builds_on", ...b })), ...leads.map((b) => ({ kind: "leads_to", ...b }))] })
          .eq("id", e.id);
        const links = [
          ...builds.flatMap((b) => topics.map((t) => ({ user_id: user.id, from_topic: b.topic, to_topic: t, kind: "prereq", why: b.why || null }))),
          ...leads.map((l) => ({ user_id: user.id, from_topic: topics[0], to_topic: l.topic, kind: "prereq", why: l.why || null })),
          ...topics.slice(1).map((t) => ({ user_id: user.id, from_topic: topics[0], to_topic: t, kind: "related", why: null })),
        ];
        if (links.length) await supabase.from("topic_links").upsert(links, { onConflict: "user_id,from_topic,to_topic", ignoreDuplicates: true });
        known.push(...topics.filter((t) => !known.includes(t)));
        done++;
      } catch {
        // skip this entry; it can be connected later
      }
    }
    return { ok: true, connected: done };
  });
}
