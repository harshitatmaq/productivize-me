"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import type { Job, JobProfileRow, JobRun, SavedSearch } from "@/lib/types";
import { api } from "@/lib/utils";
import { sb, unwrap } from "./client";

/** A run row counts as live for 10 minutes at most (a crashed worker never finishes it). */
export const isRunLive = (r: Pick<JobRun, "status" | "started_at">, now = Date.now()) =>
  r.status === "running" && now - Date.parse(r.started_at) < 10 * 60_000;

function anyRunLive(qc: QueryClient) {
  return (qc.getQueryData<JobRun[]>(["job-runs"]) ?? []).some((r) => isRunLive(r));
}

export function useJobs() {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["jobs"],
    queryFn: async () =>
      unwrap(await sb().from("jobs").select("*").order("created_at", { ascending: false }).limit(1500)) as Job[],
    // Realtime pushes new rows; polling while a search runs is the fallback when Realtime is off.
    refetchInterval: () => (anyRunLive(qc) ? 8_000 : 5 * 60_000),
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
    refetchInterval: (q) => ((q.state.data ?? []).some((r) => isRunLive(r)) ? 4_000 : 60_000),
  });
}

// ---------------------------------------------------------------------------
// Realtime: new jobs and run progress stream in while Scout searches.
// ---------------------------------------------------------------------------

/** Ids of jobs that arrived over Realtime this session (for the "just found" animation). */
const arrived = new Set<string>();
let arrivedVersion = 0;
const listeners = new Set<() => void>();
const notify = () => {
  arrivedVersion++;
  listeners.forEach((l) => l());
};
export function useArrivedJobs(): Set<string> {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => arrivedVersion,
    () => 0,
  );
  return arrived;
}

function upsertById<T extends { id: string }>(list: T[] | undefined, row: T, prepend = true): T[] {
  if (!list) return [row];
  const i = list.findIndex((x) => x.id === row.id);
  if (i >= 0) return list.map((x, j) => (j === i ? { ...x, ...row } : x));
  return prepend ? [row, ...list] : [...list, row];
}

/** Subscribe once (in the Jobs page) to inserts/updates on jobs and job_search_runs. */
export function useJobsRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const client = sb();
    let cancelled = false;
    let channel: ReturnType<typeof client.channel> | null = null;
    (async () => {
      const { data } = await client.auth.getUser();
      const uid = data.user?.id;
      if (!uid || cancelled) return;
      channel = client
        .channel(`jobs-live-${uid}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "jobs", filter: `user_id=eq.${uid}` }, (p) => {
          const job = p.new as Job;
          arrived.add(job.id);
          notify();
          qc.setQueryData<Job[]>(["jobs"], (prev) => upsertById(prev, job));
        })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "jobs", filter: `user_id=eq.${uid}` }, (p) => {
          const job = p.new as Job;
          qc.setQueryData<Job[]>(["jobs"], (prev) => (prev?.some((j) => j.id === job.id) ? upsertById(prev, job) : prev));
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "job_search_runs", filter: `user_id=eq.${uid}` }, (p) => {
          if (p.eventType === "DELETE") return;
          const run = p.new as JobRun;
          qc.setQueryData<JobRun[]>(["job-runs"], (prev) =>
            upsertById(prev, run).sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, 15),
          );
          if (run.status !== "running") {
            qc.invalidateQueries({ queryKey: ["jobs"] });
            if (run.search_id) qc.invalidateQueries({ queryKey: ["searches"] });
          }
        })
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) client.removeChannel(channel);
    };
  }, [qc]);
}

// ---------------------------------------------------------------------------
// Search & ask Scout
// ---------------------------------------------------------------------------

export type QueryResult = {
  search: SavedSearch;
  plan: SavedSearch["plan"];
  stored: { id: string; similarity: number }[];
  mode: "worker" | "inline" | "none";
};

export function useSearches() {
  return useQuery({
    queryKey: ["searches"],
    queryFn: async () =>
      unwrap(await sb().from("searches").select("*").order("created_at", { ascending: false }).limit(40)) as SavedSearch[],
  });
}

export function useRunQuery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { query: string; live?: boolean }) => api<QueryResult>("/api/jobs/query", { method: "POST", json: vars }),
    onSuccess: (r) => {
      qc.setQueryData<SavedSearch[]>(["searches"], (prev) => upsertById(prev, r.search));
      // The run row appears within a second or two; poll until Realtime takes over.
      qc.invalidateQueries({ queryKey: ["job-runs"] });
    },
  });
}

export function useUpdateSearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<SavedSearch> }) =>
      unwrap(await sb().from("searches").update(patch).eq("id", id).select("*").single()) as SavedSearch,
    onSuccess: (row) => qc.setQueryData<SavedSearch[]>(["searches"], (prev) => upsertById(prev, row)),
  });
}

export function useDeleteSearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await sb().from("searches").delete().eq("id", id)),
    onMutate: (id) => qc.setQueryData<SavedSearch[]>(["searches"], (prev) => prev?.filter((s) => s.id !== id)),
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
