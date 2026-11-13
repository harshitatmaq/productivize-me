import "server-only";

import { notify } from "@/lib/notify";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { classifyReply, matchReplyToJob, statusAfter, type ReplyOutcome } from "./apply";

type Reply = { messageId: string; from: string; subject: string; date: string | null; text?: string };

const LABEL: Record<ReplyOutcome, string> = {
  interview: "Interview invite",
  rejected: "Rejection",
  offer: "Offer",
  received: "Application received",
  other: "Reply",
};

/**
 * Reply emails in your Productivize Gmail label → application status and timeline.
 * Rules only: email text never goes to an AI. Unmatched emails are left alone.
 */
export async function applyReplies(userId: string, replies: Reply[], log: (m: string) => void = () => {}): Promise<number> {
  if (!replies.length) return 0;
  const admin = supabaseAdmin();
  const [{ data: jobs }, { data: profile }] = await Promise.all([
    admin.from("jobs").select("id, company, company_domain, title, status, applied_at").eq("user_id", userId).in("status", ["saved", "applied", "interviewing", "offer"]).limit(500),
    admin.from("profiles").select("id, email, notify_push, notify_email").eq("id", userId).maybeSingle(),
  ]);
  let updated = 0;
  for (const r of replies) {
    const outcome = classifyReply(r.subject, r.text ?? "");
    if (outcome === "other") continue;
    const job = matchReplyToJob(r.from, r.subject, r.text ?? "", jobs ?? []);
    await admin.from("email_ingest").update({ parsed: { outcome, job_id: job?.id ?? null } }).eq("user_id", userId).eq("message_id", r.messageId);
    if (!job) continue;

    const at = r.date ?? new Date().toISOString();
    const next = statusAfter(job.status, outcome);
    if (next) {
      await admin.from("jobs").update({ status: next }).eq("id", job.id);
      job.status = next;
    }
    const { data: app } = await admin.from("applications").select("timeline").eq("job_id", job.id).maybeSingle();
    const timeline = [...((app?.timeline ?? []) as { at: string; kind: string; text: string }[])];
    if (!timeline.some((e) => e.text.includes(r.subject.slice(0, 60)))) {
      timeline.push({ at, kind: outcome, text: `${LABEL[outcome]}: “${r.subject.slice(0, 120)}”` });
      await admin.from("applications").upsert({ job_id: job.id, user_id: userId, timeline: timeline.slice(-50) }, { onConflict: "job_id" });
    }
    if (profile && (outcome === "interview" || outcome === "offer" || outcome === "rejected")) {
      await notify(profile as Parameters<typeof notify>[0], {
        kind: "application",
        dedupeKey: `reply:${r.messageId}`,
        title: `${outcome === "interview" ? "🎉 Interview invite" : outcome === "offer" ? "🎉 Offer" : "Update"} · ${job.company ?? job.title}`,
        body: `${r.subject.slice(0, 140)}${next ? ` — moved to ${next}` : ""}`,
        url: `/jobs?tab=tracker&job=${job.id}`,
      }).catch(() => {});
    }
    updated++;
    log(`gmail: ${LABEL[outcome].toLowerCase()} for ${job.company ?? job.title}${next ? ` → ${next}` : ""}`);
  }
  return updated;
}
