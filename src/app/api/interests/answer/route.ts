import { z } from "zod";
import { handle, HttpError, requireUser } from "@/lib/auth";
import { answerQuestion } from "@/lib/memory/refresh";

const Body = z.object({ id: z.string().uuid(), answer: z.enum(["yes", "no", "later"]) });

/** Answer one of Scout's check-in questions. */
export async function POST(request: Request) {
  return handle(async () => {
    const { user, supabase } = await requireUser();
    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new HttpError(400, "Invalid answer");
    return { ok: true, ...(await answerQuestion(supabase, user.id, parsed.data.id, parsed.data.answer)) };
  });
}
