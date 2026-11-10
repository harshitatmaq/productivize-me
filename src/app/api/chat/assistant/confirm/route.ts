import { NextRequest, NextResponse } from "next/server";
import type { HttpError } from "@/lib/auth";
import { executeOps } from "@/lib/chat/chatExec";
import { verifyProposal } from "@/lib/chat/chatProposal";
import { proposalSecret, requireMember } from "@/lib/chat/server";


/**
 * Carries out a deletion the person has approved.
 *
 * The only way in is a token minted by `/api/chat` for *this* person, within
 * the last ten minutes, listing exactly the operations the approval card
 * showed. There is deliberately no way to name rows to delete here directly.
 */
export async function POST(req: NextRequest) {
  let token: unknown;
  let spaceIdRaw: unknown;
  try {
    ({ token, spaceId: spaceIdRaw } = await req.json());
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }
  let member;
  try {
    member = await requireMember(spaceIdRaw);
  } catch (e) {
    const err = e as HttpError;
    return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
  }
  if (typeof token !== "string" || !token) {
    return NextResponse.json({ error: "Nothing to approve." }, { status: 400 });
  }

  const secret = proposalSecret();
  if (!secret) {
    return NextResponse.json({ error: "Approvals aren't set up on the server." }, { status: 500 });
  }

  const verified = await verifyProposal(secret, token, member.user.id, Date.now(), member.spaceId);

  if (!verified.ok) {
    if (verified.reason === "expired") {
      return NextResponse.json(
        { error: "That request expired. Ask me again if you still want it.", code: "expired" },
        { status: 410 }
      );
    }
    if (verified.reason === "wrong-user") {
      return NextResponse.json(
        { error: "That request belongs to someone else.", code: "forbidden" },
        { status: 403 }
      );
    }
    return NextResponse.json({ error: "That request isn't valid.", code: "invalid" }, { status: 400 });
  }

  try {
    const result = await executeOps(member.supabase, member.user.id, member.spaceId, verified.ops);
    return NextResponse.json({ ok: result.failed.length === 0, ...result });
  } catch (error) {
    console.error("Confirm error:", error);
    return NextResponse.json({ error: "Couldn't carry that out." }, { status: 500 });
  }
}
