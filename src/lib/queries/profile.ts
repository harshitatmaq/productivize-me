"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import type { Profile } from "@/lib/types";
import { sb, unwrap } from "./client";

export function useUser() {
  return useQuery({
    queryKey: ["user"],
    queryFn: async (): Promise<User | null> => {
      const { data } = await sb().auth.getUser();
      return data.user;
    },
    staleTime: 5 * 60_000,
  });
}

export function useProfile() {
  const { data: user } = useUser();
  return useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    queryFn: async () => unwrap(await sb().from("profiles").select("*").eq("id", user!.id).single()) as Profile,
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  const { data: user } = useUser();
  return useMutation({
    mutationFn: async (patch: Partial<Profile>) =>
      unwrap(await sb().from("profiles").update(patch).eq("id", user!.id).select("*").single()) as Profile,
    onMutate: async (patch) => {
      const key = ["profile", user?.id];
      const prev = qc.getQueryData<Profile>(key);
      if (prev) qc.setQueryData(key, { ...prev, ...patch });
      return { prev };
    },
    onError: (_e, _p, ctx) => ctx?.prev && qc.setQueryData(["profile", user?.id], ctx.prev),
    onSuccess: (data) => qc.setQueryData(["profile", user?.id], data),
  });
}
