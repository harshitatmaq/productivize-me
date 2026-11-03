"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Briefcase, Compass, Radar, Search, Sparkles, Wifi } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useNow } from "@/lib/hooks";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, Segmented, Skeleton } from "@/components/ui/misc";
import { useJobProfile, useJobRuns, useJobs } from "@/lib/queries/jobs";
import type { Job } from "@/lib/types";
import { api, cn, plural, timeAgo } from "@/lib/utils";
import { Activity } from "./activity";
import { JobCard } from "./job-card";
import { JobDrawer } from "./job-drawer";
import { ProfileEditor } from "./profile-editor";
import { ScoutChat } from "./scout-chat";
import { TrackerBoard } from "./tracker-board";

type Tab = "matches" | "tracker" | "profile" | "activity";

export function JobsView() {
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: jobs = [], isLoading } = useJobs();
  const { data: row, isLoading: profileLoading } = useJobProfile();
  const { data: runs = [] } = useJobRuns();
  const ready = row?.status === "ready";
  const [tabChoice, setTab] = useState<Tab | null>((params.get("tab") as Tab) || null);
  // Until the user picks a tab, land on matches when Scout is set up, otherwise on the interview.
  const tab: Tab = tabChoice ?? (profileLoading || ready ? "matches" : "profile");
  const [open, setOpen] = useState<Job | null>(null);
  const deepJobId = params.get("job");
  const now = useNow(30_000);
  const [q, setQ] = useState("");
  const [minScore, setMinScore] = useState<"0" | "60" | "75" | "85">("60");
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [sort, setSort] = useState<"best" | "new">("best");
  const [view, setView] = useState<"new" | "saved" | "all">("new");
  const [searching, setSearching] = useState(false);

  // Deep link /jobs?job=<id> (from the Today rail and notifications)
  const deepJob = deepJobId ? (jobs.find((x) => x.id === deepJobId) ?? null) : null;
  const shown = open ?? deepJob;
  const closeDrawer = () => {
    setOpen(null);
    if (deepJobId) router.replace("/jobs");
  };

  const changeTab = (t: Tab) => {
    setTab(t);
    router.replace(t === "matches" ? "/jobs" : `/jobs?tab=${t}`);
  };

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return jobs
      .filter((j) => (view === "new" ? j.status === "new" : view === "saved" ? j.status === "saved" : j.status !== "archived"))
      .filter((j) => (j.score ?? 0) >= Number(minScore))
      .filter((j) => !remoteOnly || j.remote)
      .filter((j) => !s || `${j.title} ${j.company} ${j.location}`.toLowerCase().includes(s))
      .sort((a, b) =>
        sort === "best"
          ? (b.score ?? 0) - (a.score ?? 0) || b.created_at.localeCompare(a.created_at)
          : b.created_at.localeCompare(a.created_at),
      );
  }, [jobs, q, minScore, remoteOnly, sort, view]);

  const tracked = jobs.filter((j) => ["saved", "applied", "interviewing", "offer", "rejected"].includes(j.status));
  const counts = {
    new: jobs.filter((j) => j.status === "new" && (j.score ?? 0) >= Number(minScore)).length,
    saved: jobs.filter((j) => j.status === "saved").length,
    applied: jobs.filter((j) => ["applied", "interviewing", "offer"].includes(j.status)).length,
  };
  const lastRun = runs[0];
  const running = lastRun?.status === "running" && now - Date.parse(lastRun.started_at) < 6 * 60_000;

  const searchNow = async () => {
    setSearching(true);
    const t = toast.loading("Searching job boards, career pages and the web… (up to a few minutes)");
    try {
      const r = await api<{ stats: { inserted: number; strong: number; fetched: number; log: string[] } }>("/api/jobs/search", { method: "POST" });
      toast.success(`${plural(r.stats.inserted, "new job")} · ${r.stats.strong} strong matches (scanned ${r.stats.fetched})`, { id: t });
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["job-runs"] });
    } catch (e) {
      toast.error((e as Error).message, { id: t });
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1180px] px-4 pt-5 md:px-8 md:pt-10">
      <PageHeader
        title="Jobs"
        icon={<Briefcase className="h-5 w-5" />}
        subtitle={
          ready ? (
            <span className="inline-flex flex-wrap items-center gap-x-2">
              <span className="inline-flex items-center gap-1.5">
                <span className={cn("h-1.5 w-1.5 rounded-full", running ? "animate-pulse bg-accent" : "bg-success")} />
                {running ? "Searching now…" : `Scout searches every hour${lastRun ? ` · last ${timeAgo(lastRun.started_at)}` : ""}`}
              </span>
              <span className="text-faint">· {counts.applied} active applications</span>
            </span>
          ) : (
            "Tell Scout about yourself once — it searches the web for roles that fit you, every hour."
          )
        }
        right={
          ready ? (
            <Button variant="primary" onClick={searchNow} loading={searching || running}>
              <Radar className="h-4 w-4" /> Search now
            </Button>
          ) : null
        }
      />

      <div className="mb-5 overflow-x-auto no-scrollbar">
        <Segmented
          value={tab}
          onChange={changeTab}
          options={[
            { value: "matches", label: "Matches", count: counts.new || undefined },
            { value: "tracker", label: "Tracker", count: tracked.length || undefined },
            { value: "profile", label: ready ? "Profile & Scout" : "Set up Scout" },
            { value: "activity", label: "Activity" },
          ]}
        />
      </div>

      {tab === "matches" ? (
        !ready && !profileLoading ? (
          <EmptyState
            icon={<Compass className="h-5 w-5" />}
            title="Meet Scout, your job-search agent"
            action={
              <Button variant="primary" onClick={() => changeTab("profile")}>
                <Sparkles className="h-4 w-4" /> Start the 5-minute interview
              </Button>
            }
          >
            Scout asks about your experience, skills and preferences (or reads your resume), builds a profile, then searches LinkedIn,
            Naukri, Wellfound, company career pages and remote boards every hour — and scores every role against you.
          </EmptyState>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <div className="relative min-w-[200px] flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by title, company, location…" className="field h-8 pl-8" />
              </div>
              <Segmented
                size="sm"
                value={view}
                onChange={setView}
                options={[
                  { value: "new", label: "New" },
                  { value: "saved", label: "Saved", count: counts.saved || undefined },
                  { value: "all", label: "All" },
                ]}
              />
              <Segmented
                size="sm"
                value={minScore}
                onChange={setMinScore}
                options={[
                  { value: "0", label: "Any" },
                  { value: "60", label: "60+" },
                  { value: "75", label: "75+" },
                  { value: "85", label: "85+" },
                ]}
              />
              <button
                onClick={() => setRemoteOnly((r) => !r)}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium transition-colors",
                  remoteOnly ? "border-success/40 bg-success/10 text-success" : "border-line text-muted hover:text-fg",
                )}
              >
                <Wifi className="h-3.5 w-3.5" /> Remote
              </button>
              <Segmented
                size="sm"
                value={sort}
                onChange={setSort}
                options={[
                  { value: "best", label: "Best match" },
                  { value: "new", label: "Newest" },
                ]}
              />
            </div>
            {isLoading ? (
              <div className="grid gap-3 md:grid-cols-2">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-40 rounded-xl" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState icon={<Radar className="h-5 w-5" />} title={jobs.length ? "No jobs match these filters" : "No matches yet"}>
                {jobs.length
                  ? "Loosen the score filter or switch to All."
                  : "The first search is running or scheduled. Hit “Search now” to run one immediately."}
              </EmptyState>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {filtered.map((j) => (
                  <JobCard key={j.id} job={j} onOpen={() => setOpen(j)} />
                ))}
              </div>
            )}
          </>
        )
      ) : null}

      {tab === "tracker" ? <TrackerBoard jobs={tracked} onOpen={setOpen} /> : null}

      {tab === "profile" ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="lg:sticky lg:top-10 lg:self-start">
            <ScoutChat row={row} onFinalized={() => changeTab("matches")} />
          </div>
          {row ? (
            <ProfileEditor row={row} />
          ) : (
            <div className="rounded-xl border border-dashed border-line-strong p-6 text-[13px] text-muted">
              Your profile builds up here as you chat with Scout.
            </div>
          )}
        </div>
      ) : null}

      {tab === "activity" ? <Activity /> : null}

      <JobDrawer job={shown ? (jobs.find((j) => j.id === shown.id) ?? shown) : null} onClose={closeDrawer} />
    </div>
  );
}
