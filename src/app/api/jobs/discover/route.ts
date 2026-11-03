import { handle, requireUser } from "@/lib/auth";
import { discoverBoards, type DiscoveryLog } from "@/lib/jobs/discover";
import type { JobProfile, WatchCompany } from "@/lib/jobs/types";

export const maxDuration = 120;

/** Looks for public Greenhouse / Lever / Ashby boards for every dream company. */
export async function POST() {
  return handle(async () => {
    const { user, supabase } = await requireUser();
    const { data: row } = await supabase
      .from("job_profiles")
      .select("profile, watch_companies, ats_discovery")
      .eq("user_id", user.id)
      .maybeSingle();
    const companies = ((row?.profile as JobProfile)?.target_companies ?? []).filter(Boolean);
    if (!companies.length) return { ok: true, found: [], checked: 0, message: "Add dream companies to your profile first." };
    const watch = (row?.watch_companies as WatchCompany[]) ?? [];
    // A manual run retries everything not already watched.
    const { log, found } = await discoverBoards(companies, {} as DiscoveryLog, watch, 15);
    await supabase
      .from("job_profiles")
      .update({ ats_discovery: { ...((row?.ats_discovery as DiscoveryLog) ?? {}), ...log }, watch_companies: [...watch, ...found] })
      .eq("user_id", user.id);
    const missing = Object.entries(log).filter(([, v]) => !v.found).map(([k]) => k);
    return { ok: true, found, missing, checked: Object.keys(log).length };
  });
}
