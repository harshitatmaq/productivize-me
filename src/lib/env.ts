import "server-only";

/** Server-side configuration helpers. Nothing here is exposed to the browser. */

export function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

export function envInt(name: string, fallback: number): number {
  const v = env(name);
  const n = v ? Number.parseInt(v, 10) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}

export function envList(name: string, fallback: string[] = []): string[] {
  const v = env(name);
  if (!v) return fallback;
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function allowedEmails(): string[] {
  return envList("ALLOWED_EMAILS").map((e) => e.toLowerCase());
}

/** True when the email may use the app. With no allow-list configured, everyone with an account may. */
export function isEmailAllowed(email: string | null | undefined): boolean {
  const list = allowedEmails();
  if (list.length === 0) return true;
  return !!email && list.includes(email.toLowerCase());
}

export function appUrl(): string {
  return (
    env("NEXT_PUBLIC_APP_URL") ??
    (env("VERCEL_PROJECT_PRODUCTION_URL") ? `https://${env("VERCEL_PROJECT_PRODUCTION_URL")}` : undefined) ??
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

export function supabaseUrl(): string {
  const v = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!v) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  return v;
}

export function supabaseAnonKey(): string {
  const v = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!v) throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) is not set");
  return v;
}

export function supabaseServiceKey(): string {
  const v = env("SUPABASE_SECRET_KEY") ?? env("SUPABASE_SERVICE_ROLE_KEY");
  if (!v) throw new Error("SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) is not set");
  return v;
}
