"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Task } from "@/lib/types";
import { api } from "@/lib/utils";
import { sb, unwrap } from "./client";

export type TaskInput = Partial<Omit<Task, "id" | "user_id" | "created_at" | "updated_at">> & { title: string };

const TASK_KEY = ["tasks"];

/** Open tasks (any date) + tasks completed in the last 45 days. Small enough to keep fully client-side. */
export function useTasks() {
  return useQuery({
    queryKey: TASK_KEY,
    queryFn: async () => {
      const since = new Date(Date.now() - 45 * 86_400_000).toISOString();
      const [open, done] = await Promise.all([
        sb().from("tasks").select("*").eq("status", "todo").order("sort_order").limit(2000),
        sb().from("tasks").select("*").neq("status", "todo").gte("updated_at", since).order("completed_at", { ascending: false }).limit(1000),
      ]);
      return [...(unwrap(open) as Task[]), ...(unwrap(done) as Task[])];
    },
  });
}

function patchCache(qc: ReturnType<typeof useQueryClient>, fn: (tasks: Task[]) => Task[]) {
  const prev = qc.getQueryData<Task[]>(TASK_KEY);
  if (prev) qc.setQueryData(TASK_KEY, fn(prev));
  return prev;
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: TaskInput) => unwrap(await sb().from("tasks").insert(input).select("*").single()) as Task,
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: TASK_KEY });
      const temp: Task = {
        id: `temp-${Math.random().toString(36).slice(2)}`,
        user_id: "",
        notes: null,
        due_date: null,
        due_time: null,
        priority: 4,
        tags: [],
        status: "todo",
        completed_at: null,
        sort_order: Date.now() / 1000,
        estimate_minutes: null,
        reminder_at: null,
        reminder_sent_at: null,
        recurrence: null,
        carry_count: 0,
        original_due_date: null,
        last_carried_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...input,
      } as Task;
      const prev = patchCache(qc, (t) => [...t, temp]);
      return { prev, tempId: temp.id };
    },
    onError: (_e, _i, ctx) => ctx?.prev && qc.setQueryData(TASK_KEY, ctx.prev),
    onSuccess: (task, _i, ctx) => patchCache(qc, (t) => t.map((x) => (x.id === ctx?.tempId ? task : x))),
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Task> }) =>
      unwrap(await sb().from("tasks").update(patch).eq("id", id).select("*").single()) as Task,
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: TASK_KEY });
      const prev = patchCache(qc, (t) =>
        t.map((x) =>
          x.id === id
            ? { ...x, ...patch, completed_at: patch.status === "done" ? new Date().toISOString() : patch.status === "todo" ? null : x.completed_at }
            : x,
        ),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(TASK_KEY, ctx.prev),
    onSuccess: (task, vars) => {
      patchCache(qc, (t) => t.map((x) => (x.id === task.id ? task : x)));
      // Completing a recurring task spawns the next occurrence in the database.
      if (vars.patch.status === "done" && task.recurrence) qc.invalidateQueries({ queryKey: TASK_KEY });
    },
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await sb().from("tasks").delete().eq("id", id)),
    onMutate: async (id) => ({ prev: patchCache(qc, (t) => t.filter((x) => x.id !== id)) }),
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(TASK_KEY, ctx.prev),
  });
}

export function useCarryTasks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { to: "today" | "tomorrow" | string; ids?: string[]; until?: string }) =>
      api<{ moved: number; to: string }>("/api/tasks/carry", { json: body }),
    onSettled: () => qc.invalidateQueries({ queryKey: TASK_KEY }),
  });
}
