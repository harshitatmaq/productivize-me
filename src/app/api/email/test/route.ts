import { handle, HttpError, requireUser } from "@/lib/auth";
import { emailConfigured, sendEmail } from "@/lib/notify/email";
import { renderEmail } from "@/lib/notify/templates";

export async function POST() {
  return handle(async () => {
    const { user } = await requireUser();
    if (!emailConfigured()) throw new HttpError(400, "Email is not configured on the server (SMTP_* variables missing).");
    if (!user.email) throw new HttpError(400, "Your account has no email address.");
    const ok = await sendEmail({
      to: user.email,
      subject: "Productivize test email",
      html: renderEmail({
        preheader: "Email digests are working.",
        title: "Email digests are working",
        subtitle: "You'll get a morning brief and weekly review here (toggle them in Settings).",
        sections: [],
        cta: { label: "Open Productivize", href: "/" },
      }),
    });
    if (!ok) throw new HttpError(500, "SMTP server rejected the message — check SMTP_* settings.");
    return { ok: true };
  });
}
