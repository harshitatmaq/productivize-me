// One-time import of an existing two-chat project into a Productivize shared dashboard.
//
// Copies messages (with photos), reactions, read receipts, pins, promises and the
// workspace board. Additive and safe to re-run: rows keep their ids/client_ids and
// are upserted with "ignore duplicates", so nothing is overwritten or deleted.
//
// Usage (from the productivize-me folder, with migration 0005 already run):
//
//   set OLD_SUPABASE_URL=https://<old-project>.supabase.co
//   set OLD_SUPABASE_SERVICE_ROLE_KEY=<old project's service_role key>
//   node --env-file=.env.local scripts/import-two-chat.mjs --a you@gmail.com --b friend@gmail.com --name "Us"
//
//   --a / --b   Productivize account emails for two-chat's person A and person B
//   --name      creates a new shared dashboard with both of you in it, or
//   --space     the id of an existing dashboard you're both members of
//   --dry-run   only counts what would be copied
//
// The keys are read from the environment only and never printed.
import { createClient } from "@supabase/supabase-js";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, all) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]);
    return acc;
  }, []),
);
const need = (v, msg) => {
  if (!v) {
    console.error(msg);
    process.exit(1);
  }
  return v;
};

const oldUrl = need(process.env.OLD_SUPABASE_URL, "Set OLD_SUPABASE_URL (the two-chat project's URL).");
const oldKey = need(process.env.OLD_SUPABASE_SERVICE_ROLE_KEY, "Set OLD_SUPABASE_SERVICE_ROLE_KEY (the two-chat project's service_role key).");
const newUrl = need(process.env.NEXT_PUBLIC_SUPABASE_URL, "Run with --env-file=.env.local (NEXT_PUBLIC_SUPABASE_URL missing).");
const newKey = need(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SECRET_KEY missing in .env.local.");
const emailA = need(args.a, "Pass --a <Productivize email of person A>.");
const emailB = need(args.b, "Pass --b <Productivize email of person B>.");
if (!args.space && !args.name) need(null, 'Pass --name "Dashboard name" (creates one) or --space <existing dashboard id>.');
const dry = !!args["dry-run"];

const old = createClient(oldUrl, oldKey, { auth: { persistSession: false } });
const pz = createClient(newUrl, newKey, { auth: { persistSession: false } });

async function userId(email) {
  const { data, error } = await pz.rpc("auth_user_id_by_email", { p_email: email });
  if (error) throw new Error(`${error.message} (run migrations 0004 and 0005 first)`);
  if (!data) throw new Error(`No Productivize account for ${email}. Create or invite it first.`);
  return data;
}

async function all(table, order = "created_at") {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await old.from(table).select("*").order(order, { ascending: true }).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

async function upsert(table, rows, onConflict) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await pz.from(table).upsert(rows.slice(i, i + 500), { onConflict, ignoreDuplicates: true });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

const A = await userId(emailA);
const B = await userId(emailB);
const who = (x) => (x === "a" ? A : x === "b" ? B : null);

let spaceId = args.space;
if (!spaceId && !dry) {
  const { data, error } = await pz.from("spaces").insert({ name: String(args.name).slice(0, 80), emoji: "💬", owner_id: A }).select("id").single();
  if (error) throw new Error(`creating the dashboard: ${error.message}`);
  spaceId = data.id;
  const { error: mErr } = await pz.from("space_members").upsert({ space_id: spaceId, user_id: B, role: "member" }, { onConflict: "space_id,user_id", ignoreDuplicates: true });
  if (mErr) throw new Error(`adding ${emailB}: ${mErr.message}`);
  console.log(`Created dashboard "${args.name}" (${spaceId}) with both of you in it.`);
}

const [messages, reactions, readState, pins, promises, board] = await Promise.all([
  all("messages"),
  all("reactions"),
  old.from("read_state").select("*").then((r) => r.data ?? []),
  all("pins"),
  all("promises"),
  all("board_items"),
]);
console.log(`Found ${messages.length} messages, ${reactions.length} reactions, ${pins.length} pins, ${promises.length} promises, ${board.length} board items.`);
if (dry) process.exit(0);

// Photos: copy each object to <space>/<client_id> in Productivize's private bucket.
let copied = 0;
for (const m of messages) {
  if (!m.image_path) continue;
  const target = `${spaceId}/${m.client_id}`;
  const { data: blob, error } = await old.storage.from("chat-images").download(m.image_path);
  if (error || !blob) {
    console.warn(`  photo for ${m.client_id} not found in the old bucket — skipped`);
    m.image_path = null;
    continue;
  }
  const { error: upErr } = await pz.storage.from("chat-images").upload(target, blob, { upsert: true, contentType: blob.type || "image/webp" });
  if (upErr) throw new Error(`uploading a photo: ${upErr.message}`);
  m.image_path = target;
  copied++;
}
console.log(`Copied ${copied} photos.`);

await upsert(
  "chat_messages",
  messages
    .filter((m) => m.body || m.image_path)
    .map((m) => ({
      id: m.id,
      space_id: spaceId,
      client_id: m.client_id,
      sender: who(m.sender),
      body: m.body,
      image_path: m.image_path,
      image_width: m.image_width,
      image_height: m.image_height,
      kind: m.kind ?? "normal",
      reply_to: m.reply_to ?? null,
      mentions: (m.mentions ?? []).map(who).filter(Boolean),
      created_at: m.created_at,
      deleted_at: m.deleted_at,
    })),
  "client_id",
);
const ids = new Set(messages.map((m) => m.id));
await upsert("chat_reactions", reactions.filter((r) => ids.has(r.message_id)).map((r) => ({ message_id: r.message_id, space_id: spaceId, sender: who(r.sender), emoji: r.emoji, created_at: r.created_at })), "message_id,sender,emoji");
await upsert("chat_pins", pins.filter((p) => ids.has(p.message_id)).map((p) => ({ ...p, space_id: spaceId, author: who(p.author), pinned_by: who(p.pinned_by) })), "message_id");
await upsert(
  "chat_promises",
  promises.filter((p) => ids.has(p.message_id)).map((p) => ({ ...p, space_id: spaceId, promiser: who(p.promiser), marked_by: who(p.marked_by) })),
  "message_id",
);
await upsert(
  "chat_read_state",
  readState.filter((r) => who(r.sender)).map((r) => ({ space_id: spaceId, user_id: who(r.sender), last_read_at: r.last_read_at, cleared_before: r.cleared_before ?? null })),
  "space_id,user_id",
);
await upsert(
  "board_items",
  board.map((b) => ({ ...b, space_id: spaceId, author: who(b.author), updated_by: who(b.updated_by) })),
  "client_id",
);
console.log(`Done. Open Together → the dashboard → Chat. (Dashboard id: ${spaceId})`);
