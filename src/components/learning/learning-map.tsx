"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Combine, Network, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/misc";
import { buildGraph, layoutGraph, learnNext, similarTopics, topicSimilarity } from "@/lib/learning-map";
import { Select } from "@/components/ui/field";
import type { JobAnalysis } from "@/lib/jobs/types";
import { sb } from "@/lib/queries/client";
import { useFlashcards } from "@/lib/queries/flashcards";
import { useInterests } from "@/lib/queries/interests";
import { useConnectEntries, useLearning, useMergeTopics, useTopicLinks } from "@/lib/queries/learning";
import { cn } from "@/lib/utils";
import { useResettableState } from "@/lib/hooks";

const W = 760;
const H = 420;

/** Learning → Learning map: topics you've learned, how they connect, and what to learn next. */
export function LearningMap({ onLogTopic }: { onLogTopic?: (topic: string) => void }) {
  const { data: entries = [] } = useLearning();
  const { data: links = [], error } = useTopicLinks();
  const { data: cards = [] } = useFlashcards();
  const { data: interests = [] } = useInterests();
  const { data: gaps = [] } = useQuery({
    queryKey: ["job-gaps"],
    queryFn: async () => {
      const { data } = await sb().from("jobs").select("analysis").not("analysis", "is", null).in("status", ["new", "saved", "applied", "interviewing"]).limit(60);
      return (data ?? []).flatMap((j) => ((j.analysis as JobAnalysis | null)?.gaps ?? []) as string[]);
    },
    staleTime: 10 * 60_000,
  });
  const connect = useConnectEntries();
  const merge = useMergeTopics();
  const [selected, setSelected] = useState<string | null>(null);
  const [mergeInto, setMergeInto] = useResettableState<string, string | null>(selected, () => "");

  const graph = useMemo(() => buildGraph({ entries, links, cards, interests }), [entries, links, cards, interests]);
  // Keep the map readable: learned topics plus the next steps around them (max ~45 nodes).
  const shown = useMemo(() => {
    const learned = graph.nodes.filter((n) => n.learned).sort((a, b) => b.strength - a.strength).slice(0, 30);
    const ids = new Set(learned.map((n) => n.id));
    const next = graph.nodes.filter((n) => !n.learned && graph.edges.some((e) => (ids.has(e.from) && e.to === n.id) || (ids.has(e.to) && e.from === n.id))).slice(0, 15);
    const nodes = [...learned, ...next];
    const keep = new Set(nodes.map((n) => n.id));
    return { nodes, edges: graph.edges.filter((e) => keep.has(e.from) && keep.has(e.to)) };
  }, [graph]);
  const pos = useMemo(() => layoutGraph(shown.nodes, shown.edges, W, H), [shown]);
  const next = useMemo(() => learnNext(graph, gaps), [graph, gaps]);
  const unmapped = entries.filter((e) => !e.topics?.length);
  const sel = selected ? graph.nodes.find((n) => n.id === selected) : null;
  const duplicates = useMemo(() => similarTopics(graph.nodes), [graph]);
  // Merge targets for the selected topic: most similar names first.
  const targets = useMemo(
    () =>
      sel
        ? graph.nodes
            .filter((n) => n.id !== sel.id)
            .map((n) => ({ n, s: topicSimilarity(sel.label, n.label) }))
            .sort((a, b) => b.s - a.s || Number(b.n.learned) - Number(a.n.learned) || a.n.label.localeCompare(b.n.label))
            .map((x) => x.n)
        : [],
    [graph, sel],
  );
  const doMerge = (from: string, into: string) =>
    merge.mutate(
      { from, into, entries, links },
      {
        onSuccess: (r) => {
          toast.success(`Merged “${from}” into “${into}”${r.entries ? ` · ${r.entries} entr${r.entries === 1 ? "y" : "ies"} updated` : ""}`);
          setSelected(into.trim().toLowerCase().replace(/\s+/g, " "));
          setMergeInto("");
        },
        onError: (e) => toast.error((e as Error).message),
      },
    );

  const mapPast = async () => {
    let left = unmapped.slice(0, 30);
    let total = 0;
    while (left.length) {
      const batch = left.slice(0, 6);
      left = left.slice(6);
      try {
        total += (await connect.mutateAsync(batch.map((e) => e.id))).connected;
      } catch (e) {
        toast.error((e as Error).message);
        break;
      }
    }
    toast.success(`Mapped ${total} entr${total === 1 ? "y" : "ies"}`);
  };

  if (error) return null; // table not created yet (migration) — the rest of Learning still works
  if (!entries.length) return null;

  return (
    <Card className="p-4">
      <SectionTitle
        right={
          unmapped.length ? (
            <Button size="xs" variant="ghost" onClick={mapPast} loading={connect.isPending}>
              <Sparkles className="h-3 w-3" /> Map {Math.min(unmapped.length, 30)} past entr{unmapped.length === 1 ? "y" : "ies"}
            </Button>
          ) : null
        }
      >
        <span className="inline-flex items-center gap-1.5">
          <Network className="h-3.5 w-3.5 text-accent" /> Learning map
        </span>
      </SectionTitle>

      {duplicates.length ? (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
          <span>Looks like the same topic:</span>
          {duplicates.map((d) => (
            <Button key={`${d.a.id}>${d.b.id}`} size="xs" variant="secondary" loading={merge.isPending && merge.variables?.from === d.a.label} onClick={() => doMerge(d.a.label, d.b.label)}>
              <Combine className="h-3 w-3" /> Merge “{d.a.label}” into “{d.b.label}”
            </Button>
          ))}
        </div>
      ) : null}

      {!shown.nodes.length ? (
        <p className="text-[12.5px] text-muted">Each entry you log gets linked to its topics — what it builds on and what it leads to. Log something (or map your past entries) to see the map grow.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[520px]" role="img" aria-label="Map of the topics you've learned and how they connect">
              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="16" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--line-strong)" />
                </marker>
              </defs>
              {shown.edges.map((e) => {
                const a = pos.get(e.from);
                const b = pos.get(e.to);
                if (!a || !b) return null;
                const hot = selected && (e.from === selected || e.to === selected);
                return (
                  <line
                    key={`${e.from}>${e.to}`}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={hot ? "var(--accent)" : "var(--line-strong)"}
                    strokeWidth={hot ? 1.8 : 1}
                    strokeDasharray={e.kind === "related" ? "3 3" : undefined}
                    markerEnd={e.kind === "prereq" ? "url(#arrow)" : undefined}
                  />
                );
              })}
              {shown.nodes.map((n) => {
                const p = pos.get(n.id);
                if (!p) return null;
                const r = n.learned ? 7 + Math.min(9, Math.sqrt(n.minutes) / 2) : 6;
                return (
                  <g key={n.id} transform={`translate(${p.x},${p.y})`} className="cursor-pointer" onClick={() => setSelected(selected === n.id ? null : n.id)}>
                    <title>{n.learned ? `${n.label} · ${Math.round(n.minutes)} min · strength ${Math.round(n.strength * 100)}%` : `${n.label} · not learned yet`}</title>
                    <circle
                      r={r}
                      fill={n.learned ? "var(--accent)" : "var(--panel)"}
                      fillOpacity={n.learned ? 0.25 + n.strength * 0.75 : 1}
                      stroke={selected === n.id ? "var(--fg)" : n.learned ? "var(--accent)" : "var(--line-strong)"}
                      strokeDasharray={n.learned ? undefined : "2 2"}
                      strokeWidth={selected === n.id ? 2 : 1}
                    />
                    <text y={-r - 4} textAnchor="middle" className={cn("select-none text-[11px]", n.learned ? "fill-[var(--fg-2)]" : "fill-[var(--faint)]")}>
                      {n.label.length > 24 ? `${n.label.slice(0, 23)}…` : n.label}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
          <p className="mt-1 text-[11.5px] text-faint">Filled dots: learned (darker = stronger, from time spent, entries, flashcard recall and your confidence ratings). Dashed: next topics. Arrows point from a topic to what builds on it.</p>
        </>
      )}

      {sel ? (
        <div className="mt-3 rounded-lg border border-line bg-panel-2/50 p-3 text-[12.5px]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13.5px] font-medium text-fg">{sel.label}</span>
            {onLogTopic ? (
              <Button size="xs" variant="secondary" onClick={() => onLogTopic(sel.label)}>
                Log learning about it
              </Button>
            ) : null}
          </div>
          <div className="mt-1 text-muted">
            {sel.learned ? `${Math.round(sel.minutes)} min over ${sel.entries.length} entr${sel.entries.length === 1 ? "y" : "ies"} · strength ${Math.round(sel.strength * 100)}%` : "Not learned yet"}
            {sel.recall != null ? ` · flashcard recall ${Math.round(sel.recall * 100)}%` : ""}
            {sel.confidence != null ? ` · your confidence ${sel.confidence}/5` : ""}
            {sel.relevance != null ? ` · job relevance ${sel.relevance}` : ""}
          </div>
          {graph.edges.filter((e) => e.to === sel.id && e.kind === "prereq").length ? (
            <div className="mt-1.5 text-fg-2">
              Builds on: {graph.edges.filter((e) => e.to === sel.id && e.kind === "prereq").map((e) => graph.nodes.find((n) => n.id === e.from)?.label).join(", ")}
            </div>
          ) : null}
          {graph.edges.filter((e) => e.from === sel.id && e.kind === "prereq").length ? (
            <div className="text-fg-2">
              Leads to: {graph.edges.filter((e) => e.from === sel.id && e.kind === "prereq").map((e) => graph.nodes.find((n) => n.id === e.to)?.label).join(", ")}
            </div>
          ) : null}
          {targets.length ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-muted">Same as another topic?</span>
              <Select value={mergeInto} onChange={(e) => setMergeInto(e.target.value)} className="h-7 w-auto max-w-[220px] py-0.5 text-[12px]" aria-label={`Merge ${sel.label} into`}>
                <option value="">Merge into…</option>
                {targets.slice(0, 40).map((n) => (
                  <option key={n.id} value={n.label}>
                    {n.label}
                    {n.learned ? "" : " (not learned yet)"}
                  </option>
                ))}
              </Select>
              <Button size="xs" variant="secondary" disabled={!mergeInto} loading={merge.isPending} onClick={() => doMerge(sel.label, mergeInto)}>
                <Combine className="h-3 w-3" /> Merge
              </Button>
            </div>
          ) : null}
          {sel.entries.length ? (
            <ul className="mt-1.5 space-y-0.5 text-faint">
              {sel.entries.slice(0, 4).map((e) => (
                <li key={e.id}>
                  {e.entry_date} · {e.title}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {next.length ? (
        <div className="mt-4">
          <div className="mb-1.5 text-[12px] font-medium uppercase tracking-wide text-muted">Learn next</div>
          <ul className="space-y-1.5">
            {next.map((t) => (
              <li key={t.topic} className="flex flex-wrap items-center gap-2 text-[13px]">
                <ArrowRight className="h-3.5 w-3.5 text-accent" />
                <button type="button" className="font-medium text-fg hover:underline" onClick={() => setSelected(t.topic.trim().toLowerCase())}>
                  {t.topic}
                </button>
                <span className="text-[12px] text-muted">— {t.reasons.join(" · ")}</span>
                {onLogTopic ? (
                  <Button size="xs" variant="ghost" onClick={() => onLogTopic(t.topic)}>
                    Start
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
