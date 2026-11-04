import { handle, HttpError, requireUser } from "@/lib/auth";
import type { Profile } from "@/lib/cron/tick";
import { runJobSearch } from "@/lib/jobs/pipeline";
import { enqueue, workerOnline } from "@/lib/worker";

export const maxDuration = 300;

/** "Search now" button. Runs synchronously so the UI can show the result. */
export async function POST() {
  return handle(async () => {
    const { user, supabase } = await requireUser();
    const { data: me } = await supabase.from("profiles").select("*").eq("id", user.id).single<Profile>();
    if (!me) throw new HttpError(404, "Profile not found");
    // Prefer the worker: it can also reach JobSpy sources (LinkedIn, Naukri, Indeed) and Gmail.
    if (await workerOnline()) {
      const id = await enqueue("job_search", { userId: user.id }, { userId: user.id, priority: 2 });
      if (id) return { ok: true, queued: true, jobId: id };
    }
    const stats = await runJobSearch(user.id, { trigger: "manual", profile: me });
    return { ok: true, queued: false, stats };
  });
}
