"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cachePins,
  cachePromises,
  readCachedPins,
  readCachedPromises,
} from "./db";
import type { Message, Pin, PromiseNote, UserId } from "./types";

/**
 * Pins and promises: the two marks either of you can lay on a message.
 *
 * They live outside `messages` because the update policy there only lets you
 * edit rows you sent, and the whole point of both features is marking
 * something the *other* person wrote. Keeping them as their own rows also
 * means a mark can be lifted without touching the message it describes.
 *
 * Like reactions, edits here are optimistic and revert on failure — neither is
 * queued for offline delivery, so a mark that never landed must not linger
 * looking as though it did.
 */

/** How much of a message a pin remembers. Enough to recognise, never a wall. */
const EXCERPT_LIMIT = 180;

interface UseMarksResult {
  pins: Pin[];
  promises: PromiseNote[];
  /** Message ids, for the O(1) lookups the bubble does on every render. */
  pinnedIds: Set<string>;
  promisedIds: Set<string>;
  error: string | null;
  clearError: () => void;
  togglePin: (message: Message) => Promise<void>;
  /** Unpin from the pinned list, where only the pin row is in hand. */
  removePin: (pin: Pin) => Promise<void>;
  togglePromise: (message: Message) => Promise<void>;
  setPromiseKept: (promise: PromiseNote, kept: boolean) => Promise<void>;
  removePromise: (promise: PromiseNote) => Promise<void>;
  /** Applied from realtime events. */
  ingestPin: (pin: Pin) => void;
  dropPin: (pin: Pin) => void;
  ingestPromise: (promise: PromiseNote) => void;
  dropPromise: (promise: PromiseNote) => void;
  /** Re-read both tables after a reconnect. */
  resync: () => Promise<void>;
}

export function useMarks(
  supabase: SupabaseClient | null,
  me: UserId,
  spaceId: string,
  initialPins: Pin[],
  initialPromises: PromiseNote[]
): UseMarksResult {
  const [pins, setPins] = useState<Pin[]>(initialPins);
  const [promises, setPromises] = useState<PromiseNote[]>(initialPromises);
  const [error, setError] = useState<string | null>(null);
  /** Gates writes back to the mirror until it has been read. */
  const hydratedRef = useRef(false);

  // Local mirror first, so the pinned bar and the promise rail paint on boot
  // even with no network. Server data, when it exists, is already fresher.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [cachedPins, cachedPromises] = await Promise.all([
        readCachedPins(),
        readCachedPromises(),
      ]);
      if (!cancelled) {
        if (initialPins.length === 0 && cachedPins.length > 0) {
          setPins(cachedPins);
        }
        if (initialPromises.length === 0 && cachedPromises.length > 0) {
          setPromises(cachedPromises);
        }
      }
      hydratedRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
    // Boot-only: the initial props are a snapshot, not a live input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    void cachePins(pins);
  }, [pins]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    void cachePromises(promises);
  }, [promises]);

  const pinnedIds = useMemo(
    () => new Set(pins.map((p) => p.message_id)),
    [pins]
  );
  const promisedIds = useMemo(
    () => new Set(promises.map((p) => p.message_id)),
    [promises]
  );

  const ingestPin = useCallback((pin: Pin) => {
    setPins((current) =>
      current.some((p) => p.message_id === pin.message_id)
        ? current
        : [...current, pin]
    );
  }, []);

  const dropPin = useCallback((pin: Pin) => {
    setPins((current) =>
      current.filter((p) => p.message_id !== pin.message_id)
    );
  }, []);

  const ingestPromise = useCallback((promise: PromiseNote) => {
    setPromises((current) => {
      const index = current.findIndex(
        (p) => p.message_id === promise.message_id
      );
      if (index === -1) return [...current, promise];
      const next = current.slice();
      next[index] = promise;
      return next;
    });
  }, []);

  const dropPromise = useCallback((promise: PromiseNote) => {
    setPromises((current) =>
      current.filter((p) => p.message_id !== promise.message_id)
    );
  }, []);

  const togglePin = useCallback(
    async (message: Message) => {
      if (!supabase) {
        setError("You're offline — pins need a connection.");
        return;
      }

      const existing = pins.find((p) => p.message_id === message.id);

      if (existing) {
        dropPin(existing);
        const { error: deleteError } = await supabase
          .from("chat_pins")
          .delete()
          .eq("message_id", message.id);
        if (deleteError) {
          ingestPin(existing);
          setError("Couldn't unpin that.");
        }
        return;
      }

      const optimistic: Pin = {
        message_id: message.id,
        message_client_id: message.client_id,
        excerpt: excerptOf(message),
        author: message.sender,
        pinned_by: me,
        created_at: new Date().toISOString(),
      };
      ingestPin(optimistic);

      const { error: insertError } = await supabase
        .from("chat_pins")
        .insert(optimistic);
      if (insertError) {
        dropPin(optimistic);
        setError("Couldn't pin that.");
      }
    },
    [supabase, pins, me, ingestPin, dropPin]
  );

  const removePin = useCallback(
    async (pin: Pin) => {
      if (!supabase) {
        setError("You're offline — pins need a connection.");
        return;
      }

      dropPin(pin);
      const { error: deleteError } = await supabase
        .from("chat_pins")
        .delete()
        .eq("message_id", pin.message_id);

      if (deleteError) {
        ingestPin(pin);
        setError("Couldn't unpin that.");
      }
    },
    [supabase, ingestPin, dropPin]
  );

  const togglePromise = useCallback(
    async (message: Message) => {
      if (!supabase) {
        setError("You're offline — promises need a connection.");
        return;
      }

      const existing = promises.find((p) => p.message_id === message.id);
      if (existing) {
        dropPromise(existing);
        const { error: deleteError } = await supabase
          .from("chat_promises")
          .delete()
          .eq("message_id", message.id);
        if (deleteError) {
          ingestPromise(existing);
          setError("Couldn't remove that promise.");
        }
        return;
      }

      const optimistic: PromiseNote = {
        message_id: message.id,
        message_client_id: message.client_id,
        body: excerptOf(message),
        // The promise belongs to whoever said it, whichever of you marked it.
        promiser: message.sender,
        marked_by: me,
        kept: false,
        kept_at: null,
        due_at: null,
        created_at: new Date().toISOString(),
      };
      ingestPromise(optimistic);

      const { error: insertError } = await supabase
        .from("chat_promises")
        .insert(optimistic);
      if (insertError) {
        dropPromise(optimistic);
        setError("Couldn't mark that as a promise.");
      }
    },
    [supabase, promises, me, ingestPromise, dropPromise]
  );

  const setPromiseKept = useCallback(
    async (promise: PromiseNote, kept: boolean) => {
      if (!supabase) {
        setError("You're offline — promises need a connection.");
        return;
      }

      const kept_at = kept ? new Date().toISOString() : null;
      ingestPromise({ ...promise, kept, kept_at });

      const { error: updateError } = await supabase
        .from("chat_promises")
        .update({ kept, kept_at })
        .eq("message_id", promise.message_id);

      if (updateError) {
        ingestPromise(promise);
        setError("Couldn't update that promise.");
      }
    },
    [supabase, ingestPromise]
  );

  const removePromise = useCallback(
    async (promise: PromiseNote) => {
      if (!supabase) {
        setError("You're offline — promises need a connection.");
        return;
      }

      dropPromise(promise);
      const { error: deleteError } = await supabase
        .from("chat_promises")
        .delete()
        .eq("message_id", promise.message_id);

      if (deleteError) {
        ingestPromise(promise);
        setError("Couldn't remove that promise.");
      }
    },
    [supabase, ingestPromise, dropPromise]
  );

  const resync = useCallback(async () => {
    if (!supabase) return;
    const [pinsResult, promisesResult] = await Promise.all([
      supabase.from("chat_pins").select("*").eq("space_id", spaceId),
      supabase.from("chat_promises").select("*").eq("space_id", spaceId),
    ]);
    if (pinsResult.data) setPins(pinsResult.data as Pin[]);
    if (promisesResult.data) {
      setPromises(promisesResult.data as PromiseNote[]);
    }
  }, [supabase, spaceId]);

  const clearError = useCallback(() => setError(null), []);

  return {
    pins,
    promises,
    pinnedIds,
    promisedIds,
    error,
    clearError,
    togglePin,
    removePin,
    togglePromise,
    setPromiseKept,
    removePromise,
    ingestPin,
    dropPin,
    ingestPromise,
    dropPromise,
    resync,
  };
}

/** Photos have no text of their own; say so rather than showing a blank note. */
function excerptOf(message: Message): string {
  const body = message.body?.trim();
  if (body) return body.slice(0, EXCERPT_LIMIT);
  return message.image_path || message.localImageUrl ? "Photo" : "";
}
