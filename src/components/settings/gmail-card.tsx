"use client";

import { Check, Copy, ExternalLink, Mail } from "lucide-react";
import { useState } from "react";
import { Card } from "@/components/ui/misc";
import { cn, timeAgo } from "@/lib/utils";
import { useServerStatus } from "./integration-status";

/** Paste into Gmail search → "Create filter" → Apply the label "Productivize" (keep "Skip the Inbox" unticked). */
export const GMAIL_FILTER =
  "from:(jobalerts-noreply@linkedin.com OR jobs-listings@linkedin.com OR naukri.com OR indeed.com OR glassdoor.com OR instahyre.com OR foundit.in OR iimjobs.com OR hirist.tech OR wellfound.com OR cutshort.io OR greenhouse.io OR lever.co OR ashbyhq.com OR myworkday.com OR smartrecruiters.com)";

export function GmailCard() {
  const { data } = useServerStatus();
  const [copied, setCopied] = useState(false);
  const worker = data?.workers?.find((w) => w.gmail_for_me);
  const sync = data?.gmail;
  const connected = !!worker;
  const copy = async () => {
    await navigator.clipboard.writeText(GMAIL_FILTER).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Card className="space-y-3 p-4 text-[12.5px] text-muted">
      <div className="flex items-start gap-3">
        <Mail className={cn("mt-0.5 h-4 w-4 shrink-0", connected ? "text-success" : "text-faint")} />
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] text-fg">Gmail job alerts</div>
          <div>
            {connected
              ? `Read by ${worker.name}${sync?.lastSyncAt ? ` · last checked ${timeAgo(sync.lastSyncAt)}` : " · waiting for the first check"}`
              : "Scout reads only the “Productivize” label in your inbox (LinkedIn, Naukri, Indeed alerts and recruiter replies) — read-only, from the worker."}
          </div>
          {sync?.last_error ? <div className="mt-1 text-danger">Last error: {sync.last_error}</div> : null}
        </div>
      </div>
      {!connected ? (
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>
            In Gmail, create a label named <b className="text-fg-2">Productivize</b>.
          </li>
          <li>
            Search Gmail with this filter, choose <i>Create filter</i> → <i>Apply the label: Productivize</i> (leave “Skip the Inbox” off), and tick{" "}
            <i>Also apply to matching conversations</i>.
            <div className="mt-1.5 flex items-start gap-2 rounded-lg border border-line bg-panel-2 p-2 font-mono text-[11px] leading-relaxed text-fg-2">
              <span className="min-w-0 flex-1 break-all">{GMAIL_FILTER}</span>
              <button onClick={copy} className="shrink-0 text-muted hover:text-fg" aria-label="Copy filter">
                {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
          </li>
          <li>
            Create an{" "}
            <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-accent hover:underline">
              app password <ExternalLink className="h-3 w-3" />
            </a>{" "}
            (needs 2-Step Verification) and add it to <code className="text-fg-2">worker/.env</code> as{" "}
            <code className="text-fg-2">GMAIL_ACCOUNTS=you@gmail.com:app-password</code>. It stays on the worker — never in the app or the database.
          </li>
        </ol>
      ) : null}
    </Card>
  );
}
