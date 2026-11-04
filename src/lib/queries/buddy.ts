"use client";

import { useQuery } from "@tanstack/react-query";
import type { BuddyStats } from "@/lib/types";
import { sb, unwrap } from "./client";

export function useBuddyStats(weekStart: string, enabled: boolean) {
  return useQuery({
    queryKey: ["buddy", weekStart],
    enabled,
    refetchInterval: 5 * 60_000,
    queryFn: async () => unwrap(await sb().rpc("buddy_stats", { p_week_start: weekStart })) as BuddyStats[],
  });
}
