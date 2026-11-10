import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Op } from "./chatPlan";
import type { UserId } from "./types";

export interface ExecResult {
  done: string[];
  failed: string[];
}

/**
 * Runs planned operations as `uid`.
 *
 * The client passed in is bound to that person's own session, so row level
 * security is what enforces who may do what — and every write below is stamped
 * with `uid`, never with a name the model supplied. That is what keeps a change
 * made through the assistant showing up in the right person's colour.
 *
 * Order matters. Anything being added goes first, in one request, and deletions
 * run only if every addition succeeded. A split is "add the pieces, then delete
 * the original", so a failure part-way can leave you with extra pieces and the
 * original intact, but never with the original gone and the pieces missing.
 *
 * It is not a single database transaction, and does not pretend to be: the
 * ordering above is what protects your text.
 *
 * Everything here is safe to run twice. Additions carry ids chosen at planning
 * time and are inserted with ON CONFLICT DO NOTHING, so a replayed approval
 * cannot create duplicates; deletions only touch rows that are still live.
 */
export async function executeOps(
  supabase: SupabaseClient,
  uid: UserId,
  spaceId: string,
  ops: Op[]
): Promise<ExecResult> {
  const done: string[] = [];
  const failed: string[] = [];
  const now = new Date().toISOString();

  const adds = ops.flatMap((o) => (o.op === "add" ? [o] : []));
  const updates = ops.flatMap((o) => (o.op === "update" ? [o] : []));
  const removes = ops.flatMap((o) => (o.op === "remove" ? [o] : []));

  let addsOk = true;
  if (adds.length > 0) {
    const rows = adds.map(({ item }) => ({
      space_id: spaceId,
      client_id: item.client_id,
      kind: item.kind,
      author: uid,
      updated_by: uid,
      title: item.title,
      done: false,
      due_at: item.due_at,
      meta: item.meta,
      position: item.position,
    }));

    const { error } = await supabase
      .from("board_items")
      .upsert(rows, { onConflict: "client_id", ignoreDuplicates: true });

    if (error) {
      addsOk = false;
      adds.forEach((a) => failed.push(`${a.desc} — ${error.message}`));
    } else {
      adds.forEach((a) => done.push(a.desc));
    }
  }

  for (const update of updates) {
    const { data, error } = await supabase
      .from("board_items")
      .update({ ...update.patch, updated_by: uid, updated_at: now })
      .eq("client_id", update.client_id)
      .eq("space_id", spaceId)
      .is("deleted_at", null)
      .select("client_id");

    if (error) failed.push(`${update.desc} — ${error.message}`);
    else if (!data || data.length === 0) failed.push(`${update.desc} — it no longer exists`);
    else done.push(update.desc);
  }

  if (removes.length > 0) {
    if (!addsOk) {
      removes.forEach((r) =>
        failed.push(`${r.desc} — skipped, because the new items couldn't be added first`)
      );
    } else {
      // Soft delete, matching the rest of the app: the rows stay in Postgres
      // with `deleted_at` set, so a deletion is recoverable from the database.
      const { data, error } = await supabase
        .from("board_items")
        .update({ deleted_at: now, updated_by: uid, updated_at: now })
        .in("client_id", removes.map((r) => r.client_id))
        .eq("space_id", spaceId)
        .is("deleted_at", null)
        .select("client_id");

      if (error) {
        removes.forEach((r) => failed.push(`${r.desc} — ${error.message}`));
      } else {
        const gone = new Set((data ?? []).map((row) => row.client_id as string));
        removes.forEach((r) =>
          done.push(gone.has(r.client_id) ? r.desc : `${r.desc} (it was already gone)`)
        );
      }
    }
  }

  return { done, failed };
}
