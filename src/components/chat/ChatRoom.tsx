"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import Composer from "./Composer";
import ConnectionBanner from "./ConnectionBanner";
import ImageLightbox, { type LightboxImage } from "./ImageLightbox";
import MessageList from "./MessageList";
import PinnedBar from "./PinnedBar";
import PresenceHeader from "./PresenceHeader";
import PromiseRail from "./PromiseRail";
import { EmojiGuidePanel, FiledPanel, type PanelKind } from "./Panels";
import SearchPanel from "./SearchPanel";
import Toasts, { type Toast } from "./Toasts";
import Workspace from "./Workspace";
import AiChatbot from "./board/AiChatbot";
import { detectCapture, newBoardItem, type BoardKind } from "@/lib/chat/board";
import { mentionsMe, parseMentions } from "@/lib/chat/mentions";
import {
  cacheMessages,
  cacheReactions,
  outboxEntryToMessage,
  purgeCachedMessagesBefore,
  readCachedMessages,
  readCachedReactions,
  readOutbox,
} from "@/lib/chat/db";
import { Outbox } from "@/lib/chat/outbox";
import { Realtime, TYPING_TIMEOUT_MS } from "@/lib/chat/realtime";
import { sb } from "@/lib/queries/client";
import { setPeopleColors } from "@/lib/chat/colors";
import { setMirrorSpace } from "@/lib/chat/db";
import { setBoardSeenSpace } from "@/lib/chat/useBoard";
import { byCreatedAt } from "@/lib/chat/time";
import { useBoard } from "@/lib/chat/useBoard";
import { useMarks } from "@/lib/chat/useMarks";
import { useMessageAlerts } from "@/lib/chat/useMessageAlerts";
import {
  type ConnectionState,
  type Message,
  type MessageRow,
  type Pin,
  type PromiseNote,
  type Reaction,
  type ReadState,
  type ChatContext,
  type UserId,
} from "@/lib/chat/types";

interface Props {
  ctx: ChatContext;
  /** Chat or the dashboard's Board — one live connection serves both. */
  view: "chat" | "board";
  onViewChange: (view: "chat" | "board") => void;
  initialMessages: MessageRow[];
  initialReactions: Reaction[];
  initialReadState: ReadState[];
  initialPins: Pin[];
  initialPromises: PromiseNote[];
  loadError: string | null;
}

const PAGE_SIZE = 50;

export default function ChatRoom({
  ctx,
  view,
  onViewChange,
  initialMessages,
  initialReactions,
  initialReadState,
  initialPins,
  initialPromises,
  loadError,
}: Props) {
  const me = ctx.me;
  const spaceId = ctx.spaceId;
  // Point the offline mirror, board watermark and identity colours at this
  // dashboard before any hook reads them (idempotent).
  setMirrorSpace(spaceId, me);
  setBoardSeenSpace(spaceId);
  setPeopleColors(ctx.people, me);

  /**
   * Display names, keyed by id.
   *
   * Declared up here with the identities themselves because almost everything
   * below needs it — resolving `@mentions` on send, labelling quoted replies,
   * naming toasts.
   */
  const names = useMemo(
    () =>
      Object.fromEntries(ctx.people.map((p) => [p.id, p.name])) as Record<
        UserId,
        string
      >,
    [ctx.people],
  );
  const others = useMemo(
    () => ctx.people.filter((p) => p.id !== me).map((p) => p.id),
    [ctx.people, me],
  );

  // Keyed by client_id, not id. A queued message has no database id yet, so
  // client_id is the only identifier that is stable from composition through
  // delivery — which is exactly what makes the optimistic row and the real row
  // collapse into one instead of appearing twice.
  const [byClientId, setByClientId] = useState<Record<string, Message>>(() =>
    Object.fromEntries(
      initialMessages.map((row) => [row.client_id, toMessage(row)]),
    ),
  );
  const [reactions, setReactions] = useState<Reaction[]>(initialReactions);
  /** Everyone's read watermark (per person). */
  const [readAt, setReadAt] = useState<Record<UserId, string>>(() =>
    Object.fromEntries(
      initialReadState.map((r) => [r.user_id, r.last_read_at]),
    ),
  );
  /** Seen by everyone else: the earliest of the others' watermarks. */
  const partnerReadAt = useMemo(() => {
    if (!others.length) return null;
    const stamps = others.map((id) => readAt[id]);
    if (stamps.some((t) => !t)) return null;
    return stamps.reduce((min, t) => (t! < min! ? t : min));
  }, [others, readAt]) as string | null;
  /** My own clear-chat watermark. Never read from anyone else's row. */
  const [clearedBefore, setClearedBefore] = useState<string | null>(
    initialReadState.find((r) => r.user_id === me)?.cleared_before ?? null,
  );
  const [panel, setPanel] = useState<PanelKind | null>(null);
  const [workspaceTab, setWorkspaceTab] = useState<BoardKind | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  /** client_id the list should scroll to and flash after a search jump. */
  const [jumpTo, setJumpTo] = useState<string | null>(null);
  /** The message the composer is currently answering. */
  const [replyTo, setReplyTo] = useState<Message | null>(null);

  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [onlineIds, setOnlineIds] = useState<UserId[]>([]);
  const [typingIds, setTypingIds] = useState<UserId[]>([]);
  const typingTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {},
  );
  const partnerTyping = typingIds.length > 0;
  /** Read inside the outbox callback without rebuilding the subscription. */
  const onlineRef = useRef<UserId[]>([]);
  useEffect(() => {
    onlineRef.current = onlineIds;
  }, [onlineIds]);
  const [lightbox, setLightbox] = useState<LightboxImage | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [reachedStart, setReachedStart] = useState(
    initialMessages.length < PAGE_SIZE,
  );
  const [error, setError] = useState<string | null>(loadError);

  // Held in state rather than built during render: this component is
  // server-rendered once, and constructing a Supabase client there would both
  // waste the work and crash the request if the keys are missing. Every use of
  // it happens in an effect or a callback, so a null first render costs nothing.
  // Productivize's signed-in client (row level security per dashboard). This
  // component only ever renders in the browser, so it can be created up front.
  const [supabase] = useState<SupabaseClient | null>(() => sb());

  const marks = useMarks(supabase, me, spaceId, initialPins, initialPromises);
  const messageAlerts = useMessageAlerts();
  // Stable across renders; depended on directly so `markRead` — which the
  // message list re-runs as you scroll — does not change identity every frame.
  const clearMessageAlerts = messageAlerts.clear;

  /**
   * Whether the newest message is on screen.
   *
   * A ref, not state: it is read inside the realtime handler to decide whether
   * an arriving message needs announcing, and holding it as state would mean
   * rebuilding the whole realtime subscription every time you scrolled.
   */
  const atBottomRef = useRef(true);

  /**
   * The workspace store lives here, not inside the Workspace sheet.
   *
   * It has to keep running while the sheet is closed — that is the only way
   * the badge and the toasts can report a change the moment it happens, rather
   * than the next time someone thinks to open the board.
   */
  const board = useBoard(supabase, me, spaceId);

  const outboxRef = useRef<Outbox | null>(null);
  const realtimeRef = useRef<Realtime | null>(null);
  const lastMarkedReadRef = useRef<string>("");
  /** Set once the local mirror has been read, gating writes back to it. */
  const hydratedRef = useRef(false);

  // --- state helpers --------------------------------------------------------

  const upsertMessages = useCallback((incoming: Message[]) => {
    if (incoming.length === 0) return;
    setByClientId((current) => {
      const next = { ...current };
      for (const message of incoming) {
        const existing = next[message.client_id];
        // A real row always wins over the optimistic placeholder it replaces.
        if (existing?.localImageUrl && !message.localImageUrl) {
          URL.revokeObjectURL(existing.localImageUrl);
        }
        next[message.client_id] = message;
      }
      return next;
    });
  }, []);

  const patchMessage = useCallback(
    (clientId: string, patch: Partial<Message>) => {
      setByClientId((current) => {
        const existing = current[clientId];
        if (!existing) return current;
        return { ...current, [clientId]: { ...existing, ...patch } };
      });
    },
    [],
  );

  // --- boot -----------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // The cache fills in anything the server render did not cover and is the
      // entire history when the app opens offline.
      const [cachedMessages, cachedReactions, queued] = await Promise.all([
        readCachedMessages(),
        readCachedReactions(),
        readOutbox(),
      ]);
      if (cancelled) return;

      upsertMessages([
        ...cachedMessages.map(toMessage),
        // Server data is fresher than the mirror, so it is applied second.
        ...initialMessages.map(toMessage),
        ...queued.map(outboxEntryToMessage),
      ]);

      if (initialReactions.length === 0 && cachedReactions.length > 0) {
        setReactions(cachedReactions);
      }

      hydratedRef.current = true;
    })();

    return () => {
      cancelled = true;
    };
    // Boot-only: initial props are a snapshot, not a live input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the offline mirror current.
  useEffect(() => {
    if (initialMessages.length > 0) void cacheMessages(initialMessages);
  }, [initialMessages]);

  useEffect(() => {
    // Gated on hydration: this write replaces the whole store, so running it
    // with the empty initial state would erase the cached reactions the boot
    // effect is still in the middle of reading back.
    if (!hydratedRef.current) return;
    void cacheReactions(reactions);
  }, [reactions]);

  const resync = useCallback(async () => {
    if (!supabase) return;
    try {
      const [messagesResult, reactionsResult, readResult] = await Promise.all([
        supabase
          .from("chat_messages")
          .select("*")
          .eq("space_id", spaceId)
          .order("created_at", { ascending: false })
          .limit(PAGE_SIZE),
        supabase.from("chat_reactions").select("*").eq("space_id", spaceId),
        supabase.from("chat_read_state").select("*").eq("space_id", spaceId),
      ]);

      if (messagesResult.data) {
        const rows = messagesResult.data as MessageRow[];
        upsertMessages(rows.map(toMessage));
        void cacheMessages(rows);
      }
      if (reactionsResult.data) {
        setReactions(reactionsResult.data as Reaction[]);
      }
      if (readResult.data) {
        const rows = readResult.data as ReadState[];
        setReadAt(
          Object.fromEntries(rows.map((r) => [r.user_id, r.last_read_at])),
        );
        const mine = rows.find((r) => r.user_id === me);
        if (mine) setClearedBefore(mine.cleared_before);
      }
      setError(null);
    } catch {
      // Left to the next reconnect.
    }
  }, [supabase, spaceId, me, upsertMessages]);

  // --- outbox + realtime ----------------------------------------------------

  useEffect(() => {
    if (!supabase) return;

    const typingTimers = typingTimersRef.current;
    const outbox = new Outbox(supabase, me, spaceId, {
      onQueued: (message) => upsertMessages([message]),
      onSent: (clientId, row) => {
        upsertMessages([toMessage(row)]);
        void cacheMessages([row]);
        // Push it to whoever isn't looking at the chat right now.
        void fetch("/api/chat/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            spaceId,
            messageId: row.id,
            skip: onlineRef.current,
          }),
        }).catch(() => {});
      },
      onFailed: (clientId, message) => {
        patchMessage(clientId, { status: "failed" });
        setError(`Couldn't send: ${message}`);
      },
    });
    outboxRef.current = outbox;

    const realtime = new Realtime(supabase, me, spaceId, {
      onMessageInsert: (row) => {
        const message = toMessage(row);
        upsertMessages([message]);
        void cacheMessages([row]);

        // Nothing to announce when it is mine, or when you are already sitting
        // at the bottom of the conversation with the window in front of you —
        // the message is right there.
        if (row.sender === me) return;

        // Being tagged always announces itself. That is the entire difference
        // between a message and a ping: it is allowed to interrupt you even
        // when you are looking straight at the conversation.
        const urgent = mentionsMe(row.mentions, me);
        const watching =
          document.visibilityState === "visible" && atBottomRef.current;
        if (urgent || !watching) messageAlerts.announce(message, urgent);
      },
      onMessageUpdate: (row) => {
        upsertMessages([toMessage(row)]);
        void cacheMessages([row]);
      },
      onReactionInsert: (reaction) =>
        setReactions((current) =>
          current.some((r) => sameReaction(r, reaction))
            ? current
            : [...current, reaction],
        ),
      onReactionDelete: (reaction) =>
        setReactions((current) =>
          current.filter((r) => !sameReaction(r, reaction)),
        ),
      onPinInsert: marks.ingestPin,
      onPinDelete: marks.dropPin,
      onPromiseUpsert: marks.ingestPromise,
      onPromiseDelete: marks.dropPromise,
      onReadState: (state) => {
        if (state.user_id === me) {
          // Keeps a clear performed on another device in sync with this one.
          setClearedBefore(state.cleared_before);
        } else {
          setReadAt((current) => ({
            ...current,
            [state.user_id]: state.last_read_at,
          }));
        }
      },
      onPresence: setOnlineIds,
      onTyping: (sender) => {
        setTypingIds((current) =>
          current.includes(sender) ? current : [...current, sender],
        );
        const timers = typingTimersRef.current;
        if (timers[sender]) clearTimeout(timers[sender]);
        timers[sender] = setTimeout(
          () =>
            setTypingIds((current) => current.filter((id) => id !== sender)),
          TYPING_TIMEOUT_MS,
        );
      },
      onConnectionChange: setConnection,
      onChannelError: setError,
      onReconnect: () => {
        // A gap in the socket means missed rows. Re-read everything since the
        // newest message we hold, then drain anything queued during the outage.
        void resync();
        void marks.resync();
        outbox.onReconnect();
      },
    });
    realtimeRef.current = realtime;

    outbox.start();
    realtime.connect();

    const goOffline = () => setConnection("offline");
    const goOnline = () => setConnection("connecting");
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);

    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
      Object.values(typingTimers).forEach(clearTimeout);
      outbox.stop();
      realtime.disconnect();
      outboxRef.current = null;
      realtimeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, me, spaceId]);

  // --- derived --------------------------------------------------------------

  const messages = useMemo(() => {
    const clearedAt = clearedBefore ? new Date(clearedBefore).getTime() : null;

    const list = Object.values(byClientId).filter((m) => {
      if (m.deleted_at) return false;
      // Hidden for me only. The rows remain in Postgres and my partner's view
      // is untouched.
      if (clearedAt !== null && new Date(m.created_at).getTime() <= clearedAt) {
        return false;
      }
      return true;
    });
    list.sort(byCreatedAt);

    // Read state is a watermark: anything I sent before my partner last opened
    // the chat has been seen. Derived here rather than stored so a single
    // read_state update settles the whole backlog at once.
    return list.map((message) => {
      if (message.sender !== me) return message;
      if (message.status === "pending" || message.status === "failed") {
        return message;
      }
      const seen =
        partnerReadAt !== null &&
        new Date(message.created_at) <= new Date(partnerReadAt);
      return seen ? { ...message, status: "read" as const } : message;
    });
  }, [byClientId, me, partnerReadAt, clearedBefore]);

  /** Everything filed, ignoring the clear watermark — that is the point of filing. */
  const filedMessages = useMemo(
    () =>
      Object.values(byClientId)
        .filter((m) => m.kind !== "normal" && !m.deleted_at)
        .sort(byCreatedAt)
        .reverse(),
    [byClientId],
  );

  const reactionsByMessage = useMemo(() => {
    const map = new Map<string, Reaction[]>();
    for (const reaction of reactions) {
      const list = map.get(reaction.message_id);
      if (list) list.push(reaction);
      else map.set(reaction.message_id, [reaction]);
    }
    return map;
  }, [reactions]);

  // --- actions --------------------------------------------------------------

  const loadOlder = useCallback(async () => {
    if (!supabase || loadingOlder || reachedStart) return;

    const oldest = messages[0];
    if (!oldest) return;

    setLoadingOlder(true);
    try {
      const { data } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("space_id", spaceId)
        .lt("created_at", oldest.created_at)
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);

      const rows = (data ?? []) as MessageRow[];
      if (rows.length < PAGE_SIZE) setReachedStart(true);
      if (rows.length > 0) {
        upsertMessages(rows.map(toMessage));
        void cacheMessages(rows);
      }
    } finally {
      setLoadingOlder(false);
    }
  }, [supabase, spaceId, messages, loadingOlder, reachedStart, upsertMessages]);

  const markRead = useCallback(async () => {
    // Ahead of every early return below: the conversation is being looked at,
    // so the badges and toasts come down whether or not there is a receipt
    // worth writing.
    clearMessageAlerts();

    if (!supabase) return;
    const newest = messages[messages.length - 1];
    if (!newest) return;
    // Nothing to report if the newest thing in the room is already mine.
    if (newest.sender === me) return;
    if (lastMarkedReadRef.current >= newest.created_at) return;

    lastMarkedReadRef.current = newest.created_at;
    const now = new Date().toISOString();
    // Upsert: your row in this dashboard is created the first time you read it.
    const { error: updateError } = await supabase
      .from("chat_read_state")
      .upsert(
        { space_id: spaceId, user_id: me, last_read_at: now },
        { onConflict: "space_id,user_id" },
      );

    // Let a later view retry rather than pretending the receipt landed.
    if (updateError) lastMarkedReadRef.current = "";
  }, [supabase, messages, me, spaceId, clearMessageAlerts]);

  /**
   * Sends the message, and additionally files it to the workspace when it opens
   * with a capture prefix (`todo:`, `buy:`, `remind:` …).
   *
   * Both happen: the conversation keeps its record of what was said, and the
   * board gets the item. Capture is best-effort — a board write that fails must
   * never cost you the message, which is already durable in the outbox.
   */
  const sendText = useCallback(
    async (body: string) => {
      // Read and cleared together, so a slow board write below can never send
      // the *next* message as a reply to the same parent.
      const parent = replyTo;
      setReplyTo(null);

      // Resolved here, against the live names, and stored as ids — see
      // lib/mentions.ts for why the body is not re-parsed at read time.
      await outboxRef.current?.queueText(
        body,
        parent?.client_id ?? null,
        parseMentions(body, names),
      );

      const capture = detectCapture(body);
      if (!capture || !supabase) return;

      const { error: captureError } = await supabase
        .from("board_items")
        .insert({
          ...newBoardItem(capture.kind, me, capture.title),
          space_id: spaceId,
        });

      if (captureError) {
        setError(
          `Sent, but couldn't add to the board: ${captureError.message}`,
        );
      }
    },
    [supabase, me, spaceId, replyTo, names],
  );

  const sendImage = useCallback(
    async (file: File) => {
      const parent = replyTo;
      setReplyTo(null);
      try {
        await outboxRef.current?.queueImage(
          file,
          undefined,
          parent?.client_id ?? null,
        );
      } catch {
        setError("That image couldn't be read.");
      }
    },
    [replyTo],
  );

  const retryMessage = useCallback(
    async (clientId: string) => {
      patchMessage(clientId, { status: "pending" });
      setError(null);
      await outboxRef.current?.retry(clientId);
    },
    [patchMessage],
  );

  const toggleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!supabase) return;
      const mine = reactions.find(
        (r) =>
          r.message_id === messageId && r.sender === me && r.emoji === emoji,
      );

      // Optimistic, with a revert on failure — reactions are not queued for
      // offline delivery, so a failed one must not linger as if it landed.
      if (mine) {
        setReactions((current) =>
          current.filter((r) => !sameReaction(r, mine)),
        );
        const { error: deleteError } = await supabase
          .from("chat_reactions")
          .delete()
          .match({ message_id: messageId, sender: me, emoji });
        if (deleteError) setReactions((current) => [...current, mine]);
        return;
      }

      const optimistic: Reaction = { message_id: messageId, sender: me, emoji };
      setReactions((current) => [...current, optimistic]);
      const { error: insertError } = await supabase
        .from("chat_reactions")
        .insert(optimistic);
      if (insertError) {
        setReactions((current) =>
          current.filter((r) => !sameReaction(r, optimistic)),
        );
      }
    },
    [supabase, reactions, me],
  );

  const notifyTyping = useCallback(() => {
    realtimeRef.current?.signalTyping();
  }, []);

  /**
   * Jumps to a search result.
   *
   * The target is very likely outside the loaded page, and dropping it into the
   * list on its own would show it stranded between unrelated messages. Loading a
   * window either side first means you land on the result *in context* — which
   * is usually the reason you were searching.
   */
  const jumpToMessage = useCallback(
    async (target: MessageRow) => {
      setSearchOpen(false);

      if (supabase) {
        const [older, newer] = await Promise.all([
          supabase
            .from("chat_messages")
            .select("*")
            .eq("space_id", spaceId)
            .lte("created_at", target.created_at)
            .order("created_at", { ascending: false })
            .limit(25),
          supabase
            .from("chat_messages")
            .select("*")
            .eq("space_id", spaceId)
            .gt("created_at", target.created_at)
            .order("created_at", { ascending: true })
            .limit(25),
        ]);

        const rows = [
          ...((older.data ?? []) as MessageRow[]),
          ...((newer.data ?? []) as MessageRow[]),
        ];
        if (rows.length > 0) {
          upsertMessages(rows.map(toMessage));
          void cacheMessages(rows);
        }
      }

      upsertMessages([toMessage(target)]);
      setJumpTo(target.client_id);
    },
    [supabase, spaceId, upsertMessages],
  );

  /**
   * Jumps to a message identified only by its client_id.
   *
   * Used by the quoted line on a reply, by the pinned bar and by the promise
   * rail — none of which hold the message itself, only a reference to it. When
   * the target is already loaded this is a scroll; when it is not, it is
   * fetched with its surrounding window first, the same as a search result.
   */
  const jumpToClientId = useCallback(
    async (clientId: string) => {
      const loaded = byClientId[clientId];
      if (loaded && !clearedOut(loaded, clearedBefore)) {
        setJumpTo(clientId);
        return;
      }

      if (!supabase) {
        setError("That message isn't loaded, and you're offline.");
        return;
      }

      const { data } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("space_id", spaceId)
        .eq("client_id", clientId)
        .maybeSingle<MessageRow>();

      if (!data) {
        setError("Couldn't find that message.");
        return;
      }
      await jumpToMessage(data);
    },
    [byClientId, clearedBefore, supabase, spaceId, jumpToMessage],
  );

  /**
   * Hides the conversation for me alone by moving my watermark to now.
   *
   * Nothing is deleted — my partner's view is unaffected and every row stays in
   * Postgres, which is why this is safe to offer behind a single confirmation.
   */
  const clearChat = useCallback(async () => {
    if (!supabase) return;

    const now = new Date().toISOString();
    const previous = clearedBefore;
    setClearedBefore(now);

    const { error: clearError } = await supabase
      .from("chat_read_state")
      .upsert(
        { space_id: spaceId, user_id: me, cleared_before: now },
        { onConflict: "space_id,user_id" },
      );

    if (clearError) {
      // Don't leave the chat looking cleared when the watermark never persisted;
      // it would reappear on the next load and read as data loss.
      setClearedBefore(previous);
      setError("Couldn't clear the chat. Try again when you're online.");
      return;
    }

    void purgeCachedMessagesBefore(now);
  }, [supabase, me, spaceId, clearedBefore]);

  /** Returns a filed message to the ordinary conversation. */
  const unfileMessage = useCallback(
    async (message: Message) => {
      if (!supabase) return;

      patchMessage(message.client_id, { kind: "normal" });

      const { error: updateError } = await supabase
        .from("chat_messages")
        .update({ kind: "normal" })
        .eq("client_id", message.client_id);

      if (updateError) {
        patchMessage(message.client_id, { kind: message.kind });
        setError("Couldn't update that message.");
      }
    },
    [supabase, patchMessage],
  );

  /**
   * Everything currently asking for attention, in one stack.
   *
   * Messages first: a workspace change can wait, a message usually cannot.
   */
  const toasts = useMemo<Toast[]>(
    () => [
      ...messageAlerts.alerts.map((alert) => ({
        id: `message:${alert.id}`,
        author: alert.sender,
        initial: names[alert.sender].charAt(0).toUpperCase(),
        notificationTitle: alert.urgent
          ? `🔔 ${names[alert.sender]} needs you`
          : names[alert.sender],
        notificationUrl: "/chat",
        preview: alert.preview,
        urgent: alert.urgent,
        headline: (
          <>
            <span className="font-medium">{names[alert.sender]}</span>
            {alert.urgent && (
              <span className="ml-1.5 text-[0.6875rem] font-semibold tracking-wide text-urgent uppercase">
                tagged you
              </span>
            )}
          </>
        ) as React.ReactNode,
        onOpen: () => {
          messageAlerts.dismiss(alert.id);
          setJumpTo(alert.clientId);
        },
      })),
      ...board.alerts.map((alert) => ({
        id: `board:${alert.id}`,
        author: alert.author,
        initial: names[alert.author].charAt(0).toUpperCase(),
        // Says what happened and where, because a system notification has no
        // second line of context the way the in-app toast does.
        notificationTitle: `${names[alert.author]} ${BOARD_VERBS[alert.action]} something in ${alert.where}`,
        notificationUrl: "/chat?open=workspace",
        preview: alert.title,
        headline: (
          <>
            <span className="font-medium">{names[alert.author]}</span>{" "}
            {BOARD_VERBS[alert.action]} something in{" "}
            <span className="font-medium">{alert.where}</span>
          </>
        ) as React.ReactNode,
        onOpen: () => {
          board.dismissAlert(alert.id);
          openWorkspace(alert.kind);
        },
      })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messageAlerts.alerts, board.alerts, names],
  );

  const reportAtBottom = useCallback((pinned: boolean) => {
    atBottomRef.current = pinned;
  }, []);

  const dismissToast = useCallback(
    (id: string) => {
      const [source, ...rest] = id.split(":");
      const key = rest.join(":");
      if (source === "message") messageAlerts.dismiss(key);
      else board.dismissAlert(key);
    },
    [messageAlerts, board],
  );

  /** Opening the board is what marks its changes as seen. */
  const openWorkspace = useCallback(
    (tab: BoardKind) => {
      setWorkspaceTab(tab);
      board.markSeen();
      onViewChange("board");
    },
    [board, onViewChange],
  );

  // Opening the Board tab counts as having seen it.
  const markBoardSeen = board.markSeen;
  useEffect(() => {
    if (view === "board") markBoardSeen();
  }, [view, markBoardSeen]);

  const dismissError = useCallback(() => {
    setError(null);
    marks.clearError();
  }, [marks]);

  return (
    <div className="app-shell relative">
      <PresenceHeader
        title={ctx.spaceName}
        people={ctx.people}
        me={me}
        onlineIds={onlineIds}
        typingIds={typingIds}
        view={view}
        connection={connection}
        onOpenPanel={setPanel}
        onOpenWorkspace={() => openWorkspace("note")}
        onOpenSearch={() => setSearchOpen(true)}
        onClearChat={clearChat}
        workspaceUnseen={board.unseenCount}
      />

      <ConnectionBanner
        connection={connection}
        error={error ?? marks.error}
        onDismissError={dismissError}
      />

      {view === "board" ? (
        <Workspace
          board={board}
          me={me}
          names={names}
          initialTab={workspaceTab ?? "note"}
          onClose={() => onViewChange("chat")}
        />
      ) : (
        <>
          <PinnedBar
            pins={marks.pins}
            names={names}
            onJump={(clientId) => void jumpToClientId(clientId)}
            onUnpin={(pin) => void marks.removePin(pin)}
          />

          {/* One row so the promise rail can sit alongside the conversation on a
          wide screen, and so its edge tab and the workspace toasts have a
          positioned box to anchor to on a narrow one. */}
          <div className="relative flex min-h-0 flex-1">
            <MessageList
              messages={messages}
              me={me}
              names={names}
              messagesByClientId={byClientId}
              reactionsByMessage={reactionsByMessage}
              pinnedIds={marks.pinnedIds}
              promisedIds={marks.promisedIds}
              partnerTyping={partnerTyping}
              canLoadOlder={!reachedStart}
              loadingOlder={loadingOlder}
              onLoadOlder={loadOlder}
              onVisible={markRead}
              onPinnedChange={reportAtBottom}
              onToggleReaction={toggleReaction}
              onRetry={retryMessage}
              onOpenImage={setLightbox}
              onReply={setReplyTo}
              onTogglePin={(message) => void marks.togglePin(message)}
              onTogglePromise={(message) => void marks.togglePromise(message)}
              onJumpTo={(clientId) => void jumpToClientId(clientId)}
              supabase={supabase}
              jumpTo={jumpTo}
              onJumpComplete={() => setJumpTo(null)}
            />

            <PromiseRail
              promises={marks.promises}
              names={names}
              onJump={(clientId) => void jumpToClientId(clientId)}
              onToggleKept={(promise, kept) =>
                void marks.setPromiseKept(promise, kept)
              }
              onRemove={(promise) => void marks.removePromise(promise)}
            />

            <Toasts toasts={toasts} onDismiss={dismissToast} />
          </div>

          <Composer
            onSendText={sendText}
            onSendImage={sendImage}
            onTyping={notifyTyping}
            replyTo={replyTo}
            names={names}
            onCancelReply={() => setReplyTo(null)}
          />
        </>
      )}

      {lightbox && (
        <ImageLightbox image={lightbox} onClose={() => setLightbox(null)} />
      )}

      {(panel === "saved" || panel === "work") && (
        <FiledPanel
          kind={panel}
          supabase={supabase}
          fallback={filedMessages}
          me={me}
          names={names}
          onClose={() => setPanel(null)}
          onUnfile={unfileMessage}
        />
      )}

      {panel === "emoji" && <EmojiGuidePanel onClose={() => setPanel(null)} />}

      {searchOpen && (
        <SearchPanel
          supabase={supabase}
          names={names}
          clearedBefore={clearedBefore}
          onJump={jumpToMessage}
          onClose={() => setSearchOpen(false)}
        />
      )}

      <AiChatbot spaceId={spaceId} />
    </div>
  );
}

/** How a workspace change is described in its toast. */
const BOARD_VERBS: Record<string, string> = {
  added: "added",
  updated: "changed",
  done: "ticked off",
  removed: "removed",
};

function toMessage(row: MessageRow): Message {
  return { ...row, status: "sent" };
}

/** True when this message sits behind my own clear-chat watermark. */
function clearedOut(message: Message, clearedBefore: string | null): boolean {
  if (!clearedBefore) return false;
  return new Date(message.created_at) <= new Date(clearedBefore);
}

function sameReaction(a: Reaction, b: Reaction): boolean {
  return (
    a.message_id === b.message_id &&
    a.sender === b.sender &&
    a.emoji === b.emoji
  );
}
