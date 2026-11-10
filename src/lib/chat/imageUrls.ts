"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Signed-URL cache for images in the private Storage bucket.
 *
 * URLs are minted for a week and memoised per path, so scrolling back through
 * history does not re-sign the same image on every render. The service worker
 * caches the fetched bytes separately, which is what makes already-seen photos
 * appear offline.
 */

const TTL_SECONDS = 60 * 60 * 24 * 7;
/** Re-sign this long before expiry rather than serving a URL about to die. */
const REFRESH_MARGIN_MS = 60 * 60 * 1000;

interface Entry {
  url: string;
  expiresAt: number;
}

const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<string | null>>();

export async function getSignedImageUrl(
  supabase: SupabaseClient,
  path: string
): Promise<string | null> {
  const cached = cache.get(path);
  if (cached && cached.expiresAt - REFRESH_MARGIN_MS > Date.now()) {
    return cached.url;
  }

  const pending = inFlight.get(path);
  if (pending) return pending;

  const request = (async () => {
    try {
      const { data, error } = await supabase.storage
        .from("chat-images")
        .createSignedUrl(path, TTL_SECONDS);

      if (error || !data?.signedUrl) return null;

      cache.set(path, {
        url: data.signedUrl,
        expiresAt: Date.now() + TTL_SECONDS * 1000,
      });
      return data.signedUrl;
    } finally {
      inFlight.delete(path);
    }
  })();

  inFlight.set(path, request);
  return request;
}
