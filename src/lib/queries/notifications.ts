"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppNotification } from "@/lib/types";
import { sb, unwrap } from "./client";

export function useNotifications() {
  return useQuery({
    queryKey: ["notifications"],
    queryFn: async () =>
      unwrap(await sb().from("notifications").select("id, kind, title, body, url, channels, read_at, created_at").order("created_at", { ascending: false }).limit(40)) as AppNotification[],
    refetchInterval: 90_000,
  });
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) =>
      unwrap(await sb().from("notifications").update({ read_at: new Date().toISOString() }).in("id", ids)),
    onMutate: async (ids) => {
      const prev = qc.getQueryData<AppNotification[]>(["notifications"]);
      if (prev) qc.setQueryData(["notifications"], prev.map((n) => (ids.includes(n.id) ? { ...n, read_at: new Date().toISOString() } : n)));
    },
  });
}
