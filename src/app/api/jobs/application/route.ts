import { z } from "zod";
import { handle, HttpError, requireUser } from "@/lib/auth";
import { markApplied, preparePack } from "@/lib/jobs/apply-server";

export const maxDuration = 120;

const Body = z.object({ jobId: z.string().uuid(), action: z.enum(["prepare", "applied"]) });

/** Save → Prepare (build the application pack) and Mark applied (snapshot + answer bank). */
export async function POST(request: Request) {
  return handle(async () => {
    const { user, supabase } = await requireUser();
    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new HttpError(400, "Invalid request");
    const { jobId, action } = parsed.data;
    try {
      const application = action === "prepare" ? await preparePack(supabase, user, jobId) : await markApplied(supabase, user, jobId);
      return { ok: true, application };
    } catch (e) {
      throw new HttpError(/not found/i.test((e as Error).message) ? 404 : 500, (e as Error).message);
    }
  });
}
