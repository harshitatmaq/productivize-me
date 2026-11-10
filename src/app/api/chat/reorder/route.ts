import { NextRequest, NextResponse } from "next/server";
import { HttpError } from "@/lib/auth";
import { requireMember } from "@/lib/chat/server";
import { supabaseAdmin } from "@/lib/supabase/admin";


const MAX_ITEMS = 500;
const CONCURRENCY = 20;

interface Entry {
  client_id: string;
  position: number;
}

function parseOrder(raw: unknown): Entry[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ITEMS) return null;

  const seen = new Set<string>();
  const entries: Entry[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const { client_id, position } = item as Record<string, unknown>;

    if (typeof client_id !== "string" || client_id.length === 0 || client_id.length > 100) {
      return null;
    }
    if (typeof position !== "number" || !Number.isFinite(position) || Math.abs(position) > 1e15) {
      return null;
    }
    if (seen.has(client_id)) return null;

    seen.add(client_id);
    entries.push({ client_id, position });
  }
  return entries;
}

/**
 * Saves a new manual order for a board.
 *
 * Reordering is a change to `position` and to nothing else. It goes through the
 * server because of how edits are protected: the update policy on `board_items`
 * requires `updated_by` to be the person making the change, which is right for
 * an edit — it is what makes an edited note change colour. But a reorder is
 * not an edit and must not repaint anything, so it cannot set `updated_by`, and
 * a row last edited by the *other* person fails that check. That is the
 * "new row violates row-level security policy" your partner was seeing.
 *
 * So this route is the one place that may change `position` alone. It checks
 * the session first, accepts only ids and numbers, and touches nothing else.
 */
export async function POST(req: NextRequest) {
  let body: { order?: unknown; spaceId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const entries = parseOrder(body.order);
  if (!entries) {
    return NextResponse.json({ error: "That isn't a valid order." }, { status: 400 });
  }

  // Membership is checked as the signed-in person; the position-only writes use
  // the server key (the update policy would refuse rows someone else last edited),
  // always limited to this dashboard.
  try {
    await requireMember(body.spaceId);
  } catch (e) {
    const err = e as HttpError;
    return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
  }
  const spaceId = body.spaceId as string;
  const admin = supabaseAdmin();
  const failures: string[] = [];

  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const batch = entries.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((entry) =>
        admin
          .from("board_items")
          // `position` and nothing else. In particular not `updated_by` or
          // `updated_at`: a reorder is not an edit and must not look like one.
          .update({ position: entry.position })
          .eq("client_id", entry.client_id)
          .eq("space_id", spaceId)
          .is("deleted_at", null)
      )
    );
    results.forEach((result) => {
      if (result.error) failures.push(result.error.message);
    });
  }

  if (failures.length > 0) {
    return NextResponse.json(
      { error: `Couldn't save the new order (${failures[0]}).` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, updated: entries.length });
}
