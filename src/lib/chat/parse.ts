import type { MessageKind } from "./types";

/**
 * Prefix routing for messages.
 *
 * A message beginning `save:` is filed under Saved, and `work:` under Work
 * items. Both are matched case-insensitively and tolerate stray whitespace, so
 * `Save:`, `WORK :` and ` save :` all land where you would expect.
 *
 * The prefix is stripped before storage: the body holds only what you meant to
 * say, and `kind` carries the routing. Keeping the marker in the text would
 * mean every list and every bubble had to strip it again at render time.
 */

const PREFIXES: [RegExp, MessageKind][] = [
  [/^\s*save\s*:\s*/i, "saved"],
  [/^\s*work\s*:\s*/i, "work"],
];

export interface ParsedMessage {
  kind: MessageKind;
  body: string;
}

export function parseMessage(input: string): ParsedMessage {
  for (const [pattern, kind] of PREFIXES) {
    if (!pattern.test(input)) continue;

    const body = input.replace(pattern, "").trim();
    // `save:` on its own carries no content worth filing — treat it as an
    // ordinary message rather than creating an empty saved entry.
    if (body.length === 0) break;

    return { kind, body };
  }

  return { kind: "normal", body: input.trim() };
}

export function kindLabel(kind: MessageKind): string {
  if (kind === "saved") return "Saved";
  if (kind === "work") return "Work";
  return "";
}
