import { z } from "zod";
import { handle, HttpError, requireUser } from "@/lib/auth";
import { deliverInvite } from "@/lib/invites";

const Body = z.object({ spaceId: z.string().uuid(), email: z.string().trim().toLowerCase().email().max(200) });

/** Invite someone (by email) to a shared dashboard you're in. */
export async function POST(request: Request) {
  return handle(async () => {
    const { user, supabase } = await requireUser();
    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new HttpError(400, "Enter a valid email address.");
    const { spaceId, email } = parsed.data;
    if (email === user.email?.toLowerCase()) throw new HttpError(400, "That's you!");

    const { data: space } = await supabase.from("spaces").select("id, name, emoji").eq("id", spaceId).maybeSingle();
    if (!space) throw new HttpError(404, "Shared dashboard not found.");
    const { data: people } = await supabase.rpc("space_people", { p_space: spaceId });
    if (((people ?? []) as { email: string | null }[]).some((p) => p.email?.toLowerCase() === email)) {
      throw new HttpError(409, "They're already in this dashboard.");
    }

    // Reuse a pending invite (resend) or create one. RLS: only members can invite.
    let resend = false;
    let { data: invite } = await supabase.from("space_invites").select("id").eq("space_id", spaceId).eq("email", email).eq("status", "pending").maybeSingle();
    if (invite) resend = true;
    else {
      const ins = await supabase.from("space_invites").insert({ space_id: spaceId, email, invited_by: user.id }).select("id").single();
      if (ins.error) throw new HttpError(403, ins.error.message);
      invite = ins.data;
    }

    const { data: me } = await supabase.from("profiles").select("full_name, email").eq("id", user.id).single();
    const inviterName = (me?.full_name || me?.email || "A friend").split(" ")[0];
    const result = await deliverInvite({ space, inviterName, email, inviteId: invite!.id, resend });
    return { ok: true, inviteId: invite!.id, resend, ...result };
  });
}
