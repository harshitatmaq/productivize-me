"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LearningEntry } from "@/lib/types";
import { api } from "@/lib/utils";
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

