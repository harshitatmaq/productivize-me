"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";
import { todayStr } from "@/lib/time";

/** Current local date (YYYY-MM-DD), updating at midnight and when the tab regains focus. */
export function useToday(): string {
  const [today, setToday] = useState(() => todayStr());
  useEffect(() => {
    const tick = () => setToday((prev) => (prev === todayStr() ? prev : todayStr()));
    const id = setInterval(tick, 60_000);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", tick);
    };
  }, []);
  return today;
}

export function useNowMinutes(): number {
  const [m, setM] = useState(() => new Date().getHours() * 60 + new Date().getMinutes());
  useEffect(() => {
    const id = setInterval(() => setM(new Date().getHours() * 60 + new Date().getMinutes()), 60_000);
    return () => clearInterval(id);
  }, []);
  return m;
}

/** Global single-key shortcuts that ignore typing in inputs. */
export function useHotkey(key: string, handler: (e: KeyboardEvent) => void, opts: { meta?: boolean } = {}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if (opts.meta) {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === key) {
          e.preventDefault();
          handler(e);
        }
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toLowerCase() === key) {
        e.preventDefault();
        handler(e);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [key, handler, opts.meta]);
}

export function useMediaQuery(q: string, serverValue = false): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const mq = window.matchMedia(q);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    [q],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(q).matches, () => serverValue);
}

/** Epoch ms, refreshed every `intervalMs` (keeps render pure). */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * Local state initialised from `source`, and re-initialised whenever `source`
 * changes identity (React's "adjust state when a prop changes" pattern).
 */
export function useResettableState<T, S>(source: S, init: (s: S) => T): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState(() => init(source));
  const [prev, setPrev] = useState(source);
  if (prev !== source) {
    setPrev(source);
    setState(init(source));
  }
  return [state, setState];
}

/**
 * Runs `onTrigger` once each time `value` becomes truthy (e.g. a `?new=1` deep link),
 * during render rather than in an effect.
 */
export function useTrigger(value: string | null, onTrigger: () => void) {
  const [handled, setHandled] = useState<string | null>(null);
  if (value && value !== handled) {
    setHandled(value);
    onTrigger();
  } else if (!value && handled) {
    setHandled(null);
  }
}

export function useIsStandalone(): boolean {
  return useMediaQuery("(display-mode: standalone)");
}

const noopSubscribe = () => () => {};

/** false during SSR/prerender and hydration, true once running in the browser. */
export function useMounted(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}
