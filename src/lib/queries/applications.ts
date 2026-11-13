"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BankCategory, BankEntry, PackField } from "@/lib/jobs/apply";
import type { Application } from "@/lib/jobs/apply-server";
import { api } from "@/lib/utils";
import { sb, unwrap } from "./client";

const appKey = (jobId: string) => ["application", jobId] as const;

export function useApplication(jobId: string | null) {
  return useQuery({
    queryKey: appKey(jobId ?? "none"),
    enabled: !!jobId,
    queryFn: async () => unwrap(await sb().from("applications").select("*").eq("job_id", jobId!).maybeSingle()) as Application | null,
  });
}

/** prepare: build the pack · applied: snapshot + answer bank + status. */
export function useApplicationAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { jobId: string; action: "prepare" | "applied" }) => api<{ application: Application }>("/api/jobs/application", { json: v }),
    onSuccess: (r, v) => {
      qc.setQueryData(appKey(v.jobId), r.application);
      qc.invalidateQueries({ queryKey: ["jobs"] });
      if (v.action === "applied") qc.invalidateQueries({ queryKey: ["answer-bank"] });
    },
  });
}

/** Saves edits to the pack (answers, cover letter) straight to your application row. */
export function useUpdateApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { jobId: string; patch: { fields?: PackField[]; cover_letter?: string } }) =>
      unwrap(await sb().from("applications").update(v.patch).eq("job_id", v.jobId).select("*").single()) as Application,
    onMutate: (v) => qc.setQueryData<Application | null>(appKey(v.jobId), (prev) => (prev ? { ...prev, ...v.patch } : prev)),
  });
}

export function useAnswerBank() {
  return useQuery({
    queryKey: ["answer-bank"],
    queryFn: async () => unwrap(await sb().from("answer_bank").select("*").order("category").order("question")) as (BankEntry & { id: string; updated_at: string })[],
  });
}

export function useSaveAnswer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { key: string; question: string; answer: string; category: BankCategory }) =>
      unwrap(await sb().from("answer_bank").upsert(v, { onConflict: "user_id,key" }).select("*").single()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["answer-bank"] }),
  });
}

export function useDeleteAnswer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await sb().from("answer_bank").delete().eq("id", id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["answer-bank"] }),
  });
}
