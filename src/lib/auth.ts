import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { isUserAllowed } from "@/lib/env";
import { supabaseServer } from "@/lib/supabase/server";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Resolve the signed-in, allow-listed user for a Route Handler, or throw a 401. */
export async function requireUser(): Promise<{ user: User; supabase: SupabaseClient }> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new HttpError(401, "Not signed in");
  if (!isUserAllowed(user)) throw new HttpError(403, "This account is not allowed to use the app");
  return { user, supabase };
}

/** Wraps a Route Handler body with consistent JSON error handling. */
export async function handle<T>(fn: () => Promise<T>): Promise<Response> {
  try {
    const result = await fn();
    if (result instanceof Response) return result;
    return NextResponse.json(result ?? { ok: true });
  } catch (e) {
    if (e instanceof HttpError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: (e as Error).message ?? "Unexpected error" }, { status: 500 });
  }
}

/** Cron endpoints are called by Supabase pg_cron / Vercel Cron / GitHub Actions with `Authorization: Bearer CRON_SECRET`. */
export function assertCron(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new HttpError(500, "CRON_SECRET is not configured");
  const header = request.headers.get("authorization") ?? "";
  const url = new URL(request.url);
  const provided = header.startsWith("Bearer ") ? header.slice(7) : url.searchParams.get("secret");
  if (provided !== secret) throw new HttpError(401, "Bad cron secret");
}
