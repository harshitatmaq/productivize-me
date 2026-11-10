"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { factKey, type Fact, type FactKind } from "@/lib/memory/facts";
import { api } from "@/lib/utils";
import { sb, unwrap } from "./client";

const KEY = ["user-facts"] as const;

/** Everything the AI knows about you (Settings → What the AI knows). */
export function useFacts() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () =>
      unwrap(await sb().from("user_facts").select("*").order("pinned", { ascending: false }).order("confidence", { ascending: false })) as Fact[],
  });
}

export function useUpdateFact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Fact> }) => {
      // Editing the words makes it yours.
      const full = patch.statement
        ? {
            ...patch,
            key: factKey(patch.statement),
            source: "you" as const,
            confidence: 100,
          }
        : patch;
      return unwrap(await sb().from("user_facts").update(full).eq("id", id).select("*").single()) as Fact;
    },
    onMutate: ({ id, patch }) => qc.setQueryData<Fact[]>(KEY, (prev) => prev?.map((f) => (f.id === id ? { ...f, ...patch } : f))),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteFact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await sb().from("user_facts").delete().eq("id", id)),
    onMutate: (id) => qc.setQueryData<Fact[]>(KEY, (prev) => prev?.filter((f) => f.id !== id)),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useAddFact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { statement: string; kind: FactKind }) =>
      api<{ fact: Fact }>("/api/preferences/memory", {
        json: { action: "add", ...v },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export type LearnResult = {
  added: number;
  suggested: number;
  confirmed: number;
  questions: number;
  skipped?: string;
};

export function useLearnNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<LearnResult>("/api/preferences/memory", {
        json: { action: "learn" },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["memory-questions"] });
      qc.invalidateQueries({ queryKey: ["profile"] });
    },
  });
}

export function useMemoryAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { action: "routine"; id: string } | { action: "forget-learned" }) => api<{ ok: true }>("/api/preferences/memory", { json: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["profile"] });
      qc.invalidateQueries({ queryKey: ["memory-questions"] });
    },
  });
}
