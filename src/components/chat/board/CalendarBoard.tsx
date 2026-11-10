"use client";

import { whoClass } from "@/lib/chat/colors";
import { useMemo, useState } from "react";
import {
  Attribution,
  Check,
  DeleteButton,
  EmptyBoard,
  itemClasses,
} from "./shared";
import {
  isToday,
  isoDay,
  monthGrid,
  ownerOf,
  type BoardItem,
} from "@/lib/chat/board";
import type { useBoard } from "@/lib/chat/useBoard";
import type { UserId } from "@/lib/chat/types";

interface Props {
  items: BoardItem[];
  me: UserId;
  names: Record<UserId, string>;
  board: ReturnType<typeof useBoard>;
}

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

/**
 * Month view plus the day's agenda.
 *
 * Reminders and week/month plans are the same record as everything else — an
 * `event` with a `due_at`. Selecting a day filters the list below and targets
 * the add field, so adding to a date never needs a date picker.
 */
export default function CalendarBoard({ items, names, board }: Props) {
  const [anchor, setAnchor] = useState(() => new Date());
  const [selected, setSelected] = useState(() => isoDay(new Date()));
  const [draft, setDraft] = useState("");

  const grid = useMemo(() => monthGrid(anchor), [anchor]);

  const byDay = useMemo(() => {
    const map = new Map<string, BoardItem[]>();
    for (const item of items) {
      if (!item.due_at) continue;
      const key = isoDay(new Date(item.due_at));
      const list = map.get(key);
      if (list) list.push(item);
      else map.set(key, [item]);
    }
    return map;
  }, [items]);

  const undated = useMemo(() => items.filter((i) => !i.due_at), [items]);
  const dayItems = byDay.get(selected) ?? [];

  const add = async () => {
    const title = draft.trim();
    if (!title) return;
    setDraft("");
    // Noon local, so a timezone shift can never roll the entry onto the
    // previous or next day.
    const due = new Date(`${selected}T12:00:00`);
    await board.add("event", title, { due_at: due.toISOString() });
  };

  const monthLabel = anchor.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="pb-8">
      <div className="mb-3 flex items-center gap-2">
        <Stepper
          label="Previous month"
          direction="left"
          onClick={() =>
            setAnchor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))
          }
        />
        <p className="flex-1 text-center text-[0.875rem] font-medium text-ink">
          {monthLabel}
        </p>
        <Stepper
          label="Next month"
          direction="right"
          onClick={() =>
            setAnchor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))
          }
        />
      </div>

      <div className="mb-1 grid grid-cols-7 gap-1">
        {WEEKDAYS.map((d, i) => (
          <span
            key={i}
            className="text-center text-[0.625rem] tracking-wider text-faint uppercase"
          >
            {d}
          </span>
        ))}
      </div>

      <div className="mb-5 grid grid-cols-7 gap-1">
        {grid.map((day) => {
          const key = isoDay(day);
          const inMonth = day.getMonth() === anchor.getMonth();
          const dayList = byDay.get(key) ?? [];
          const isSelected = key === selected;
          const today = isToday(day);

          return (
            <button
              key={key}
              type="button"
              onClick={() => setSelected(key)}
              className={`relative grid aspect-square place-items-center rounded-lg text-[0.75rem] transition-all hover:scale-105 ${
                isSelected
                  ? "bg-accent font-medium text-accent-ink"
                  : today
                    ? "bg-accent-soft text-accent"
                    : inMonth
                      ? "text-ink hover:bg-accent-soft"
                      : "text-faint"
              }`}
            >
              {day.getDate()}

              {dayList.length > 0 && (
                <span className="absolute bottom-1 flex gap-0.5">
                  {/* One dot per person with something on that day. */}
                  {[
                    ...new Set(
                      dayList.filter((i) => !i.done).map((i) => ownerOf(i)),
                    ),
                  ].map((u) => (
                    <span
                      key={u}
                      className={`h-1 w-1 rounded-full ${
                        isSelected ? "bg-current" : `${whoClass(u)} bg-who`
                      }`}
                    />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mb-3 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void add();
          }}
          placeholder={`Add to ${new Date(
            `${selected}T12:00:00`,
          ).toLocaleDateString(undefined, {
            day: "numeric",
            month: "short",
          })}…`}
          className="min-w-0 flex-1 rounded-2xl border border-hairline bg-surface px-4 py-2.5 text-[0.9375rem] text-ink placeholder:text-faint focus:border-accent focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void add()}
          disabled={!draft.trim()}
          title="Add"
          aria-label="Add"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-accent text-accent-ink transition-all disabled:scale-90 disabled:opacity-0"
        >
          <svg width="17" height="17" viewBox="0 0 18 18" fill="none">
            <path
              d="M9 3.5v11M3.5 9h11"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {dayItems.length === 0 && undated.length === 0 ? (
        <EmptyBoard>Nothing planned. Pick a day and add something.</EmptyBoard>
      ) : (
        <div className="flex flex-col gap-1.5">
          {dayItems.map((item, index) => (
            <EventRow
              key={item.client_id}
              item={item}
              names={names}
              index={index}
              board={board}
            />
          ))}

          {undated.length > 0 && (
            <>
              <div className="mt-4 flex items-center gap-3">
                <span className="text-[0.6875rem] tracking-wider text-faint uppercase">
                  No date
                </span>
                <span className="h-px flex-1 bg-hairline" />
              </div>
              {undated.map((item, index) => (
                <EventRow
                  key={item.client_id}
                  item={item}
                  names={names}
                  index={index}
                  board={board}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function EventRow({
  item,
  names,
  index,
  board,
}: {
  item: BoardItem;
  names: Record<UserId, string>;
  index: number;
  board: ReturnType<typeof useBoard>;
}) {
  const colors = itemClasses(item);

  return (
    <div
      className={`group animate-slide-up flex items-start gap-3 rounded-xl border-l-[3px] bg-surface px-3 py-2.5 ${
        colors.border
      } ${item.done ? "opacity-55" : ""}`}
      style={{ animationDelay: `${Math.min(index * 28, 300)}ms` }}
    >
      <Check
        done={item.done}
        owner={ownerOf(item)}
        onToggle={() => board.toggle(item)}
      />
      <div className="min-w-0 flex-1">
        <p
          className={`text-[0.9375rem] break-words text-ink ${
            item.done ? "line-through decoration-1" : ""
          }`}
        >
          {item.title}
        </p>
        <Attribution item={item} names={names} />
      </div>
      <DeleteButton onClick={() => board.remove(item)} />
    </div>
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
