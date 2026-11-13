"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle } from "lucide-react";
import type { AiActivity } from "@/app/api/ai/activity/route";
import { Card, SectionTitle, Skeleton } from "@/components/ui/misc";
import { api, cn, timeAgo } from "@/lib/utils";

const LABELS: Record<string, string> = {
  "plan-day": "Plan my day",
  "preferences-learn": "Remember (preferences)",
  "memory-learn": "Daily memory learning",
  onboarding: "Scout interview",
  "profile-synthesis": "Job profile",
  "search-plan": "Search plan",
  "job-scoring": "Job scoring",
  "job-query": "Search & ask",
  "job-import": "Job import",
  "job-analysis": "Job analysis",
  resume: "Tailored resume",
  portfolio: "Portfolio",
  "memory-suggest": "Interest suggestions",
  "memory-relevance": "Interest relevance",
  "learning-suggest": "Learning suggestions",
  flashcards: "Flashcards",
  "learning-recap": "Weekly recap",
  "dashboard-assistant": "Board assistant",
};
const secs = (ms: number) => (ms >= 10_000 ? `${Math.round(ms / 1000)}s` : `${(ms / 1000).toFixed(1)}s`);

/** Settings → Integrations: what the AI did in the last 7 days, which models answered, and what failed. */
export function AiActivityCard() {
  const { data, isLoading, error } = useQuery({ queryKey: ["ai-activity"], queryFn: () => api<AiActivity>("/api/ai/activity"), staleTime: 60_000 });
  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (error) {
    const msg = (error as Error).message;
    if (/owners/.test(msg)) return null;
    return <p className="text-[12.5px] text-danger">Couldn&apos;t load AI activity: {msg}</p>;
  }
  if (!data) return null;
  const rate = data.total ? Math.round((data.ok / data.total) * 100) : 0;
  return (
    <Card className="p-4">
      <SectionTitle right={<span className="text-[12px] text-muted">last 7 days</span>}>
        <span className="inline-flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5 text-accent" /> AI activity
        </span>
      </SectionTitle>
      {!data.total ? (
        <p className="text-[12.5px] text-muted">No AI requests yet. Use Plan my day, Scout or flashcards, and this shows which models answered and how fast.</p>
      ) : (
        <div className="space-y-4">
          <p className="text-[13px] text-fg-2">
            {data.total} requests · <span className={cn(rate >= 95 ? "text-success" : rate >= 80 ? "text-warning" : "text-danger")}>{rate}% answered</span>
            {data.models.length ? ` · mostly ${data.models[0].model}` : ""}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-[12.5px]">
              <thead className="text-[11px] uppercase tracking-wide text-faint">
                <tr>
                  <th className="py-1 font-medium">Task</th>
                  <th className="py-1 font-medium">Requests</th>
                  <th className="py-1 font-medium">Answered</th>
                  <th className="py-1 font-medium">Avg time</th>
                  <th className="py-1 font-medium">Usually answered by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.tasks.map((t) => (
                  <tr key={t.purpose} title={t.lastError ? `Last problem: ${t.lastError}` : undefined}>
                    <td className="py-1.5 text-fg">{LABELS[t.purpose] ?? t.purpose}</td>
                    <td className="py-1.5 tabular-nums text-muted">{t.calls}</td>
                    <td className={cn("py-1.5 tabular-nums", t.ok === t.calls ? "text-success" : t.ok / t.calls >= 0.8 ? "text-warning" : "text-danger")}>
                      {t.ok}/{t.calls}
                      {t.fallbacks ? <span className="text-faint"> · {t.fallbacks} retries</span> : null}
                    </td>
                    <td className="py-1.5 tabular-nums text-muted">{secs(t.avgMs)}</td>
                    <td className="max-w-[220px] truncate py-1.5 font-mono text-[11.5px] text-muted">{t.topModel ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.failures.length ? (
            <details className="text-[12.5px]">
              <summary className="cursor-pointer text-muted hover:text-fg">
                <AlertTriangle className="mr-1 inline h-3.5 w-3.5 -translate-y-px text-warning" />
                {data.failures.length} request{data.failures.length > 1 ? "s" : ""} where every model failed
              </summary>
              <ul className="mt-2 space-y-1">
                {data.failures.map((f, i) => (
                  <li key={i} className="text-muted">
                    <span className="text-fg-2">{LABELS[f.purpose] ?? f.purpose}</span> · {timeAgo(f.at)} — <span className="break-all text-faint">{f.error.slice(0, 200)}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      )}
    </Card>
  );
}
