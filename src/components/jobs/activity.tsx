"use client";

import { CheckCircle2, CircleAlert, CircleDashed, Loader2, Search, Server } from "lucide-react";
import { toast } from "sonner";
import { IntegrationStatus, useServerStatus, type ServerStatus } from "@/components/settings/integration-status";
import { Switch } from "@/components/ui/field";
import { Card, EmptyState, SectionTitle, Skeleton } from "@/components/ui/misc";
import { useJobProfile, useJobRuns, useSearches, useUpdateJobProfile } from "@/lib/queries/jobs";
import { cn, timeAgo } from "@/lib/utils";
import { runSourceLabel } from "./live-run";

function Workers({ workers }: { workers: NonNullable<ServerStatus["workers"]> }) {
  if (!workers.length)
    return (
      <Card className="p-4 text-[12.5px] text-muted">
        <div className="mb-1 flex items-center gap-2 text-[13px] text-fg-2">
          <Server className="h-4 w-4 text-faint" /> No Scout worker connected
        </div>
        Searches run in the app every hour (web search and job boards). Start the worker on your PC or a free Oracle VM to add LinkedIn, Naukri, Indeed,
        Glassdoor, 100+ curated career sites and your Gmail job alerts — see <code className="text-fg-2">worker/README.md</code>.
      </Card>
    );
  return (
    <Card className="divide-y divide-line">
      {workers.map((w) => (
        <div key={w.name} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
          <span className={cn("h-2 w-2 shrink-0 rounded-full", w.online ? "bg-success" : "bg-faint")} />
          <span className="text-[13px] font-medium text-fg">{w.name}</span>
          <span className="text-[11.5px] text-faint">{w.online ? "online" : `offline · seen ${timeAgo(w.last_seen)}`}</span>
          <span className="ml-auto flex flex-wrap gap-1">
            {[...w.jobspy_sites.map((s) => s[0].toUpperCase() + s.slice(1)), ...(w.gmail_for_me ? ["Your Gmail"] : []), "Career sites"].map((c) => (
              <span key={c} className="rounded border border-line px-1.5 text-[11px] leading-5 text-muted">
                {c}
              </span>
            ))}
          </span>
        </div>
      ))}
    </Card>
  );
}

function SourceToggles({ status }: { status: ServerStatus }) {
  const { data: row } = useJobProfile();
  const update = useUpdateJobProfile();
  const disabled = new Set(row?.disabled_sources ?? []);
  const online = (status.workers ?? []).filter((w) => w.online);
  const availability = (id: string, workerOnly: boolean, configured: boolean): { ok: boolean; note: string } => {
    if (!workerOnly) return configured ? { ok: true, note: "" } : { ok: false, note: "needs an API key" };
    if (!online.length) return { ok: false, note: "needs the Scout worker" };
    if (id.startsWith("jobspy_")) {
      const site = id.slice(7);
      return online.some((w) => w.jobspy_sites.includes(site)) ? { ok: true, note: "on worker" } : { ok: false, note: "not enabled on the worker" };
    }
    if (id === "gmail") return online.some((w) => w.gmail_for_me) ? { ok: true, note: "on worker" } : { ok: false, note: "add your app password on the worker" };
    return { ok: true, note: "on worker" };
  };
  const toggle = (id: string, on: boolean) => {
    const next = on ? [...disabled].filter((x) => x !== id) : [...disabled, id];
    update.mutate({ disabled_sources: next }, { onError: (e) => toast.error((e as Error).message) });
  };
  if (!row) return null;
  return (
    <Card className="grid gap-x-6 px-4 sm:grid-cols-2">
      {status.sources.map((s) => {
        const a = availability(s.id, s.workerOnly, s.configured);
        return (
          <div key={s.id} className="border-b border-line last:border-0 sm:[&:nth-last-child(2)]:border-0">
            <Switch
              checked={!disabled.has(s.id)}
              onChange={(v) => toggle(s.id, v)}
              label={<span className={cn(!a.ok && "text-muted")}>{runSourceLabel(s.id) === s.id ? s.label : runSourceLabel(s.id)}</span>}
              description={
                <span className={cn(!a.ok && "text-faint")}>
                  {a.ok ? `every ${s.minIntervalMin >= 60 ? `${s.minIntervalMin / 60}h` : `${s.minIntervalMin}m`}` : a.note}
                  {a.ok && a.note ? ` · ${a.note}` : ""}
                </span>
              }
            />
          </div>
        );
      })}
    </Card>
  );
}

export function Activity() {
  const { data: runs = [] } = useJobRuns();
  const { data: status, isLoading } = useServerStatus();
  const { data: searches = [] } = useSearches();
  const queryOf = (id: string | null) => (id ? searches.find((s) => s.id === id)?.query : undefined);
  return (
    <div className="space-y-6">
      <div>
        <SectionTitle>Scout worker</SectionTitle>
        {isLoading ? <Skeleton className="h-14 rounded-xl" /> : status ? <Workers workers={status.workers ?? []} /> : null}
      </div>
      <div>
        <SectionTitle>Recent searches</SectionTitle>
        {runs.length === 0 ? (
          <EmptyState title="No searches yet">Searches run every hour once your profile is ready.</EmptyState>
        ) : (
          <Card className="divide-y divide-line">
            {runs.map((r) => {
              const Icon = r.status === "running" ? Loader2 : r.status === "ok" ? CheckCircle2 : r.status === "error" ? CircleAlert : CircleDashed;
              const q = queryOf(r.search_id);
              return (
                <details key={r.id} className="group px-4 py-3">
                  <summary className="flex cursor-pointer list-none items-center gap-3">
                    <Icon
                      className={cn(
                        "h-4 w-4 shrink-0",
                        r.status === "running" && "animate-spin text-accent",
                        r.status === "ok" && "text-success",
                        r.status === "partial" && "text-warning",
                        r.status === "error" && "text-danger",
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-fg-2">
                      {r.status === "running" ? (r.stats?.stage ?? "Starting") + "…" : `${r.stats?.inserted ?? 0} new · ${r.stats?.strong ?? 0} strong`}
                      {q ? (
                        <span className="ml-1.5 inline-flex items-center gap-1 text-muted">
                          <Search className="h-3 w-3" /> “{q}”
                        </span>
                      ) : (
                        <span className="text-faint"> · scanned {r.stats?.fetched ?? 0}, scored {r.stats?.scored ?? 0}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-[11.5px] text-faint">
                      {r.worker ? `${r.worker} · ` : ""}
                      {r.trigger} · {timeAgo(r.started_at)}
                      {r.stats?.ms ? ` · ${Math.round(r.stats.ms / 1000)}s` : ""}
                    </span>
                  </summary>
                  <div className="mt-3 grid gap-3 text-[12px] sm:grid-cols-2">
                    <div>
                      <div className="mb-1 text-muted">Sources</div>
                      {Object.entries(r.stats?.sources ?? {}).map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-2 text-fg-2">
                          <span className="shrink-0">{runSourceLabel(k)}</span>
                          <span className={cn("truncate text-right", v.error ? "text-danger" : "text-faint")} title={v.error ?? v.skipped}>
                            {v.running ? "searching…" : v.error ? v.error : v.skipped ? v.skipped : `${v.fetched} found`}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div>
                      <div className="mb-1 text-muted">Log {r.stats?.providers?.length ? `· AI: ${r.stats.providers.join(", ")}` : ""}</div>
                      <ul className="space-y-0.5 text-faint">
                        {(r.stats?.log ?? []).map((l, i) => (
                          <li key={i} className="break-words">
                            {l}
                          </li>
                        ))}
                        {r.error ? <li className="text-danger">{r.error}</li> : null}
                      </ul>
                    </div>
                  </div>
                </details>
              );
            })}
          </Card>
        )}
      </div>
      <div>
        <SectionTitle>Sources</SectionTitle>
        <p className="-mt-1 mb-2 text-[12px] text-faint">Turn off any source you don&apos;t want Scout to use. LinkedIn and Naukri are read from public listings only — never with your login.</p>
        {status ? <SourceToggles status={status} /> : <Skeleton className="h-40 rounded-xl" />}
      </div>
      <div>
        <SectionTitle>Configured on the server</SectionTitle>
        <IntegrationStatus only={["search", "ai"]} />
      </div>
    </div>
  );
}
