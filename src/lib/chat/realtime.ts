"use client";

import type {
  RealtimeChannel,
  SupabaseClient,
} from "@supabase/supabase-js";
import type {
  ConnectionState,
  MessageRow,
  Pin,
  PromiseNote,
  Reaction,
  ReadState,
  UserId,
} from "./types";

/**
 * One channel carries everything live: durable row changes, presence, and the
 * typing indicator.
 *
 * Typing deliberately rides on broadcast rather than the database. It fires
 * every few keystrokes and is worthless a second later — writing it to Postgres
 * would mean constant write load and replication traffic for data nobody ever
 * reads back.
 */

const TYPING_EVENT = "typing";
/** How long a received typing signal stays live without a refresh. */
export const TYPING_TIMEOUT_MS = 4000;
/** Rate limit on outgoing typing signals. */
const TYPING_THROTTLE_MS = 2000;

export interface RealtimeHandlers {
  onMessageInsert: (row: MessageRow) => void;
  onMessageUpdate: (row: MessageRow) => void;
  onReactionInsert: (reaction: Reaction) => void;
  onReactionDelete: (reaction: Reaction) => void;
  onPinInsert: (pin: Pin) => void;
  onPinDelete: (pin: Pin) => void;
  onPromiseUpsert: (promise: PromiseNote) => void;
  onPromiseDelete: (promise: PromiseNote) => void;
  onReadState: (state: ReadState) => void;
  /** Everyone else in the dashboard who has the chat open right now. */
  onPresence: (online: UserId[]) => void;
  onTyping: (sender: UserId) => void;
  onConnectionChange: (state: ConnectionState) => void;
  /** Fired after a drop-and-recover so callers can resync and reflush. */
  onReconnect: () => void;
  /**
   * A channel-level failure, already described in plain language.
   *
   * Worth surfacing rather than swallowing: when the socket is refused, the
   * app carries on looking entirely healthy over REST, so a silent failure
   * here is indistinguishable from "nobody is typing".
   */
  onChannelError: (message: string) => void;
}

export class Realtime {
  private supabase: SupabaseClient;
  private userId: UserId;
  private spaceId: string;
  private handlers: RealtimeHandlers;

  private channel: RealtimeChannel | null = null;
  private lastTypingSentAt = 0;
  private hasConnectedOnce = false;
  /** Consecutive failed joins, for backing off the retry. */
  private failedJoins = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    supabase: SupabaseClient,
    userId: UserId,
    spaceId: string,
    handlers: RealtimeHandlers
  ) {
    this.supabase = supabase;
    this.userId = userId;
    this.spaceId = spaceId;
    this.handlers = handlers;
  }

  connect() {
    if (this.channel) return;
    this.stopped = false;

    const space = this.spaceId;
    const filter = `space_id=eq.${space}`;
    // DELETE events can't be filtered server-side; the full old row (replica
    // identity full) carries space_id, so other dashboards' events are dropped here.
    const mine = (row: { space_id?: string } | null | undefined) => row?.space_id === space;
    const channel = this.supabase.channel(`chat:${space}`, {
      config: { presence: { key: this.userId } },
    });
    this.channel = channel;

    channel
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter },
        (payload) => this.handlers.onMessageInsert(payload.new as MessageRow)
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chat_messages", filter },
        (payload) => this.handlers.onMessageUpdate(payload.new as MessageRow)
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_reactions", filter },
        (payload) => this.handlers.onReactionInsert(payload.new as Reaction)
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "chat_reactions" },
        (payload) => mine(payload.old as { space_id?: string }) && this.handlers.onReactionDelete(payload.old as Reaction)
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_pins", filter },
        (payload) => this.handlers.onPinInsert(payload.new as Pin)
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "chat_pins" },
        (payload) => mine(payload.old as { space_id?: string }) && this.handlers.onPinDelete(payload.old as Pin)
      )
      // INSERT and UPDATE land on the same handler: marking a promise and
      // ticking it off are the same upsert as far as the rail is concerned.
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_promises", filter },
        (payload) => this.handlers.onPromiseUpsert(payload.new as PromiseNote)
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chat_promises", filter },
        (payload) => this.handlers.onPromiseUpsert(payload.new as PromiseNote)
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "chat_promises" },
        (payload) => mine(payload.old as { space_id?: string }) && this.handlers.onPromiseDelete(payload.old as PromiseNote)
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chat_read_state", filter },
        (payload) => this.handlers.onReadState(payload.new as ReadState)
      )
      .on("presence", { event: "sync" }, () => this.reportPresence())
      .on("presence", { event: "join" }, () => this.reportPresence())
      .on("presence", { event: "leave" }, () => this.reportPresence())
      .on("broadcast", { event: TYPING_EVENT }, ({ payload }) => {
        if (payload?.sender && payload.sender !== this.userId) this.handlers.onTyping(payload.sender as UserId);
      })
      .subscribe((status, error) => {
        if (status === "SUBSCRIBED") {
          this.failedJoins = 0;
          this.handlers.onConnectionChange("online");
          void channel.track({ at: Date.now() });
          if (this.hasConnectedOnce) this.handlers.onReconnect();
          this.hasConnectedOnce = true;
          return;
        }

        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          this.handlers.onConnectionChange("offline");
          if (status === "CHANNEL_ERROR") {
            this.handlers.onChannelError(describeJoinError(error));
          }
          this.scheduleRejoin();
          return;
        }

        if (status === "CLOSED") {
          this.handlers.onConnectionChange("connecting");
        }
      });
  }

  /**
   * Tears the channel down and joins a fresh one, with backoff.
   *
   * The socket underneath reconnects on its own, but a channel that fails
   * during *join* — a rejected token, a `postgres_changes` binding the server
   * would not accept — stays dead, and the app would sit there looking
   * connected with nothing ever arriving again.
   */
  private scheduleRejoin() {
    if (this.stopped || this.retryTimer) return;

    this.failedJoins += 1;
    const delay = Math.min(30_000, 2 ** this.failedJoins * 1000);

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.stopped) return;

      if (this.channel) {
        void this.supabase.removeChannel(this.channel);
        this.channel = null;
      }
      this.connect();
    }, delay);
  }

  private reportPresence() {
    if (!this.channel) return;
    const state = this.channel.presenceState();
    this.handlers.onPresence(Object.keys(state).filter((id) => id !== this.userId && state[id]?.length));
  }

  /** Throttled — safe to call on every keystroke. */
  signalTyping() {
    const now = Date.now();
    if (now - this.lastTypingSentAt < TYPING_THROTTLE_MS) return;
    this.lastTypingSentAt = now;

    void this.channel?.send({
      type: "broadcast",
      event: TYPING_EVENT,
      payload: { sender: this.userId },
    });
  }

  disconnect() {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;

    if (!this.channel) return;
    void this.supabase.removeChannel(this.channel);
    this.channel = null;
    this.hasConnectedOnce = false;
  }
}

/**
 * Turns a join failure into something worth reading.
 *
 * The overwhelmingly common cause is the token: either the socket joined
 * without our JWT, or the tables were never added to the realtime publication.
 * Both look identical from here, so the message names both.
 */
function describeJoinError(error: unknown): string {
  const detail =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  return detail
    ? `Live updates were refused: ${detail}`
    : "Live updates were refused. Check that the tables are in the supabase_realtime publication.";
}
