import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { HttpError, requireUser } from "@/lib/auth";

/** Signed-in Productivize user who is a member of the dashboard, or a 401/403. */
export async function requireMember(spaceId: unknown): Promise<{ user: User; supabase: SupabaseClient; spaceId: string; name: string }> {
  if (typeof spaceId !== "string" || !/^[0-9a-f-]{36}$/i.test(spaceId)) throw new HttpError(400, "Missing dashboard.");
  const { user, supabase } = await requireUser();
  const { data: ok } = await supabase.rpc("is_space_member", { p_space: spaceId });
  if (ok !== true) throw new HttpError(403, "You're not in this dashboard.");
  const { data: me } = await supabase.from("profiles").select("full_name, email").eq("id", user.id).maybeSingle();
  return { user, supabase, spaceId, name: ((me?.full_name as string) || (me?.email as string) || "You").split(" ")[0] };
}

/** Key for signing delete approvals (derived inside chatProposal; never used raw). */
export function proposalSecret(): string | null {
  return process.env.CHAT_PROPOSAL_SECRET || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.CRON_SECRET || null;
}
