import "server-only";

import nodemailer, { type Transporter } from "nodemailer";
import { env, envInt } from "@/lib/env";

let transporter: Transporter | null = null;

export function emailConfigured(): boolean {
  return !!(env("SMTP_HOST") && env("SMTP_USER") && env("SMTP_PASS"));
}

function getTransport(): Transporter {
  if (transporter) return transporter;
  const port = envInt("SMTP_PORT", 465);
  transporter = nodemailer.createTransport({
    host: env("SMTP_HOST"),
    port,
    secure: port === 465,
    auth: { user: env("SMTP_USER"), pass: env("SMTP_PASS") },
  });
  return transporter;
}

export async function sendEmail(params: { to: string; subject: string; html: string; text?: string }): Promise<boolean> {
  if (!emailConfigured()) return false;
  try {
    await getTransport().sendMail({
      from: env("EMAIL_FROM") ?? env("SMTP_USER"),
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    });
    return true;
  } catch (e) {
    console.warn("[email] send failed:", (e as Error).message);
    return false;
  }
}
