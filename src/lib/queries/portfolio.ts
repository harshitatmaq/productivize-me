"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { normalizePortfolio } from "@/lib/portfolio";
import type { PortfolioRow } from "@/lib/types";
import { sb, unwrap } from "./client";

export function usePortfolio() {
  return useQuery({
    queryKey: ["portfolio"],
    queryFn: async () => {
      const row = unwrap(await sb().from("portfolios").select("*").maybeSingle()) as PortfolioRow | null;
      return row ? { ...row, data: normalizePortfolio(row.data) } : null;
    },
  });
}

export function useSavePortfolio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<PortfolioRow>) => {
      const { data: u } = await sb().auth.getUser();
      const row = unwrap(await sb().from("portfolios").upsert({ user_id: u.user!.id, ...patch }).select("*").single()) as PortfolioRow;
      return { ...row, data: normalizePortfolio(row.data) };
    },
    onSuccess: (row) => qc.setQueryData(["portfolio"], row),
  });
}
