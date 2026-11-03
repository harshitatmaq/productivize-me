import { connection } from "next/server";
import { assertCron, handle } from "@/lib/auth";
import { runTick } from "@/lib/cron/tick";

export const maxDuration = 60;

/** Every 5 minutes: reminders, morning brief, end-of-day carry-forward, learning nudges, reviews. */
export async function GET(request: Request) {
  await connection();
  return handle(async () => {
    assertCron(request);
    const results = await runTick();
    return { ok: true, at: new Date().toISOString(), results };
  });
}

export const POST = GET;
