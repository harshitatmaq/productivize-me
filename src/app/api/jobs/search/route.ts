import { handle, HttpError, requireUser } from "@/lib/auth";
import type { Profile } from "@/lib/cron/tick";
import { runJobSearch } from "@/lib/jobs/pipeline";

export const maxDuration = 300;

/** "Search now" button. Runs synchronously so the UI can show the result. */
export async function POST() {
  return handle(async () => {
    const { user, supabase } = await requireUser();
    const { data: me } = await supabase.from("profiles").select("*").eq("id", user.id).single<Profile>();
    if (!me) throw new HttpError(404, "Profile not found");
    const stats = await runJobSearch(user.id, { trigger: "manual", profile: me });
    return { ok: true, stats };
  });
}
