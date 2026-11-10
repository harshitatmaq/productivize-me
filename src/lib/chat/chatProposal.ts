import { SignJWT } from "jose/jwt/sign";
import { jwtVerify } from "jose/jwt/verify";
import type { Op } from "./chatPlan";
import type { UserId } from "./types";

/**
 * Approval tokens.
 *
 * When the assistant wants to delete something, nothing is run. The pending
 * operations are sealed into a token and handed to the browser, and the
 * "Yes" button redeems that token. Three properties make the button mean what
 * it says:
 *
 *  - **Bound to what was shown.** The token carries the exact operations the
 *    approval card listed, so approving cannot run anything else.
 *  - **Bound to a person.** It names whoever asked, and only they can redeem it.
 *  - **Short-lived.** It expires after ten minutes, so an old card cannot be
 *    approved long after the board has moved on.
 *
 * No server-side state is needed, which matters on serverless hosting where
 * there is no memory shared between requests.
 */

const PURPOSE = "chat-proposal";
const LABEL = "two-chat/chat-proposal/v1";

/** How long an approval card stays redeemable. */
export const PROPOSAL_TTL_SECONDS = 10 * 60;

/**
 * The signing key is *derived* from the project's JWT secret, never the secret
 * itself. That secret also signs the session tokens Supabase accepts as login,
 * so signing approvals with it directly would put two unrelated kinds of token
 * under one key. Deriving a separate key means a proposal token is not a valid
 * Supabase credential, and a session token is not a valid proposal.
 */
async function deriveKey(secret: string): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const out = await crypto.subtle.sign("HMAC", base, new TextEncoder().encode(LABEL));
  return new Uint8Array(out);
}

export async function signProposal(
  secret: string,
  uid: UserId,
  ops: Op[],
  nowMs: number = Date.now(),
  space = ""
): Promise<{ token: string; expiresAt: number }> {
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + PROPOSAL_TTL_SECONDS;

  // Bound to the person and the dashboard it was made in.
  const token = await new SignJWT({ purpose: PURPOSE, uid, space, ops })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(await deriveKey(secret));

  return { token, expiresAt: exp * 1000 };
}

export type Verified =
  | { ok: true; ops: Op[] }
  | { ok: false; reason: "invalid" | "expired" | "wrong-user" };

function isOp(value: unknown): value is Op {
  if (!value || typeof value !== "object") return false;
  const op = value as Record<string, unknown>;

  if (op.op === "remove") return typeof op.client_id === "string";
  if (op.op === "update") {
    return typeof op.client_id === "string" && !!op.patch && typeof op.patch === "object";
  }
  if (op.op === "add") {
    const item = op.item as Record<string, unknown> | undefined;
    return (
      !!item &&
      typeof item.client_id === "string" &&
      typeof item.kind === "string" &&
      typeof item.title === "string" &&
      typeof item.position === "number"
    );
  }
  return false;
}

export async function verifyProposal(
  secret: string,
  token: string,
  uid: UserId,
  nowMs: number = Date.now(),
  space = ""
): Promise<Verified> {
  try {
    const { payload } = await jwtVerify(token, await deriveKey(secret), {
      currentDate: new Date(nowMs),
    });

    if (payload.purpose !== PURPOSE) return { ok: false, reason: "invalid" };
    if (payload.uid !== uid) return { ok: false, reason: "wrong-user" };
    if ((payload.space ?? "") !== space) return { ok: false, reason: "invalid" };

    const ops = payload.ops;
    // Signed by us, so this is belt and braces — but a malformed payload must
    // fail closed rather than reach the database.
    if (!Array.isArray(ops) || !ops.every(isOp)) {
      return { ok: false, reason: "invalid" };
    }
    return { ok: true, ops };
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    return { ok: false, reason: code === "ERR_JWT_EXPIRED" ? "expired" : "invalid" };
  }
}
