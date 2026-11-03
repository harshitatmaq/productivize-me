import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseServiceKey, supabaseUrl } from "@/lib/env";

let admin: SupabaseClient | null = null;

/** Service-role client. Bypasses RLS — only use in trusted server code (cron, background jobs). */
export function supabaseAdmin(): SupabaseClient {
  if (admin) return admin;
  admin = createClient(supabaseUrl(), supabaseServiceKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}
