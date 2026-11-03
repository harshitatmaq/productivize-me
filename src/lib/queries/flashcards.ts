"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Grade } from "ts-fsrs";
import { newCard, review } from "@/lib/fsrs";
import type { Flashcard } from "@/lib/types";
import { api } from "@/lib/utils";
import { sb, unwrap } from "./client";

const KEY = ["flashcards"];

export function useFlashcards() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () =>
      unwrap(await sb().from("flashcards").select("*").eq("suspended", false).order("due").limit(2000)) as Flashcard[],
    refetchInterval: 10 * 60_000,
  });
}

export function useReviewCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ card, grade }: { card: Flashcard; grade: Grade }) => {
      const patch = review(card.card, grade);
      return unwrap(await sb().from("flashcards").update(patch).eq("id", card.id).select("*").single()) as Flashcard;
    },
    onSuccess: (updated) => {
      const prev = qc.getQueryData<Flashcard[]>(KEY);
      if (prev) qc.setQueryData(KEY, prev.map((c) => (c.id === updated.id ? updated : c)));
    },
  });
}

export function useAddCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (c: { front: string; back: string; entry_id?: string | null; tags?: string[] }) =>
      unwrap(await sb().from("flashcards").insert({ ...c, card: newCard(), due: new Date().toISOString() }).select("*").single()) as Flashcard,
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Flashcard> }) =>
      unwrap(await sb().from("flashcards").update(patch).eq("id", id).select("*").single()) as Flashcard,
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await sb().from("flashcards").delete().eq("id", id)),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useGenerateCards() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entryId: string) => api<{ cards: Flashcard[] }>("/api/learning/flashcards", { json: { entryId } }),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
