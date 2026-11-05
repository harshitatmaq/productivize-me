"use client";

import {
  ArrowUp,
  CalendarDays,
  Copy,
  ExternalLink,
  Link2,
  LogOut,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Share2,
  Trash2,
  UserMinus,
  UserPlus,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/field";
import { Menu, MenuItem, MenuSeparator, Tip } from "@/components/ui/menu";
import { Card, EmptyState, Segmented, Skeleton } from "@/components/ui/misc";
import { useToday } from "@/lib/hooks";
import { useBuddyStats } from "@/lib/queries/buddy";
import { useProfile, useUpdateProfile, useUser } from "@/lib/queries/profile";
import {
  useAddComment,
  useAddList,
  useAddListItem,
  useDeleteComment,
  useDeleteList,
  useDeleteListItem,
  useDeleteSpace,
  useDeleteSpaceItem,
  useRemoveMember,
  useShareTo,
  useSpaceComments,
  useSpaceItems,
  useSpaceListItems,
  useSpaceLists,
  useSpacePeople,
  useSpaceReactions,
  useSpaceRealtime,
  useToggleReaction,
  useUpdateList,
  useUpdateListItem,
  useUpdateSpace,
  useUpdateSpaceItem,
} from "@/lib/queries/spaces";
import { COPY_LABEL, openShare, shareLink, shareNote, takeCopy } from "@/lib/share";
import { startOfWeek } from "@/lib/time";
import type { ShareKind, Space, SpaceComment, SpaceItem, SpaceList, SpaceListItem, SpacePerson, SpaceReaction } from "@/lib/types";
import { cn, initials, timeAgo } from "@/lib/utils";
import { InviteDialog } from "./invite-dialog";
import { KIND_NAMES, KindIcon } from "./kind-icon";
import { PersonCard } from "./person-card";

const REACTIONS = ["👍", "❤️", "🎉", "👀", "🔥"];
const JOB_STATUSES = ["Interested", "Applied", "Interviewing", "Offer", "Not for us"];

function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#8b93f5] to-[#5e6ad2] text-[9.5px] font-semibold text-white ring-2 ring-bg",
        className,
      )}
      title={name}
    >
      {initials(name)}
    </span>
  );
}

const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s.trim());
const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------

function Composer({ space }: { space: Space }) {
  const [text, setText] = useState("");
  const share = useShareTo();
  const submit = () => {
    const t = text.trim();
    if (!t) return;
    const input = isUrl(t) ? shareLink(t) : shareNote(t);
    share.mutate({ ...input, spaceIds: [space.id] }, { onSuccess: () => setText(""), onError: (e) => toast.error((e as Error).message) });
  };
  return (
    <div className="relative mb-4 rounded-xl border border-line bg-panel p-1 transition-colors focus-within:border-accent/50">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        rows={1}
        maxLength={4000}
        placeholder={`Write a note or paste a link for ${space.name}…`}
        aria-label="Share a note or link"
        className="block max-h-40 min-h-9 w-full resize-none bg-transparent px-3 py-2 pr-11 text-[13.5px] text-fg outline-none placeholder:text-faint"
      />
      <Tip content="Share (Enter)">
        <button
          onClick={submit}
          disabled={!text.trim() || share.isPending}
          aria-label="Share note"
          className="absolute bottom-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-white disabled:opacity-40"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      </Tip>
      <div className="hidden px-3 pb-1.5 text-[11px] text-faint sm:block">
        Tip: use <b>Share to…</b> on any task, job, learning note or flashcard to bring it here.
      </div>
    </div>
  );
}

function Comments({
  item,
  comments,
  nameOf,
  me,
}: {
  item: SpaceItem;
  comments: SpaceComment[];
  nameOf: (id: string | null) => string;
  me: string | undefined;
}) {
  const [text, setText] = useState("");
  const add = useAddComment();
  const del = useDeleteComment();
  return (
    <div className="mt-3 space-y-2 border-t border-line pt-3">
      {comments.map((c) => (
        <div key={c.id} className="group flex items-start gap-2 text-[12.5px]">
          <Avatar name={nameOf(c.user_id)} className="h-5 w-5 text-[8.5px] ring-0" />
          <div className="min-w-0 flex-1">
            <span className="font-medium text-fg-2">{nameOf(c.user_id)}</span> <span className="text-faint">{timeAgo(c.created_at)}</span>
            <div className="whitespace-pre-wrap break-words text-fg-2">{c.body}</div>
          </div>
          {c.user_id === me ? (
            <Tip content="Delete comment">
              <button onClick={() => del.mutate(c)} aria-label="Delete comment" className="rounded p-0.5 text-faint opacity-0 hover:text-danger group-hover:opacity-100 focus:opacity-100">
                <X className="h-3 w-3" />
              </button>
            </Tip>
          ) : null}
        </div>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          add.mutate({ item, body: text.trim() }, { onSuccess: () => setText(""), onError: (er) => toast.error((er as Error).message) });
        }}
        className="flex gap-2"
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Reply…" aria-label="Write a comment" className="field h-8 flex-1" maxLength={2000} />
        <Button size="sm" type="submit" loading={add.isPending} disabled={!text.trim()}>
          Send
        </Button>
      </form>
    </div>
  );
}

function ItemDetails({ item }: { item: SpaceItem }) {
  const p = item.payload as Record<string, unknown>;
  const [open, setOpen] = useState(false);
  const body = item.body?.trim();
  switch (item.kind) {
    case "job": {
      const url = (p.apply_url as string) || (p.url as string);
      return (
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
          {p.location ? <span>{String(p.location)}</span> : null}
          {p.remote ? <span className="text-success">Remote</span> : null}
          {p.salary ? <span>{String(p.salary)}</span> : null}
          {url && /^https?:/.test(url) ? (
            <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
              Open posting <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
        </div>
      );
    }
    case "link":
      return (
        <a href={String(p.url)} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[12px] text-accent hover:underline">
          {host(String(p.url))} <ExternalLink className="h-3 w-3" />
        </a>
      );
    case "task":
      return (
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
          {p.due_date ? (
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="h-3 w-3" /> {String(p.due_date)}
              {p.due_time ? ` ${String(p.due_time).slice(0, 5)}` : ""}
            </span>
          ) : null}
          {((p.tags as string[]) ?? []).map((t) => (
            <span key={t} className="text-faint">
              #{t}
            </span>
          ))}
          {body ? <p className="w-full whitespace-pre-wrap text-fg-2">{body}</p> : null}
        </div>
      );
    case "flashcards":
    case "learning": {
      const cards = (p.cards as { front: string; back: string }[] | undefined) ?? [];
      const resources = (p.resources as { url: string; title?: string }[] | undefined) ?? [];
      return (
        <div className="mt-1 space-y-1.5 text-[12.5px] text-fg-2">
          {body ? <p className={cn("whitespace-pre-wrap", !open && "line-clamp-3")}>{body}</p> : null}
          {resources.length ? (
            <div className="flex flex-wrap gap-x-3">
              {resources.map((r) => (
                <a key={r.url} href={r.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-accent hover:underline">
                  {r.title || host(r.url)} <ExternalLink className="h-3 w-3" />
                </a>
              ))}
            </div>
          ) : null}
          {cards.length ? (
            <div className="space-y-1">
              {(open ? cards : cards.slice(0, 3)).map((c, i) => (
                <div key={i} className="rounded-md border border-line bg-panel-2/60 px-2 py-1 text-[12px]">
                  <span className="text-fg">{c.front}</span>
                  {open ? <span className="block text-muted">{c.back}</span> : null}
                </div>
              ))}
            </div>
          ) : null}
          {(body && body.length > 220) || cards.length > 3 || (cards.length && !open) ? (
            <button onClick={() => setOpen((o) => !o)} className="text-[12px] text-muted hover:text-fg">
              {open ? "Show less" : cards.length ? `Show ${cards.length} card${cards.length > 1 ? "s" : ""} with answers` : "Show more"}
            </button>
          ) : null}
        </div>
      );
    }
    case "interest":
      return (
        <div className="mt-1 text-[12px] capitalize text-muted">
          {String(p.kind ?? "")} · {String(p.stage ?? "")}
          {body ? <p className="normal-case text-fg-2">{body}</p> : null}
        </div>
      );
    default:
      return body && body !== item.title ? <p className="mt-1 whitespace-pre-wrap text-[13px] text-fg-2">{body}</p> : null;
  }
}

function ItemCard({
  item,
  space,
  people,
  comments,
  reactions,
  me,
  focused,
}: {
  item: SpaceItem;
  space: Space;
  people: SpacePerson[];
  comments: SpaceComment[];
  reactions: SpaceReaction[];
  me: string | undefined;
  focused: boolean;
}) {
  const router = useRouter();
  const update = useUpdateSpaceItem();
  const del = useDeleteSpaceItem();
  const react = useToggleReaction();
  const [showComments, setShowComments] = useState(focused);
  const [copying, setCopying] = useState(false);
  const nameOf = (id: string | null) => people.find((p) => p.user_id === id)?.name ?? "Someone";
  const sharedBy = nameOf(item.shared_by);
  const canDelete = item.shared_by === me || space.owner_id === me;
  const counts = REACTIONS.map((e) => ({ e, n: reactions.filter((r) => r.emoji === e).length, mine: reactions.some((r) => r.emoji === e && r.user_id === me) }));

  const copy = async () => {
    setCopying(true);
    try {
      const r = await takeCopy(item, sharedBy);
      toast.success(r.where, { action: { label: "Open", onClick: () => router.push(r.href) } });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCopying(false);
    }
  };

  return (
    <motion.article
      layout="position"
      id={`item-${item.id}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      className={cn("rounded-xl border border-line bg-panel p-4", focused && "border-accent/40", item.done && "opacity-70")}
    >
      <div className="flex items-start gap-3">
        {item.kind === "task" ? (
          <button
            role="checkbox"
            aria-checked={item.done}
            aria-label={item.done ? "Mark not done" : "Mark done"}
            onClick={() => update.mutate({ item, patch: { done: !item.done } })}
            className={cn(
              "mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition-colors",
              item.done ? "border-success bg-success text-white" : "border-line-strong hover:border-accent",
            )}
          >
            {item.done ? <span className="text-[10px]">✓</span> : null}
          </button>
        ) : (
          <KindIcon kind={item.kind} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className={cn("text-[14px] font-medium leading-snug text-fg", item.done && "line-through")}>{item.title}</h3>
            <Menu
              label="More actions — copy to yours, share on, remove"
              trigger={
                <button aria-label="More actions" className="-mr-1 -mt-1 rounded-md p-1 text-faint hover:bg-panel-hover hover:text-fg">
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              }
            >
              <MenuItem icon={<Copy className="h-3.5 w-3.5" />} onSelect={copy}>
                {COPY_LABEL[item.kind]}
              </MenuItem>
              <MenuItem
                icon={<Share2 className="h-3.5 w-3.5" />}
                onSelect={() => openShare({ kind: item.kind, title: item.title, body: item.body, payload: item.payload })}
              >
                Share to another dashboard…
              </MenuItem>
              {canDelete ? (
                <>
                  <MenuSeparator />
                  <MenuItem danger icon={<Trash2 className="h-3.5 w-3.5" />} onSelect={() => del.mutate(item, { onError: (e) => toast.error((e as Error).message) })}>
                    Remove from {space.name}
                  </MenuItem>
                </>
              ) : null}
            </Menu>
          </div>
          <div className="mt-0.5 text-[11.5px] text-faint">
            {KIND_NAMES[item.kind]} · shared by {item.shared_by === me ? "you" : sharedBy} · {timeAgo(item.created_at)}
            {item.done && item.done_by ? ` · done by ${item.done_by === me ? "you" : nameOf(item.done_by)}` : ""}
          </div>
          {item.note ? <blockquote className="mt-2 border-l-2 border-accent/50 pl-2.5 text-[13px] italic text-fg-2">{item.note}</blockquote> : null}
          <ItemDetails item={item} />

          <div className="mt-3 flex flex-wrap items-center gap-1">
            {counts.map(({ e, n, mine }) => (
              <Tip key={e} content={mine ? "Remove reaction" : "React"}>
                <button
                  onClick={() => me && react.mutate({ item, emoji: e, mine, userId: me })}
                  aria-label={`React ${e}`}
                  aria-pressed={mine}
                  className={cn(
                    "inline-flex h-7 items-center gap-1 rounded-full border px-2 text-[12px] transition-colors",
                    mine ? "border-accent/40 bg-accent/10" : n ? "border-line" : "border-transparent opacity-50 hover:opacity-100",
                  )}
                >
                  {e}
                  {n ? <span className="tabular-nums text-muted">{n}</span> : null}
                </button>
              </Tip>
            ))}
<Tip content={showComments ? "Hide comments" : "Comments"}>
            <button
              onClick={() => setShowComments((s) => !s)}
              aria-expanded={showComments}
              aria-label={comments.length ? `${comments.length} comment${comments.length > 1 ? "s" : ""} — show` : "Reply"}
              className="ml-1 inline-flex h-7 items-center gap-1 rounded-full px-2 text-[12px] text-muted hover:bg-panel-hover hover:text-fg"
            >
              <MessageCircle className="h-3.5 w-3.5" /> {comments.length ? comments.length : "Reply"}
            </button>
</Tip>
            <span className="flex-1" />
            {item.kind === "job" ? (
              <select
                value={item.status ?? ""}
                onChange={(e) => update.mutate({ item, patch: { status: e.target.value || null } })}
                aria-label="Status"
                className="field h-7 w-auto py-0 pr-7 text-[12px]"
              >
                <option value="">Set status…</option>
                {JOB_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            ) : null}
            <Button size="sm" variant="secondary" onClick={copy} loading={copying}>
              <Copy className="h-3.5 w-3.5" /> {COPY_LABEL[item.kind]}
            </Button>
          </div>
          {showComments ? <Comments item={item} comments={comments} nameOf={nameOf} me={me} /> : null}
        </div>
      </div>
    </motion.article>
  );
}

function Feed({ space, people, me, focusItem }: { space: Space; people: SpacePerson[]; me: string | undefined; focusItem: string | null }) {
  const { data: items = [], isLoading } = useSpaceItems(space.id);
  const { data: comments = [] } = useSpaceComments(space.id);
  const { data: reactions = [] } = useSpaceReactions(space.id);
  const [kind, setKind] = useState<ShareKind | "all">("all");
  const kinds = [...new Set(items.map((i) => i.kind))];
  const shown = items.filter((i) => kind === "all" || i.kind === kind);
  const byItem = useMemo(() => {
    const m = new Map<string, SpaceComment[]>();
    comments.forEach((c) => m.set(c.item_id, [...(m.get(c.item_id) ?? []), c]));
    return m;
  }, [comments]);

  return (
    <div>
      <Composer space={space} />
      {kinds.length > 1 ? (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {(["all", ...kinds] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              aria-pressed={kind === k}
              className={cn(
                "h-7 rounded-full border px-3 text-[12px] transition-colors",
                kind === k ? "border-line-strong bg-panel text-fg" : "border-transparent text-muted hover:text-fg",
              )}
            >
              {k === "all" ? "Everything" : KIND_NAMES[k]}
            </button>
          ))}
        </div>
      ) : null}
      {isLoading ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : !items.length ? (
        <EmptyState icon={<Share2 className="h-5 w-5" />} title="Nothing shared yet">
          Write a note above, or open any task, job, learning note or flashcard and choose <b>Share to… → {space.name}</b>.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {shown.map((it) => (
              <ItemCard
                key={it.id}
                item={it}
                space={space}
                people={people}
                comments={byItem.get(it.id) ?? []}
                reactions={reactions.filter((r) => r.item_id === it.id)}
                me={me}
                focused={focusItem === it.id}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared lists
// ---------------------------------------------------------------------------

function ListCard({ list, items, nameOf, me }: { list: SpaceList; items: SpaceListItem[]; nameOf: (id: string | null) => string; me: string | undefined }) {
  const [text, setText] = useState("");
  const [showDone, setShowDone] = useState(false);
  const add = useAddListItem();
  const upd = useUpdateListItem();
  const del = useDeleteListItem();
  const rename = useUpdateList();
  const remove = useDeleteList();
  const open = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);
  const row = (i: SpaceListItem) => (
    <motion.li key={i.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="group flex items-center gap-2.5 py-1.5">
      <button
        role="checkbox"
        aria-checked={i.done}
        aria-label={i.done ? `Mark “${i.text}” not done` : `Mark “${i.text}” done`}
        onClick={() => upd.mutate({ item: i, patch: { done: !i.done } })}
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
          i.done ? "border-success bg-success text-[9px] text-white" : "border-line-strong hover:border-accent",
        )}
      >
        {i.done ? "✓" : null}
      </button>
      <span className={cn("min-w-0 flex-1 text-[13px]", i.done ? "text-faint line-through" : "text-fg-2")}>{i.text}</span>
      {i.done && i.done_by ? <span className="shrink-0 text-[11px] text-faint">{i.done_by === me ? "you" : nameOf(i.done_by)}</span> : null}
      <Tip content="Delete item">
        <button onClick={() => del.mutate(i)} aria-label={`Delete “${i.text}”`} className="rounded p-0.5 text-faint opacity-0 hover:text-danger group-hover:opacity-100 focus:opacity-100">
          <X className="h-3.5 w-3.5" />
        </button>
      </Tip>
    </motion.li>
  );
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-fg">{list.title}</h3>
        <span className="text-[11.5px] tabular-nums text-faint">
          {done.length}/{items.length}
        </span>
        <Menu
          label="List actions — rename, delete"
          trigger={
            <button aria-label="List actions" className="rounded-md p-1 text-faint hover:bg-panel-hover hover:text-fg">
              <MoreHorizontal className="h-4 w-4" />
            </button>
          }
        >
          <MenuItem
            icon={<Pencil className="h-3.5 w-3.5" />}
            onSelect={() => {
              const t = window.prompt("Rename list", list.title)?.trim();
              if (t) rename.mutate({ list, title: t });
            }}
          >
            Rename
          </MenuItem>
          <MenuItem
            danger
            icon={<Trash2 className="h-3.5 w-3.5" />}
            onSelect={() => window.confirm(`Delete “${list.title}” for everyone?`) && remove.mutate(list)}
          >
            Delete list
          </MenuItem>
        </Menu>
      </div>
      <ul>
        <AnimatePresence initial={false}>{open.map(row)}</AnimatePresence>
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          add.mutate({ list, text: text.trim() }, { onSuccess: () => setText("") });
        }}
        className="mt-1 flex items-center gap-2"
      >
        <Plus className="h-4 w-4 shrink-0 text-faint" />
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add an item" aria-label={`Add to ${list.title}`} className="h-8 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-faint" maxLength={300} />
      </form>
      {done.length ? (
        <div className="mt-2 border-t border-line pt-2">
          <button onClick={() => setShowDone((s) => !s)} className="text-[12px] text-muted hover:text-fg" aria-expanded={showDone}>
            {showDone ? "Hide" : "Show"} {done.length} done
          </button>
          {showDone ? <ul className="mt-1">{done.map(row)}</ul> : null}
        </div>
      ) : null}
    </Card>
  );
}

function Lists({ space, people, me }: { space: Space; people: SpacePerson[]; me: string | undefined }) {
  const { data: lists = [], isLoading } = useSpaceLists(space.id);
  const { data: items = [] } = useSpaceListItems(space.id);
  const add = useAddList();
  const [title, setTitle] = useState("");
  const nameOf = (id: string | null) => people.find((p) => p.user_id === id)?.name ?? "Someone";
  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) add.mutate({ spaceId: space.id, title: title.trim() }, { onSuccess: () => setTitle("") });
        }}
        className="mb-4 flex gap-2"
      >
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New list — e.g. Groceries, Interview prep plan, Trip packing" aria-label="New list name" className="field h-9 flex-1" maxLength={120} />
        <Button type="submit" variant="primary" loading={add.isPending} disabled={!title.trim()}>
          <Plus className="h-4 w-4" /> New list
        </Button>
      </form>
      {isLoading ? (
        <Skeleton className="h-32 rounded-xl" />
      ) : !lists.length ? (
        <EmptyState title="No shared lists yet">Lists here can be edited and ticked off by everyone in {space.name}.</EmptyState>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {lists.map((l) => (
            <ListCard key={l.id} list={l} items={items.filter((i) => i.list_id === l.id)} nameOf={nameOf} me={me} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// People + weekly progress
// ---------------------------------------------------------------------------

function People({ space, people, me, onInvite }: { space: Space; people: SpacePerson[]; me: string | undefined; onInvite: () => void }) {
  const today = useToday();
  const { data: profile } = useProfile();
  const updateProfile = useUpdateProfile();
  const sharing = !!profile?.share_progress;
  const { data: stats = [], isLoading } = useBuddyStats(startOfWeek(today, profile?.week_starts_on ?? 1), sharing, space.id);
  const remove = useRemoveMember();
  const isOwner = space.owner_id === me;
  return (
    <div className="space-y-6">
      <Card className="divide-y divide-line">
        {people.map((p) => (
          <div key={p.user_id} className="flex items-center gap-3 px-4 py-2.5">
            <Avatar name={p.name} className="h-7 w-7 text-[10px] ring-0" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] text-fg">
                {p.name} {p.user_id === me ? <span className="text-faint">(you)</span> : null}
              </div>
              <div className="truncate text-[11.5px] text-faint">{p.email}</div>
            </div>
            <span className="text-[11.5px] capitalize text-muted">{p.role}</span>
            {isOwner && p.user_id !== me ? (
              <Tip content={`Remove ${p.name}`}>
                <button
                  onClick={() => window.confirm(`Remove ${p.name} from ${space.name}?`) && remove.mutate({ spaceId: space.id, userId: p.user_id })}
                  aria-label={`Remove ${p.name}`}
                  className="rounded p-1 text-faint hover:bg-panel-hover hover:text-danger"
                >
                  <UserMinus className="h-3.5 w-3.5" />
                </button>
              </Tip>
            ) : null}
          </div>
        ))}
        <button onClick={onInvite} className="flex w-full items-center gap-2 px-4 py-2.5 text-[13px] text-accent hover:bg-panel-hover">
          <UserPlus className="h-4 w-4" /> Invite someone
        </button>
      </Card>

      <div>
        <Card className="mb-4 px-4">
          <Switch
            label="Share my weekly progress"
            description="People in your shared dashboards see your totals (tasks done, learning days, applications, focus time) — never titles, notes or jobs."
            checked={sharing}
            onChange={(v) => updateProfile.mutate({ share_progress: v }, { onSuccess: () => toast(v ? "Sharing on" : "Sharing off") })}
          />
        </Card>
        {!sharing ? null : isLoading ? (
          <Skeleton className="h-64 rounded-xl" />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {stats.map((p) => (
              <PersonCard key={p.user_id} p={p} />
            ))}
            {stats.length < 2 ? (
              <EmptyState title="Waiting for the others">Their card appears once they turn on “Share my weekly progress” too.</EmptyState>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function SpaceView({ space, focusItem }: { space: Space; focusItem: string | null }) {
  const router = useRouter();
  const { data: user } = useUser();
  const me = user?.id;
  const { data: people = [] } = useSpacePeople(space.id);
  const { data: items = [] } = useSpaceItems(space.id);
  const { data: lists = [] } = useSpaceLists(space.id);
  useSpaceRealtime(space.id);
  const [tab, setTab] = useState<"feed" | "lists" | "people">("feed");
  const [inviting, setInviting] = useState(false);
  const rename = useUpdateSpace();
  const del = useDeleteSpace();
  const remove = useRemoveMember();
  const isOwner = space.owner_id === me;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="text-[26px] leading-none">{space.emoji}</span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[17px] font-semibold text-fg">{space.name}</h2>
          <div className="mt-1 flex items-center">
            <div className="flex -space-x-1.5">
              {people.slice(0, 6).map((p) => (
                <Avatar key={p.user_id} name={p.name} />
              ))}
            </div>
            <span className="ml-2 text-[12px] text-muted">
              {people.length} {people.length === 1 ? "person" : "people"}
            </span>
          </div>
        </div>
        <Button variant="secondary" onClick={() => setInviting(true)}>
          <UserPlus className="h-4 w-4" /> Invite
        </Button>
        <Menu
          label="Dashboard settings — rename, copy link, leave or delete"
          trigger={
            <button aria-label="Dashboard settings" className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-muted hover:border-line-strong hover:text-fg">
              <MoreHorizontal className="h-4 w-4" />
            </button>
          }
        >
          {isOwner ? (
            <MenuItem
              icon={<Pencil className="h-3.5 w-3.5" />}
              onSelect={() => {
                const name = window.prompt("Rename shared dashboard", space.name)?.trim();
                if (name) rename.mutate({ id: space.id, patch: { name } });
              }}
            >
              Rename
            </MenuItem>
          ) : null}
          <MenuItem icon={<Link2 className="h-3.5 w-3.5" />} onSelect={() => navigator.clipboard.writeText(`${window.location.origin}/together?space=${space.id}`).then(() => toast("Link copied — works for members"))}>
            Copy link
          </MenuItem>
          <MenuSeparator />
          {isOwner ? (
            <MenuItem
              danger
              icon={<Trash2 className="h-3.5 w-3.5" />}
              onSelect={() => {
                if (!window.confirm(`Delete “${space.name}” and everything shared in it, for everyone? Your own dashboards aren't affected.`)) return;
                del.mutate(space.id, { onSuccess: () => router.replace("/together") });
              }}
            >
              Delete dashboard
            </MenuItem>
          ) : (
            <MenuItem
              danger
              icon={<LogOut className="h-3.5 w-3.5" />}
              onSelect={() => {
                if (!me || !window.confirm(`Leave “${space.name}”?`)) return;
                remove.mutate({ spaceId: space.id, userId: me }, { onSuccess: () => router.replace("/together") });
              }}
            >
              Leave dashboard
            </MenuItem>
          )}
        </Menu>
      </div>

      <div className="mb-4">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "feed", label: "Shared", count: items.length || undefined },
            { value: "lists", label: "Lists", count: lists.length || undefined },
            { value: "people", label: "People & progress", count: people.length || undefined },
          ]}
        />
      </div>

      {tab === "feed" ? <Feed space={space} people={people} me={me} focusItem={focusItem} /> : null}
      {tab === "lists" ? <Lists space={space} people={people} me={me} /> : null}
      {tab === "people" ? <People space={space} people={people} me={me} onInvite={() => setInviting(true)} /> : null}

      <InviteDialog space={space} open={inviting} onClose={() => setInviting(false)} />
      <p className="mt-8 text-center text-[11.5px] text-faint">
        Everything here is a copy. Changing it never changes anyone&apos;s own tasks or jobs. <Link href="/settings" className="hover:text-muted">Settings</Link>
      </p>
    </div>
  );
}
