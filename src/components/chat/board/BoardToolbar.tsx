"use client";

import { useState } from "react";

type SortMode = "manual" | "newest" | "oldest" | "mine" | "person";

interface Props {
  onSort: (mode: SortMode) => void;
  currentSort: SortMode;
  /** Whether drag-and-drop reorder is currently active. */
  reorderActive: boolean;
  onToggleReorder: () => void;
}

const SORT_OPTIONS: { value: SortMode; label: string; icon: string }[] = [
  { value: "manual", label: "Manual order", icon: "⇅" },
  { value: "newest", label: "Newest first", icon: "↓" },
  { value: "oldest", label: "Oldest first", icon: "↑" },
  { value: "mine", label: "Mine first", icon: "◉" },
  { value: "person", label: "Grouped by person", icon: "◎" },
];

export type { SortMode };

export default function BoardToolbar({
  onSort,
  currentSort,
  reorderActive,
  onToggleReorder,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="mb-3 flex items-center gap-2">
      {/* Sort / arrange menu */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          className="flex items-center gap-1.5 rounded-xl border border-hairline bg-surface px-3 py-1.5 text-[0.8125rem] text-muted transition-all hover:border-accent hover:text-accent"
          title="Sort and arrange"
          aria-label="Sort and arrange"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path
              d="M2 4h12M4 8h8M6 12h4"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
          Arrange
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            className={`transition-transform ${menuOpen ? "rotate-180" : ""}`}
          >
            <path
              d="M2.5 3.5 5 6l2.5-2.5"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {menuOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setMenuOpen(false)}
            />
            <div className="animate-slide-up absolute left-0 top-full z-50 mt-1 min-w-[11rem] rounded-xl border border-hairline bg-surface py-1 shadow-[var(--shadow)]">
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onSort(opt.value);
                    setMenuOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[0.8125rem] transition-colors hover:bg-accent-soft ${
                    currentSort === opt.value
                      ? "font-medium text-accent"
                      : "text-ink"
                  }`}
                >
                  <span className="w-4 text-center text-[0.75rem] opacity-70">
                    {opt.icon}
                  </span>
                  {opt.label}
                  {currentSort === opt.value && (
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 14 14"
                      fill="none"
                      className="ml-auto text-accent"
                    >
                      <path
                        d="M3 7l3 3 5-5"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Drag reorder toggle */}
      <button
        type="button"
        onClick={onToggleReorder}
        className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[0.8125rem] transition-all ${
          reorderActive
            ? "border-accent bg-accent-soft text-accent"
            : "border-hairline bg-surface text-muted hover:border-accent hover:text-accent"
        }`}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path
            d="M5.5 3v10M10.5 3v10M3 5.5h10M3 10.5h10"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
        {reorderActive ? "Done" : "Reorder"}
      </button>
    </div>
  );
}
