"use client";

import { QueryClient } from "@tanstack/react-query";
import { supabaseBrowser } from "@/lib/supabase/client";

export const sb = () => supabaseBrowser();

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, refetchOnWindowFocus: true, retry: 1 },
      mutations: { retry: 0 },
    },
  });
}

export function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}
