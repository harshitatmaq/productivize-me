import "server-only";

import { appUrl, isUserAllowed } from "@/lib/env";
import { notify, type NotifyProfile } from "@/lib/notify";
import { emailConfigured, sendEmail } from "@/lib/notify/email";
import { renderEmail } from "@/lib/notify/templates";
import { supabaseAdmin } from "@/lib/supabase/admin";

type Space = { id: string; name: string; emoji: string };

/** One-click sign-in link that lands on `next` (handled by /auth/confirm). */
function confirmUrl(hashedToken: string, type: "invite" | "magiclink", next: string) {
  const u = new URL("/auth/confirm", appUrl());
  u.searchParams.set("token_hash", hashedToken);
  u.searchParams.set("type", type);
  u.searchParams.set("next", next);
  return u.toString();
}

async function userIdByEmail(email: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin().rpc("auth_user_id_by_email", { p_email: email });
  if (error) throw new Error(`${error.message} (did you run supabase/migrations/0004_sharing_interests.sql?)`);
  return (data as string | null) ?? null;
}

/** Marks an account as allowed to use the app (invite-only access). */
async function grantAccess(userId: string) {
  const admin = supabaseAdmin();
  const { data } = await admin.auth.admin.getUserById(userId);
  if (data.user && isUserAllowed(data.user)) return;
  await admin.auth.admin.updateUserById(userId, { app_metadata: { ...(data.user?.app_metadata ?? {}), access: "invited" } });
}

export type InviteResult = {
  status: "emailed" | "notified" | "link";
  /** Present when email isn't set up: share it yourself (WhatsApp, Teams…). */
  link?: string;
  newAccount: boolean;
};

/**
 * Invites `email` to a shared dashboard. New people get an account (invite-only)
 * and an email with a sign-up link; people who already use the app get an
 * in-app + push invite. The invite row itself is created by the caller (RLS).
 */
export async function deliverInvite(params: { space: Space; inviterName: string; email: string; inviteId: string; resend?: boolean }): Promise<InviteResult> {
  const admin = supabaseAdmin();
  const { space, inviterName, email } = params;
  const existing = await userIdByEmail(email);

  if (existing) {
    await grantAccess(existing);
    const { data: profile } = await admin.from("profiles").select("id, email, notify_push, notify_email, email_alerts").eq("id", existing).maybeSingle<NotifyProfile>();
    if (profile) {
      await notify(profile, {
        kind: "space",
        dedupeKey: `space-invite:${params.inviteId}${params.resend ? `:${new Date().toISOString().slice(0, 13)}` : ""}`,
        title: `${inviterName} invited you to “${space.name}”`,
        body: "A shared dashboard — open Together to accept.",
        url: "/together",
        push: { tag: "space-invite" },
        email: {
          force: true,
          subject: `${inviterName} invited you to “${space.name}” on Productivize`,
          html: renderEmail({
            preheader: `Join ${space.name} on Productivize`,
            title: `${space.emoji} ${space.name}`,
            subtitle: `${inviterName} invited you to a shared dashboard.`,
            sections: [{ heading: "What's this?", paragraph: "Share tasks, jobs, learning notes and lists with each other. Your own dashboard stays private — only what you share appears here." }],
            cta: { label: "Open Together", href: "/together" },
            footer: "You get this because someone invited you on Productivize.",
          }),
        },
      });
    }
    return { status: "notified", newAccount: false };
  }

  const { data, error } = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: { data: { invited_by_name: inviterName } },
  });
  if (error || !data.user) throw new Error(error?.message ?? "Could not create the invite");
  await admin.auth.admin.updateUserById(data.user.id, { app_metadata: { ...(data.user.app_metadata ?? {}), access: "invited" } });
  const link = confirmUrl(data.properties.hashed_token, "invite", "/welcome");

  if (emailConfigured()) {
    const ok = await sendEmail({
      to: email,
      subject: `${inviterName} invited you to “${space.name}” on Productivize`,
      html: renderEmail({
        preheader: `${inviterName} invited you to Productivize`,
        title: `${space.emoji} ${space.name}`,
        subtitle: `${inviterName} invited you to Productivize — a calm app for tasks, learning and your job search.`,
        sections: [
          {
            heading: "You get",
            items: [
              { text: "Your own private dashboard", meta: "Tasks, reminders, learning log, job search with Scout" },
              { text: `A shared dashboard with ${inviterName}`, meta: "Share tasks, jobs, notes and lists — always as copies" },
            ],
          },
          { heading: "Next", paragraph: "Click below, choose a password, and accept the invite. The link works once; if it expires, use “Email me a sign-in link” on the sign-in page." },
        ],
        cta: { label: "Accept invite", href: link },
        footer: "You get this because someone invited you. Ignore it if it isn't for you.",
      }),
      text: `${inviterName} invited you to “${space.name}” on Productivize.\n\nAccept: ${link}`,
    });
    if (ok) return { status: "emailed", newAccount: true };
  }
  return { status: "link", link, newAccount: true };
}

/**
 * "Email me a sign-in link" — for invited people whose link expired, or anyone
 * who forgot their password. Only existing, allowed accounts get an email; the
 * response is the same either way so it can't be used to probe for accounts.
 */
export async function sendSignInLink(email: string): Promise<void> {
  if (!emailConfigured()) return;
  const id = await userIdByEmail(email).catch(() => null);
  if (!id) return;
  const admin = supabaseAdmin();
  const { data: u } = await admin.auth.admin.getUserById(id);
  if (!isUserAllowed(u.user)) return;
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data.properties?.hashed_token) return;
  const link = confirmUrl(data.properties.hashed_token, "magiclink", "/welcome?from=link");
  await sendEmail({
    to: email,
    subject: "Your Productivize sign-in link",
    html: renderEmail({
      preheader: "Sign in to Productivize",
      title: "Sign in to Productivize",
      subtitle: "This link signs you in once. You can set a new password on the next screen.",
      sections: [],
      cta: { label: "Sign in", href: link },
      footer: "You get this because someone asked for a sign-in link for this email. Ignore it if it wasn't you.",
    }),
    text: `Sign in to Productivize: ${link}`,
  });
}
