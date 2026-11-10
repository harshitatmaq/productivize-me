import type { UserId } from "./types";

/**
 * Tagging someone.
 *
 * With only two people in the room, an ordinary message is already addressed
 * to the other one. A mention means something stronger: *this one needs you
 * now*. It is the only thing in the app that will interrupt someone who is not
 * looking at it, so it is deliberately something you have to type on purpose.
 *
 * Names are matched, ids are stored. The display names come from environment
 * variables and can change; re-parsing the body at read time would silently
 * un-address every message that had ever tagged someone whose name was later
 * edited.
 */

/** Always works, whichever names are configured. */
export const EVERYONE_ALIAS = "all";

/** Matches `@` followed by a run of word characters. */
const MENTION_PATTERN = /@([\p{L}\p{N}_]+)/gu;

/** Names contain spaces and punctuation; mention tokens cannot. */
export function mentionToken(name: string): string {
  const cleaned = name.replace(/[^\p{L}\p{N}_]/gu, "");
  return cleaned || "them";
}

/**
 * Resolves the mentions in a body to user ids.
 *
 * Matching is case-insensitive and tolerant of the token being only the first
 * word of a longer name, because that is what people actually type.
 */
export function parseMentions(
  body: string,
  names: Record<UserId, string>
): UserId[] {
  const found = new Set<UserId>();

  for (const match of body.matchAll(MENTION_PATTERN)) {
    const token = match[1].toLowerCase();

    if (token === EVERYONE_ALIAS) {
      Object.keys(names).forEach((id) => found.add(id));
      continue;
    }

    for (const id of Object.keys(names)) {
      const name = names[id];
      if (!name) continue;
      if (
        token === mentionToken(name).toLowerCase() ||
        token === name.split(/\s+/)[0].toLowerCase()
      ) {
        found.add(id);
      }
    }
  }

  return Array.from(found);
}

/** True when this message is an urgent ping aimed at me. */
export function mentionsMe(
  mentions: UserId[] | null | undefined,
  me: UserId
): boolean {
  return Boolean(mentions?.includes(me));
}

export interface MentionSegment {
  type: "text" | "mention";
  value: string;
  /** For mentions that resolved to one of the two of you. */
  user?: UserId;
}

/**
 * Splits text so `@name` can be rendered as a chip.
 *
 * An `@word` that matches nobody stays plain text — highlighting an email
 * address or a stray `@` would be worse than leaving it alone.
 */
export function segmentMentions(
  text: string,
  names: Record<UserId, string>
): MentionSegment[] {
  const segments: MentionSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(MENTION_PATTERN)) {
    const index = match.index ?? 0;
    const resolved = parseMentions(match[0], names);
    if (resolved.length === 0) continue;

    if (index > cursor) {
      segments.push({ type: "text", value: text.slice(cursor, index) });
    }
    segments.push({
      type: "mention",
      value: match[0],
      // `@all` resolves to both; colour it after the first, which is enough to
      // mark it as a mention without inventing a third identity colour.
      user: resolved[0],
    });
    cursor = index + match[0].length;
  }

  if (cursor < text.length) {
    segments.push({ type: "text", value: text.slice(cursor) });
  }

  return segments;
}
