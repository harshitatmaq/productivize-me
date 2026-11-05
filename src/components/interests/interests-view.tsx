"use client";

import { Ban, Briefcase, Check, ChevronDown, Lightbulb, MoreHorizontal, Plus, RefreshCw, Share2, Sparkles, Trash2, Undo2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Menu, MenuItem, MenuLabel, MenuSeparator, Tip } from "@/components/ui/menu";
import { Card, EmptyState, PageHeader, Segmented, SectionTitle, Skeleton } from "@/components/ui/misc";
import { jobUse, SEARCH_AT, BONUS_AT } from "@/lib/memory/interests";
import { useAddInterest, useDeleteInterest, useInterests, useRefreshMemory, useUpdateInterest } from "@/lib/queries/interests";
import { useJobProfile } from "@/lib/queries/jobs";
import { openShare, shareInterest } from "@/lib/share";
import type { Interest, InterestKind } from "@/lib/types";
import { cn, plural, timeAgo } from "@/lib/utils";
import { CheckIns } from "./check-ins";

const KINDS: { value: InterestKind; label: string; hint: string }[] = [
  { value: "career", label: "Career skills", hint: "Tools and skills for work" },
  { value: "learning", label: "Learning", hint: "Topics you're studying" },
  { value: "hobby", label: "Hobbies", hint: "Just for you — Scout only uses them for jobs if they clearly help" },
];

const STAGE_LABEL: Record<Interest["stage"], string> = { curious: "Curious", learning: "Learning", using: "Using", strong: "Strong" };

const USE_META = {
  search: { label: "Used for job search", tone: "text-success border-success/30 bg-success/[0.07]" },
  bonus: { label: "Bonus if a job mentions it", tone: "text-warning border-warning/30 bg-warning/[0.07]" },
  off: { label: "Not used for jobs", tone: "text-faint border-line" },
} as const;

function RelevanceBadge({ i }: { i: Interest }) {
  const use = jobUse(i);
  const meta = USE_META[use];
  const why =
    i.job_use === "always"
      ? "You chose “Use for jobs”."
      : i.job_use === "never"
        ? "You chose “Never use for jobs”."
        : i.job_relevance === null
          ? "Not scored yet — Scout scores it on the next refresh."
          : `${i.relevance_reason ?? ""} Scout searches at ${SEARCH_AT}+, counts it as a bonus at ${BONUS_AT}–${SEARCH_AT - 1}.`;
  return (
    <Tip content={<span className="block max-w-[260px]">{why}</span>}>
      <span className={cn("inline-flex h-6 items-center gap-1 rounded-md border px-1.5 text-[11.5px] tabular-nums", meta.tone)} tabIndex={0}>
        <Briefcase className="h-3 w-3" />
        {i.job_relevance ?? "–"}
        <span className="hidden sm:inline">· {meta.label}</span>
      </span>
    </Tip>
  );
}

function StrengthBar({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel-2" role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label="Strength">
      <motion.div className="h-full rounded-full bg-accent" initial={{ width: 0 }} animate={{ width: `${Math.max(4, value)}%` }} transition={{ type: "spring", stiffness: 80, damping: 20 }} />
    </div>
  );
}

function InterestCard({ i }: { i: Interest }) {
  const update = useUpdateInterest();
  const del = useDeleteInterest();
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<Interest>, msg?: string) => update.mutate({ id: i.id, patch }, { onSuccess: () => msg && toast(msg) });
  return (
    <motion.div layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }}>
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[14px] font-medium text-fg">{i.name}</h3>
              <span className="rounded bg-panel-2 px-1.5 text-[11px] leading-5 text-muted">{STAGE_LABEL[i.stage]}</span>
              {i.source === "scout" ? (
                <Tip content="Scout found this in your activity">
                  <Sparkles className="h-3 w-3 text-accent" aria-label="Found by Scout" />
                </Tip>
              ) : null}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <StrengthBar value={i.strength} />
              <span className="w-8 shrink-0 text-right text-[11.5px] tabular-nums text-faint">{i.strength}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px] text-faint">
              <RelevanceBadge i={i} />
              <span>
                {i.evidence_count ? plural(i.evidence_count, "sign") : "no activity yet"}
                {i.minutes >= 30 ? ` · ${Math.round(i.minutes / 6) / 10}h` : ""}
                {i.last_seen_at ? ` · last ${timeAgo(i.last_seen_at)}` : ""}
              </span>
            </div>
          </div>
          <Menu
            label="More actions — job use, share, not interested, delete"
            trigger={
              <button aria-label="More actions" className="-mr-1 rounded-md p-1 text-faint hover:bg-panel-hover hover:text-fg">
                <MoreHorizontal className="h-4 w-4" />
              </button>
            }
          >
            <MenuLabel>For job search</MenuLabel>
            {(
              [
                ["auto", "Let Scout decide (by relevance)"],
                ["always", "Use for jobs"],
                ["never", "Never use for jobs"],
              ] as const
            ).map(([v, label]) => (
              <MenuItem key={v} onSelect={() => set({ job_use: v })} shortcut={i.job_use === v ? "✓" : undefined}>
                {label}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuLabel>Kind</MenuLabel>
            {KINDS.map((k) => (
              <MenuItem key={k.value} onSelect={() => set({ kind: k.value })} shortcut={i.kind === k.value ? "✓" : undefined}>
                {k.label}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem icon={<Share2 className="h-3.5 w-3.5" />} onSelect={() => openShare(shareInterest(i))}>
              Share to…
            </MenuItem>
            <MenuItem icon={<Ban className="h-3.5 w-3.5" />} onSelect={() => set({ status: "not_interested" }, `Scout won't use ${i.name} or suggest it again`)}>
              Not interested
            </MenuItem>
            <MenuItem danger icon={<Trash2 className="h-3.5 w-3.5" />} onSelect={() => del.mutate(i.id)}>
              Delete
            </MenuItem>
          </Menu>
        </div>
        {i.evidence.length ? (
          <div className="mt-2">
            <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-fg">
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} /> Why Scout thinks so
            </button>
            <AnimatePresence initial={false}>
              {open ? (
                <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mt-1.5 space-y-1 overflow-hidden">
                  {i.evidence.slice(0, 8).map((e, n) => (
                    <li key={`${e.id}-${n}`} className="flex gap-2 text-[12px] text-fg-2">
                      <span className="min-w-0 flex-1 truncate">{e.label}</span>
                      {e.at ? <span className="shrink-0 text-faint">{timeAgo(e.at)}</span> : null}
                    </li>
                  ))}
                </motion.ul>
              ) : null}
            </AnimatePresence>
          </div>
        ) : null}
      </Card>
    </motion.div>
  );
}

function Suggestions({ items }: { items: Interest[] }) {
  const update = useUpdateInterest();
  if (!items.length) return null;
  return (
    <div className="mb-8">
      <SectionTitle>
        <span className="inline-flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-accent" /> Scout noticed
        </span>
      </SectionTitle>
      <div className="grid gap-2 md:grid-cols-2">
        {items.map((i) => (
          <Card key={i.id} className="flex items-center gap-3 border-accent/25 p-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13.5px] font-medium text-fg">{i.name}</div>
              <div className="text-[11.5px] text-faint">
                {KINDS.find((k) => k.value === i.kind)?.label} · {plural(i.evidence_count, "sign")} in your activity
              </div>
            </div>
            <Tip content="Yes, add it">
              <button
                onClick={() => update.mutate({ id: i.id, patch: { status: "active" } }, { onSuccess: () => toast.success(`Added ${i.name}`) })}
                aria-label={`Add ${i.name}`}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white"
              >
                <Check className="h-4 w-4" />
              </button>
            </Tip>
            <Tip content="Not interested">
              <button
                onClick={() => update.mutate({ id: i.id, patch: { status: "not_interested" } })}
                aria-label={`Not interested in ${i.name}`}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-muted hover:text-fg"
              >
                <X className="h-4 w-4" />
              </button>
            </Tip>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function InterestsView() {
  const params = useSearchParams();
  const { data: interests = [], isLoading } = useInterests();
  const { data: jp } = useJobProfile();
  const add = useAddInterest();
  const update = useUpdateInterest();
  const refresh = useRefreshMemory();
  const [name, setName] = useState(params.get("add") ?? "");
  const [kind, setKind] = useState<InterestKind>("learning");
  const active = interests.filter((i) => i.status === "active");
  const suggested = interests.filter((i) => i.status === "suggested");
  const no = interests.filter((i) => i.status === "not_interested");

  const submit = () => {
    const n = name.trim();
    if (!n) return;
    add.mutate({ name: n, kind }, { onSuccess: () => setName(""), onError: (e) => toast.error((e as Error).message) });
  };

  return (
    <div className="mx-auto max-w-[980px] px-4 pt-5 md:px-8 md:pt-10">
      <PageHeader
        title="Interests"
        icon={<Lightbulb className="h-5 w-5" />}
        subtitle="What Scout knows about you — career skills, things you're learning and hobbies. Strength comes from your activity; job relevance decides whether Scout uses it for jobs."
        right={
          <Tip content="Re-read your learning log, tasks, focus time and job feedback now">
            <Button
              variant="secondary"
              loading={refresh.isPending}
              onClick={() =>
                refresh.mutate(undefined, {
                  onSuccess: (r) =>
                    toast.success(r.suggested.length ? `Scout noticed ${r.suggested.join(", ")}` : "Up to date", {
                      description: r.questions ? `${plural(r.questions, "new question")} for you` : undefined,
                    }),
                  onError: (e) => toast.error((e as Error).message),
                })
              }
            >
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
          </Tip>
        }
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="mb-6 flex flex-col gap-2 rounded-xl border border-line bg-panel p-2 sm:flex-row sm:items-center"
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Add an interest — e.g. Microsoft Fabric, System design, Photography"
          aria-label="Interest name"
          maxLength={80}
          className="h-9 min-w-0 flex-1 bg-transparent px-2 text-[13.5px] text-fg outline-none placeholder:text-faint"
        />
        <div className="flex items-center gap-2">
          <Segmented size="sm" value={kind} onChange={setKind} options={KINDS.map((k) => ({ value: k.value, label: k.label }))} />
          <Button type="submit" variant="primary" size="sm" loading={add.isPending} disabled={!name.trim()}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>
      </form>

      <CheckIns className="mb-6" />
      <Suggestions items={suggested} />

      {isLoading ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : !active.length && !suggested.length ? (
        <EmptyState icon={<Lightbulb className="h-5 w-5" />} title="Nothing here yet">
          Add a few interests above, or keep using Learning, Tasks and Focus — Scout notices what you keep coming back to and asks before adding it.
          {!jp?.profile?.target_titles?.length ? " Set up Scout on the Jobs page so it can tell which interests help your job search." : ""}
        </EmptyState>
      ) : (
        <div className="space-y-8">
          {KINDS.map((k) => {
            const list = active.filter((i) => i.kind === k.value);
            if (!list.length) return null;
            return (
              <section key={k.value}>
                <SectionTitle right={<span className="text-[11.5px] text-faint">{k.hint}</span>}>
                  {k.label} · {list.length}
                </SectionTitle>
                <div className="grid gap-3 md:grid-cols-2">
                  <AnimatePresence initial={false}>
                    {list.map((i) => (
                      <InterestCard key={i.id} i={i} />
                    ))}
                  </AnimatePresence>
                </div>
              </section>
            );
          })}
        </div>
      )}

      {no.length ? (
        <section className="mt-10">
          <SectionTitle>Not interested</SectionTitle>
          <p className="-mt-1 mb-2 text-[12px] text-faint">Scout never suggests these and steers job search away from them.</p>
          <div className="flex flex-wrap gap-1.5">
            {no.map((i) => (
              <span key={i.id} className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line pl-3 pr-1 text-[12.5px] text-muted">
                {i.name}
                <Tip content="Undo — make it an interest again">
                  <button
                    onClick={() => update.mutate({ id: i.id, patch: { status: "active" } })}
                    aria-label={`Undo not interested for ${i.name}`}
                    className="rounded-full p-1 hover:bg-panel-hover hover:text-fg"
                  >
                    <Undo2 className="h-3 w-3" />
                  </button>
                </Tip>
              </span>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
