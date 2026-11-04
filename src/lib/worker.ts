import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type WorkerInfo = { name: string; capabilities: string[]; info: Record<string, unknown>; started_at: string; last_seen: string; online: boolean };

const ONLINE_MS = 3 * 60_000;

export async function listWorkers(admin: SupabaseClient = supabaseAdmin()): Promise<WorkerInfo[]> {
  const { data, error } = await admin.from("worker_heartbeats").select("*").order("last_seen", { ascending: false });
  if (error) return []; // migration 0003 not applied yet
  return (data ?? []).map((w) => ({ ...w, online: Date.now() - Date.parse(w.last_seen) < ONLINE_MS })) as WorkerInfo[];
}

/** True when at least one Scout worker has checked in during the last few minutes. */
export async function workerOnline(admin?: SupabaseClient): Promise<boolean> {
  return (await listWorkers(admin)).some((w) => w.online);
}

export async function enqueue(
  type: string,
  payload: Record<string, unknown>,
  opts: { userId?: string; lane?: "fast" | "batch" | "overnight"; priority?: number; runAfter?: Date } = {},
): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from("agent_jobs")
    .insert({
      type,
      payload,
      user_id: opts.userId ?? null,
      lane: opts.lane ?? "fast",
      priority: opts.priority ?? 5,
      run_after: (opts.runAfter ?? new Date()).toISOString(),
    })
    .select("id")
    .single();
  if (error) {
    console.warn("[queue] enqueue failed:", error.message);
    return null;
  }
  return data.id as string;
}
