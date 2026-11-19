"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LearningEntry } from "@/lib/types";
import { api } from "@/lib/utils";
import { mergeTopicPlan, type MapLink, type MergeEntry } from "@/lib/learning-map";
import { sb, unwrap } from "./client";

const KEY = ["learning"];

export function useLearning() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () =>
      unwrap(await sb().from("learning_entries").select("*").order("entry_date", { ascending: false }).order("created_at", { ascending: false }).limit(1500)) as LearningEntry[],
  });
}

export function useSaveLearning() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (e: Partial<LearningEntry> & { title: string }) => {
      const { id, ...rest } = e;
      return id
        ? (unwrap(await sb().from("learning_entries").update(rest).eq("id", id).select("*").single()) as LearningEntry)
        : (unwrap(await sb().from("learning_entries").insert(rest).select("*").single()) as LearningEntry);
    },
    onSuccess: (entry) => {
      // Learning map: link the entry to its topics in the background (one small AI call).
      api("/api/learning/connect", { json: { entryIds: [entry.id] } })
        .then(() => {
          qc.invalidateQueries({ queryKey: KEY });
          qc.invalidateQueries({ queryKey: ["topic-links"] });
        })
        .catch(() => {});
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteLearning() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await sb().from("learning_entries").delete().eq("id", id)),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Learning map: how your topics connect. */
export function useTopicLinks() {
  return useQuery({
    queryKey: ["topic-links"],
    queryFn: async () => unwrap(await sb().from("topic_links").select("from_topic, to_topic, kind, why").limit(2000)) as { from_topic: string; to_topic: string; kind: "prereq" | "related"; why: string | null }[],
  });
}

/** Connects up to 6 entries per call (used to map past entries). */
export function useConnectEntries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entryIds: string[]) => api<{ connected: number }>("/api/learning/connect", { json: { entryIds } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["topic-links"] });
    },
  });
}


/** Learning map → Merge: renames a topic into another across your entries and topic links. */
export function useMergeTopics() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ from, into, entries, links }: { from: string; into: string; entries: MergeEntry[]; links: MapLink[] }) => {
      const plan = mergeTopicPlan(entries, links, from, into);
      for (const u of plan.entryUpdates) {
        unwrap(await sb().from("learning_entries").update({ topics: u.topics, connections: u.connections }).eq("id", u.id));
      }
      for (const d of plan.linkDeletes) {
        unwrap(await sb().from("topic_links").delete().eq("from_topic", d.from_topic).eq("to_topic", d.to_topic));
      }
      if (plan.linkInserts.length) {
        const { data: u } = await sb().auth.getUser();
        unwrap(
          await sb()
            .from("topic_links")
            .upsert(
              plan.linkInserts.map((l) => ({ user_id: u.user!.id, from_topic: l.from_topic, to_topic: l.to_topic, kind: l.kind, why: l.why ?? null })),
              { onConflict: "user_id,from_topic,to_topic", ignoreDuplicates: true },
            ),
        );
      }
      return { entries: plan.entryUpdates.length };
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["topic-links"] });
    },
  });
}
