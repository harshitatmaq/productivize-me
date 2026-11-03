"use client";

import { CheckCircle2, CircleAlert, CircleDashed, Loader2 } from "lucide-react";
import { IntegrationStatus } from "@/components/settings/integration-status";
import { Card, EmptyState, SectionTitle } from "@/components/ui/misc";
import { useJobRuns } from "@/lib/queries/jobs";
import { cn, timeAgo } from "@/lib/utils";

export function Activity() {
  const { data: runs = [] } = useJobRuns();
  return (
    <div className="space-y-6">
      <div>
        <SectionTitle>Recent searches</SectionTitle>
        {runs.length === 0 ? (
          <EmptyState title="No searches yet">Searches run every hour once your profile is ready.</EmptyState>
        ) : (
          <Card className="divide-y divide-line">
            {runs.map((r) => {
              const Icon = r.status === "running" ? Loader2 : r.status === "ok" ? CheckCircle2 : r.status === "error" ? CircleAlert : CircleDashed;
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
                    <span className="min-w-0 flex-1 text-[13px] text-fg-2">
                      {r.stats?.inserted ?? 0} new · {r.stats?.strong ?? 0} strong
                      <span className="text-faint"> · scanned {r.stats?.fetched ?? 0}, scored {r.stats?.scored ?? 0}</span>
                    </span>
                    <span className="shrink-0 text-[11.5px] text-faint">
                      {r.trigger} · {timeAgo(r.started_at)}
                      {r.stats?.ms ? ` · ${Math.round(r.stats.ms / 1000)}s` : ""}
                    </span>
                  </summary>
                  <div className="mt-3 grid gap-3 text-[12px] sm:grid-cols-2">
                    <div>
                      <div className="mb-1 text-muted">Sources</div>
                      {Object.entries(r.stats?.sources ?? {}).map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-2 text-fg-2">
                          <span>{k}</span>
                          <span className={cn("truncate text-right", v.error ? "text-danger" : "text-faint")}>
                            {v.error ? v.error : v.skipped ? v.skipped : `${v.fetched} found`}
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
        <SectionTitle>Configured on the server</SectionTitle>
        <IntegrationStatus only={["sources", "search", "ai"]} />
      </div>
    </div>
  );
}
