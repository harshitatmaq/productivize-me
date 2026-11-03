"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Reminder } from "@/lib/types";
import { sb, unwrap } from "./client";

const KEY = ["reminders"];

export function useReminders() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => unwrap(await sb().from("reminders").select("*").order("next_fire_at", { nullsFirst: false })) as Reminder[],
  });
}

export function useSaveReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (r: Partial<Reminder> & { title: string }) => {
      const { id, ...rest } = r;
      return id
        ? (unwrap(await sb().from("reminders").update(rest).eq("id", id).select("*").single()) as Reminder)
        : (unwrap(await sb().from("reminders").insert(rest).select("*").single()) as Reminder);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await sb().from("reminders").delete().eq("id", id)),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
