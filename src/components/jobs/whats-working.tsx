"use client";

import { ChevronDown, Clock, Lightbulb, MailQuestion, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/misc";
import { Tip } from "@/components/ui/menu";
import { useNow } from "@/lib/hooks";
import { applicationInsights, FOLLOW_UP_AFTER_DAYS, SILENT_AFTER_DAYS, type InsightRow } from "@/lib/jobs/insights";
import { useApplicationSummaries } from "@/lib/queries/applications";
import type { Job } from "@/lib/types";
import { cn } from "@/lib/utils";

function Stat({ label, value, tip }: { label: string; value: string; tip: string }) {
  return (
    <Tip content={tip}>
      <div tabIndex={0} className="min-w-0 rounded-lg border border-line bg-panel-2/50 px-3 py-2">
        <div className="text-[18px] font-semibold tabular-nums text-fg">{value}</div>
        <div className="truncate text-[11.5px] text-muted">{label}</div>
      </div>
    </Tip>
  );
}

function Row({ r, max }: { r: InsightRow; max: number }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-[12.5px]">
      <span className="truncate text-fg-2">{r.label}</span>
      <span className="tabular-nums text-muted">
        {r.rate == null ? "waiting" : `${r.rate}% replied`} · {r.applied} sent{r.interviews ? ` · ${r.interviews} interview${r.interviews > 1 ? "s" : ""}` : ""}
      </span>
      <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-panel-2">
        <div className="h-full rounded-full bg-accent/70" style={{ width: `${max ? Math.max(4, ((r.rate ?? 0) / max) * 100) : 0}%`, opacity: r.rate == null ? 0.25 : 1 }} />
      </div>
    </li>
  );
}

/** Jobs → Tracker: reply rates by how you applied, where you found the job, match score and resume. */
export function WhatsWorking({ jobs, onOpen }: { jobs: Job[]; onOpen: (j: Job) => void }) {
  const { data: apps = [] } = useApplicationSummaries();
  const now = useNow(60 * 60_000);
  const [open, setOpen] = useState(false);
  const insights = useMemo(() => applicationInsights(jobs, apps, now), [jobs, apps, now]);
  if (!insights.applied) return null;
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const max = Math.max(1, ...insights.groups.flatMap((g) => g.rows.map((r) => r.rate ?? 0)));

  return (
    <Card className="mb-5 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[13.5px] font-medium text-fg">
          <TrendingUp className="h-4 w-4 text-accent" /> What&apos;s working
        </h3>
        <span className="text-[11.5px] text-faint">
          {insights.enough ? `Based on ${insights.decided} applications with an answer or ${SILENT_AFTER_DAYS}+ days of silence` : `Early numbers — clearer after ${5 - insights.decided} more applications get an answer (or ${SILENT_AFTER_DAYS} days pass)`}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Applied" value={String(insights.applied)} tip={`${insights.week.applied} this week · ${insights.waiting} still within ${SILENT_AFTER_DAYS} days`} />
        <Stat label="Got a reply" value={insights.replyRate == null ? "–" : `${insights.replyRate}%`} tip="Interviews, offers and rejections, out of applications that got an answer or stayed silent 21+ days" />
        <Stat label="Interviews" value={insights.interviewRate == null ? "–" : `${insights.interviewRate}%`} tip={`${insights.interviews} interview${insights.interviews === 1 ? "" : "s"} or offer${insights.interviews === 1 ? "" : "s"}`} />
        <Stat label="Typical reply time" value={insights.medianReplyDays == null ? "–" : `${insights.medianReplyDays}d`} tip="Median days from applying to the first reply (from email updates and status changes in the timeline)" />
      </div>

      {insights.tip ? (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-accent-soft px-3 py-2 text-[12.5px] text-fg-2">
          <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" /> {insights.tip}
        </p>
      ) : null}

      {insights.quiet.length ? (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-muted">
            <MailQuestion className="h-3.5 w-3.5" /> Quiet for {FOLLOW_UP_AFTER_DAYS}+ days — a short follow-up helps (Apply tab → Draft messages)
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {insights.quiet.map((q) => (
              <li key={q.id}>
                <button
                  onClick={() => byId.get(q.id) && onOpen(byId.get(q.id)!)}
                  className="inline-flex max-w-[260px] items-center gap-1.5 rounded-md border border-line px-2 py-1 text-[12px] text-fg-2 hover:border-line-strong hover:text-fg"
                >
                  <span className="truncate">
                    {q.title}
                    {q.company ? ` · ${q.company}` : ""}
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-0.5 text-faint">
                    <Clock className="h-3 w-3" />
                    {q.days}d
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {insights.groups.length ? (
        <>
          <button onClick={() => setOpen((o) => !o)} className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline" aria-expanded={open}>
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} /> {open ? "Hide breakdown" : "Breakdown by channel, source, match and resume"}
          </button>
          {open ? (
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              {insights.groups.map((g) => (
                <section key={g.title}>
                  <h4 className="mb-1.5 text-[11.5px] font-medium uppercase tracking-wide text-muted">{g.title}</h4>
                  <ul className="space-y-2">
                    {g.rows.map((r) => (
                      <Row key={r.label} r={r} max={max} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}
