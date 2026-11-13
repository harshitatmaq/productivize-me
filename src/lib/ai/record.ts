import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

export type AiCallRecord = {
  purpose?: string;
  provider?: string;
  model?: string;
  ok: boolean;
  ms: number;
  fallbacks: number;
  error?: string;
};

/** Saves one row to the AI activity log (Settings → Integrations). Never throws. */
export async function recordAiCall(r: AiCallRecord): Promise<void> {
  try {
    await Promise.race([
      supabaseAdmin()
        .from("ai_calls")
        .insert({ ...r, error: r.error?.slice(0, 400) ?? null }),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
  } catch {
    // no database configured, or the table isn't there yet — the log is best-effort
  }
}
