"use client";

import { Brain, CalendarClock, Check, MoreHorizontal, Pencil, Pin, PinOff, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Select, Switch } from "@/components/ui/field";
import { Menu, MenuItem, MenuSeparator, Tip } from "@/components/ui/menu";
import { Badge, Card } from "@/components/ui/misc";
import { confidenceWord, FACT_KINDS, type Fact, type FactKind } from "@/lib/memory/facts";
import { useAddFact, useDeleteFact, useFacts, useLearnNow, useMemoryAction, useUpdateFact } from "@/lib/queries/memory";
import { useUpdateProfile } from "@/lib/queries/profile";
import type { Profile } from "@/lib/types";
import { cn, timeAgo } from "@/lib/utils";

const iconBtn = "flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-panel-hover hover:text-fg";

function FactRow({ fact }: { fact: Fact }) {
  const update = useUpdateFact();
  const remove = useDeleteFact();
  const action = useMemoryAction();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(fact.statement);
  const save = () => {
    const s = text.trim();
    if (s.length < 3 || s === fact.statement) return setEditing(false);
    update.mutate(
      { id: fact.id, patch: { statement: s } },
      {
        onSuccess: () => setEditing(false),
        onError: (e) => toast.error((e as Error).message),
      },
    );
  };
  const why = fact.evidence[0]?.label;
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      className="group flex items-start gap-2 py-2"
    >
      <div className="min-w-0 flex-1">
        {editing ? (
          <form
            className="flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={240}
              autoFocus
              aria-label="Edit this memory"
              onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
            />
            <Button type="submit" size="sm" variant="primary" loading={update.isPending}>
              Save
            </Button>
          </form>
        ) : (
          <div className="text-[13.5px] leading-snug text-fg">
            {fact.pinned ? <Pin className="mr-1 inline h-3 w-3 -translate-y-px text-accent" aria-label="Pinned" /> : null}
            {fact.statement}
          </div>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-faint">
          {fact.source === "you" ? (
            <Badge tone="accent">You told it</Badge>
          ) : (
            <Tip content={why ? `Why: ${why}` : "Noticed from how you use Productivize"}>
              <Badge tabIndex={0}>
                Learned · {confidenceWord(fact.confidence)} · seen {fact.evidence_count}×
              </Badge>
            </Tip>
          )}
          {fact.routine ? (
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="h-3 w-3" /> {fact.routine.start}–{fact.routine.end}
            </span>
          ) : null}
          {fact.last_seen_at ? <span>· {timeAgo(fact.last_seen_at)}</span> : null}
        </div>
      </div>
      {!editing ? (
        <Menu
          label="Edit, pin or remove"
          trigger={
            <button type="button" className={iconBtn} aria-label={`Options for “${fact.statement}”`}>
              <MoreHorizontal className="h-4 w-4" />
            </button>
          }
        >
          <MenuItem icon={<Pencil className="h-3.5 w-3.5" />} onSelect={() => (setText(fact.statement), setEditing(true))}>
            Edit
          </MenuItem>
          <MenuItem
            icon={fact.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
            onSelect={() => update.mutate({ id: fact.id, patch: { pinned: !fact.pinned } })}
          >
            {fact.pinned ? "Unpin" : "Pin — always use it"}
          </MenuItem>
          {fact.routine ? (
            <MenuItem
              icon={<CalendarClock className="h-3.5 w-3.5" />}
              onSelect={() =>
                action.mutate(
                  { action: "routine", id: fact.id },
                  {
                    onSuccess: () => toast.success(`Plan my day now keeps ${fact.routine!.start}–${fact.routine!.end} for ${fact.routine!.label}`),
                    onError: (e) => toast.error((e as Error).message),
                  },
                )
              }
            >
              Make it a routine
            </MenuItem>
          ) : null}
          <MenuSeparator />
          <MenuItem
            icon={<X className="h-3.5 w-3.5" />}
            onSelect={() =>
              update.mutate(
                { id: fact.id, patch: { status: "rejected" } },
                {
                  onSuccess: () => toast("Got it — it won't assume that again"),
                },
              )
            }
          >
            Not true
          </MenuItem>
          <MenuItem danger icon={<Trash2 className="h-3.5 w-3.5" />} onSelect={() => remove.mutate(fact.id)}>
            Delete
          </MenuItem>
        </Menu>
      ) : null}
    </motion.li>
  );
}

/**
 * Settings → What the AI knows about you. Everything here is given to the AI when
 * it plans your day, suggests what to learn or interviews you for jobs.
 */
export function MemoryCard({ profile }: { profile: Profile }) {
  const { data: facts = [], isLoading, error } = useFacts();
  const updateProfile = useUpdateProfile();
  const updateFact = useUpdateFact();
  const add = useAddFact();
  const learn = useLearnNow();
  const action = useMemoryAction();
  const [text, setText] = useState("");
  const [kind, setKind] = useState<FactKind>("like");
  const [confirmForget, setConfirmForget] = useState(false);
  const [showRejected, setShowRejected] = useState(false);
  const learningOn = profile.memory_learning !== false;

  const suggested = facts.filter((f) => f.status === "suggested");
  const active = facts.filter((f) => f.status === "active");
  const rejected = facts.filter((f) => f.status === "rejected");
  const groups = FACT_KINDS.map((k) => ({
    ...k,
    items: active.filter((f) => f.kind === k.id),
  })).filter((g) => g.items.length);

  const submit = () => {
    if (text.trim().length < 3) return;
    add.mutate(
      { statement: text.trim(), kind },
      {
        onSuccess: () => (setText(""), toast.success("Saved — the AI will use it")),
        onError: (e) => toast.error((e as Error).message),
      },
    );
  };
  const runLearn = () =>
    learn.mutate(undefined, {
      onSuccess: (r) =>
        r.skipped
          ? toast(r.skipped === "nothing new" ? "Nothing new to learn yet" : `Nothing learned: ${r.skipped}`)
          : toast.success(
              [r.added && `${r.added} new`, r.suggested && `${r.suggested} to confirm`, r.confirmed && `${r.confirmed} confirmed`]
                .filter(Boolean)
                .join(" · ") || "Up to date",
            ),
      onError: (e) => toast.error((e as Error).message),
    });

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <Switch
          checked={learningOn}
          onChange={(v) =>
            updateProfile.mutate(
              { memory_learning: v },
              {
                onSuccess: () => toast.success(v ? "Learning is on" : "Learning paused — what it knows is still used"),
              },
            )
          }
          label="Keep learning about me"
          description="Once a day it looks at when you finish tasks, focus, train and study, what you keep postponing, and what you tell the AI (Scout chat, job searches, plan changes, Remember). New things you haven't confirmed are asked about on Today first."
        />
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
          <span>{profile.memory_learned_at ? `Last learned ${timeAgo(profile.memory_learned_at)}` : "Hasn't learned anything yet"}</span>
          <Button size="sm" variant="secondary" onClick={runLearn} loading={learn.isPending}>
            <RefreshCw className="h-3.5 w-3.5" /> Learn now
          </Button>
        </div>
      </Card>

      <Card className="p-4">
        <div className="mb-2 text-[13px] font-medium text-fg">Tell it something about you</div>
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Select value={kind} onChange={(e) => setKind(e.target.value as FactKind)} aria-label="What kind of thing is this" className="sm:w-44">
            {FACT_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </Select>
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={240}
            placeholder="e.g. I do my best thinking before lunch · I believe rest days matter"
          />
          <Button type="submit" variant="primary" loading={add.isPending} disabled={text.trim().length < 3}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </form>
      </Card>

      {error ? (
        <p className="text-[12.5px] text-danger">
          Couldn&apos;t load memories: {(error as Error).message}. Run supabase/migrations/0005_planning_health_chat_memory.sql.
        </p>
      ) : null}

      {suggested.length ? (
        <Card className="border-accent/30 bg-accent/[0.04] p-4">
          <div className="mb-1 flex items-center gap-2 text-[13px] font-medium text-fg">
            <Brain className="h-4 w-4 text-accent" /> Noticed — is this right?
          </div>
          <ul className="divide-y divide-line">
            <AnimatePresence initial={false}>
              {suggested.map((f) => (
                <motion.li key={f.id} layout exit={{ opacity: 0, height: 0 }} className="flex flex-wrap items-center gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] text-fg">{f.statement}</div>
                    {f.evidence[0] ? <div className="text-[11.5px] text-faint">{f.evidence[0].label}</div> : null}
                  </div>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() =>
                      updateFact.mutate({
                        id: f.id,
                        patch: {
                          status: "active",
                          confidence: Math.max(f.confidence, 85),
                        },
                      })
                    }
                  >
                    <Check className="h-3.5 w-3.5" /> Right
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      updateFact.mutate({
                        id: f.id,
                        patch: { status: "rejected" },
                      })
                    }
                  >
                    <X className="h-3.5 w-3.5" /> Not true
                  </Button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </Card>
      ) : null}

      {isLoading ? null : groups.length ? (
        <Card className="divide-y divide-line px-4">
          {groups.map((g) => (
            <section key={g.id} className="py-3">
              <div className="flex items-baseline justify-between gap-2">
                <h4 className="text-[12px] font-semibold uppercase tracking-wide text-muted">{g.label}</h4>
                <span className="text-[11.5px] text-faint">{g.hint}</span>
              </div>
              <ul className="divide-y divide-line/60">
                <AnimatePresence initial={false}>
                  {g.items.map((f) => (
                    <FactRow key={f.id} fact={f} />
                  ))}
                </AnimatePresence>
              </ul>
            </section>
          ))}
        </Card>
      ) : (
        <p className="rounded-lg border border-dashed border-line p-4 text-[12.5px] text-muted">
          Nothing yet. Add something above, use <b>Remember</b> in Planning preferences, or just keep using Productivize — after a few days of tasks it starts
          noticing when you like to do things.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 text-[12px]">
        {rejected.length ? (
          <button
            type="button"
            className="text-muted underline-offset-2 hover:text-fg hover:underline"
            onClick={() => setShowRejected((s) => !s)}
            aria-expanded={showRejected}
          >
            {showRejected ? "Hide" : "Show"} {rejected.length} thing
            {rejected.length > 1 ? "s" : ""} you said aren&apos;t true
          </button>
        ) : null}
        <span className="flex-1" />
        {confirmForget ? (
          <span className="inline-flex items-center gap-2 text-danger">
            Delete everything it learned? (What you told it stays.)
            <Button
              size="sm"
              variant="danger"
              onClick={() =>
                action.mutate(
                  { action: "forget-learned" },
                  {
                    onSuccess: () => (setConfirmForget(false), toast.success("Forgotten")),
                  },
                )
              }
            >
              Forget
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmForget(false)}>
              Keep
            </Button>
          </span>
        ) : (
          <button type="button" className="text-muted underline-offset-2 hover:text-danger hover:underline" onClick={() => setConfirmForget(true)}>
            Forget everything it learned
          </button>
        )}
      </div>
      {showRejected && rejected.length ? (
        <ul className="space-y-1 text-[12.5px] text-muted">
          {rejected.map((f) => (
            <li key={f.id} className={cn("flex items-center gap-2")}>
              <span className="line-through">{f.statement}</span>
              <Tip content="It was right after all">
                <button type="button" className="text-accent hover:underline" onClick={() => updateFact.mutate({ id: f.id, patch: { status: "active" } })}>
                  Undo
                </button>
              </Tip>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
