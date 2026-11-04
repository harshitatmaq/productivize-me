// Creates one of the (two) allowed accounts with a password, already confirmed.
// Usage: node --env-file=.env.local scripts/create-user.mjs you@example.com 'a-strong-password' "Your Name"
import { createClient } from "@supabase/supabase-js";

const [email, password, fullName] = process.argv.slice(2);
if (!email || !password) {
  console.error('Usage: node --env-file=.env.local scripts/create-user.mjs <email> <password> ["Full Name"]');
  process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) first.");
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false } });
const { data, error } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: fullName ? { full_name: fullName } : {},
});
if (error) {
  console.error("Failed:", error.message);
  process.exit(1);
}
console.log(`Created ${data.user.email} (${data.user.id}). Add this email to ALLOWED_EMAILS.`);
