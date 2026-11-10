"use client";

import { personRank } from "@/lib/chat/colors";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AddField,
  Attribution,
  DeleteButton,
  EmptyBoard,
  itemClasses,
  tiltFor,
} from "./shared";
import FormattedText from "./FormattedText";
import BoardToolbar, { type SortMode } from "./BoardToolbar";
import { clearOrder, publishOrder } from "@/lib/chat/boardLayout";
import type { BoardItem, BoardTab } from "@/lib/chat/board";
import type { useBoard } from "@/lib/chat/useBoard";
import type { UserId } from "@/lib/chat/types";

interface Props {
  items: BoardItem[];
  me: UserId;
  names: Record<UserId, string>;
  tab: BoardTab;
  board: ReturnType<typeof useBoard>;
}

export default function StickyNotes({ items, names, tab, board }: Props) {
  const [sortMode, setSortMode] = useState<SortMode>("manual");
  const [reorderActive, setReorderActive] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const list = [...items];
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
      // "manual" keeps original position order
    }
    return list;
  }, [items, sortMode]);

  // Tells the assistant what order is on screen, so "the note in row 3,
  // column 2" means the note you are actually looking at.
  useEffect(() => {
    publishOrder(
      "note",
      sorted.map((i) => i.client_id),
    );
    return () => clearOrder("note");
  }, [sorted]);

  const handleDragStart = useCallback(
    (e: React.DragEvent, clientId: string) => {
      setDraggedId(clientId);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", clientId);
      // Slightly transparent dragged element
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

      // Reorder: assign positions based on new arrangement
      const currentOrder = sorted.map((i) => i.client_id);
      const sourceIndex = currentOrder.indexOf(sourceId);
      const targetIndex = currentOrder.indexOf(targetId);
      if (sourceIndex === -1 || targetIndex === -1) return;

      // Remove source and insert at target position
      currentOrder.splice(sourceIndex, 1);
      currentOrder.splice(targetIndex, 0, sourceId);

      // One request for the whole new order. It changes `position` only, so a
      // note you merely moved is not repainted as edited by you.
      const byId = new Map(sorted.map((it) => [it.client_id, it]));
      const ordered = currentOrder.flatMap((id) => {
        const item = byId.get(id);
        return item ? [item] : [];
      });
      void board.reorder(ordered);

      setDraggedId(null);
      setDragOverId(null);
      setSortMode("manual");
    },
    [sorted, board],
  );

  return (
    <>
      <AddField
        placeholder={tab.prompt}
        onAdd={(value) => board.add("note", value)}
      />

      {items.length > 0 && (
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
        <div className="grid grid-cols-2 gap-3 pb-8 sm:grid-cols-3">
          {sorted.map((item, index) => (
            <Note
              key={item.client_id}
              item={item}
              names={names}
              index={index}
              draggable={reorderActive}
              isDragOver={dragOverId === item.client_id}
              isDragging={draggedId === item.client_id}
              onDragStart={(e) => handleDragStart(e, item.client_id)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => handleDragOver(e, item.client_id)}
              onDrop={(e) => handleDrop(e, item.client_id)}
              onSave={(title) =>
                title === item.title ? undefined : board.update(item, { title })
              }
              onDelete={() => board.remove(item)}
            />
          ))}
        </div>
      )}
    </>
  );
}

function Note({
  item,
  names,
  index,
  draggable,
  isDragOver,
  isDragging,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onSave,
  onDelete,
}: {
  item: BoardItem;
  names: Record<UserId, string>;
  index: number;
  draggable: boolean;
  isDragOver: boolean;
  isDragging: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onSave: (title: string) => void | Promise<void> | undefined;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.title);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const colors = itemClasses(item);

  // Track incoming edits from the other side, but never clobber what is being
  // typed here — that would yank text out from under the writer.
  useEffect(() => {
    if (!editing) setDraft(item.title);
  }, [item.title, editing]);

  useEffect(() => {
    if (!editing) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (!trimmed) {
      setDraft(item.title);
      return;
    }
    void onSave(trimmed);
  };

  return (
    <div
      className={`sticky-note animate-pop group relative flex min-h-[7.5rem] flex-col rounded-xl p-3 shadow-[var(--shadow)] ${colors.note} ${
        isDragOver ? "ring-2 ring-accent ring-offset-2" : ""
      } ${isDragging ? "opacity-50" : ""}`}
      style={
        {
          "--tilt": draggable ? "0deg" : tiltFor(item.client_id),
          // Staggered entrance so a full board cascades instead of snapping in.
          animationDelay: `${Math.min(index * 35, 350)}ms`,
        } as React.CSSProperties
      }
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5">
        {draggable && (
          <span className="cursor-grab text-faint" aria-label="Drag to reorder">
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
        <DeleteButton onClick={onDelete} />
      </div>

      {editing ? (
        <textarea
          ref={textareaRef}
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
          className="min-h-[4.5rem] flex-1 resize-none bg-transparent font-serif text-[0.875rem] leading-[1.45] text-ink focus:outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="flex-1 text-left"
        >
          <FormattedText
            text={item.title}
            className="font-serif text-[0.875rem] leading-[1.45] text-ink"
          />
        </button>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        <Attribution item={item} names={names} />
      </div>
    </div>
  );
}
