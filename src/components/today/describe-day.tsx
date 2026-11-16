"use client";

import { AlarmClock, ArrowLeft, Flag, Hash, MessageSquareText, Mic, Repeat, Sparkles, Timer, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { FromTextResult } from "@/app/api/tasks/from-text/route";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/field";
import { Tip } from "@/components/ui/menu";
import { Badge } from "@/components/ui/misc";
import type { ClarifyingQuestion, DraftTask } from "@/lib/day-capture";
import { useToday } from "@/lib/hooks";
import { useCreateTasks } from "@/lib/queries/tasks";
import { api, cn } from "@/lib/utils";
import { useVoiceInput } from "@/lib/voice";
import { dateLabel, describeRecurrence, formatTime, localIso, PRIORITY_COLOR } from "@/components/tasks/task-utils";

const nowParts = () => {
  const d = new Date();
  return { now: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`, weekday: d.getDay() };
};

/** One message → many tasks. The AI may ask up to 3 quick questions first. */
export function DescribeDayDialog({ open, onOpenChange, initialText = "" }: { open: boolean; onOpenChange: (o: boolean) => void; initialText?: string }) {
  const today = useToday();
  const create = useCreateTasks();
  const [text, setText] = useState(initialText);
  const [seeded, setSeeded] = useState(initialText);
  const [loading, setLoading] = useState(false);
  const [drafts, setDrafts] = useState<(DraftTask & { include: boolean })[] | null>(null);
  const [questions, setQuestions] = useState<ClarifyingQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState("");
  const voice = useVoiceInput((heard) => setText((t) => (t ? `${t} ${heard}` : heard)));

  // A new message handed over from quick add replaces the old one.
  if (open && initialText && initialText !== seeded) {
    setSeeded(initialText);
    setText(initialText);
    setDrafts(null);
  }

  const reset = () => {
    setDrafts(null);
    setQuestions([]);
    setAnswers({});
    setSummary("");
  };
  const close = () => {
    onOpenChange(false);
    setTimeout(() => {
      reset();
      setText("");
      setSeeded("");
    }, 200);
  };

  const ask = async (withAnswers: boolean) => {
    if (text.trim().length < 3) return;
    setLoading(true);
    try {
      const answered = withAnswers ? questions.filter((q) => answers[q.id]?.trim()).map((q) => ({ question: q.question, answer: answers[q.id].trim() })) : undefined;
      const r = await api<FromTextResult>("/api/tasks/from-text", {
        json: { text: text.trim(), date: today, ...nowParts(), answers: answered, previous: withAnswers && drafts ? drafts.filter((d) => d.include) : undefined },
      });
      setDrafts(r.tasks.map((t) => ({ ...t, include: true })));
      setQuestions(r.questions);
      setAnswers({});
      setSummary(r.summary);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const edit = (key: string, patch: Partial<DraftTask & { include: boolean }>) => setDrafts((ds) => ds?.map((d) => (d.key === key ? { ...d, ...patch } : d)) ?? null);
  const chosen = drafts?.filter((d) => d.include && d.title.trim()) ?? [];

  const addAll = () => {
    if (!chosen.length) return;
    create.mutate(
      chosen.map((d) => ({
        title: d.title.trim(),
        due_date: d.due_date,
        due_time: d.due_time,
        priority: d.priority,
        tags: d.tags,
        recurrence: d.recurrence,
        recurrence_interval: d.recurrence_interval,
        recurrence_days: d.recurrence_days,
        estimate_minutes: d.estimate_minutes,
        notes: d.notes,
        reminder_at: d.due_date && d.due_time ? localIso(d.due_date, d.due_time) : null,
      })),
      {
        onSuccess: (rows) => {
          toast.success(`Added ${rows.length} task${rows.length > 1 ? "s" : ""}`);
          close();
        },
        onError: (e) => toast.error(`Couldn't add tasks: ${(e as Error).message}`),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
      title="Describe your day"
      description={drafts ? summary || "Check the list, then add it." : "Write (or say) everything you need to do, in one go. The AI turns it into tasks and asks if something's unclear."}
      size="lg"
      footer={
        drafts ? (
          <>
            <Button variant="ghost" className="mr-auto" onClick={reset}>
              <ArrowLeft className="h-3.5 w-3.5" /> Edit message
            </Button>
            {questions.length ? (
              <Button variant="secondary" onClick={() => ask(true)} loading={loading} disabled={!questions.some((q) => answers[q.id]?.trim())}>
                Update with answers
              </Button>
            ) : null}
            <Button variant="primary" onClick={addAll} loading={create.isPending} disabled={!chosen.length}>
              Add {chosen.length} task{chosen.length === 1 ? "" : "s"}
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={() => ask(false)} loading={loading} disabled={text.trim().length < 3}>
            <Sparkles className="h-3.5 w-3.5" /> Make tasks
          </Button>
        )
      }
    >
      {!drafts ? (
        <div className="space-y-2">
          <div className="relative">
            <Textarea
              rows={7}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask(false);
              }}
              autoFocus
              aria-label="Your tasks, in your own words"
              placeholder="e.g. Gym at 7, then finish Azure SQL days 0-2 (about 2 hours). Reply to the recruiter from Razorpay before lunch — urgent. Call mom tonight. Pick up groceries on the way back. Every Monday plan the week."
              className="pr-11"
            />
            {voice.supported ? (
              <Tip content={voice.listening ? "Stop listening" : "Say it instead"}>
                <button
                  type="button"
                  onClick={voice.listening ? voice.stop : voice.start}
                  aria-label={voice.listening ? "Stop listening" : "Say it instead"}
                  className={cn("absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-md", voice.listening ? "animate-pulse bg-danger/15 text-danger" : "text-muted hover:bg-panel-hover hover:text-fg")}
                >
                  <Mic className="h-4 w-4" />
                </button>
              </Tip>
            ) : null}
          </div>
          <p className="text-[12px] text-faint">Mention days, times, how long things take, what&apos;s urgent and what repeats. Ctrl+Enter to send.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {questions.length ? (
            <div className="space-y-3 rounded-lg border border-accent/30 bg-accent/[0.05] p-3">
              <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-fg">
                <MessageSquareText className="h-3.5 w-3.5 text-accent" /> {questions.length > 1 ? "A few quick questions" : "A quick question"} — or just add the list as it is
              </div>
              {questions.map((q) => (
                <div key={q.id} className="space-y-1.5">
                  <div className="text-[13px] text-fg-2">{q.question}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {q.options.map((o) => (
                      <button
                        key={o}
                        type="button"
                        aria-pressed={answers[q.id] === o}
                        onClick={() => setAnswers((a) => ({ ...a, [q.id]: a[q.id] === o ? "" : o }))}
                        className={cn("rounded-md border px-2 py-1 text-[12.5px]", answers[q.id] === o ? "border-accent bg-accent text-white" : "border-line text-fg-2 hover:border-line-strong")}
                      >
                        {o}
                      </button>
                    ))}
                    <Input
                      value={q.options.includes(answers[q.id] ?? "") ? "" : (answers[q.id] ?? "")}
                      onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                      placeholder="Or type an answer"
                      aria-label={`Answer: ${q.question}`}
                      className="h-8 w-48 py-1 text-[12.5px]"
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <ul className="space-y-2">
            {drafts.map((d) => (
              <li key={d.key} className={cn("rounded-lg border border-line p-2.5", !d.include && "opacity-50")}>
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={d.include} onChange={(e) => edit(d.key, { include: e.target.checked })} aria-label={`Add “${d.title}”`} className="h-4 w-4 accent-[var(--accent)]" />
                  <Input value={d.title} onChange={(e) => edit(d.key, { title: e.target.value })} aria-label="Task title" className="h-8 flex-1 border-transparent bg-transparent px-1.5 py-1 text-[13.5px] hover:border-line focus:border-line" />
                  <Tip content="Remove">
                    <button type="button" aria-label={`Remove “${d.title}”`} onClick={() => setDrafts((ds) => ds?.filter((x) => x.key !== d.key) ?? null)} className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-panel-hover hover:text-fg">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </Tip>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-6">
                  <input type="date" value={d.due_date ?? ""} onChange={(e) => edit(d.key, { due_date: e.target.value || null })} aria-label="Date" className="h-6 rounded-md border border-line bg-panel px-1.5 text-[11.5px] text-fg-2" />
                  <input type="time" value={d.due_time ?? ""} onChange={(e) => edit(d.key, { due_time: e.target.value || null, routine: undefined })} aria-label="Time" className="h-6 rounded-md border border-line bg-panel px-1.5 text-[11.5px] text-fg-2" />
                  {d.due_date ? <span className="text-[11.5px] text-muted">{dateLabel(d.due_date, today)}</span> : <span className="text-[11.5px] text-faint">no date</span>}
                  {d.routine && d.due_time ? (
                    <Badge tone="accent">
                      <AlarmClock className="h-3 w-3" />
                      {formatTime(d.due_time)} · your {d.routine.toLowerCase()} time
                    </Badge>
                  ) : null}
                  {d.estimate_minutes ? (
                    <Badge>
                      <Timer className="h-3 w-3" />~{d.estimate_minutes}m
                    </Badge>
                  ) : null}
                  {d.priority < 4 ? (
                    <Badge>
                      <Flag className="h-3 w-3" style={{ color: PRIORITY_COLOR[d.priority] }} />P{d.priority}
                    </Badge>
                  ) : null}
                  {d.recurrence ? (
                    <Badge>
                      <Repeat className="h-3 w-3" />
                      {describeRecurrence(d)}
                    </Badge>
                  ) : null}
                  {d.tags.map((t) => (
                    <Badge key={t}>
                      <Hash className="h-3 w-3" />
                      {t}
                    </Badge>
                  ))}
                </div>
                {d.notes ? <p className="mt-1 pl-6 text-[12px] text-faint">{d.notes}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  );
}

export function DescribeDayButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Tip content="Describe your whole day in one message — the AI makes the tasks">
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          <MessageSquareText className="h-3.5 w-3.5" /> Describe your day
        </Button>
      </Tip>
      <DescribeDayDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
