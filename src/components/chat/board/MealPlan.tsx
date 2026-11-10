"use client";

import { useMemo, useState } from "react";
import { Attribution, itemClasses } from "./shared";
import {
  MEAL_SLOTS,
  addDays,
  isToday,
  isoDay,
  shortDay,
  startOfWeek,
  weekDays,
  type BoardItem,
  type MealSlot,
} from "@/lib/chat/board";
import type { useBoard } from "@/lib/chat/useBoard";
import type { UserId } from "@/lib/chat/types";

interface Props {
  items: BoardItem[];
  me: UserId;
  names: Record<UserId, string>;
  board: ReturnType<typeof useBoard>;
}

const SLOT_LABEL: Record<MealSlot, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
};

/**
 * The week's meals as a day × sitting grid.
 *
 * Each cell holds at most one entry, so tapping a filled cell edits it rather
 * than stacking a second meal into the same slot.
 */
export default function MealPlan({ items, names, board }: Props) {
  const [anchor, setAnchor] = useState(() => startOfWeek(new Date()));
  const days = useMemo(() => weekDays(anchor), [anchor]);

  const bySlot = useMemo(() => {
    const map = new Map<string, BoardItem>();
    for (const item of items) {
      const { date, slot } = item.meta;
      if (date && slot) map.set(`${date}|${slot}`, item);
    }
    return map;
  }, [items]);

  const label = `${days[0].toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  })} – ${days[6].toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  })}`;

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <Stepper
          label="Previous week"
          direction="left"
          onClick={() => setAnchor((d) => addDays(d, -7))}
        />
        <p className="flex-1 text-center text-[0.875rem] font-medium text-ink">
          {label}
        </p>
        <Stepper
          label="Next week"
          direction="right"
          onClick={() => setAnchor((d) => addDays(d, 7))}
        />
      </div>

      <div className="flex flex-col gap-2 pb-8">
        {days.map((day, index) => {
          const key = isoDay(day);
          const today = isToday(day);

          return (
            <section
              key={key}
              className={`animate-slide-up rounded-2xl border p-3 ${
                today
                  ? "border-accent bg-accent-soft/40"
                  : "border-hairline bg-surface"
              }`}
              style={{ animationDelay: `${index * 30}ms` }}
            >
              <h3 className="mb-2 flex items-baseline gap-2">
                <span
                  className={`text-[0.8125rem] font-medium ${
                    today ? "text-accent" : "text-ink"
                  }`}
                >
                  {shortDay(day)}
                </span>
                <span className="text-[0.6875rem] text-faint">
                  {day.getDate()}
                </span>
                {today && (
                  <span className="ml-auto text-[0.625rem] tracking-wider text-accent uppercase">
                    today
                  </span>
                )}
              </h3>

              <div className="grid gap-1.5 sm:grid-cols-3">
                {MEAL_SLOTS.map((slot) => (
                  <MealCell
                    key={slot}
                    slot={slot}
                    item={bySlot.get(`${key}|${slot}`)}
                    names={names}
                    onSet={(title) => {
                      const existing = bySlot.get(`${key}|${slot}`);
                      if (existing) {
                        if (!title) return board.remove(existing);
                        return board.update(existing, { title });
                      }
                      if (!title) return;
                      return board.add("meal", title, {
                        meta: { date: key, slot },
                      });
                    }}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

function MealCell({
  slot,
  item,
  names,
  onSet,
}: {
  slot: MealSlot;
  item: BoardItem | undefined;
  names: Record<UserId, string>;
  onSet: (title: string) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item?.title ?? "");

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed === (item?.title ?? "")) return;
    void onSet(trimmed);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(item?.title ?? "");
            setEditing(false);
          }
        }}
        placeholder={SLOT_LABEL[slot]}
        className="w-full rounded-lg border border-accent bg-surface px-2.5 py-2 text-[0.8125rem] text-ink focus:outline-none"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(item?.title ?? "");
        setEditing(true);
      }}
      className={`min-h-[3.25rem] rounded-lg px-2.5 py-2 text-left transition-transform hover:scale-[1.02] ${
        item
          ? itemClasses(item).note
          : "border border-dashed border-hairline bg-transparent"
      }`}
    >
      <span className="block text-[0.5938rem] tracking-wider text-faint uppercase">
        {SLOT_LABEL[slot]}
      </span>
      {item ? (
        <>
          <span className="mt-0.5 block text-[0.8125rem] leading-tight break-words text-ink">
            {item.title}
          </span>
          <span className="mt-1 block">
            <Attribution item={item} names={names} />
          </span>
        </>
      ) : (
        <span className="mt-0.5 block text-[0.8125rem] text-faint">+</span>
      )}
    </button>
  );
}

function Stepper({
  label,
  direction,
  onClick,
}: {
  label: string;
  direction: "left" | "right";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-accent-soft hover:text-accent"
    >
      <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
        <path
          d={direction === "left" ? "M11 4 6 9l5 5" : "M7 4l5 5-5 5"}
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
