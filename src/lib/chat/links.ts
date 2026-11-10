/**
 * URL detection for message bodies.
 *
 * Deliberately conservative: only http and https are ever linked. Rendering a
 * `javascript:` or `data:` URL as a clickable anchor would turn a chat message
 * into a script-execution vector, and no other scheme is worth the risk here.
 */

/** Matches bare URLs and www-prefixed hosts, stopping before trailing punctuation. */
const URL_PATTERN =
  /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;

/** Punctuation that almost always belongs to the sentence, not the URL. */
const TRAILING_JUNK = /[.,;:!?)\]}'"]+$/;

export interface TextSegment {
  type: "text" | "link";
  value: string;
  /** For links: the fully-qualified href to navigate to. */
  href?: string;
}

function normalise(raw: string): string | null {
  const href = raw.startsWith("www.") ? `https://${raw}` : raw;
  try {
    const url = new URL(href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Splits a message body into plain text and link runs, in order. */
export function segmentText(body: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let lastIndex = 0;

  for (const match of body.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    let raw = match[0];

    // "see example.com/page." — the full stop ends the sentence, not the path.
    const trimmed = raw.replace(TRAILING_JUNK, "");
    const dropped = raw.length - trimmed.length;
    raw = trimmed;

    const href = normalise(raw);
    if (!href) continue;

    if (start > lastIndex) {
      segments.push({ type: "text", value: body.slice(lastIndex, start) });
    }
    segments.push({ type: "link", value: raw, href });
    lastIndex = start + raw.length + dropped - dropped;
  }

  if (lastIndex < body.length) {
    segments.push({ type: "text", value: body.slice(lastIndex) });
  }

  return segments;
}

/** The first linkable URL in a body, if any — what gets a preview card. */
export function firstUrl(body: string | null): string | null {
  if (!body) return null;
  for (const segment of segmentText(body)) {
    if (segment.type === "link" && segment.href) return segment.href;
  }
  return null;
}

/** Compact host label for a preview card, e.g. "github.com". */
export function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
