/** A Productivize account id (uuid). A chat belongs to a shared dashboard. */
export type UserId = string;

/**
 * How a message was filed. `saved` and `work` come from a `save:` / `work:`
 * prefix and additionally appear in their own panels.
 */
export type MessageKind = "normal" | "saved" | "work";

/** A row as it exists in Postgres. */
export interface MessageRow {
  id: string;
  space_id: string;
  client_id: string;
  sender: UserId;
  body: string | null;
  image_path: string | null;
  image_width: number | null;
  image_height: number | null;
  kind: MessageKind;
  /** `client_id` of the message this one answers, if any. */
  reply_to: string | null;
  /** Who this message is addressed at. A mention is an urgent ping. */
  mentions: UserId[];
  created_at: string;
  deleted_at: string | null;
}

/**
 * How far a message has got. `pending` and `failed` exist only on the client —
 * they describe entries sitting in the outbox that Postgres has never seen.
 */
export type DeliveryStatus = "pending" | "failed" | "sent" | "read";

/** A message as the UI knows it: a row, plus local-only delivery state. */
export interface Message extends MessageRow {
  status: DeliveryStatus;
  /** Object URL for a queued image that has not finished uploading yet. */
  localImageUrl?: string;
}

export interface Reaction {
  message_id: string;
  sender: UserId;
  emoji: string;
}

/**
 * Marks laid on a message by either of you.
 *
 * Both carry a copy of the text they were made from, so a pinned line or a
 * promise note still reads correctly once the original has scrolled out of the
 * loaded page — or when the app is opened offline.
 */
export interface Pin {
  message_id: string;
  message_client_id: string;
  excerpt: string;
  author: UserId;
  pinned_by: UserId;
  created_at: string;
}

/** Named for the feature, not the built-in — `Promise` is already taken. */
export interface PromiseNote {
  message_id: string;
  message_client_id: string;
  body: string;
  /** Who made the promise: whoever wrote the message. */
  promiser: UserId;
  /** Who held them to it by marking it. */
  marked_by: UserId;
  kept: boolean;
  kept_at: string | null;
  due_at: string | null;
  created_at: string;
}

export interface ReadState {
  space_id: string;
  user_id: UserId;
  last_read_at: string;
  /** Messages at or before this are hidden from this person only. */
  cleared_before: string | null;
}

/** Who is in this dashboard's chat, as the client knows them. */
export interface Person {
  id: UserId;
  name: string;
  /** Identity colour id (see colors.ts) — unique within the dashboard. */
  color: string;
}

export interface ChatContext {
  spaceId: string;
  spaceName: string;
  me: UserId;
  people: Person[];
}

export type ConnectionState = "connecting" | "online" | "offline";

export const REACTION_CHOICES = ["❤️", "😂", "🥹", "🔥", "👍", "😮"] as const;
