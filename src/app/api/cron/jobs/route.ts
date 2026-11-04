import { after, connection } from "next/server";
import { assertCron, handle } from "@/lib/auth";
import { runJobSearch } from "@/lib/jobs/pipeline";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Profile } from "@/lib/cron/tick";
import { workerOnline } from "@/lib/worker";

export const maxDuration = 300;

async function runAll() {
  const admin = supabaseAdmin();
  const [{ data: profiles }, { data: ready }] = await Promise.all([
    admin.from("profiles").select("*").eq("job_search_enabled", true),
    admin.from("job_profiles").select("user_id").eq("status", "ready"),
  ]);
  const readyIds = new Set((ready ?? []).map((r) => r.user_id));
  const out: Record<string, unknown> = {};
  for (const p of (profiles ?? []) as Profile[]) {
    if (!readyIds.has(p.id)) continue;
    try {
      const stats = await runJobSearch(p.id, { trigger: "cron", profile: p });
      out[p.email ?? p.id] = { inserted: stats.inserted, strong: stats.strong, fetched: stats.fetched, ms: stats.ms };
    } catch (e) {
      out[p.email ?? p.id] = { error: (e as Error).message };
    }
  }
  return out;
}

/** Hourly job search for every user with a finished profile. Add ?wait=1 to block until done. */
export async function GET(request: Request) {
  await connection();
  return handle(async () => {
    assertCron(request);
    // The Scout worker runs searches itself (every few minutes, sources claimed per interval).
    // Vercel only steps in when no worker has checked in recently.
    if ((await workerOnline()) && new URL(request.url).searchParams.get("force") !== "1") {
      return { ok: true, delegated: "worker" };
    }
    if (new URL(request.url).searchParams.get("wait") === "1") {
      return { ok: true, results: await runAll() };
    }
    after(async () => {
      try {
        console.log("[cron/jobs]", JSON.stringify(await runAll()));
      } catch (e) {
        console.error("[cron/jobs] failed", e);
      }
    });
    return { ok: true, queued: true };
  });
}

export const POST = GET;
