"use client";

import { Check, CircleCheck, ClipboardList, Copy, ExternalLink, FileUp, History, Pencil, RefreshCw, Sparkles, UserRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { Tip } from "@/components/ui/menu";
import { Badge, Skeleton } from "@/components/ui/misc";
import { packStats, type PackField } from "@/lib/jobs/apply";
import { useApplication, useApplicationAction, useUpdateApplication } from "@/lib/queries/applications";
import type { Job } from "@/lib/types";
import { cn, timeAgo } from "@/lib/utils";
import { ResumeButton } from "./resume-pdf";

const SOURCE: Record<PackField["source"], { label: string; tone: "success" | "accent" | "warning" | "neutral"; tip: string }> = {
  bank: { label: "Answer bank", tone: "success", tip: "From your answer bank" },
  profile: { label: "Profile", tone: "success", tip: "From your job profile — check it's still right" },
  ai: { label: "AI draft", tone: "accent", tip: "Drafted by the AI from your profile — read and adjust before submitting" },
  you: { label: "Needs you", tone: "warning", tip: "Only you know this one. Your answer is saved to the answer bank when you mark applied" },
  file: { label: "Upload", tone: "neutral", tip: "Attach a file on the form" },
};

function CopyIcon({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Tip content={done ? "Copied" : `Copy ${label}`}>
      <button
        type="button"
        aria-label={`Copy ${label}`}
        disabled={!text}
        onClick={() => {
          navigator.clipboard.writeText(text).then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1200);
          });
        }}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-panel-hover hover:text-fg disabled:opacity-30"
      >
        {done ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </Tip>
  );
}

function FieldRow({ field, onSave }: { field: PackField; onSave: (answer: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(field.answer);
  const meta = SOURCE[field.source];
  const empty = !field.answer.trim() && field.source !== "file";
  return (
    <li className={cn("rounded-lg border p-3", empty && (field.required || field.source === "you") ? "border-warning/40 bg-warning/[0.04]" : "border-line")}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[13px] font-medium text-fg">
              {field.label}
              {field.required ? <span className="text-danger"> *</span> : null}
            </span>
            <Tip content={meta.tip}>
              <Badge tone={meta.tone} tabIndex={0}>
                {meta.label}
              </Badge>
            </Tip>
          </div>
          {field.options?.length ? <div className="mt-0.5 text-[11.5px] text-faint">Options: {field.options.slice(0, 8).join(" · ")}</div> : null}
        </div>
        {field.source !== "file" ? (
          <>
            <CopyIcon text={field.answer} label="answer" />
            <Tip content="Edit answer">
              <button type="button" aria-label="Edit answer" onClick={() => (setText(field.answer), setEditing((e) => !e))} className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-panel-hover hover:text-fg">
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </Tip>
          </>
        ) : (
          <FileUp className="mt-1 h-4 w-4 text-muted" aria-hidden />
        )}
      </div>
      {editing ? (
        <div className="mt-2 space-y-2">
          <Textarea rows={Math.min(8, Math.max(2, Math.ceil(text.length / 70)))} value={text} onChange={(e) => setText(e.target.value)} autoFocus aria-label={`Answer for ${field.label}`} />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                onSave(text);
                setEditing(false);
              }}
            >
              Save
            </Button>
          </div>
        </div>
      ) : field.answer ? (
        <p className="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed text-fg-2">{field.answer}</p>
      ) : (
        <p className="mt-1.5 text-[12.5px] text-warning">{field.note ?? "Needs your answer"}</p>
      )}
      {field.answer && field.note && field.source === "ai" ? <p className="mt-1 text-[11.5px] text-faint">{field.note}</p> : null}
    </li>
  );
}

/** Job drawer → Apply: the application pack, cover letter, resume, apply link and the record. */
export function ApplyPanel({ job }: { job: Job }) {
  const { data: app, isLoading } = useApplication(job.id);
  const action = useApplicationAction();
  const update = useUpdateApplication();
  const [coverEdit, setCoverEdit] = useState<string | null>(null);

  const run = (a: "prepare" | "applied") =>
    action.mutate(
      { jobId: job.id, action: a },
      {
        onSuccess: (r) => {
          if (a === "applied") toast.success("Marked applied — a follow-up task is set for next week");
          else {
            const s = packStats(r.application.fields);
            toast.success(`Ready · ${s.answered}/${s.total} answered${s.needYou ? ` · ${s.needYou} need you` : ""}`);
          }
        },
        onError: (e) => toast.error((e as Error).message),
      },
    );

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  if (!app?.prepared_at) {
    return (
      <div className="rounded-xl border border-dashed border-line-strong px-6 py-10 text-center">
        <ClipboardList className="mx-auto mb-3 h-6 w-6 text-accent" />
        <div className="text-[14px] font-medium text-fg">Get this application ready</div>
        <p className="mx-auto mt-1 max-w-md text-[13px] text-muted">
          Reads the application form (exact questions for Greenhouse jobs, common questions elsewhere), fills what it knows from your answer bank and profile,
          drafts the open questions and a cover letter, and flags what only you can answer. Nothing is submitted for you.
        </p>
        <Button className="mt-4" variant="primary" onClick={() => run("prepare")} loading={action.isPending}>
          <Sparkles className="h-3.5 w-3.5" /> Prepare application
        </Button>
        {app?.timeline?.length ? <Timeline events={app.timeline} /> : null}
      </div>
    );
  }

  const stats = packStats(app.fields);
  const saveField = (id: string, answer: string) => {
    const fields = app.fields.map((f) => (f.id === id ? { ...f, answer, source: f.source === "ai" || f.source === "you" ? (f.source === "ai" && answer.trim() ? "ai" : "you") : f.source } : f)) as PackField[];
    update.mutate({ jobId: job.id, patch: { fields } }, { onError: (e) => toast.error((e as Error).message) });
  };
  const applied = !!app.applied_at;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-panel-2/50 p-3 text-[12.5px]">
        <span className="font-medium text-fg">
          {stats.answered}/{stats.total} answered
        </span>
        {stats.needYou ? <Badge tone="warning">{stats.needYou} need you</Badge> : <Badge tone="success">nothing missing</Badge>}
        {stats.drafts ? <Badge tone="accent">{stats.drafts} AI draft{stats.drafts > 1 ? "s" : ""} to check</Badge> : null}
        <span className="text-muted">· {app.form_source === "greenhouse" ? "the company's own form" : "common questions (this site's form couldn't be read)"}</span>
        <span className="flex-1" />
        <Tip content="Prepare again (keeps your edits, redrafts the rest)">
          <Button size="xs" variant="ghost" onClick={() => run("prepare")} loading={action.isPending && action.variables?.action === "prepare"} aria-label="Prepare again">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </Tip>
      </div>

      {applied ? (
        <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/[0.06] p-3 text-[13px] text-fg-2">
          <CircleCheck className="h-4 w-4 text-success" /> Applied {timeAgo(app.applied_at!)}. What you submitted is saved below.
        </div>
      ) : null}

      <ol className="space-y-2">
        {app.fields.map((f) => (
          <FieldRow key={`${f.id}-${f.answer.length}`} field={f} onSave={(a) => saveField(f.id, a)} />
        ))}
      </ol>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-[12px] font-medium uppercase tracking-wide text-muted">Cover letter</h4>
          <div className="flex items-center">
            <CopyIcon text={app.cover_letter ?? ""} label="cover letter" />
            <Tip content="Edit cover letter">
              <button type="button" aria-label="Edit cover letter" onClick={() => setCoverEdit(coverEdit === null ? (app.cover_letter ?? "") : null)} className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-panel-hover hover:text-fg">
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </Tip>
          </div>
        </div>
        {coverEdit !== null ? (
          <div className="space-y-2">
            <Textarea rows={10} value={coverEdit} onChange={(e) => setCoverEdit(e.target.value)} aria-label="Cover letter" />
            <div className="flex justify-end">
              <Button size="sm" variant="primary" onClick={() => update.mutate({ jobId: job.id, patch: { cover_letter: coverEdit } }, { onSuccess: () => setCoverEdit(null) })}>
                Save
              </Button>
            </div>
          </div>
        ) : (
          <div className="whitespace-pre-line rounded-lg border border-line bg-panel-2/60 p-3 text-[13px] leading-relaxed text-fg-2">{app.cover_letter || "No cover letter yet — prepare again, or use Tailor with AI."}</div>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <ResumeButton jobId={job.id} label="Tailored resume PDF" variant="secondary" size="sm" />
        <a href={app.apply_url || job.url} target="_blank" rel="noreferrer">
          <Button size="sm" variant="secondary">
            Open application <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </a>
        <span className="flex-1" />
        {!applied ? (
          <Tip content="After you've pressed Submit on the company's site">
            <Button size="sm" variant="primary" onClick={() => run("applied")} loading={action.isPending && action.variables?.action === "applied"}>
              <CircleCheck className="h-3.5 w-3.5" /> Mark applied
            </Button>
          </Tip>
        ) : null}
      </div>
      <p className="text-[11.5px] text-faint">
        <UserRound className="mr-1 inline h-3 w-3 -translate-y-px" />
        You always submit yourself. Answers you write for “Needs you” questions are saved to your answer bank when you mark applied.
      </p>

      {app.timeline?.length ? <Timeline events={app.timeline} /> : null}
    </div>
  );
}

function Timeline({ events }: { events: { at: string; kind: string; text: string }[] }) {
  return (
    <section className="text-left">
      <h4 className="mb-2 mt-4 flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-wide text-muted">
        <History className="h-3.5 w-3.5" /> Application history
      </h4>
      <ol className="space-y-1.5 border-l border-line pl-3">
        {[...events].reverse().map((e, i) => (
          <li key={i} className="text-[12.5px] text-fg-2">
            <span className="text-faint">{timeAgo(e.at)} · </span>
            {e.text}
          </li>
        ))}
      </ol>
    </section>
  );
}
