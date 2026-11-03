"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Job, JobProfileRow, JobRun } from "@/lib/types";
import { sb, unwrap } from "./client";

export function useJobs() {
  return useQuery({
    queryKey: ["jobs"],
    queryFn: async () =>
      unwrap(await sb().from("jobs").select("*").order("created_at", { ascending: false }).limit(1500)) as Job[],
    refetchInterval: 5 * 60_000,
  });
}

export function useJobProfile() {
  return useQuery({
    queryKey: ["job-profile"],
    queryFn: async () => unwrap(await sb().from("job_profiles").select("*").maybeSingle()) as JobProfileRow | null,
  });
}

export function useJobRuns() {
  return useQuery({
    queryKey: ["job-runs"],
    queryFn: async () => unwrap(await sb().from("job_search_runs").select("*").order("started_at", { ascending: false }).limit(15)) as JobRun[],
    refetchInterval: 60_000,
  });
}

export function useUpdateJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Job> }) =>
      unwrap(await sb().from("jobs").update(patch).eq("id", id).select("*").single()) as Job,
    onMutate: async ({ id, patch }) => {
      const prev = qc.getQueryData<Job[]>(["jobs"]);
      if (prev) qc.setQueryData(["jobs"], prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(["jobs"], ctx.prev),
    onSuccess: (job, vars) => {
      const prev = qc.getQueryData<Job[]>(["jobs"]);
      if (prev) qc.setQueryData(["jobs"], prev.map((j) => (j.id === job.id ? job : j)));
      // Status / next-step changes create or close follow-up tasks in the database.
      if ("status" in vars.patch || "next_step_date" in vars.patch || "next_step" in vars.patch) {
        qc.invalidateQueries({ queryKey: ["tasks"] });
      }
    },
  });
}

export function useAddJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (job: Partial<Job> & { title: string; url: string; url_hash: string; dedupe_key: string }) =>
      unwrap(await sb().from("jobs").insert(job).select("*").single()) as Job,
    onSettled: () => qc.invalidateQueries({ queryKey: ["jobs"] }),
  });
}

export function useDeleteJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await sb().from("jobs").delete().eq("id", id)),
    onMutate: async (id) => {
      const prev = qc.getQueryData<Job[]>(["jobs"]);
      if (prev) qc.setQueryData(["jobs"], prev.filter((j) => j.id !== id));
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(["jobs"], ctx.prev),
  });
}

export function useUpdateJobProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<JobProfileRow>) => {
      const { data: u } = await sb().auth.getUser();
      return unwrap(await sb().from("job_profiles").upsert({ user_id: u.user!.id, ...patch }).select("*").single()) as JobProfileRow;
    },
    onSuccess: (row) => qc.setQueryData(["job-profile"], row),
  });
}
