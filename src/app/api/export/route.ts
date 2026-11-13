import { connection } from "next/server";
import { handle, requireUser } from "@/lib/auth";

export const maxDuration = 60;

/** Your own rows in each table (read with your session, so row-level security applies). */
const OWN = [
  "tasks",
  "reminders",
  "learning_entries",
  "flashcards",
  "focus_sessions",
  "notifications",
  "job_profiles",
  "jobs",
  "searches",
  "portfolios",
  "interests",
  "memory_questions",
  "user_facts",
  "exercises",
  "workouts",
  "workout_sets",
  "body_metrics",
] as const;

/** Shared dashboards: only what you wrote or shared yourself. */
const AUTHORED: [table: string, column: string][] = [
  ["space_items", "shared_by"],
  ["space_comments", "user_id"],
  ["chat_messages", "sender"],
  ["board_items", "author"],
];

/** Settings → Your data → Export: everything you've added, as one JSON file. */
export async function GET() {
  await connection();
  return handle(async () => {
    const { user, supabase } = await requireUser();
    const all = async (table: string, column: string) => {
      const rows: unknown[] = [];
      for (let from = 0; from < 50_000; from += 1000) {
        const { data, error } = await supabase.from(table).select("*").eq(column, user.id).range(from, from + 999);
        if (error) return { error: error.message };
        rows.push(...(data ?? []));
        if ((data ?? []).length < 1000) break;
      }
      return rows;
    };

    const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
    if (profile) delete (profile as Record<string, unknown>).calendar_token; // a private link, not your data
    const { data: spaces } = await supabase.from("spaces").select("id, name, emoji, created_at");

    const tables: Record<string, unknown> = {};
    for (const t of OWN) tables[t] = await all(t, "user_id");
    for (const [t, c] of AUTHORED) tables[t] = await all(t, c);

    const exportedAt = new Date().toISOString();
    const body = JSON.stringify({ app: "Productivize", exportedAt, account: { id: user.id, email: user.email }, profile, spaces: spaces ?? [], tables }, null, 2);
    return new Response(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="productivize-export-${exportedAt.slice(0, 10)}.json"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
