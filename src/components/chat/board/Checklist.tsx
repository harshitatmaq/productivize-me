"use client";

import { personRank } from "@/lib/chat/colors";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AddField,
  Attribution,
  Check,
  DeleteButton,
  EmptyBoard,
  itemClasses,
} from "./shared";
import FormattedText from "./FormattedText";
import BoardToolbar, { type SortMode } from "./BoardToolbar";
import { clearOrder, publishOrder } from "@/lib/chat/boardLayout";
import { ownerOf, type BoardItem, type BoardTab } from "@/lib/chat/board";
import type { useBoard } from "@/lib/chat/useBoard";
import type { UserId } from "@/lib/chat/types";

interface Props {
  items: BoardItem[];
  me: UserId;
  names: Record<UserId, string>;
  tab: BoardTab;
  board: ReturnType<typeof useBoard>;
}

/**
 * Tasks, discussion topics and the shopping list.
 *
 * One component: they differ only in wording. Completed items sink to the
 * bottom rather than vanishing, so ticking something off never makes you lose
 * your place.
 */
export default function Checklist({ items, names, tab, board }: Props) {
  const isDiscuss = tab.kind === "discuss";
  const [sortMode, setSortMode] = useState<SortMode>("manual");
  const [reorderActive, setReorderActive] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const { open, done } = useMemo(
    () => ({
      open: items.filter((i) => !i.done),
      done: items.filter((i) => i.done),
    }),
    [items],
  );

  const sortedOpen = useMemo(() => {
    if (!isDiscuss) return open;
    const list = [...open];
    switch (sortMode) {
      case "newest":
        list.sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );
        break;
      case "oldest":
        list.sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        );
        break;
      case "mine":
      case "person": {
        const mode = sortMode;
        list.sort((a, b) =>
          personRank(a.updated_by ?? a.author, mode).localeCompare(
            personRank(b.updated_by ?? b.author, mode),
          ),
        );
        break;
      }
    }
    return list;
  }, [open, sortMode, isDiscuss]);

  // Tells the assistant what order is on screen: open items first, then the
  // finished ones below the divider — the same order its row numbers follow.
  const kind = tab.kind;
  useEffect(() => {
    publishOrder(
      kind,
      [...sortedOpen, ...done].map((i) => i.client_id),
    );
    return () => clearOrder(kind);
  }, [kind, sortedOpen, done]);

  const handleDragStart = useCallback(
    (e: React.DragEvent, clientId: string) => {
      setDraggedId(clientId);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", clientId);
      if (e.currentTarget instanceof HTMLElement) {
        e.currentTarget.style.opacity = "0.5";
      }
    },
    [],
  );

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    setDraggedId(null);
    setDragOverId(null);
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = "1";
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, clientId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverId(clientId);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetId: string) => {
      e.preventDefault();
      const sourceId = e.dataTransfer.getData("text/plain");
      if (!sourceId || sourceId === targetId) {
        setDraggedId(null);
        setDragOverId(null);
        return;
      }

      const currentOrder = sortedOpen.map((i) => i.client_id);
      const sourceIndex = currentOrder.indexOf(sourceId);
      const targetIndex = currentOrder.indexOf(targetId);
      if (sourceIndex === -1 || targetIndex === -1) return;

      currentOrder.splice(sourceIndex, 1);
      currentOrder.splice(targetIndex, 0, sourceId);

      // One request for the whole new order, changing `position` only.
      const byId = new Map(sortedOpen.map((it) => [it.client_id, it]));
      const ordered = currentOrder.flatMap((id) => {
        const item = byId.get(id);
        return item ? [item] : [];
      });
      void board.reorder(ordered);

      setDraggedId(null);
      setDragOverId(null);
      setSortMode("manual");
    },
    [sortedOpen, board],
  );

  return (
    <>
      <AddField
        placeholder={tab.prompt}
        onAdd={(value) => board.add(tab.kind, value)}
      />

      {isDiscuss && items.length > 0 && (
        <BoardToolbar
          onSort={setSortMode}
          currentSort={sortMode}
          reorderActive={reorderActive}
          onToggleReorder={() => setReorderActive((r) => !r)}
        />
      )}

      {items.length === 0 ? (
        <EmptyBoard>{tab.empty}</EmptyBoard>
      ) : (
        <div className="flex flex-col gap-1.5 pb-8">
          {sortedOpen.map((item, index) => (
            <Row
              key={item.client_id}
              item={item}
              names={names}
              index={index}
              board={board}
              useFormatting={isDiscuss}
              draggable={isDiscuss && reorderActive}
              isDragOver={dragOverId === item.client_id}
              isDragging={draggedId === item.client_id}
              onDragStart={(e) => handleDragStart(e, item.client_id)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => handleDragOver(e, item.client_id)}
              onDrop={(e) => handleDrop(e, item.client_id)}
            />
          ))}

          {done.length > 0 && (
            <div className="mt-4 flex items-center gap-3">
              <span className="text-[0.6875rem] tracking-wider text-faint uppercase">
                Done · {done.length}
              </span>
              <span className="h-px flex-1 bg-hairline" />
              <button
                type="button"
                onClick={() => board.clearDone(tab.kind)}
                className="text-[0.6875rem] text-muted underline underline-offset-2 transition-colors hover:text-accent"
              >
                Clear
              </button>
            </div>
          )}

          {done.map((item, index) => (
            <Row
              key={item.client_id}
              item={item}
              names={names}
              index={index}
              board={board}
              useFormatting={isDiscuss}
              draggable={false}
              isDragOver={false}
              isDragging={false}
              onDragStart={() => {}}
              onDragEnd={() => {}}
              onDragOver={() => {}}
              onDrop={() => {}}
            />
          ))}
        </div>
      )}
    </>
  );
}

function Row({
  item,
  names,
  index,
  board,
  useFormatting,
  draggable,
  isDragOver,
  isDragging,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  item: BoardItem;
  names: Record<UserId, string>;
  index: number;
  board: ReturnType<typeof useBoard>;
  useFormatting: boolean;
  draggable: boolean;
  isDragOver: boolean;
  isDragging: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.title);
  const colors = itemClasses(item);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (!trimmed || trimmed === item.title) {
      setDraft(item.title);
      return;
    }
    void board.update(item, { title: trimmed });
  };

  return (
    <div
      className={`group animate-slide-up flex items-start gap-3 rounded-xl border border-hairline bg-surface px-3 py-2.5 transition-all ${
        item.done ? "opacity-55" : ""
      } ${isDragOver ? "ring-2 ring-accent ring-offset-1" : ""} ${
        isDragging ? "opacity-40" : ""
      }`}
      style={{ animationDelay: `${Math.min(index * 28, 300)}ms` }}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {draggable && (
        <span
          className="mt-0.5 cursor-grab text-faint"
          aria-label="Drag to reorder"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <circle cx="6" cy="4" r="1.2" fill="currentColor" />
            <circle cx="10" cy="4" r="1.2" fill="currentColor" />
            <circle cx="6" cy="8" r="1.2" fill="currentColor" />
            <circle cx="10" cy="8" r="1.2" fill="currentColor" />
            <circle cx="6" cy="12" r="1.2" fill="currentColor" />
            <circle cx="10" cy="12" r="1.2" fill="currentColor" />
          </svg>
        </span>
      )}

      <Check
        done={item.done}
        owner={ownerOf(item)}
        onToggle={() => board.toggle(item)}
      />

      <div className="min-w-0 flex-1">
        {editing ? (
          useFormatting ? (
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  commit();
                }
                if (e.key === "Escape") {
                  setDraft(item.title);
                  setEditing(false);
                }
              }}
              rows={Math.max(3, draft.split("\n").length)}
              className="w-full resize-none rounded-lg border border-hairline bg-transparent p-1 text-[0.9375rem] text-ink focus:border-accent focus:outline-none"
            />
          ) : (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") {
                  setDraft(item.title);
                  setEditing(false);
                }
              }}
              className="w-full bg-transparent text-[0.9375rem] text-ink focus:outline-none"
            />
          )
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(item.title);
              setEditing(true);
            }}
            className={`block w-full text-left text-[0.9375rem] break-words text-ink ${
              item.done ? "line-through decoration-1" : ""
            }`}
          >
            {useFormatting ? <FormattedText text={item.title} /> : item.title}
          </button>
        )}

        <div className="mt-0.5 flex items-center gap-2">
          <span
            aria-hidden
            className={`h-1.5 w-1.5 rounded-full ${colors.solid}`}
          />
          <Attribution item={item} names={names} />
        </div>
      </div>

      <DeleteButton onClick={() => board.remove(item)} />
    </div>
  );
}
