"use client";

import { useQuery } from "@tanstack/react-query";
import type { BuddyStats } from "@/lib/types";
import { sb, unwrap } from "./client";

/** Weekly totals for you and the people you share a dashboard with (optionally one dashboard). */
export function useBuddyStats(weekStart: string, enabled: boolean, spaceId?: string | null) {
  return useQuery({
    queryKey: ["buddy", weekStart, spaceId ?? null],
    enabled,
    refetchInterval: 5 * 60_000,
    queryFn: async () =>
      unwrap(await sb().rpc("buddy_stats", { p_week_start: weekStart, ...(spaceId ? { p_space: spaceId } : {}) })) as BuddyStats[],
  });
}
