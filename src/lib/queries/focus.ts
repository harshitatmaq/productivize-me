"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FocusSession } from "@/lib/types";
import { sb, unwrap } from "./client";

export function useFocusSessions(sinceIso: string) {
  return useQuery({
    queryKey: ["focus", sinceIso],
    queryFn: async () =>
      unwrap(await sb().from("focus_sessions").select("*").gte("started_at", sinceIso).order("started_at", { ascending: false }).limit(500)) as FocusSession[],
  });
}

export function useLogFocus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (s: Omit<FocusSession, "id">) => unwrap(await sb().from("focus_sessions").insert(s).select("*").single()) as FocusSession,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["focus"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}
