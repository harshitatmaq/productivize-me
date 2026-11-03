"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useLogFocus } from "@/lib/queries/focus";

export type FocusRun = {
  taskId: string | null;
  title: string;
  mode: "pomodoro" | "stopwatch";
  startedAt: number;
  targetMin: number | null;
};

type FocusCtx = {
  run: FocusRun | null;
  start: (opts: { taskId?: string | null; title: string; minutes?: number | null }) => void;
  finish: (opts?: { auto?: boolean }) => void;
  cancel: () => void;
};

const Ctx = createContext<FocusCtx | null>(null);
const STORAGE = "pm-focus-run";

function load(): FocusRun | null {
  try {
    const raw = localStorage.getItem(STORAGE);
    return raw ? (JSON.parse(raw) as FocusRun) : null;
  } catch {
    return null;
  }
}

function save(run: FocusRun | null) {
  try {
    if (run) localStorage.setItem(STORAGE, JSON.stringify(run));
    else localStorage.removeItem(STORAGE);
  } catch {
    // private mode etc. — the timer still works for this tab
  }
}

async function ding(title: string, body: string) {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted" && "serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration("/");
      await reg?.showNotification(title, { body, icon: "/icons/icon-192.png", badge: "/icons/badge-96.png", tag: "focus" });
    }
  } catch {
    // best effort
  }
}

export function FocusProvider({ children }: { children: ReactNode }) {
  // Restored from localStorage so a running timer survives navigation and reloads.
  const [run, setRun] = useState<FocusRun | null>(load);
  const log = useLogFocus();

  const start: FocusCtx["start"] = useCallback(({ taskId = null, title, minutes = 25 }) => {
    const next: FocusRun = { taskId, title, mode: minutes ? "pomodoro" : "stopwatch", startedAt: Date.now(), targetMin: minutes };
    setRun(next);
    save(next);
    toast(minutes ? `Focus · ${minutes} min` : "Stopwatch started", { description: title });
  }, []);

  const finish: FocusCtx["finish"] = useCallback(
    ({ auto } = {}) => {
      const current = run;
      if (!current) return;
      const end = auto && current.targetMin ? current.startedAt + current.targetMin * 60_000 : Date.now();
      const minutes = Math.round((end - current.startedAt) / 60_000);
      setRun(null);
      save(null);
      if (minutes >= 1) {
        log.mutate({
          task_id: current.taskId,
          kind: current.mode,
          started_at: new Date(current.startedAt).toISOString(),
          ended_at: new Date(end).toISOString(),
          minutes,
        });
      }
      if (auto) {
        toast.success(`Focus session done — ${minutes} min on “${current.title}”`, { description: "Take a 5-minute break." });
        ding("⏱️ Focus session done", `${minutes} min on ${current.title}. Take a short break.`);
      } else if (minutes >= 1) {
        toast.success(`Logged ${minutes} min`, { description: current.title });
      } else {
        toast("Under a minute — nothing logged");
      }
    },
    [run, log],
  );

  const cancel = useCallback(() => {
    setRun(null);
    save(null);
  }, []);

  // Keep tabs in sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => e.key === STORAGE && setRun(load());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const value = useMemo(() => ({ run, start, finish, cancel }), [run, start, finish, cancel]);
  return <Ctx value={value}>{children}</Ctx>;
}

export function useFocus() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useFocus must be used inside FocusProvider");
  return v;
}
