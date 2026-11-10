"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import {
  BOARD_TABS,
  newBoardItem,
  type BoardItem,
  type BoardKind,
  type BoardMeta,
} from "./board";
import { cacheBoardItems, readCachedBoardItems } from "./db";
import type { UserId } from "./types";

/**
 * The shared workspace store.
 *
 * Board edits are applied optimistically and reverted if the write fails —
 * the same contract as reactions. They are deliberately *not* queued offline
 * the way messages are: two people editing the same note while disconnected
 * would need real conflict resolution, and quietly replaying stale edits over
 * newer ones is worse than saying "not saved". Reads still work offline from
 * the local mirror.
 */

/** Something the other person did to the workspace, worth surfacing. */
export interface BoardAlert {
  id: string;
  kind: BoardKind;
  /** Tab label, so a toast can say *where* it happened. */
  where: string;
  title: string;
  author: UserId;
  action: "added" | "updated" | "done" | "removed";
  at: string;
}

interface UseBoardResult {
  items: BoardItem[];
  loading: boolean;
  error: string | null;
  /** Changes the other person made since you last opened the workspace. */
  alerts: BoardAlert[];
  unseenCount: number;
  dismissAlert: (id: string) => void;
  /** Called when the workspace is opened: moves the watermark to now. */
  markSeen: () => void;
  add: (
    kind: BoardKind,
    title: string,
    extra?: { due_at?: string | null; meta?: BoardMeta }
  ) => Promise<void>;
  update: (item: BoardItem, patch: Partial<BoardItem>) => Promise<void>;
  /**
   * Saves a manual order. Takes the items in their new order and changes
   * `position` and nothing else, so it never repaints an item as edited.
   */
  reorder: (ordered: BoardItem[]) => Promise<void>;
  toggle: (item: BoardItem) => Promise<void>;
  remove: (item: BoardItem) => Promise<void>;
  clearDone: (kind: BoardKind) => Promise<void>;
  /** The last soft-delete, offered back for a short window. */
  pendingUndo: PendingUndo | null;
  undo: () => Promise<void>;
  dismissUndo: () => void;
}

export interface PendingUndo {
  items: BoardItem[];
  label: string;
}

/** How long the undo offer stays on screen. */
const UNDO_WINDOW_MS = 9000;
/** How long a workspace toast lingers before it fades on its own. */
const ALERT_WINDOW_MS = 7000;
/** At most this many toasts stack up; a bulk edit must not bury the chat. */
const MAX_ALERTS = 3;

let SEEN_KEY = "board-seen-at";
/** The "seen the board" watermark is per dashboard (and per device). */
export function setBoardSeenSpace(spaceId: string) {
  SEEN_KEY = `pz-board-seen:${spaceId}`;
}

function readSeenAt(): string {
  try {
    return localStorage.getItem(SEEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function useBoard(
  supabase: SupabaseClient | null,
  me: UserId,
  spaceId: string
): UseBoardResult {
  const [byId, setById] = useState<Record<string, BoardItem>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const hydratedRef = useRef(false);
  const [pendingUndo, setPendingUndo] = useState<PendingUndo | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [alerts, setAlerts] = useState<BoardAlert[]>([]);
  /**
   * Watermark for "you have seen the workspace". Read lazily rather than at
   * module scope: this hook renders on the server first, where there is no
   * localStorage at all.
   */
  const [seenAt, setSeenAt] = useState("");
  const seenAtRef = useRef("");

  useEffect(() => {
    const stored = readSeenAt();
    setSeenAt(stored);
    seenAtRef.current = stored;
  }, []);

  const applyLocal = useCallback((item: BoardItem) => {
    setById((current) => ({ ...current, [item.client_id]: item }));
  }, []);

  const dropLocal = useCallback((clientId: string) => {
    setById((current) => {
      const next = { ...current };
      delete next[clientId];
      return next;
    });
  }, []);

  // Local mirror first so the workspace opens instantly, and at all offline.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await readCachedBoardItems();
      if (cancelled || cached.length === 0) return;
      setById((current) =>
        Object.keys(current).length > 0
          ? current
          : Object.fromEntries(cached.map((i) => [i.client_id, i]))
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    if (!supabase) return;

    const { data, error: loadError } = await supabase
      .from("board_items")
      .select("*")
      .eq("space_id", spaceId)
      .is("deleted_at", null)
      .order("position", { ascending: true });

    if (loadError) {
      setError(loadError.message);
      setLoading(false);
      return;
    }

    const items = (data ?? []) as BoardItem[];
    setById(Object.fromEntries(items.map((i) => [i.client_id, i])));
    hydratedRef.current = true;
    setLoading(false);
    setError(null);
    void cacheBoardItems(items);
  }, [supabase, spaceId]);

  /**
   * Raises a toast for something the other person did.
   *
   * Only their edits, and only ones newer than the watermark — otherwise
   * ticking off your own task would announce itself back to you, and a
   * reconnect that replays recent rows would fire a burst of stale toasts.
   */
  const announce = useCallback(
    (row: BoardItem, action: BoardAlert["action"]) => {
      const actor = row.updated_by ?? row.author;
      if (actor === me) return;
      if (row.updated_at <= seenAtRef.current) return;

      const alert: BoardAlert = {
        id: `${row.client_id}:${row.updated_at}`,
        kind: row.kind,
        where: BOARD_TABS.find((t) => t.kind === row.kind)?.label ?? "Workspace",
        title: row.title,
        author: actor,
        action,
        at: row.updated_at,
      };

      setAlerts((current) =>
        current.some((a) => a.id === alert.id)
          ? current
          : [...current, alert].slice(-MAX_ALERTS)
      );
    },
    [me]
  );

  // Toasts expire on their own. One timer over the whole queue rather than one
  // per alert, so nothing is left running when the component unmounts.
  useEffect(() => {
    if (alerts.length === 0) return;
    const timer = setInterval(() => {
      const cutoff = Date.now() - ALERT_WINDOW_MS;
      setAlerts((current) =>
        current.filter((a) => new Date(a.at).getTime() > cutoff)
      );
    }, 1000);
    return () => clearInterval(timer);
  }, [alerts.length]);

  useEffect(() => {
    if (!supabase) return;
    void load();

    const channel = supabase
      .channel(`board:${spaceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "board_items", filter: `space_id=eq.${spaceId}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const old = payload.old as BoardItem & { space_id?: string };
            if (old?.space_id && old.space_id !== spaceId) return;
            if (old?.client_id) dropLocal(old.client_id);
            return;
          }

          const row = payload.new as BoardItem;
          if (row.deleted_at) {
            dropLocal(row.client_id);
            announce(row, "removed");
            return;
          }

          applyLocal(row);
          announce(
            row,
            payload.eventType === "INSERT"
              ? "added"
              : row.done
                ? "done"
                : "updated"
          );
        }
      )
      .subscribe();

    channelRef.current = channel;
    return () => {
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [supabase, spaceId, load, applyLocal, dropLocal, announce]);

  const items = useMemo(() => {
    const list = Object.values(byId).filter((i) => !i.deleted_at);
    list.sort((a, b) =>
      a.position !== b.position
        ? a.position - b.position
        : a.created_at.localeCompare(b.created_at)
    );
    return list;
  }, [byId]);

  // Persist the mirror once real data has arrived, never the empty first state.
  useEffect(() => {
    if (!hydratedRef.current) return;
    void cacheBoardItems(items);
  }, [items]);

  /**
   * How many items the other person has touched since you last looked.
   *
   * Derived from the items themselves rather than counted off the toast queue,
   * so the badge survives a reload and does not drift when toasts expire.
   */
  const unseenCount = useMemo(() => {
    if (!seenAt) return 0;
    return items.filter(
      (item) => (item.updated_by ?? item.author) !== me && item.updated_at > seenAt
    ).length;
  }, [items, me, seenAt]);

  const markSeen = useCallback(() => {
    const now = new Date().toISOString();
    seenAtRef.current = now;
    setSeenAt(now);
    setAlerts([]);
    try {
      localStorage.setItem(SEEN_KEY, now);
    } catch {
      // Private mode; the badge just will not persist across reloads.
    }
  }, []);

  const dismissAlert = useCallback((id: string) => {
    setAlerts((current) => current.filter((a) => a.id !== id));
  }, []);

  const add = useCallback<UseBoardResult["add"]>(
    async (kind, title, extra) => {
      if (!title.trim()) return;
      if (!supabase) {
        setError("You're offline — the workspace is read-only right now.");
        return;
      }

      const draft = newBoardItem(kind, me, title.trim(), {
        due_at: extra?.due_at ?? null,
        meta: extra?.meta ?? {},
      });

      const optimistic: BoardItem = {
        ...draft,
        id: `pending:${draft.client_id}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deleted_at: null,
      };
      applyLocal(optimistic);

      const { data, error: insertError } = await supabase
        .from("board_items")
        .insert({ ...draft, space_id: spaceId })
        .select()
        .single();

      if (insertError) {
        dropLocal(draft.client_id);
        setError(insertError.message);
        return;
      }
      applyLocal(data as BoardItem);
      setError(null);
    },
    [supabase, me, spaceId, applyLocal, dropLocal]
  );

  const update = useCallback<UseBoardResult["update"]>(
    async (item, patch) => {
      if (!supabase) {
        setError("You're offline — the workspace is read-only right now.");
        return;
      }

      const previous = item;
      // `updated_by` is what repaints the item in the editor's colour, and RLS
      // requires it to match the caller.
      const optimistic: BoardItem = {
        ...item,
        ...patch,
        updated_by: me,
        updated_at: new Date().toISOString(),
      };
      applyLocal(optimistic);

      const { error: updateError } = await supabase
        .from("board_items")
        .update({ ...patch, updated_by: me, updated_at: optimistic.updated_at })
        .eq("client_id", item.client_id);

      if (updateError) {
        applyLocal(previous);
        setError(updateError.message);
        return;
      }
      setError(null);
    },
    [supabase, me, applyLocal]
  );

  const reorder = useCallback<UseBoardResult["reorder"]>(
    async (ordered) => {
      if (!supabase) {
        setError("You're offline — the workspace is read-only right now.");
        return;
      }
      if (ordered.length === 0) return;

      // Small whole numbers rather than timestamps. New items are stamped with
      // the current time, which dwarfs these, so anything added after a reorder
      // lands at the end instead of being slotted into the middle.
      const entries = ordered.map((item, index) => ({
        client_id: item.client_id,
        position: index + 1,
      }));

      const positionOf = new Map(entries.map((e) => [e.client_id, e.position]));
      setById((current) => {
        const next = { ...current };
        for (const [id, position] of positionOf) {
          if (next[id]) next[id] = { ...next[id], position };
        }
        return next;
      });

      try {
        // Through the server, not straight to Postgres. A reorder changes
        // `position` only, and the update policy on this table requires
        // `updated_by` to be the person writing — which fails for any row the
        // other person last edited. See app/api/board/reorder/route.ts.
        const response = await fetch("/api/chat/reorder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order: entries, spaceId }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error ?? "Couldn't save the new order.");
        }
        setError(null);
      } catch (reorderError) {
        // Put back what was on screen before: the order was never saved, and
        // leaving it looking saved would only be undone by the next reload.
        setById((current) => {
          const next = { ...current };
          for (const item of ordered) {
            if (next[item.client_id]) {
              next[item.client_id] = { ...next[item.client_id], position: item.position };
            }
          }
          return next;
        });
        setError(
          reorderError instanceof Error
            ? reorderError.message
            : "Couldn't save the new order."
        );
      }
    },
    [supabase, spaceId]
  );

  const toggle = useCallback(
    (item: BoardItem) => update(item, { done: !item.done }),
    [update]
  );

  const dismissUndo = useCallback(() => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = null;
    setPendingUndo(null);
  }, []);

  const offerUndo = useCallback((deleted: BoardItem[], label: string) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setPendingUndo({ items: deleted, label });
    undoTimerRef.current = setTimeout(() => setPendingUndo(null), UNDO_WINDOW_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

  /**
   * Restores the last soft-deleted items.
   *
   * Clearing `deleted_at` is all that is required — the rows never left, so
   * ids, timestamps, authorship and position all come back exactly as they were
   * rather than being recreated as lookalikes.
   */
  const undo = useCallback(async () => {
    if (!supabase || !pendingUndo) return;

    const restoring = pendingUndo.items;
    dismissUndo();
    restoring.forEach((item) => applyLocal({ ...item, deleted_at: null }));

    const { error: undoError } = await supabase
      .from("board_items")
      .update({ deleted_at: null, updated_by: me })
      .in(
        "client_id",
        restoring.map((i) => i.client_id)
      );

    if (undoError) {
      restoring.forEach((item) => dropLocal(item.client_id));
      setError(undoError.message);
    }
  }, [supabase, me, pendingUndo, dismissUndo, applyLocal, dropLocal]);

  const remove = useCallback<UseBoardResult["remove"]>(
    async (item) => {
      if (!supabase) {
        setError("You're offline — the workspace is read-only right now.");
        return;
      }

      dropLocal(item.client_id);

      // Soft delete: the row stays in Postgres with `deleted_at` set. That is
      // what makes the undo below possible, and it means a mis-tapped × is
      // never unrecoverable — there is no backup underneath it otherwise.
      const { error: deleteError } = await supabase
        .from("board_items")
        .update({ deleted_at: new Date().toISOString(), updated_by: me })
        .eq("client_id", item.client_id);

      if (deleteError) {
        applyLocal(item);
        setError(deleteError.message);
        return;
      }

      offerUndo([item], "Deleted");
    },
    [supabase, me, applyLocal, dropLocal, offerUndo]
  );

  const clearDone = useCallback<UseBoardResult["clearDone"]>(
    async (kind) => {
      if (!supabase) return;
      const finished = items.filter((i) => i.kind === kind && i.done);
      if (finished.length === 0) return;

      finished.forEach((i) => dropLocal(i.client_id));
      const { error: deleteError } = await supabase
        .from("board_items")
        .update({ deleted_at: new Date().toISOString(), updated_by: me })
        .eq("kind", kind)
        .eq("done", true)
        .is("deleted_at", null);

      if (deleteError) {
        finished.forEach(applyLocal);
        setError(deleteError.message);
        return;
      }

      offerUndo(
        finished,
        `Cleared ${finished.length} item${finished.length === 1 ? "" : "s"}`
      );
    },
    [supabase, me, items, applyLocal, dropLocal, offerUndo]
  );

  return {
    items,
    loading,
    error,
    alerts,
    unseenCount,
    dismissAlert,
    markSeen,
    add,
    update,
    reorder,
    toggle,
    remove,
    clearDone,
    pendingUndo,
    undo,
    dismissUndo,
  };
}
