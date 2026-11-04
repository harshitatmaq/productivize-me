"use client";

import { ArrowUp, Bookmark, BookmarkCheck, Building2, Clock, History, MapPin, Radar, Sparkles, Trash2, Wifi, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { EmptyState, SectionTitle, Skeleton } from "@/components/ui/misc";
import { Tip } from "@/components/ui/menu";
import { isRunLive, useDeleteSearch, useJobProfile, useJobRuns, useRunQuery, useSearches, useUpdateSearch, type QueryResult } from "@/lib/queries/jobs";
import type { Job, SavedSearch } from "@/lib/types";
import { cn, plural, timeAgo } from "@/lib/utils";
import { JobGrid } from "./job-grid";
import { LiveRun } from "./live-run";

type Active = Pick<QueryResult, "search" | "plan" | "stored" | "mode">;

const byScore = (a: Job, b: Job) => (b.score ?? 0) - (a.score ?? 0) || b.created_at.localeCompare(a.created_at);

function suggestionsFrom(profile: { target_titles?: string[]; locations?: string[]; target_companies?: string[]; remote?: string } | undefined) {
  const titles = profile?.target_titles?.filter(Boolean) ?? [];
  const loc = profile?.locations?.find(Boolean);
  const out: string[] = [];
  if (titles[0]) out.push(loc ? `${titles[0]} roles in ${loc}` : `${titles[0]} roles`);
  if (titles[0]) out.push(`Remote ${titles[0]} jobs posted this week`);
  if (titles[1]) out.push(loc ? `${titles[1]} in ${loc}` : titles[1]);
  if (profile?.target_companies?.[0] && titles[0]) out.push(`${titles[0]} at ${profile.target_companies.slice(0, 2).join(" or ")}`);
  if (titles[0]) out.push(`Senior ${titles[0].replace(/^senior\s+/i, "")} at product startups`);
  if (!out.length) out.push("Data engineer roles in Bengaluru", "Remote analytics engineer jobs posted this week", "Power BI developer at product companies");
  return [...new Set(out)].slice(0, 5);
}

function PlanChips({ plan }: { plan: Active["plan"] }) {
  const chips: { icon: React.ReactNode; text: string }[] = [
    ...(plan.titles ?? []).slice(0, 3).map((t) => ({ icon: <Radar className="h-3 w-3" />, text: t })),
    ...(plan.locations ?? []).slice(0, 2).map((l) => ({ icon: <MapPin className="h-3 w-3" />, text: l })),
    ...(plan.remote && plan.remote !== "any" ? [{ icon: <Wifi className="h-3 w-3" />, text: plan.remote }] : []),
    ...(plan.companies ?? []).slice(0, 3).map((c) => ({ icon: <Building2 className="h-3 w-3" />, text: c })),
    ...(plan.posted_within_days ? [{ icon: <Clock className="h-3 w-3" />, text: `last ${plan.posted_within_days}d` }] : []),
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((c, i) => (
        <motion.span
          key={`${c.text}-${i}`}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.04 }}
          className="inline-flex h-6 items-center gap-1 rounded-md border border-line bg-panel px-2 text-[11.5px] capitalize text-fg-2"
        >
          <span className="text-faint">{c.icon}</span>
          {c.text}
        </motion.span>
      ))}
    </div>
  );
}

export function SearchPanel({ jobs, onOpen }: { jobs: Job[]; onOpen: (j: Job) => void }) {
  const { data: row } = useJobProfile();
  const { data: searches = [], isLoading: searchesLoading } = useSearches();
  const { data: runs = [] } = useJobRuns();
  const run = useRunQuery();
  const update = useUpdateSearch();
  const remove = useDeleteSearch();
  const [q, setQ] = useState("");
  const [active, setActive] = useState<Active | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const qc = useQueryClient();

  const suggestions = useMemo(() => suggestionsFrom(row?.profile), [row?.profile]);
  const saved = searches.filter((s) => s.saved);
  const recent = useMemo(() => {
    const seen = new Set<string>();
    return searches.filter((s) => !s.saved && !seen.has(s.query.toLowerCase()) && seen.add(s.query.toLowerCase())).slice(0, 6);
  }, [searches]);

  const current = active ? (searches.find((s) => s.id === active.search.id) ?? active.search) : null;
  const activeRun = current ? runs.find((r) => r.search_id === current.id) : undefined;
  const live = !!activeRun && isRunLive(activeRun);
  const byId = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);
  const fresh = current ? jobs.filter((j) => j.search_id === current.id).sort(byScore) : [];
  const freshIds = new Set(fresh.map((j) => j.id));
  // Until the run row shows up (Realtime may be off), poll for it for up to a minute.
  const waitingForRun = !!active && active.mode !== "none" && !activeRun;
  useEffect(() => {
    if (!waitingForRun) return;
    const started = Date.now();
    const t = setInterval(() => {
      if (Date.now() - started > 60_000) return clearInterval(t);
      qc.invalidateQueries({ queryKey: ["job-runs"] });
    }, 3_000);
    return () => clearInterval(t);
  }, [waitingForRun, qc]);
  const stored = (active?.stored ?? []).map((s) => byId.get(s.id)).filter((j): j is Job => !!j && !freshIds.has(j.id));

  const submit = (text = q) => {
    const query = text.trim();
    if (query.length < 2 || run.isPending) return;
    setQ(query);
    run.mutate(
      { query },
      {
        onSuccess: (r) => {
          setActive(r);
          if (r.mode === "worker") toast.success("Searching live on your Scout worker — results stream in below.");
        },
        onError: (e) => toast.error((e as Error).message),
      },
    );
  };

  const openPast = (s: SavedSearch) => {
    setQ(s.query);
    setActive({ search: s, plan: s.plan, stored: [], mode: "none" });
  };

  const toggleSave = (s: SavedSearch) =>
    update.mutate(
      { id: s.id, patch: { saved: !s.saved } },
      {
        onSuccess: (r) => toast.success(r.saved ? "Saved — Scout includes this in its hourly search" : "Removed from saved searches"),
        onError: (e) => toast.error((e as Error).message),
      },
    );

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div className="min-w-0">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="relative rounded-2xl border border-line bg-panel p-1.5 shadow-card transition-colors focus-within:border-accent/50"
        >
          <textarea
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={2}
            maxLength={500}
            placeholder="Ask Scout… e.g. “Fabric or Databricks data engineer roles in Bengaluru posted this week, not consulting”"
            className="w-full resize-none bg-transparent px-3 pb-8 pt-2.5 text-[14px] text-fg outline-none placeholder:text-faint"
            aria-label="Describe the jobs you want"
          />
          <div className="absolute bottom-2.5 left-4 text-[11px] text-faint">Searches what Scout has already found, then the live web.</div>
          <button
            type="submit"
            disabled={q.trim().length < 2 || run.isPending}
            aria-label="Search"
            className="absolute bottom-2 right-2 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white transition-opacity disabled:opacity-40"
          >
            {run.isPending ? <Radar className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </button>
        </form>

        {!active && !run.isPending ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {suggestions.map((s, i) => (
              <motion.button
                key={s}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 * i }}
                onClick={() => submit(s)}
                className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line px-3 text-[12px] text-muted transition-colors hover:border-line-strong hover:text-fg"
              >
                <Sparkles className="h-3 w-3 text-accent" /> {s}
              </motion.button>
            ))}
          </div>
        ) : null}

        <AnimatePresence mode="wait">
          {run.isPending ? (
            <motion.div key="thinking" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-6 space-y-3">
              <div className="flex items-center gap-2 text-[13px] text-muted">
                <Sparkles className="h-4 w-4 animate-pulse text-accent" /> Understanding your search and checking what Scout already found…
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-36 rounded-xl" />
                ))}
              </div>
            </motion.div>
          ) : current && active ? (
            <motion.div key={current.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-5 space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-2">
                  <p className="text-[13px] text-fg-2">{active.plan.summary ?? current.query}</p>
                  <PlanChips plan={active.plan} />
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => toggleSave(current)}
                    className={cn(
                      "inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium transition-colors",
                      current.saved ? "border-accent/40 bg-accent/10 text-accent" : "border-line text-muted hover:text-fg",
                    )}
                  >
                    {current.saved ? <BookmarkCheck className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
                    {current.saved ? "Saved" : "Save & search hourly"}
                  </button>
                  <Tip content="Close">
                    <button onClick={() => setActive(null)} className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-panel-hover hover:text-fg" aria-label="Close search">
                      <X className="h-4 w-4" />
                    </button>
                  </Tip>
                </div>
              </div>

              <AnimatePresence>{live && activeRun ? <LiveRun run={activeRun} found={fresh.length} /> : null}</AnimatePresence>

              <section>
                <SectionTitle right={fresh.length ? <span className="text-[11.5px] text-faint">{plural(fresh.length, "role")}</span> : null}>
                  {live ? "Found just now" : "Found by this search"}
                </SectionTitle>
                {fresh.length ? (
                  <JobGrid jobs={fresh} onOpen={onOpen} pageSize={20} />
                ) : (
                  <p className="rounded-xl border border-dashed border-line p-4 text-[12.5px] text-muted">
                    {live || (active.mode !== "none" && !activeRun)
                      ? "Scout is searching job boards and career sites — new roles appear here the moment they're found."
                      : activeRun
                        ? `This search didn't find anything new${stored.length ? " — roles you'd already seen are listed below" : ""}.`
                        : `Last searched ${timeAgo(current.last_run_at ?? current.created_at)}. Search again to look for new roles.`}
                  </p>
                )}
              </section>

              {stored.length ? (
                <section>
                  <SectionTitle right={<span className="text-[11.5px] text-faint">{plural(stored.length, "role")}</span>}>Already in your feed</SectionTitle>
                  <JobGrid jobs={stored} onOpen={onOpen} pageSize={10} />
                </section>
              ) : null}

              {active.mode === "none" && !live ? (
                <button onClick={() => submit(current.query)} className="text-[12.5px] text-accent hover:underline">
                  Search the web again for “{current.query}”
                </button>
              ) : null}
            </motion.div>
          ) : (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-8">
              <EmptyState icon={<Radar className="h-5 w-5" />} title="Ask for exactly what you want">
                Describe roles in plain words — title, city, remote, companies, how recent. Scout shows matching jobs it has already found, then searches
                LinkedIn, Naukri, Indeed, career sites and the web live. Save a search to include it in the hourly run.
              </EmptyState>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <aside className="space-y-5">
        <div>
          <SectionTitle>
            <span className="inline-flex items-center gap-1.5">
              <BookmarkCheck className="h-3.5 w-3.5" /> Saved searches
            </span>
          </SectionTitle>
          {searchesLoading ? (
            <Skeleton className="h-16 rounded-lg" />
          ) : saved.length ? (
            <SearchList items={saved} activeId={current?.id} onOpen={openPast} onSave={toggleSave} onDelete={(s) => remove.mutate(s.id)} />
          ) : (
            <p className="text-[12px] text-faint">Save a search to have Scout run it every hour alongside your profile.</p>
          )}
        </div>
        {recent.length ? (
          <div>
            <SectionTitle>
              <span className="inline-flex items-center gap-1.5">
                <History className="h-3.5 w-3.5" /> Recent
              </span>
            </SectionTitle>
            <SearchList items={recent} activeId={current?.id} onOpen={openPast} onSave={toggleSave} onDelete={(s) => remove.mutate(s.id)} />
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function SearchList({
  items,
  activeId,
  onOpen,
  onSave,
  onDelete,
}: {
  items: SavedSearch[];
  activeId?: string;
  onOpen: (s: SavedSearch) => void;
  onSave: (s: SavedSearch) => void;
  onDelete: (s: SavedSearch) => void;
}) {
  return (
    <ul className="space-y-0.5">
      <AnimatePresence initial={false}>
        {items.map((s) => (
          <motion.li key={s.id} layout initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, height: 0 }} className="group flex items-center gap-1">
            <button
              onClick={() => onOpen(s)}
              className={cn(
                "min-w-0 flex-1 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-panel-hover",
                activeId === s.id && "bg-panel-hover",
              )}
            >
              <div className="truncate text-[12.5px] text-fg-2">{s.query}</div>
              <div className="text-[11px] text-faint">
                {s.result_count ? `${plural(s.result_count, "new role")} · ` : ""}
                {timeAgo(s.last_run_at ?? s.created_at)}
              </div>
            </button>
            <div className="flex shrink-0 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
              <Tip content={s.saved ? "Stop searching hourly" : "Save & search hourly"}>
                <button onClick={() => onSave(s)} className="inline-flex h-6 w-6 items-center justify-center rounded text-faint hover:text-fg" aria-label="Toggle saved">
                  {s.saved ? <BookmarkCheck className="h-3.5 w-3.5 text-accent" /> : <Bookmark className="h-3.5 w-3.5" />}
                </button>
              </Tip>
              <Tip content="Delete">
                <button onClick={() => onDelete(s)} className="inline-flex h-6 w-6 items-center justify-center rounded text-faint hover:text-danger" aria-label="Delete search">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </Tip>
            </div>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}
