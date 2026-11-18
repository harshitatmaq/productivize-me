"use client";

import { Check, Copy, ExternalLink, MessageSquareHeart, Target } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { Outreach } from "@/app/api/jobs/outreach/route";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/menu";
import { keywordCoverage } from "@/lib/jobs/apply";
import type { JobAnalysis } from "@/lib/jobs/types";
import { useJobProfile } from "@/lib/queries/jobs";
import type { Job } from "@/lib/types";
import { api, cn } from "@/lib/utils";

function Copyable({ label, text }: { label: string; text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="rounded-lg border border-line p-2.5">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11.5px] font-medium uppercase tracking-wide text-muted">{label}</span>
        <Tip content={done ? "Copied" : `Copy ${label.toLowerCase()}`}>
          <button
            type="button"
            aria-label={`Copy ${label.toLowerCase()}`}
            onClick={() => navigator.clipboard.writeText(text).then(() => (setDone(true), setTimeout(() => setDone(false), 1200)))}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-panel-hover hover:text-fg"
          >
            {done ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </Tip>
      </div>
      <p className="whitespace-pre-line text-[12.5px] leading-relaxed text-fg-2">{text}</p>
    </div>
  );
}

/** Apply tab → Get noticed: keyword coverage of your resume, and a referral (the biggest boost). */
export function GetNoticed({ job, resume }: { job: Job; resume?: unknown }) {
  const { data: row } = useJobProfile();
  const [drafts, setDrafts] = useState<Outreach | null>(null);
  const [loading, setLoading] = useState(false);
  const analysis = job.analysis as JobAnalysis | null;
  const resumeText = resume ? JSON.stringify(resume) : [row?.resume_text ?? "", (row?.profile?.skills ?? []).join(" "), (row?.profile?.tools ?? []).join(" ")].join(" ");
  const cov = analysis?.keywords?.length ? keywordCoverage(analysis.keywords, resumeText) : null;
  const company = job.company ?? "";
  const people = (q: string) => `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(q)}`;

  const draft = async () => {
    setLoading(true);
    try {
      setDrafts(await api<Outreach>("/api/jobs/outreach", { json: { jobId: job.id } }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="mb-5 space-y-3 rounded-xl border border-line p-4">
      <div className="flex items-start gap-2">
        <Target className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <div className="min-w-0 flex-1 text-[12.5px]">
          {cov ? (
            <>
              <span className={cn("font-medium", cov.missing.length <= cov.covered.length / 3 ? "text-success" : "text-warning")}>
                Your {resume ? "tailored resume" : "profile"} covers {cov.covered.length}/{cov.covered.length + cov.missing.length} keywords from this posting
              </span>
              {cov.missing.length ? (
                <span className="text-muted">
                  {" "}
                  · missing: {cov.missing.slice(0, 8).join(", ")}. Add the ones you genuinely have — the tailored resume PDF does this for you.
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-muted">Run “Tailor with AI → Analyze” to see how well your resume covers this posting&apos;s keywords.</span>
          )}
        </div>
      </div>

      <div className="flex items-start gap-2">
        <MessageSquareHeart className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-[12.5px] text-fg-2">
            <b>Get referred</b> — the biggest boost. Find someone at {company || "the company"} (ideally on the team or an alum of your college), send a short note, and apply on the company&apos;s own site.
          </p>
          <div className="flex flex-wrap gap-2">
            {company ? (
              <>
                <a href={people(`${company} ${job.title.split(/[,(–-]/)[0]}`)} target="_blank" rel="noreferrer">
                  <Button size="xs" variant="secondary">
                    People on this team <ExternalLink className="h-3 w-3" />
                  </Button>
                </a>
                <a href={people(`${company} recruiter`)} target="_blank" rel="noreferrer">
                  <Button size="xs" variant="secondary">
                    Recruiters at {company.length > 18 ? `${company.slice(0, 18)}…` : company} <ExternalLink className="h-3 w-3" />
                  </Button>
                </a>
              </>
            ) : null}
            <Button size="xs" variant="primary" onClick={draft} loading={loading}>
              {drafts ? "Draft again" : "Draft messages"}
            </Button>
          </div>
          {drafts ? (
            <div className="grid gap-2">
              <Copyable label="Referral ask" text={drafts.referral} />
              <Copyable label="Note to the recruiter" text={drafts.recruiter} />
              {drafts.follow_up ? <Copyable label="Follow-up (5-7 days later)" text={drafts.follow_up} /> : null}
            </div>
          ) : null}
          <p className="text-[11.5px] text-faint">You browse and send these yourself — nothing is automated on LinkedIn.</p>
        </div>
      </div>
    </section>
  );
}
