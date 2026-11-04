import "server-only";

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { classifyEmail, extractJobsFromEmail } from "./gmail-parse";
import type { RawJob } from "./types";

/**
 * Worker-only Gmail reader. Credentials come from the worker's environment:
 *   GMAIL_ACCOUNTS="you@gmail.com:app password,friend@gmail.com:app password"
 *   GMAIL_LABEL=Productivize
 * Only the label is opened — nothing else in the mailbox is read.
 */
export function gmailAccounts(): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of (process.env.GMAIL_ACCOUNTS ?? "").split(",")) {
    const i = part.indexOf(":");
    if (i <= 0) continue;
    map.set(part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).replace(/\s+/g, ""));
  }
  return map;
}

export function gmailLabel() {
  return process.env.GMAIL_LABEL?.trim() || "Productivize";
}

export type GmailBatch = {
  jobs: RawJob[];
  emails: { messageId: string; kind: "alert" | "reply" | "other"; from: string; subject: string; date: string | null; jobs: number }[];
  lastUid: number;
  uidValidity: string;
};

/** Reads new messages in the label since `lastUid` (first run: the last 7 days). */
export async function readGmailLabel(email: string, appPassword: string, state: { lastUid?: number; uidValidity?: string }): Promise<GmailBatch> {
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: email, pass: appPassword },
    logger: false,
  });
  await client.connect();
  const out: GmailBatch = { jobs: [], emails: [], lastUid: state.lastUid ?? 0, uidValidity: state.uidValidity ?? "" };
  const lock = await client.getMailboxLock(gmailLabel());
  try {
    const mailbox = client.mailbox;
    const validity = mailbox && typeof mailbox === "object" ? String(mailbox.uidValidity) : "";
    const resume = state.lastUid && state.uidValidity === validity;
    const range = resume ? { uid: `${state.lastUid! + 1}:*` } : { since: new Date(Date.now() - 7 * 86_400_000) };
    const uids = (await client.search(range, { uid: true })) || [];
    for (const uid of uids.slice(-150)) {
      if (resume && uid <= state.lastUid!) continue;
      const msg = await client.fetchOne(String(uid), { source: true, uid: true }, { uid: true });
      if (!msg || !msg.source) continue;
      const parsed = await simpleParser(msg.source);
      const from = parsed.from?.text ?? "";
      const subject = parsed.subject ?? "";
      const kind = classifyEmail(from, subject);
      const html = typeof parsed.html === "string" ? parsed.html : parsed.textAsHtml ?? "";
      const jobs = kind === "alert" ? extractJobsFromEmail(html, parsed.date ?? null) : [];
      out.jobs.push(...jobs);
      out.emails.push({
        messageId: parsed.messageId ?? `uid-${validity}-${uid}`,
        kind,
        from: from.slice(0, 200),
        subject: subject.slice(0, 300),
        date: parsed.date ? parsed.date.toISOString() : null,
        jobs: jobs.length,
      });
      out.lastUid = Math.max(out.lastUid, uid);
    }
    out.uidValidity = validity;
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
  return out;
}
