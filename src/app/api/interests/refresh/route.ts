import { handle, requireUser } from "@/lib/auth";
import { refreshMemory } from "@/lib/memory/refresh";

export const maxDuration = 120;

/** "Refresh" on the Interests page: re-read your activity now. */
export async function POST() {
  return handle(async () => {
    const { user } = await requireUser();
    return { ok: true, ...(await refreshMemory(user.id, { force: true })) };
  });
}
