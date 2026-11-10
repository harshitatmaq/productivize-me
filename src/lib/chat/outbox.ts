"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  dequeue,
  enqueue,
  outboxEntryToMessage,
  readOutbox,
  updateOutboxEntry,
  type OutboxEntry,
} from "./db";
import { expandEmoji } from "./emoji";
import { prepareImage } from "./image";
import { parseMessage } from "./parse";
import type { Message, MessageKind, MessageRow, UserId } from "./types";

/**
 * The send queue.
 *
 * Every outgoing message lands in IndexedDB *before* any network call, then the
 * flusher drains it. That ordering is what makes offline sending work and what
 * makes a mid-send crash recoverable: nothing is ever held only in memory.
 *
 * Delivery is at-least-once at the network layer and exactly-once in the
 * database, because `messages.client_id` carries a UNIQUE constraint and every
 * insert is an `upsert ... ignoreDuplicates`. A message retried after a dropped
 * connection collapses onto the row it already created.
 */

const BUCKET = "chat-images";
const MAX_BACKOFF_MS = 30_000;
const IDLE_RETRY_MS = 15_000;

export interface OutboxHandlers {
  /** A new entry is queued and should render immediately as pending. */
  onQueued: (message: Message) => void;
  /** The row is durable in Postgres. */
  onSent: (clientId: string, row: MessageRow) => void;
  /** This attempt failed; the entry stays queued for another try. */
  onFailed: (clientId: string, error: string) => void;
}

export class Outbox {
  private supabase: SupabaseClient;
  private userId: UserId;
  private spaceId: string;
  private handlers: OutboxHandlers;

  private flushing = false;
  /** Set when a flush is requested while one is already running. */
  private flushAgain = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners: Array<() => void> = [];

  constructor(
    supabase: SupabaseClient,
    userId: UserId,
    spaceId: string,
    handlers: OutboxHandlers
  ) {
    this.supabase = supabase;
    this.userId = userId;
    this.spaceId = spaceId;
    this.handlers = handlers;
  }

  // --- lifecycle ------------------------------------------------------------

  start() {
    const kick = () => void this.flush();

    const online = () => kick();
    const visible = () => {
      if (document.visibilityState === "visible") kick();
    };

    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", visible);
    this.listeners = [
      () => window.removeEventListener("online", online),
      () => document.removeEventListener("visibilitychange", visible),
    ];

    // A slow safety net for the cases the events above miss — a connection that
    // comes back without firing `online`, or a server that was briefly 5xx-ing.
    this.timer = setInterval(kick, IDLE_RETRY_MS);

    kick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.listeners.forEach((off) => off());
    this.listeners = [];
  }

  /** Called when the realtime socket reconnects. */
  onReconnect() {
    void this.flush();
  }

  // --- queueing -------------------------------------------------------------

  async queueText(
    body: string,
    replyTo?: string | null,
    mentions?: UserId[]
  ): Promise<void> {
    // Expand again here rather than trusting the composer: pasted text and
    // programmatic sends never pass through the live keystroke handler.
    const { kind, body: parsed } = parseMessage(expandEmoji(body));
    if (!parsed) return;
    await this.push({
      body: parsed,
      kind,
      reply_to: replyTo ?? null,
      mentions: mentions ?? [],
    });
  }

  async queueImage(
    file: File,
    caption?: string,
    replyTo?: string | null
  ): Promise<void> {
    const prepared = await prepareImage(file);
    await this.push({
      body: caption?.trim() ? expandEmoji(caption.trim()) : null,
      image_blob: prepared.blob,
      image_width: prepared.width,
      image_height: prepared.height,
      extension: prepared.extension,
      reply_to: replyTo ?? null,
    });
  }

  private async push(input: {
    body?: string | null;
    kind?: MessageKind;
    image_blob?: Blob;
    image_width?: number;
    image_height?: number;
    extension?: string;
    reply_to?: string | null;
    mentions?: UserId[];
  }) {
    const entry: OutboxEntry = {
      client_id: `${crypto.randomUUID()}${
        input.extension ? `.${input.extension}` : ""
      }`,
      space_id: this.spaceId,
      sender: this.userId,
      body: input.body ?? null,
      kind: input.kind ?? "normal",
      image_blob: input.image_blob,
      image_width: input.image_width,
      image_height: input.image_height,
      reply_to: input.reply_to ?? null,
      mentions: input.mentions ?? [],
      created_at: new Date().toISOString(),
      attempts: 0,
      next_attempt_at: 0,
    };

    await enqueue(entry);
    this.handlers.onQueued(outboxEntryToMessage(entry));
    void this.flush();
  }

  /** Clears a permanently stuck entry at the user's request. */
  async discard(clientId: string): Promise<void> {
    await dequeue(clientId);
  }

  /** Retry now, ignoring backoff — for the "try again" affordance. */
  async retry(clientId: string): Promise<void> {
    const entry = (await readOutbox()).find((e) => e.client_id === clientId);
    if (!entry) return;
    await updateOutboxEntry({
      ...entry,
      attempts: 0,
      next_attempt_at: 0,
      last_error: undefined,
    });
    void this.flush();
  }

  // --- draining -------------------------------------------------------------

  async flush(): Promise<void> {
    if (this.flushing) {
      this.flushAgain = true;
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;

    this.flushing = true;
    try {
      const entries = (await readOutbox()).filter((e) => e.space_id === this.spaceId);
      const now = Date.now();

      for (const entry of entries) {
        if (entry.next_attempt_at > now) continue;
        // Strictly sequential: messages must arrive in the order they were
        // written, and a parallel drain would interleave them.
        const ok = await this.deliver(entry);
        if (!ok) break;
      }
    } finally {
      this.flushing = false;
      if (this.flushAgain) {
        this.flushAgain = false;
        void this.flush();
      }
    }
  }

  private async deliver(entry: OutboxEntry): Promise<boolean> {
    try {
      let imagePath: string | null = null;

      if (entry.image_blob) {
        // Under the dashboard's folder: storage policies check membership from it.
        imagePath = `${entry.space_id}/${entry.client_id}`;
        const { error: uploadError } = await this.supabase.storage
          .from(BUCKET)
          .upload(imagePath, entry.image_blob, {
            contentType: entry.image_blob.type || "image/webp",
            // A retry after a partially-completed send must not 409.
            upsert: true,
          });
        if (uploadError) throw uploadError;
      }

      const { error: insertError } = await this.supabase
        .from("chat_messages")
        .upsert(
          {
            space_id: entry.space_id,
            client_id: entry.client_id,
            sender: entry.sender,
            body: entry.body,
            kind: entry.kind,
            reply_to: entry.reply_to ?? null,
            mentions: entry.mentions ?? [],
            image_path: imagePath,
            image_width: entry.image_width ?? null,
            image_height: entry.image_height ?? null,
            created_at: entry.created_at,
          },
          { onConflict: "client_id", ignoreDuplicates: true }
        );
      if (insertError) throw insertError;

      // Read back the authoritative row. With `ignoreDuplicates` the upsert
      // returns nothing when the row already existed, and this also means the
      // UI settles even if the realtime event never arrives.
      const { data: row, error: selectError } = await this.supabase
        .from("chat_messages")
        .select("*")
        .eq("client_id", entry.client_id)
        .single<MessageRow>();
      if (selectError) throw selectError;

      await dequeue(entry.client_id);
      this.handlers.onSent(entry.client_id, row);
      return true;
    } catch (error) {
      const attempts = entry.attempts + 1;
      const message = error instanceof Error ? error.message : "Send failed";

      await updateOutboxEntry({
        ...entry,
        attempts,
        last_error: message,
        next_attempt_at:
          Date.now() + Math.min(MAX_BACKOFF_MS, 2 ** attempts * 500),
      });

      // Only surface a failure once the transient window has passed, so a
      // one-second network blip never flashes an error at the user.
      if (attempts >= 3) this.handlers.onFailed(entry.client_id, message);
      return false;
    }
  }
}
