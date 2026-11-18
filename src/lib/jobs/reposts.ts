/**
 * Reposts: the same company posting the same role again under a new link on the
 * same site. Two or more reposts often mean an evergreen or "ghost" listing.
 * Pure helpers.
 */
import { linkedinJobId } from "./liveness";
import { domainOf } from "./normalize";
import type { JobSignals } from "./types";

/** What identifies one posting on its site: LinkedIn's job id, a job id or UUID in the link, else the link. */
export function postingId(url: string): string {
  const li = linkedinJobId(url);
  if (li) return `linkedin:${li}`;
  const uuid = url.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (uuid) return `${domainOf(url)}:${uuid[0].toLowerCase()}`;
  const num = url.match(/(?:\/|=|-|_)(\d{5,})(?=[/?#&]|$)/);
  if (num) return `${domainOf(url)}:${num[1]}`;
  return url.replace(/\/(?:apply|application)\/?$/i, "");
}

/**
 * The stored job's signals with this new link counted as a repost, or null when it isn't one
 * (another site listing the same job, the same posting, or a link already counted).
 */
export function repostOf(stored: { url: string; signals?: JobSignals | null }, newUrl: string, newHash: string, now: string): JobSignals | null {
  const a = domainOf(stored.url);
  if (!a || a !== domainOf(newUrl)) return null;
  if (postingId(stored.url) === postingId(newUrl)) return null;
  const seen = stored.signals?.reposts ?? [];
  if (seen.includes(newHash)) return null;
  return { ...(stored.signals ?? {}), reposts: [...seen, newHash].slice(-10), reposted_at: now };
}

/** How many times the role was posted again. */
export const repostCount = (signals: JobSignals | null | undefined): number => signals?.reposts?.length ?? 0;
