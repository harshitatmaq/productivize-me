"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LearningEntry } from "@/lib/types";
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
