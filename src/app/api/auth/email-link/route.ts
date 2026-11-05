import { z } from "zod";
import { handle } from "@/lib/auth";
import { sendSignInLink } from "@/lib/invites";

const Body = z.object({ email: z.string().trim().toLowerCase().email().max(200) });
const recent = new Map<string, number>();

/** "Email me a sign-in link" on the login page. Always answers the same way. */
export async function POST(request: Request) {
  return handle(async () => {
    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (parsed.success) {
      const { email } = parsed.data;
      const last = recent.get(email) ?? 0;
      if (Date.now() - last > 60_000) {
        recent.set(email, Date.now());
        await sendSignInLink(email).catch((e) => console.warn("[email-link]", (e as Error).message));
      }
    }
    return { ok: true, message: "If that email has an account here, a sign-in link is on its way." };
  });
}
