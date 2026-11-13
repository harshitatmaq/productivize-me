import { connection } from "next/server";
import { handle, HttpError, requireUser } from "@/lib/auth";
import { isEmailAllowed } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/admin";

type Row = { purpose: string | null; provider: string | null; model: string | null; ok: boolean; ms: number; fallbacks: number; error: string | null; created_at: string };

export type AiActivity = {
  since: string;
  total: number;
  ok: number;
  tasks: { purpose: string; calls: number; ok: number; avgMs: number; fallbacks: number; topModel: string | null; lastError: string | null }[];
  models: { model: string; answered: number }[];
  failures: { at: string; purpose: string; error: string }[];
};

/** Settings → Integrations → AI activity: the last 7 days, summarised (founding accounts only). */
export async function GET() {
  await connection();
  return handle(async () => {
    const { user } = await requireUser();
    if (!isEmailAllowed(user.email)) throw new HttpError(403, "Only the app's owners can see AI activity.");
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const { data, error } = await supabaseAdmin()
      .from("ai_calls")
      .select("purpose, provider, model, ok, ms, fallbacks, error, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error) throw new HttpError(500, `${error.message} (run supabase/migrations/0005_planning_health_chat_memory.sql again)`);
    const rows = (data ?? []) as Row[];
    const byTask = new Map<string, Row[]>();
    for (const r of rows) byTask.set(r.purpose ?? "other", [...(byTask.get(r.purpose ?? "other") ?? []), r]);
    const top = (rs: Row[]) => {
      const counts = new Map<string, number>();
      for (const r of rs) if (r.ok && r.model) counts.set(`${r.provider}/${r.model}`, (counts.get(`${r.provider}/${r.model}`) ?? 0) + 1);
      return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    };
    const models = new Map<string, number>();
    for (const r of rows) if (r.ok && r.model) models.set(`${r.provider}/${r.model}`, (models.get(`${r.provider}/${r.model}`) ?? 0) + 1);
    const out: AiActivity = {
      since,
      total: rows.length,
      ok: rows.filter((r) => r.ok).length,
      tasks: [...byTask]
        .map(([purpose, rs]) => ({
          purpose,
          calls: rs.length,
          ok: rs.filter((r) => r.ok).length,
          avgMs: Math.round(rs.reduce((s, r) => s + r.ms, 0) / rs.length),
          fallbacks: rs.reduce((s, r) => s + r.fallbacks, 0),
          topModel: top(rs),
          lastError: rs.find((r) => r.error)?.error ?? null,
        }))
        .sort((a, b) => b.calls - a.calls),
      models: [...models].map(([model, answered]) => ({ model, answered })).sort((a, b) => b.answered - a.answered),
      failures: rows
        .filter((r) => !r.ok)
        .slice(0, 15)
        .map((r) => ({ at: r.created_at, purpose: r.purpose ?? "other", error: r.error ?? "unknown error" })),
    };
    return out;
  });
}
