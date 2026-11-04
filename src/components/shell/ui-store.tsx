"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Task } from "@/lib/types";

type QuickAddDefaults = { due_date?: string | null; text?: string };

type UiState = {
  quickAdd: QuickAddDefaults | null;
  openQuickAdd: (d?: QuickAddDefaults) => void;
  closeQuickAdd: () => void;
  editing: Task | null;
  editTask: (t: Task | null) => void;
  commandOpen: boolean;
  setCommandOpen: (o: boolean) => void;
  reviewOpen: boolean;
  setReviewOpen: (o: boolean) => void;
};

const Ctx = createContext<UiState | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [quickAdd, setQuickAdd] = useState<QuickAddDefaults | null>(null);
  const [editing, setEditing] = useState<Task | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const openQuickAdd = useCallback((d: QuickAddDefaults = {}) => setQuickAdd(d), []);
  const closeQuickAdd = useCallback(() => setQuickAdd(null), []);
  const value = useMemo(
    () => ({ quickAdd, openQuickAdd, closeQuickAdd, editing, editTask: setEditing, commandOpen, setCommandOpen, reviewOpen, setReviewOpen }),
    [quickAdd, openQuickAdd, closeQuickAdd, editing, commandOpen, reviewOpen],
  );
  return <Ctx value={value}>{children}</Ctx>;
}

export function useUi() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useUi must be used inside UiProvider");
  return v;
}
