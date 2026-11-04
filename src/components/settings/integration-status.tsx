"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, CircleDashed, ExternalLink } from "lucide-react";
import { Card, SectionTitle, Skeleton } from "@/components/ui/misc";
import { api, cn } from "@/lib/utils";

export type ServerStatus = {
  ai: { id: string; label: string; configured: boolean; models: string[]; signupUrl: string }[];
  search: { id: string; label: string; configured: boolean; monthlyLimit: number; signupUrl: string }[];
  sources: { id: string; label: string; kind: string; configured: boolean; minIntervalMin: number; signupUrl?: string; workerOnly: boolean }[];
  embeddings?: string[];
  workers?: { name: string; online: boolean; last_seen: string; capabilities: string[]; jobspy_sites: string[]; gmail_for_me: boolean }[];
  gmail?: { last_run_at: string | null; lastSyncAt?: string; lastUid?: number; last_count?: number; last_error?: string | null } | null;
  push: boolean;
  email: boolean;
  cron: boolean;
  serviceKey: boolean;
  usage: { provider: string; period: string; count: number }[];
};

export function useServerStatus() {
  return useQuery({ queryKey: ["server-status"], queryFn: () => api<ServerStatus>("/api/status"), staleTime: 5 * 60_000 });
}

function Dot({ ok }: { ok: boolean }) {
  return ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" /> : <CircleDashed className="h-3.5 w-3.5 shrink-0 text-faint" />;
}

function Row({ ok, label, meta, href }: { ok: boolean; label: string; meta?: string; href?: string }) {
  return (
    <div className="flex items-center gap-2.5 py-1.5 text-[13px]">
      <Dot ok={ok} />
      <span className={cn("min-w-0 flex-1 truncate", ok ? "text-fg-2" : "text-muted")}>{label}</span>
      {meta ? <span className="shrink-0 text-[11.5px] text-faint">{meta}</span> : null}
      {!ok && href ? (
        <a href={href} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-[11.5px] text-accent hover:underline">
          get key <ExternalLink className="h-3 w-3" />
        </a>
      ) : null}
    </div>
  );
}

export function IntegrationStatus({ only }: { only?: ("ai" | "search" | "sources" | "system")[] }) {
  const { data, isLoading, error } = useServerStatus();
  const show = (k: "ai" | "search" | "sources" | "system") => !only || only.includes(k);
  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (error || !data) return <p className="text-[12.5px] text-danger">Couldn&apos;t load server status: {(error as Error)?.message}</p>;
  const used = (p: string) => data.usage.filter((u) => u.provider === p || u.provider === `search:${p}` || u.provider === `jobs:${p}`).reduce((s, u) => s + u.count, 0);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {show("ai") ? (
        <Card className="p-4">
          <SectionTitle>AI providers (fallback order)</SectionTitle>
          {data.ai.map((p, i) => (
            <Row key={p.id} ok={p.configured} label={`${i + 1}. ${p.label}`} meta={p.configured ? p.models[0] : undefined} href={p.signupUrl || undefined} />
          ))}
        </Card>
      ) : null}
      {show("search") ? (
        <Card className="p-4">
          <SectionTitle>Web search (fallback order)</SectionTitle>
          {data.search.map((p) => (
            <Row key={p.id} ok={p.configured} label={p.label} meta={p.configured ? `${used(p.id)}/${p.monthlyLimit} this month` : undefined} href={p.signupUrl} />
          ))}
        </Card>
      ) : null}
      {show("sources") ? (
        <Card className="p-4">
          <SectionTitle>Job sources</SectionTitle>
          {data.sources.map((s) => {
            // Worker-only sources are configured on the worker (its own .env), not here.
            const viaWorker = s.workerOnly && !s.configured;
            const ok = viaWorker ? (data.workers ?? []).some((w) => w.online) : s.configured;
            const every = `every ${s.minIntervalMin >= 60 ? `${s.minIntervalMin / 60}h` : `${s.minIntervalMin}m`}`;
            return <Row key={s.id} ok={ok} label={s.label} meta={viaWorker ? "Scout worker" : ok ? every : undefined} href={viaWorker ? undefined : s.signupUrl} />;
          })}
        </Card>
      ) : null}
      {show("system") ? (
        <Card className="p-4">
          <SectionTitle>System</SectionTitle>
          <Row ok={data.serviceKey} label="Supabase service key (background jobs)" />
          <Row ok={data.cron} label="Cron secret (scheduler)" />
          <Row ok={data.push} label="Web push (VAPID keys)" />
          <Row ok={data.email} label="Email (SMTP)" />
        </Card>
      ) : null}
    </div>
  );
}
