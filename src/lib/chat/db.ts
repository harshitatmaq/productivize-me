"use client";

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { BoardItem } from "./board";
import type {
  Message,
  MessageKind,
  MessageRow,
  Pin,
  PromiseNote,
  Reaction,
  UserId,
} from "./types";

/**
 * Local mirror of the conversation.
 *
 * Two jobs: paint the full history instantly on boot (network or not), and hold
 * unsent messages until they can be delivered. Everything here is disposable —
 * Postgres remains the source of truth, and clearing this store only costs a
 * re-fetch.
 */

export interface OutboxEntry {
  client_id: string;
  space_id: string;
  sender: UserId;
  body: string | null;
  kind: MessageKind;
  /** Held as a Blob so an image composed offline survives a page reload. */
  image_blob?: Blob;
  image_width?: number;
  image_height?: number;
  /** `client_id` of the message being answered. */
  reply_to?: string | null;
  /** Who the message is addressed at, resolved before queueing. */
  mentions?: UserId[];
  created_at: string;
  attempts: number;
  /** Epoch ms; the flusher skips entries until this passes (backoff). */
  next_attempt_at: number;
  last_error?: string;
}

interface ChatDB extends DBSchema {
  messages: {
    key: string; // client_id
    value: MessageRow;
    indexes: { by_created_at: string };
  };
  board: {
    key: string; // client_id
    value: BoardItem;
  };
  outbox: {
    key: string; // client_id
    value: OutboxEntry;
  };
  reactions: {
    key: [string, string, string]; // message_id, sender, emoji
    value: Reaction;
  };
  pins: {
    key: string; // message_id
    value: Pin;
  };
  promises: {
    key: string; // message_id
    value: PromiseNote;
  };
  meta: {
    key: string;
    value: unknown;
  };
}

const DB_VERSION = 3;

// One local mirror per shared dashboard (and per signed-in person on this device).
let currentKey = "";
let dbPromise: Promise<IDBPDatabase<ChatDB>> | null = null;

/** Points the mirror at a dashboard's chat. Call before anything else. */
export function setMirrorSpace(spaceId: string, userId: string) {
  const key = `pz-chat:${userId}:${spaceId}`;
  if (key === currentKey) return;
  currentKey = key;
  if (dbPromise) void dbPromise.then((d) => d.close()).catch(() => {});
  dbPromise = null;
}

function db() {
  if (!currentKey) return Promise.reject(new Error("chat mirror has no dashboard"));
  if (!dbPromise) {
    dbPromise = openDB<ChatDB>(currentKey, DB_VERSION, {
      // Guarded per store rather than switching on version, so an install at
      // any older version upgrades correctly in one pass.
      upgrade(database) {
        if (!database.objectStoreNames.contains("messages")) {
          const messages = database.createObjectStore("messages", {
            keyPath: "client_id",
          });
          messages.createIndex("by_created_at", "created_at");
        }
        if (!database.objectStoreNames.contains("outbox")) {
          database.createObjectStore("outbox", { keyPath: "client_id" });
        }
        if (!database.objectStoreNames.contains("reactions")) {
          database.createObjectStore("reactions", {
            keyPath: ["message_id", "sender", "emoji"],
          });
        }
        if (!database.objectStoreNames.contains("meta")) {
          database.createObjectStore("meta");
        }
        if (!database.objectStoreNames.contains("board")) {
          database.createObjectStore("board", { keyPath: "client_id" });
        }
        if (!database.objectStoreNames.contains("pins")) {
          database.createObjectStore("pins", { keyPath: "message_id" });
        }
        if (!database.objectStoreNames.contains("promises")) {
          database.createObjectStore("promises", { keyPath: "message_id" });
        }
      },
    });
  }
  return dbPromise;
}

/** IndexedDB is unavailable in some private-browsing modes; degrade quietly. */
async function safely<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work();
  } catch {
    return fallback;
  }
}

// --- messages ---------------------------------------------------------------

export async function cacheMessages(rows: MessageRow[]): Promise<void> {
  if (rows.length === 0) return;
  await safely(async () => {
    const tx = (await db()).transaction("messages", "readwrite");
    await Promise.all(rows.map((row) => tx.store.put(row)));
    await tx.done;
  }, undefined);
}

export async function readCachedMessages(): Promise<MessageRow[]> {
  return safely(
    async () => (await db()).getAllFromIndex("messages", "by_created_at"),
    []
  );
}

export async function dropCachedMessage(clientId: string): Promise<void> {
  await safely(async () => (await db()).delete("messages", clientId), undefined);
}

/**
 * Drops locally-mirrored messages at or before `iso` after a chat clear.
 *
 * Saved and work items are kept: they were filed deliberately, they stay
 * visible in their panels, and keeping them cached is what lets those panels
 * open offline. The rows all still exist in Postgres regardless — this only
 * reclaims local space for history this device will no longer display.
 */
export async function purgeCachedMessagesBefore(iso: string): Promise<void> {
  await safely(async () => {
    const database = await db();
    const tx = database.transaction("messages", "readwrite");
    const rows = await tx.store.getAll();

    await Promise.all(
      rows
        .filter((row) => row.kind === "normal" && row.created_at <= iso)
        .map((row) => tx.store.delete(row.client_id))
    );

    await tx.done;
  }, undefined);
}

// --- reactions --------------------------------------------------------------

export async function cacheReactions(rows: Reaction[]): Promise<void> {
  await safely(async () => {
    const tx = (await db()).transaction("reactions", "readwrite");
    await tx.store.clear();
    await Promise.all(rows.map((row) => tx.store.put(row)));
    await tx.done;
  }, undefined);
}

export async function readCachedReactions(): Promise<Reaction[]> {
  return safely(async () => (await db()).getAll("reactions"), []);
}

// --- pins and promises ------------------------------------------------------

export async function cachePins(rows: Pin[]): Promise<void> {
  await safely(async () => {
    const tx = (await db()).transaction("pins", "readwrite");
    // Authoritative replace, as for reactions: a full fetch is the source of
    // truth and merging would resurrect marks lifted on the other device.
    await tx.store.clear();
    await Promise.all(rows.map((row) => tx.store.put(row)));
    await tx.done;
  }, undefined);
}

export async function readCachedPins(): Promise<Pin[]> {
  return safely(async () => (await db()).getAll("pins"), []);
}

export async function cachePromises(rows: PromiseNote[]): Promise<void> {
  await safely(async () => {
    const tx = (await db()).transaction("promises", "readwrite");
    await tx.store.clear();
    await Promise.all(rows.map((row) => tx.store.put(row)));
    await tx.done;
  }, undefined);
}

export async function readCachedPromises(): Promise<PromiseNote[]> {
  return safely(async () => (await db()).getAll("promises"), []);
}

// --- board ------------------------------------------------------------------

export async function cacheBoardItems(items: BoardItem[]): Promise<void> {
  await safely(async () => {
    const tx = (await db()).transaction("board", "readwrite");
    // Authoritative replace: a full board fetch is the source of truth, and
    // merging would resurrect items deleted on the other device.
    await tx.store.clear();
    await Promise.all(items.map((item) => tx.store.put(item)));
    await tx.done;
  }, undefined);
}

export async function readCachedBoardItems(): Promise<BoardItem[]> {
  return safely(async () => (await db()).getAll("board"), []);
}

// --- outbox -----------------------------------------------------------------

export async function enqueue(entry: OutboxEntry): Promise<void> {
  await safely(async () => (await db()).put("outbox", entry), undefined);
}

export async function readOutbox(): Promise<OutboxEntry[]> {
  const entries = await safely<OutboxEntry[]>(
    async () => (await db()).getAll("outbox"),
    []
  );
  return entries.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function dequeue(clientId: string): Promise<void> {
  await safely(async () => (await db()).delete("outbox", clientId), undefined);
}

export async function updateOutboxEntry(entry: OutboxEntry): Promise<void> {
  await safely(async () => (await db()).put("outbox", entry), undefined);
}

// --- helpers ----------------------------------------------------------------

/** Turns an outbox entry into something the message list can render now. */
export function outboxEntryToMessage(entry: OutboxEntry): Message {
  return {
    id: `pending:${entry.client_id}`,
    space_id: entry.space_id,
    client_id: entry.client_id,
    sender: entry.sender,
    body: entry.body,
    kind: entry.kind,
    reply_to: entry.reply_to ?? null,
    mentions: entry.mentions ?? [],
    image_path: null,
    image_width: entry.image_width ?? null,
    image_height: entry.image_height ?? null,
    created_at: entry.created_at,
    deleted_at: null,
    status: entry.last_error ? "failed" : "pending",
    localImageUrl: entry.image_blob
      ? URL.createObjectURL(entry.image_blob)
      : undefined,
  };
}
