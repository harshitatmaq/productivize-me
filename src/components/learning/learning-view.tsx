"use client";

import { BookOpenCheck, Brain, ChevronDown, Clock, Flame, GraduationCap, Layers, Link2, MoreHorizontal, Pencil, Plus, RotateCcw, Search, Share2, Sparkles, Trash2, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ChipsInput } from "@/components/ui/chips-input";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Markdown } from "@/components/ui/markdown";
import { Menu, MenuItem, MenuLabel, MenuSeparator, Tip } from "@/components/ui/menu";
import { openShare, shareLearning } from "@/lib/share";
import { Badge, Card, EmptyState, PageHeader, ProgressRing, SectionTitle } from "@/components/ui/misc";
import { useToday, useTrigger } from "@/lib/hooks";
import { useFlashcards, useGenerateCards } from "@/lib/queries/flashcards";
import { AddCardDialog, FlashcardsPanel, ReviewDialog } from "./flashcards";
import { LearningSuggestions } from "./suggestions";
import { useDeleteLearning, useLearning, useSaveLearning } from "@/lib/queries/learning";
import { useProfile } from "@/lib/queries/profile";
import { addDays, diffDays, startOfWeek } from "@/lib/time";
import type { LearningEntry } from "@/lib/types";
import { api, cn } from "@/lib/utils";
import { dateLabel } from "@/components/tasks/task-utils";
import { AiLinkButtons, chatgptUrl, claudeUrl, PROMPTS } from "./ai-links";
import { Heatmap } from "./heatmap";

type Draft = {
  id?: string;
  entry_date: string;
  title: string;
  content: string;
  tags: string[];
  minutes: number | null;
  confidence: number | null;
  questions: string;
  resources: { title?: string; url: string }[];
};

type Recap = { summary: string; themes: string[]; gaps: string[]; next_steps: string[]; quiz: { q: string; a: string }[] };


function Confidence({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  const labels = ["Lost", "Shaky", "Okay", "Solid", "Could teach it"];
  return (
    <div className="flex items-center gap-1.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          title={labels[n - 1]}
          className={cn("h-2.5 w-7 rounded-full transition-colors", value && n <= value ? "bg-accent" : "bg-panel-hover hover:bg-line-strong")}
        />
      ))}
      <span className="ml-1 text-[12px] text-muted">{value ? labels[value - 1] : "How well do you get it?"}</span>
    </div>
  );
}

function EntryCard({ e, onEdit }: { e: LearningEntry; onEdit: () => void }) {
  const del = useDeleteLearning();
  const { data: allCards = [] } = useFlashcards();
  const gen = useGenerateCards();
  const [addingCard, setAddingCard] = useState(false);
  const makeCards = () =>
    gen.mutate(e.id, {
      onSuccess: (r) => toast.success(`${r.cards.length} flashcards created — review them now or later`),
      onError: (err) => toast.error((err as Error).message),
    });
  const [open, setOpen] = useState(false);
  const long = (e.content ?? "").length > 280;
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-medium text-fg">{e.title}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted">
            {e.minutes ? (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" /> {e.minutes}m
              </span>
            ) : null}
            {e.confidence ? <span>confidence {e.confidence}/5</span> : null}
            {e.review_count ? (
              <span className="inline-flex items-center gap-1">
                <RotateCcw className="h-3 w-3" /> reviewed {e.review_count}×
              </span>
            ) : null}
            {e.tags.map((t) => (
              <span key={t} className="text-accent">
                #{t}
              </span>
            ))}
          </div>
        </div>
        <Menu
          label="More actions — continue with AI, flashcards, share, edit"
          trigger={
            <button className="rounded-md p-1 text-faint hover:bg-panel-hover hover:text-fg" aria-label="More actions">
              <MoreHorizontal className="h-4 w-4" />
            </button>
          }
        >
          <MenuLabel>Continue with AI</MenuLabel>
          {PROMPTS.map((p) => (
            <MenuItem key={`g-${p.id}`} onSelect={() => window.open(chatgptUrl(p.build(e)), "_blank")}>
              {p.label} <span className="text-faint">· ChatGPT</span>
            </MenuItem>
          ))}
          {PROMPTS.slice(0, 2).map((p) => (
            <MenuItem key={`c-${p.id}`} onSelect={() => window.open(claudeUrl(p.build(e)), "_blank")}>
              {p.label} <span className="text-faint">· Claude</span>
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem icon={<Layers className="h-3.5 w-3.5" />} onSelect={makeCards} disabled={gen.isPending}>
            {gen.isPending ? "Making flashcards…" : "Make flashcards (AI)"}
          </MenuItem>
          <MenuItem icon={<Plus className="h-3.5 w-3.5" />} onSelect={() => setAddingCard(true)}>
            Add a flashcard
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Share2 className="h-3.5 w-3.5" />} onSelect={() => openShare(shareLearning(e, allCards.filter((c) => c.entry_id === e.id)))}>
            Share to…
          </MenuItem>
          <MenuItem icon={<Pencil className="h-3.5 w-3.5" />} onSelect={onEdit}>
            Edit
          </MenuItem>
          <MenuItem danger icon={<Trash2 className="h-3.5 w-3.5" />} onSelect={() => del.mutate(e.id)}>
            Delete
          </MenuItem>
        </Menu>
      </div>
      {e.content ? (
        <div className={cn("relative mt-2.5 text-[13px] leading-relaxed text-fg-2", !open && long && "max-h-28 overflow-hidden")}>
          <Markdown text={e.content} />
          {!open && long ? <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[var(--panel)] to-transparent" /> : null}
        </div>
      ) : null}
      {long ? (
        <button onClick={() => setOpen((o) => !o)} className="mt-1 inline-flex items-center gap-1 text-[12px] text-muted hover:text-fg">
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} /> {open ? "Less" : "More"}
        </button>
      ) : null}
      <AddCardDialog open={addingCard} onOpenChange={setAddingCard} entryId={e.id} />
      {e.questions ? (
        <div className="mt-2.5 rounded-lg bg-warning/8 px-3 py-2 text-[12.5px] text-fg-2">
          <span className="font-medium text-warning">Open questions · </span>
          {e.questions}
        </div>
      ) : null}
      {e.resources?.length ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {e.resources.map((r, i) => (
            <a key={i} href={r.url} target="_blank" rel="noreferrer" className="inline-flex max-w-[260px] items-center gap-1 truncate rounded-md border border-line px-2 py-0.5 text-[12px] text-muted hover:text-fg">
              <Link2 className="h-3 w-3 shrink-0" />
              <span className="truncate">{r.title || r.url.replace(/^https?:\/\/(www\.)?/, "")}</span>
            </a>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

export function LearningView() {
  const today = useToday();
  const { data: entries = [], isLoading } = useLearning();
  const { data: profile } = useProfile();
  const save = useSaveLearning();
  const params = useSearchParams();
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [resUrl, setResUrl] = useState("");
  const [q, setQ] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [recap, setRecap] = useState<Recap | null>(null);
  const [recapLoading, setRecapLoading] = useState(false);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [visible, setVisible] = useState(20);

  const blank = (): Draft => ({ entry_date: today, title: "", content: "", tags: [], minutes: null, confidence: null, questions: "", resources: [] });

  const [reviewing, setReviewing] = useState(false);
  const wantsReview = params.get("review");
  useTrigger(wantsReview, () => setReviewing(true));
  useEffect(() => {
    if (wantsReview) router.replace("/learning");
  }, [wantsReview, router]);

  // Deep link from the learning nudge notification: /learning?new=1
  const wantsNew = params.get("new");
  useTrigger(wantsNew, () => {
    // Prefill from the share sheet: /learning?new=1&title=…&url=…
    const shared = params.get("url");
    setDraft({ ...blank(), title: params.get("title") ?? "", resources: shared ? [{ url: shared }] : [] });
  });
  useEffect(() => {
    if (wantsNew) router.replace("/learning");
  }, [wantsNew, router]);

  const goal = profile?.learning_goal_per_week ?? 5;
  const weekStart = startOfWeek(today, profile?.week_starts_on ?? 1);

  const stats = useMemo(() => {
    const counts = new Map<string, number>();
    entries.forEach((e) => counts.set(e.entry_date, (counts.get(e.entry_date) ?? 0) + 1));
    const weekDays = [...counts.keys()].filter((d) => d >= weekStart && d <= today).length;
    let streak = 0;
    let cursor = counts.has(today) ? today : addDays(today, -1);
    while (counts.has(cursor)) {
      streak++;
      cursor = addDays(cursor, -1);
    }
    const monthMinutes = entries.filter((e) => e.entry_date.slice(0, 7) === today.slice(0, 7)).reduce((s, e) => s + (e.minutes ?? 0), 0);
    const tags = new Map<string, number>();
    entries.forEach((e) => e.tags.forEach((t) => tags.set(t, (tags.get(t) ?? 0) + 1)));
    return { counts, weekDays, streak, monthMinutes, tags: [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12) };
  }, [entries, today, weekStart]);

  const loggedToday = stats.counts.has(today);
  const daysLeft = 7 - diffDays(today, weekStart);

  const filtered = entries.filter(
    (e) => (!tag || e.tags.includes(tag)) && (!q || `${e.title} ${e.content} ${e.tags.join(" ")}`.toLowerCase().includes(q.toLowerCase())),
  );
  const grouped = useMemo(() => {
    const g = new Map<string, LearningEntry[]>();
    filtered.slice(0, visible).forEach((e) => g.set(e.entry_date, [...(g.get(e.entry_date) ?? []), e]));
    return [...g.entries()];
  }, [filtered, visible]);

  const submit = () => {
    if (!draft || !draft.title.trim()) return toast.error("Give it a short title — what was the topic?");
    save.mutate(
      {
        id: draft.id,
        entry_date: draft.entry_date,
        title: draft.title.trim(),
        content: draft.content.trim() || null,
        tags: draft.tags.map((t) => t.toLowerCase()),
        minutes: draft.minutes,
        confidence: draft.confidence,
        questions: draft.questions.trim() || null,
        resources: draft.resources,
      },
      {
        onSuccess: () => {
          toast.success(draft.id ? "Updated" : stats.weekDays + (loggedToday ? 0 : 1) >= goal ? "Logged — weekly goal reached 🎉" : "Logged. Keep the streak going!");
          setDraft(null);
        },
        onError: (e) => toast.error((e as Error).message),
      },
    );
  };

  const runRecap = async () => {
    setRecapLoading(true);
    setRevealed(new Set());
    try {
      const r = await api<{ recap: Recap }>("/api/learning/recap", { json: { from: addDays(today, -6), to: today } });
      setRecap(r.recap);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRecapLoading(false);
    }
  };

  const latest = entries[0];
  const promptSource = draft ?? latest;

  return (
    <div className="mx-auto max-w-[1100px] px-4 pt-5 md:px-8 md:pt-10">
      <PageHeader
        title="Learning"
        icon={<GraduationCap className="h-5 w-5" />}
        subtitle="A line a day compounds. Log what you learned, lock it in with flashcards, and go deeper with AI."
        right={
          <Button variant="primary" onClick={() => setDraft(blank())}>
            <Plus className="h-4 w-4" /> Log learning
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="flex items-center gap-3 p-3 sm:p-4">
          <ProgressRing value={stats.weekDays / goal} size={46} stroke={4} color={stats.weekDays >= goal ? "var(--success)" : "var(--accent)"}>
            <span className="text-[12px] font-semibold tabular-nums">
              {stats.weekDays}/{goal}
            </span>
          </ProgressRing>
          <div>
            <div className="text-[13px] font-medium text-fg">This week</div>
            <div className="text-[12px] text-muted">
              {stats.weekDays >= goal ? "Goal reached" : goal - stats.weekDays > daysLeft ? "Goal out of reach — keep going" : `${goal - stats.weekDays} more in ${daysLeft} days`}
            </div>
          </div>
        </Card>
        <Card className="flex items-center gap-3 p-3 sm:p-4">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-p2/12 text-p2">
            <Flame className="h-5 w-5" />
          </span>
          <div>
            <div className="text-[18px] font-semibold tabular-nums text-fg">{stats.streak}</div>
            <div className="text-[12px] text-muted">day streak</div>
          </div>
        </Card>
        <Card className="flex items-center gap-3 p-3 sm:p-4">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <BookOpenCheck className="h-5 w-5" />
          </span>
          <div>
            <div className="text-[18px] font-semibold tabular-nums text-fg">{entries.length}</div>
            <div className="text-[12px] text-muted">entries total</div>
          </div>
        </Card>
        <Card className="flex items-center gap-3 p-3 sm:p-4">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-success/12 text-success">
            <Clock className="h-5 w-5" />
          </span>
          <div>
            <div className="text-[18px] font-semibold tabular-nums text-fg">{Math.round(stats.monthMinutes / 6) / 10}h</div>
            <div className="text-[12px] text-muted">this month</div>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          {!loggedToday ? (
            <button
              onClick={() => setDraft(blank())}
              className="group flex w-full items-center gap-4 rounded-xl border border-dashed border-accent/40 bg-accent-soft/40 p-4 text-left transition-colors hover:bg-accent-soft"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-white">
                <Brain className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium text-fg">What did you learn today?</span>
                <span className="block text-[12.5px] text-muted">Two sentences is plenty. You&apos;ll get a nudge in the evening if you forget.</span>
              </span>
              <Plus className="h-4 w-4 text-accent transition-transform group-hover:rotate-90" />
            </button>
          ) : null}

          <Card className="p-4">
            <SectionTitle>Last 26 weeks</SectionTitle>
            <Heatmap counts={stats.counts} today={today} weeks={26} weekStartsOn={profile?.week_starts_on ?? 1} />
          </Card>

          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="relative min-w-[180px] flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your notes…" className="field h-8 pl-8" />
              </div>
              {tag ? (
                <button onClick={() => setTag(null)} className="inline-flex h-7 items-center gap-1 rounded-lg bg-accent-soft px-2 text-[12px] text-accent">
                  #{tag} <X className="h-3 w-3" />
                </button>
              ) : null}
            </div>
            {isLoading ? null : grouped.length === 0 ? (
              <EmptyState icon={<GraduationCap className="h-5 w-5" />} title={entries.length ? "Nothing matches" : "Your learning log starts today"}>
                {entries.length ? "Try another search or tag." : "Log a concept, a bug you fixed, a chapter you read — anything you didn't know yesterday."}
              </EmptyState>
            ) : (
              <div className="space-y-6">
                {grouped.map(([date, list]) => (
                  <section key={date}>
                    <h2 className="mb-2 text-[12.5px] font-medium text-muted">
                      {dateLabel(date, today)}
                      <span className="ml-2 text-faint">{new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: date.slice(0, 4) !== today.slice(0, 4) ? "numeric" : undefined })}</span>
                    </h2>
                    <div className="space-y-3">
                      {list.map((e) => (
                        <EntryCard
                          key={e.id}
                          e={e}
                          onEdit={() =>
                            setDraft({
                              id: e.id,
                              entry_date: e.entry_date,
                              title: e.title,
                              content: e.content ?? "",
                              tags: e.tags,
                              minutes: e.minutes,
                              confidence: e.confidence,
                              questions: e.questions ?? "",
                              resources: e.resources ?? [],
                            })
                          }
                        />
                      ))}
                    </div>
                  </section>
                ))}
                {filtered.length > visible ? (
                  <div className="flex justify-center">
                    <Button variant="secondary" onClick={() => setVisible((v) => v + 20)}>
                      Show older ({filtered.length - visible} more)
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-10 lg:self-start">
          <Card className="p-4">
            <SectionTitle>Keep going with AI</SectionTitle>
            <p className="mb-3 text-[12.5px] text-muted">
              Free API keys can&apos;t tutor you for hours — your ChatGPT or Claude account can. These open a new chat with your notes pre-filled.
            </p>
            <AiLinkButtons prompt={promptSource ? PROMPTS[0].build(promptSource) : undefined} />
            {promptSource ? (
              <div className="mt-3 space-y-1">
                <div className="text-[11.5px] text-faint">About “{promptSource.title || "your latest entry"}”</div>
                <div className="flex flex-wrap gap-1.5">
                  {PROMPTS.map((p) => (
                    <a
                      key={p.id}
                      href={chatgptUrl(p.build(promptSource))}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-md border border-line px-2 py-0.5 text-[12px] text-fg-2 hover:border-line-strong hover:text-fg"
                    >
                      {p.label}
                    </a>
                  ))}
                </div>
              </div>
            ) : null}
          </Card>

          <Card className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <SectionTitle className="mb-0">Weekly recap</SectionTitle>
              <Button size="xs" variant="ghost" onClick={runRecap} loading={recapLoading} disabled={!entries.length}>
                <Sparkles className="h-3 w-3" /> {recap ? "Refresh" : "Generate"}
              </Button>
            </div>
            {recap ? (
              <div className="space-y-3 text-[12.5px] text-fg-2">
                <p className="leading-relaxed">{recap.summary}</p>
                {recap.next_steps.length ? (
                  <div>
                    <div className="mb-1 font-medium text-fg">Next steps</div>
                    <ul className="list-disc space-y-0.5 pl-4">{recap.next_steps.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </div>
                ) : null}
                {recap.gaps.length ? (
                  <div>
                    <div className="mb-1 font-medium text-fg">Worth revisiting</div>
                    <ul className="list-disc space-y-0.5 pl-4">{recap.gaps.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </div>
                ) : null}
                {recap.quiz.length ? (
                  <div>
                    <div className="mb-1 font-medium text-fg">Quick quiz</div>
                    <ol className="space-y-1.5">
                      {recap.quiz.map((item, i) => (
                        <li key={i}>
                          <button className="text-left" onClick={() => setRevealed((s) => new Set(s).add(i))}>
                            {i + 1}. {item.q}
                          </button>
                          {revealed.has(i) ? <div className="mt-0.5 rounded bg-success/10 px-2 py-1 text-success">{item.a}</div> : <div className="text-[11px] text-faint">tap to reveal</div>}
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-[12.5px] text-muted">A summary of the last 7 days, gaps to revisit and a short quiz.</p>
            )}
          </Card>

          <FlashcardsPanel onReview={() => setReviewing(true)} />

          <LearningSuggestions />

          {stats.tags.length ? (
            <Card className="p-4">
              <SectionTitle>Topics</SectionTitle>
              <div className="flex flex-wrap gap-1.5">
                {stats.tags.map(([t, n]) => (
                  <button key={t} onClick={() => setTag(tag === t ? null : t)}>
                    <Badge tone={tag === t ? "accent" : "neutral"}>
                      #{t} <span className="text-faint">{n}</span>
                    </Badge>
                  </button>
                ))}
              </div>
            </Card>
          ) : null}
        </aside>
      </div>

      <ReviewDialog open={reviewing} onOpenChange={setReviewing} />

      <Dialog
        open={!!draft}
        onOpenChange={(o) => !o && setDraft(null)}
        title={draft?.id ? "Edit entry" : "What did you learn?"}
        size="lg"
        footer={
          <>
            {draft ? <AiLinkButtons size="sm" className="mr-auto" prompt={draft.title ? PROMPTS[0].build(draft) : undefined} /> : null}
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} loading={save.isPending}>
              Save
            </Button>
          </>
        }
      >
        {draft ? (
          <div className="space-y-4">
            <input
              autoFocus
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="Topic — e.g. How Postgres MVCC works"
              className="w-full bg-transparent text-[17px] font-medium text-fg outline-none placeholder:text-faint"
            />
            <Textarea
              rows={7}
              value={draft.content}
              onChange={(e) => setDraft({ ...draft, content: e.target.value })}
              placeholder={"In your own words… (markdown: **bold**, - lists, `code`)\n\n- Key idea\n- Why it matters\n- Example"}
            />
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Date">
                <Input type="date" value={draft.entry_date} max={today} onChange={(e) => setDraft({ ...draft, entry_date: e.target.value })} />
              </Field>
              <Field label="Time spent (min)">
                <Input type="number" min={0} step={5} value={draft.minutes ?? ""} onChange={(e) => setDraft({ ...draft, minutes: e.target.value ? Number(e.target.value) : null })} />
              </Field>
              <Field label="Tags">
                <ChipsInput value={draft.tags} onChange={(v) => setDraft({ ...draft, tags: v })} placeholder="postgres, dsa…" prefix="#" />
              </Field>
            </div>
            <Field label="Confidence">
              <Confidence value={draft.confidence} onChange={(v) => setDraft({ ...draft, confidence: v })} />
            </Field>
            <Field label="Questions I still have">
              <Input value={draft.questions} onChange={(e) => setDraft({ ...draft, questions: e.target.value })} placeholder="What's still fuzzy?" />
            </Field>
            <Field label="Resources">
              <div className="flex gap-2">
                <Input value={resUrl} onChange={(e) => setResUrl(e.target.value)} placeholder="https://… (article, video, docs)" onKeyDown={(e) => {
                  if (e.key === "Enter" && resUrl.trim()) {
                    e.preventDefault();
                    setDraft({ ...draft, resources: [...draft.resources, { url: resUrl.trim() }] });
                    setResUrl("");
                  }
                }} />
                <Button
                  onClick={() => {
                    if (!resUrl.trim()) return;
                    setDraft({ ...draft, resources: [...draft.resources, { url: resUrl.trim() }] });
                    setResUrl("");
                  }}
                >
                  Add
                </Button>
              </div>
              {draft.resources.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {draft.resources.map((r, i) => (
                    <span key={i} className="inline-flex max-w-[260px] items-center gap-1 rounded-md border border-line px-2 py-0.5 text-[12px] text-muted">
                      <span className="truncate">{r.url}</span>
                      <Tip content="Remove link">
                        <button onClick={() => setDraft({ ...draft, resources: draft.resources.filter((_, j) => j !== i) })} aria-label={`Remove ${r.url}`}>
                          <X className="h-3 w-3" />
                        </button>
                      </Tip>
                    </span>
                  ))}
                </div>
              ) : null}
            </Field>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
