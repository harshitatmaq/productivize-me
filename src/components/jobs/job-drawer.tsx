"use client";

import { AlertTriangle, Check, Copy, ExternalLink, Lightbulb, MapPin, Share2, Sparkles, Trash2, Wallet, Wifi } from "lucide-react";
import { useEffect, useState } from "react";
import { useResettableState } from "@/lib/hooks";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/menu";
import { openShare, shareJob } from "@/lib/share";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Badge, Segmented } from "@/components/ui/misc";
import { useDeleteJob, useUpdateJob } from "@/lib/queries/jobs";
import type { Job } from "@/lib/types";
import { api, cn, timeAgo } from "@/lib/utils";
import type { JobAnalysis } from "@/lib/jobs/types";
import { CompanyLogo, ScoreBadge, sourceLabel, STATUS_META } from "./job-bits";
import { JobFeedback } from "./job-feedback";
import { ApplyPanel } from "./apply-panel";
import { ResumeButton } from "./resume-pdf";

function CopyButton({ text }: { text: string }) {
  return (
    <Button
      size="xs"
      variant="ghost"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => toast.success("Copied"));
      }}
    >
      <Copy className="h-3 w-3" /> Copy
    </Button>
  );
}

function List({ items, icon }: { items: string[]; icon?: React.ReactNode }) {
  return (
    <ul className="space-y-1.5">
      {items.map((x, i) => (
        <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-fg-2">
          <span className="mt-1 shrink-0">{icon ?? <span className="block h-1.5 w-1.5 translate-y-1 rounded-full bg-faint" />}</span>
          <span>{x}</span>
        </li>
      ))}
    </ul>
  );
}

export function JobDrawer({ job, onClose }: { job: Job | null; onClose: () => void }) {
  const update = useUpdateJob();
  const del = useDeleteJob();
  const id = job?.id ?? null;
  const [tab, setTab] = useResettableState<"overview" | "tailor" | "apply" | "track", string | null>(id, () => "overview");
  const [analysis, setAnalysis] = useResettableState<JobAnalysis | null, string | null>(id, () => job?.analysis ?? null);
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useResettableState(id, () => job?.notes ?? "");
  const [nextStep, setNextStep] = useResettableState(id, () => job?.next_step ?? "");
  const [nextDate, setNextDate] = useResettableState(id, () => job?.next_step_date ?? "");

  // Opening a job marks it as seen (clears the "new" badge).
  useEffect(() => {
    if (job && !job.seen_at) update.mutate({ id: job.id, patch: { seen_at: new Date().toISOString() } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!job) return null;

  const analyze = async () => {
    setLoading(true);
    try {
      const r = await api<{ analysis: JobAnalysis }>("/api/jobs/analyze", { json: { id: job.id } });
      setAnalysis(r.analysis);
      setTab("tailor");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const setStatus = (status: Job["status"]) =>
    update.mutate({
      id: job.id,
      patch: { status, ...(status === "applied" && !job.applied_at ? { applied_at: new Date().toISOString() } : {}) },
    });

  const saveTracking = () =>
    update.mutate(
      { id: job.id, patch: { notes: notes || null, next_step: nextStep || null, next_step_date: nextDate || null } },
      { onSuccess: () => toast.success("Saved") },
    );

  return (
    <Dialog
      open={!!job}
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={
        <span className="flex items-center gap-3">
          <CompanyLogo name={job.company} domain={job.company_domain} logo={job.company_logo} size={32} />
          <span className="min-w-0">
            <span className="block truncate">{job.title}</span>
            <span className="block truncate text-[12.5px] font-normal text-muted">{job.company}</span>
          </span>
        </span>
      }
      footer={
        <>
          <Tip content="Delete job">
            <Button variant="ghost" className="text-danger hover:text-danger" onClick={() => { del.mutate(job.id); onClose(); }} aria-label="Delete job">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </Tip>
          <Tip content="Share to a shared dashboard">
            <Button variant="ghost" onClick={() => openShare(shareJob(job))} aria-label="Share to…">
              <Share2 className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Share</span>
            </Button>
          </Tip>
          <div className="mr-auto flex items-center">
            <JobFeedback job={job} />
          </div>
          <ResumeButton jobId={job.id} label="Resume" variant="secondary" />
          <Select value={job.status} onChange={(e) => setStatus(e.target.value as Job["status"])} className="h-8 w-auto py-1">
            {Object.entries(STATUS_META).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
          <a href={job.url} target="_blank" rel="noreferrer" onClick={() => job.status === "new" && setStatus("saved")}>
            <Button variant="primary">
              Open posting <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </a>
        </>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
        <ScoreBadge score={job.score} />
        {job.location ? (
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" /> {job.location}
          </span>
        ) : null}
        {job.remote ? (
          <span className="inline-flex items-center gap-1 text-success">
            <Wifi className="h-3.5 w-3.5" /> Remote
          </span>
        ) : null}
        {job.salary ? (
          <span className="inline-flex items-center gap-1">
            <Wallet className="h-3.5 w-3.5" /> {job.salary}
          </span>
        ) : null}
        {job.employment_type ? <Badge>{job.employment_type}</Badge> : null}
        {job.seniority ? <Badge>{job.seniority}</Badge> : null}
        <span className="text-faint">
          {sourceLabel(job.source)} · {timeAgo(job.posted_at ?? job.created_at)}
        </span>
      </div>

      <Segmented
        className="mb-4"
        value={tab}
        onChange={setTab}
        options={[
          { value: "overview", label: "Overview" },
          { value: "tailor", label: "Tailor with AI" },
          { value: "apply", label: "Apply" },
          { value: "track", label: "Tracking" },
        ]}
      />

      {tab === "overview" ? (
        <div className="space-y-5">
          {job.reasons?.length ? (
            <section>
              <h4 className="mb-2 text-[12px] font-medium uppercase tracking-wide text-muted">Why it fits</h4>
              <List items={job.reasons} icon={<Check className="h-3.5 w-3.5 text-success" />} />
            </section>
          ) : null}
          {job.interest_matches?.length ? (
            <section>
              <h4 className="mb-2 text-[12px] font-medium uppercase tracking-wide text-muted">Your interests it uses</h4>
              <div className="flex flex-wrap gap-1.5">
                {job.interest_matches.map((m) => (
                  <Tip key={m.id} content={m.relevance >= 70 ? "Job-relevant interest — counted in the match" : "Side interest — a small bonus"}>
                    <a
                      href="/interests"
                      className={cn(
                        "inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[12px]",
                        m.relevance >= 70 ? "border-success/30 text-success" : "border-warning/30 text-warning",
                      )}
                    >
                      <Lightbulb className="h-3 w-3" /> {m.name}
                      <span className="tabular-nums text-faint">{m.relevance}</span>
                    </a>
                  </Tip>
                ))}
              </div>
            </section>
          ) : null}
          {job.concerns?.length ? (
            <section>
              <h4 className="mb-2 text-[12px] font-medium uppercase tracking-wide text-muted">Watch out</h4>
              <List items={job.concerns} icon={<AlertTriangle className="h-3.5 w-3.5 text-warning" />} />
            </section>
          ) : null}
          <section>
            <h4 className="mb-2 text-[12px] font-medium uppercase tracking-wide text-muted">Description</h4>
            <div className="max-h-[38vh] overflow-y-auto whitespace-pre-line rounded-lg border border-line bg-panel-2/60 p-3 text-[13px] leading-relaxed text-fg-2">
              {job.description || "No description captured — open the posting to read more, or run “Tailor with AI” to fetch it."}
            </div>
          </section>
        </div>
      ) : null}

      {tab === "tailor" ? (
        analysis ? (
          <div className="space-y-5">
            <div className="rounded-xl border border-accent/25 bg-accent-soft p-3.5 text-[13px] leading-relaxed text-fg-2">
              <div className="mb-1 flex items-center gap-2 font-medium text-fg">
                <Sparkles className="h-3.5 w-3.5 text-accent" /> Fit {analysis.fit_score}/100
              </div>
              {analysis.summary}
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <section>
                <h4 className="mb-2 text-[12px] font-medium uppercase tracking-wide text-muted">Strengths</h4>
                <List items={analysis.strengths} icon={<Check className="h-3.5 w-3.5 text-success" />} />
              </section>
              <section>
                <h4 className="mb-2 text-[12px] font-medium uppercase tracking-wide text-muted">Gaps & how to address</h4>
                <List items={analysis.gaps} icon={<AlertTriangle className="h-3.5 w-3.5 text-warning" />} />
              </section>
            </div>
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-[12px] font-medium uppercase tracking-wide text-muted">Tailored resume bullets</h4>
                <CopyButton text={analysis.resume_bullets.map((b) => `• ${b}`).join("\n")} />
              </div>
              <List items={analysis.resume_bullets} />
            </section>
            {analysis.keywords.length ? (
              <section>
                <h4 className="mb-2 text-[12px] font-medium uppercase tracking-wide text-muted">ATS keywords</h4>
                <div className="flex flex-wrap gap-1.5">
                  {analysis.keywords.map((k) => (
                    <Badge key={k}>{k}</Badge>
                  ))}
                </div>
              </section>
            ) : null}
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-[12px] font-medium uppercase tracking-wide text-muted">Cover letter</h4>
                <CopyButton text={analysis.cover_letter} />
              </div>
              <div className="whitespace-pre-line rounded-lg border border-line bg-panel-2/60 p-3 text-[13px] leading-relaxed text-fg-2">{analysis.cover_letter}</div>
            </section>
            <div className="grid gap-5 sm:grid-cols-2">
              <section>
                <h4 className="mb-2 text-[12px] font-medium uppercase tracking-wide text-muted">Interview prep</h4>
                <List items={analysis.interview_prep} />
              </section>
              <section>
                <h4 className="mb-2 text-[12px] font-medium uppercase tracking-wide text-muted">Ask them</h4>
                <List items={analysis.questions_to_ask} />
              </section>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-faint">
              <ResumeButton jobId={job.id} label="Download tailored resume PDF" variant="primary" size="sm" />
              <span>
                Generated {timeAgo(analysis.generated_at)}
                {analysis.provider ? ` · ${analysis.provider}` : ""}
              </span>
              <Button size="xs" variant="ghost" onClick={analyze} loading={loading}>
                Regenerate
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-line-strong px-6 py-10 text-center">
            <Sparkles className="mx-auto mb-3 h-6 w-6 text-accent" />
            <div className="text-[14px] font-medium text-fg">Tailor your application</div>
            <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted">
              Reads the full posting, compares it with your profile and writes resume bullets, a cover letter and interview prep.
            </p>
            <Button className="mt-4" variant="primary" onClick={analyze} loading={loading}>
              <Sparkles className="h-3.5 w-3.5" /> Analyze this job
            </Button>
          </div>
        )
      ) : null}

      {tab === "apply" ? <ApplyPanel job={job} /> : null}

      {tab === "track" ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Next step">
              <Input value={nextStep} onChange={(e) => setNextStep(e.target.value)} placeholder="e.g. Follow up with recruiter" />
            </Field>
            <Field label="By">
              <Input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
            </Field>
          </div>
          <Field label="Notes">
            <Textarea rows={6} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Referral contact, salary discussed, interview feedback…" />
          </Field>
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-faint">{job.applied_at ? `Applied ${timeAgo(job.applied_at)}` : "Not applied yet"}</span>
            <Button variant="primary" size="sm" onClick={saveTracking}>
              Save
            </Button>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
