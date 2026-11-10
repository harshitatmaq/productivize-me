"use client";

import { Check, HeartHandshake, Plus, X } from "lucide-react";
import { motion } from "motion/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Card, EmptyState, PageHeader, Skeleton } from "@/components/ui/misc";
import { useAnswerInvite, useCreateSpace, useInvite, useMyInvites, useSpaces, type InviteResponse } from "@/lib/queries/spaces";
import { cn, timeAgo } from "@/lib/utils";
import { InviteResultNote } from "./invite-dialog";
import { SpaceView } from "./space-view";

const EMOJIS = ["🤝", "💼", "📚", "🏠", "🎯", "🚀", "🧠", "🎉", "💪", "✈️"];

function CreateSpaceDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const create = useCreateSpace();
  const invite = useInvite();
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState(EMOJIS[0]);
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<InviteResponse | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setEmail("");
    setEmoji(EMOJIS[0]);
    setResult(null);
    setCreatedId(null);
  };
  const close = () => {
    if (createdId) onCreated(createdId);
    reset();
    onClose();
  };

  const submit = async () => {
    if (!name.trim()) return toast.error("Give it a name");
    try {
      const space = await create.mutateAsync({ name: name.trim(), emoji });
      setCreatedId(space.id);
      if (email.trim()) {
        const r = await invite.mutateAsync({ spaceId: space.id, email: email.trim() });
        if (r.status === "link") return setResult(r);
        toast.success(r.status === "emailed" ? `Invite emailed to ${email.trim()}` : `${email.trim()} already uses Productivize — they'll see the invite in Together`);
      } else toast.success("Shared dashboard created");
      onCreated(space.id);
      reset();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close()}
      title="New shared dashboard"
      description="Invite someone by email. You each keep your own private dashboard; this one only holds what you share."
      size="sm"
      footer={
        result ? (
          <div className="flex justify-end">
            <Button variant="primary" onClick={close}>
              Done
            </Button>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} loading={create.isPending || invite.isPending}>
              Create{email.trim() ? " & invite" : ""}
            </Button>
          </div>
        )
      }
    >
      {result ? (
        <InviteResultNote result={result} email={email} />
      ) : (
        <div className="space-y-4">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Job hunt with Sid, Home, Study group" maxLength={80} autoFocus />
          </Field>
          <div>
            <div className="mb-1.5 text-[12px] font-medium text-muted">Icon</div>
            <div className="flex flex-wrap gap-1.5">
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  onClick={() => setEmoji(e)}
                  aria-label={`Use ${e}`}
                  aria-pressed={emoji === e}
                  className={cn("flex h-9 w-9 items-center justify-center rounded-lg border text-[17px]", emoji === e ? "border-accent bg-accent/10" : "border-line hover:border-line-strong")}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
          <Field label="Invite (optional)" hint="They get an email to join. People new to Productivize get their own account too.">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="friend@gmail.com" autoComplete="off" />
          </Field>
        </div>
      )}
    </Dialog>
  );
}

function InviteCards() {
  const { data: invites = [] } = useMyInvites();
  const answer = useAnswerInvite();
  const router = useRouter();
  if (!invites.length) return null;
  return (
    <div className="mb-6 space-y-2">
      {invites.map((inv) => (
        <motion.div key={inv.id} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="flex flex-wrap items-center gap-3 border-accent/30 bg-accent/[0.04] p-4">
            <span className="text-[22px] leading-none">{inv.space.emoji}</span>
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-medium text-fg">You&apos;re invited to “{inv.space.name}”</div>
              <div className="text-[12px] text-muted">A shared dashboard · invited {timeAgo(inv.created_at)}</div>
            </div>
            <div className="flex w-full justify-end gap-2 sm:w-auto">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => answer.mutate({ id: inv.id, accept: false }, { onSuccess: () => toast("Invite declined") })}
              >
                <X className="h-3.5 w-3.5" /> Decline
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() =>
                  answer.mutate(
                    { id: inv.id, accept: true },
                    {
                      onSuccess: (spaceId) => {
                        toast.success(`Joined ${inv.space.name}`);
                        if (spaceId) router.replace(`/together?space=${spaceId}`);
                      },
                      onError: (e) => toast.error((e as Error).message),
                    },
                  )
                }
              >
                <Check className="h-3.5 w-3.5" /> Accept
              </Button>
            </div>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}

export function TogetherView() {
  const params = useSearchParams();
  const router = useRouter();
  const { data: spaces = [], isLoading } = useSpaces();
  const [creating, setCreating] = useState(params.get("new") === "1");
  const selectedId = (spaces.find((s) => s.id === params.get("space")) ?? spaces[0])?.id ?? null;
  const selected = spaces.find((s) => s.id === selectedId) ?? null;
  const select = (id: string) => router.replace(`/together?space=${id}`);

  return (
    <div className="mx-auto max-w-[980px] px-4 pt-5 md:px-8 md:pt-10">
      <PageHeader
        title="Together"
        icon={<HeartHandshake className="h-5 w-5" />}
        subtitle="Shared dashboards with people you invite: chat, plan on a shared board, and share copies of tasks, jobs and notes. Your own dashboard stays private."
        right={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New shared dashboard
          </Button>
        }
      />

      <InviteCards />

      {isLoading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : !spaces.length ? (
        <EmptyState
          icon={<HeartHandshake className="h-5 w-5" />}
          title="Start a shared dashboard"
          action={
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> Create and invite
            </Button>
          }
        >
          Invite a friend, partner or study buddy by email. Then use <b>Share to…</b> on any task, job, learning note or flashcard to send them a copy, chat,
          plan together on a shared board, and see each other&apos;s weekly progress.
        </EmptyState>
      ) : (
        <>
          <div className="mb-5 flex gap-1.5 overflow-x-auto pb-1 no-scrollbar" role="tablist" aria-label="Shared dashboards">
            {spaces.map((s) => (
              <button
                key={s.id}
                role="tab"
                aria-selected={s.id === selectedId}
                onClick={() => select(s.id)}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border px-3 text-[13px] transition-colors",
                  s.id === selectedId ? "border-line-strong bg-panel text-fg shadow-card" : "border-transparent text-muted hover:bg-panel-hover hover:text-fg",
                )}
              >
                <span className="text-[15px] leading-none">{s.emoji}</span>
                {s.name}
              </button>
            ))}
          </div>
          {selected ? (
            <SpaceView
              key={selected.id}
              space={selected}
              focusItem={params.get("item")}
              initialTab={(["feed", "chat", "board", "people"] as const).find((t) => t === params.get("tab")) ?? null}
            />
          ) : null}
        </>
      )}

      <CreateSpaceDialog open={creating} onClose={() => setCreating(false)} onCreated={select} />
    </div>
  );
}
