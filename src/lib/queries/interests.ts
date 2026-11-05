"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useToday } from "@/lib/hooks";
import type { Interest, MemoryQuestion } from "@/lib/types";
import { api } from "@/lib/utils";
import { sb, unwrap } from "./client";

const KEY = ["interests"] as const;

export function useInterests() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => unwrap(await sb().from("interests").select("*").order("strength", { ascending: false }).order("name")) as Interest[],
  });
}

export function useAddInterest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { name: string; kind: Interest["kind"] }) => {
      const res = await sb().from("interests").insert({ ...v, status: "active", source: "manual", strength: 25 }).select("*").single();
      if (res.error?.code === "23505") throw new Error(`“${v.name}” is already in your interests.`);
      return unwrap(res) as Interest;
    },
    onSuccess: (row) => qc.setQueryData<Interest[]>(KEY, (prev) => [row, ...(prev ?? [])]),
  });
}

export function useUpdateInterest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Interest> }) =>
      unwrap(await sb().from("interests").update(patch).eq("id", id).select("*").single()) as Interest,
    onMutate: ({ id, patch }) => qc.setQueryData<Interest[]>(KEY, (prev) => prev?.map((i) => (i.id === id ? { ...i, ...patch } : i))),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteInterest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await sb().from("interests").delete().eq("id", id)),
    onMutate: (id) => qc.setQueryData<Interest[]>(KEY, (prev) => prev?.filter((i) => i.id !== id)),
  });
}

export function useRefreshMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ suggested: string[]; updated: number; questions: number }>("/api/interests/refresh", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["memory-questions"] });
    },
  });
}

/**
 * Scout's check-in questions — at most 2 shown per day. Questions shown today keep
 * their slot (even once answered), so answering doesn't pull in a third.
 */
export function useCheckIns() {
  const today = useToday();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["memory-questions", today],
    queryFn: async () => {
      const rows = unwrap(await sb().from("memory_questions").select("*").or(`status.eq.pending,shown_on.eq.${today}`).order("created_at")) as MemoryQuestion[];
      const now = Date.now();
      const shownToday = rows.filter((r) => r.shown_on === today);
      const slots = Math.max(0, 2 - shownToday.length);
      const fresh = rows.filter((r) => r.status === "pending" && r.shown_on !== today && (!r.snooze_until || Date.parse(r.snooze_until) <= now)).slice(0, slots);
      return { shown: [...shownToday.filter((r) => r.status === "pending"), ...fresh], claim: fresh.map((r) => r.id) };
    },
  });
  const claim = q.data?.claim ?? [];
  useEffect(() => {
    if (!claim.length) return;
    sb()
      .from("memory_questions")
      .update({ shown_on: today })
      .in("id", claim)
      .then(() => {});
  }, [claim.join(","), today]); // eslint-disable-line react-hooks/exhaustive-deps
  const answer = useMutation({
    mutationFn: (v: { id: string; answer: "yes" | "no" | "later" }) => api<{ message: string }>("/api/interests/answer", { json: v }),
    onMutate: (v) =>
      qc.setQueryData<{ shown: MemoryQuestion[]; claim: string[] }>(["memory-questions", today], (prev) =>
        prev ? { shown: prev.shown.filter((x) => x.id !== v.id), claim: [] } : prev,
      ),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["job-profile"] });
    },
  });
  return { questions: q.data?.shown ?? [], answer };
}
