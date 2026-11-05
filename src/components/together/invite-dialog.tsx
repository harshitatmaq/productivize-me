"use client";

import { Check, Copy, MailCheck, MailWarning, RotateCw, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Tip } from "@/components/ui/menu";
import { useInvite, usePendingSpaceInvites, useRevokeInvite, type InviteResponse } from "@/lib/queries/spaces";
import type { Space } from "@/lib/types";
import { timeAgo } from "@/lib/utils";

export function InviteResultNote({ result, email }: { result: Pick<InviteResponse, "status" | "link">; email: string }) {
  const [copied, setCopied] = useState(false);
  if (result.status !== "link" || !result.link)
    return (
      <p className="flex items-center gap-2 text-[13px] text-fg-2">
        <MailCheck className="h-4 w-4 text-success" /> Invite sent to {email}.
      </p>
    );
  return (
    <div className="space-y-2 text-[12.5px] text-muted">
      <p className="flex items-start gap-2 text-fg-2">
        <MailWarning className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        Email isn&apos;t set up on the server, so send {email} this one-time link yourself (WhatsApp, Teams…). It signs them up and opens the invite.
      </p>
      <div className="flex items-start gap-2 rounded-lg border border-line bg-panel-2 p-2 font-mono text-[11px] text-fg-2">
        <span className="min-w-0 flex-1 break-all">{result.link}</span>
        <Tip content={copied ? "Copied" : "Copy link"}>
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(result.link!).catch(() => {});
              setCopied(true);
            }}
            aria-label="Copy invite link"
            className="shrink-0 text-muted hover:text-fg"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </Tip>
      </div>
      <p className="text-faint">It works once and expires (Supabase’s email link lifetime). If it does, they can use “Email me a sign-in link” on the sign-in page, or you can invite again.</p>
    </div>
  );
}

/** Invite people + manage pending invites for one shared dashboard. */
export function InviteDialog({ space, open, onClose }: { space: Space; open: boolean; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<InviteResponse | null>(null);
  const [sentTo, setSentTo] = useState("");
  const invite = useInvite();
  const revoke = useRevokeInvite();
  const { data: pending = [] } = usePendingSpaceInvites(open ? space.id : null);

  const send = (to: string) =>
    invite.mutate(
      { spaceId: space.id, email: to },
      {
        onSuccess: (r) => {
          setSentTo(to);
          setEmail("");
          if (r.status === "link") return setResult(r);
          setResult(null);
          toast.success(
            r.status === "emailed"
              ? `${r.resend ? "Invite re-sent" : "Invite emailed"} to ${to}`
              : `${to} already uses Productivize — they'll see the invite in Together`,
          );
        },
        onError: (e) => toast.error((e as Error).message),
      },
    );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setResult(null);
          onClose();
        }
      }}
      title={`Invite to ${space.emoji} ${space.name}`}
      description="Anyone with an email. New people get their own private dashboard as well."
      size="sm"
    >
      <div className="space-y-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (email.trim()) send(email.trim());
          }}
          className="flex items-end gap-2"
        >
          <Field label="Email" className="flex-1">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="friend@gmail.com" autoComplete="off" required />
          </Field>
          <Button type="submit" variant="primary" loading={invite.isPending}>
            Invite
          </Button>
        </form>
        {result ? <InviteResultNote result={result} email={sentTo} /> : null}
        {pending.length ? (
          <div>
            <div className="mb-1.5 text-[12px] font-medium text-muted">Waiting for an answer</div>
            <ul className="divide-y divide-line rounded-lg border border-line">
              {pending.map((p) => (
                <li key={p.id} className="flex items-center gap-2 px-3 py-2 text-[12.5px]">
                  <span className="min-w-0 flex-1 truncate text-fg-2">{p.email}</span>
                  <span className="shrink-0 text-faint">{timeAgo(p.created_at)}</span>
                  <Tip content="Send again">
                    <button onClick={() => send(p.email)} aria-label={`Resend invite to ${p.email}`} className="rounded p-1 text-muted hover:bg-panel-hover hover:text-fg">
                      <RotateCw className="h-3.5 w-3.5" />
                    </button>
                  </Tip>
                  <Tip content="Cancel invite">
                    <button
                      onClick={() => revoke.mutate(p, { onSuccess: () => toast("Invite cancelled") })}
                      aria-label={`Cancel invite to ${p.email}`}
                      className="rounded p-1 text-muted hover:bg-panel-hover hover:text-danger"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </Tip>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
