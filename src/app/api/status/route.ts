import { connection } from "next/server";
import { embeddingProviders } from "@/lib/ai/embeddings";
import { configuredProviderSummary } from "@/lib/ai/llm";
import { handle, requireUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { jobSourceSummary } from "@/lib/jobs/sources";
import { emailConfigured } from "@/lib/notify/email";
import { pushConfigured } from "@/lib/notify/push";
import { searchProviderSummary } from "@/lib/search/web";
import { monthPeriod } from "@/lib/usage";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { listWorkers } from "@/lib/worker";

/** What is configured on the server (never returns secret values). */
export async function GET() {
  await connection();
  return handle(async () => {
    const { user } = await requireUser();
    let usage: { provider: string; period: string; count: number }[] = [];
    try {
      const { data } = await supabaseAdmin()
        .from("api_usage")
        .select("provider, period, count")
        .gte("period", monthPeriod())
        .order("provider");
      usage = data ?? [];
    } catch {
      // service key missing — status still useful
    }
    return {
      ai: configuredProviderSummary(),
      search: searchProviderSummary(),
      sources: jobSourceSummary(),
      push: pushConfigured(),
      email: emailConfigured(),
      cron: !!env("CRON_SECRET"),
      embeddings: embeddingProviders().map((p) => p.model),
      workers: (await listWorkers().catch(() => [])).map((w) => ({
        name: w.name,
        online: w.online,
        last_seen: w.last_seen,
        capabilities: w.capabilities,
        jobspy_sites: (w.info as { jobspy_sites?: string[] }).jobspy_sites ?? [],
        gmail_for_me: ((w.info as { gmail_accounts?: string[] }).gmail_accounts ?? []).includes((user.email ?? "").toLowerCase()),
      })),
      gmail: await (async () => {
        try {
          const { data } = await supabaseAdmin().from("source_state").select("last_run_at, data").eq("key", `${user.id}:gmail`).maybeSingle();
          return data ? { last_run_at: data.last_run_at, ...(data.data as Record<string, unknown>) } : null;
        } catch {
          return null;
        }
      })(),
      serviceKey: !!(env("SUPABASE_SECRET_KEY") ?? env("SUPABASE_SERVICE_ROLE_KEY")),
      usage,
    };
  });
}
