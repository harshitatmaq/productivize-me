import type { UserId } from "./types";
import type { BoardKind, BoardMeta } from "./board";

/**
 * Turns what the assistant asked for into something safe to run.
 *
 * This module is deliberately free of I/O and of any import that needs a
 * bundler: it takes the model's raw tool-call output plus a snapshot of the
 * board and returns a plan. Keeping it pure is what makes the rules below —
 * which are the ones that stand between a language model and your data —
 * testable without a database or a model in the loop.
 *
 * The one rule that matters most: **anything that deletes is "guarded"** and is
 * never run from here. It is handed back for the user to approve.
 */

export const BOARD_KINDS: readonly BoardKind[] = [
  "note",
  "task",
  "discuss",
  "shop",
  "meal",
  "event",
];

/** Boards a person can point at by position: a grid (notes) or a list. */
const ADDRESSABLE: readonly BoardKind[] = ["note", "task", "discuss", "shop"];

const KIND_LABEL: Record<BoardKind, string> = {
  note: "Notes",
  task: "Tasks",
  discuss: "Discuss",
  shop: "Shopping",
  meal: "Meals",
  event: "Calendar",
};

const MEAL_SLOTS = ["breakfast", "lunch", "dinner"];

const KIND_ALIASES: Record<string, BoardKind> = {
  note: "note",
  notes: "note",
  sticky: "note",
  task: "task",
  tasks: "task",
  todo: "task",
  todos: "task",
  discuss: "discuss",
  discussion: "discuss",
  topic: "discuss",
  shop: "shop",
  shopping: "shop",
  grocery: "shop",
  groceries: "shop",
  meal: "meal",
  meals: "meal",
  event: "event",
  events: "event",
  calendar: "event",
  reminder: "event",
  reminders: "event",
};

/** Most actions one request may carry. A runaway reply must not become a flood. */
export const MAX_ACTIONS = 40;
export const MAX_OPS = 80;
export const MAX_PARTS = 30;
export const MAX_TITLE = 8000;
/**
 * Longest item text the model is shown in full. Anything beyond this is cut in
 * the prompt, and — because the model cannot rewrite what it has not seen — such
 * an item is refused for split and for title edits. Otherwise "split and delete
 * the original" would quietly delete the part the model never read.
 */
export const MAX_LISTED = 3000;

export interface PlanItem {
  client_id: string;
  kind: BoardKind;
  title: string;
  done: boolean;
  position: number;
  created_at: string;
  author: UserId;
  updated_by: UserId | null;
  due_at: string | null;
  meta: BoardMeta | null;
}

// --- ordering and addressing -------------------------------------------------

export interface LayoutHint {
  /** Columns the notes grid currently has on the person's screen. */
  noteColumns?: number;
  /** Item ids in the order the person's screen shows them, per board. */
  order?: Partial<Record<BoardKind, string[]>>;
}

export interface Cell {
  item: PlanItem;
  row: number;
  col: number;
  /** `R3C2` for the notes grid, `#4` for a list. */
  label: string;
}

export interface Layout {
  noteColumns: number;
  cells: Partial<Record<BoardKind, Cell[]>>;
  labels: Map<string, string>;
}

function byPosition(a: PlanItem, b: PlanItem): number {
  return a.position !== b.position
    ? a.position - b.position
    : a.created_at.localeCompare(b.created_at);
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/**
 * Lays the board out the way the person's screen does, so "row 3, column 2"
 * means the same thing to the assistant as to them.
 *
 * Order comes from what their screen reports when it can (they may have sorted
 * the notes), and falls back to manual order otherwise. Items the screen did not
 * mention are appended in manual order rather than dropped.
 *
 * All the arithmetic lives here. Language models are unreliable at
 * `(row - 1) * columns + (col - 1)`, so the model is never asked to do it: it is
 * shown a finished label for every item and told to quote labels, not compute.
 */
export function buildLayout(items: PlanItem[], hint?: LayoutHint): Layout {
  const noteColumns = clampInt(hint?.noteColumns, 1, 6, 3);
  const cells: Layout["cells"] = {};
  const labels = new Map<string, string>();

  for (const kind of ADDRESSABLE) {
    let list = items.filter((i) => i.kind === kind).sort(byPosition);

    // Lists show open items first and finished ones below a divider.
    if (kind !== "note") {
      list = [...list.filter((i) => !i.done), ...list.filter((i) => i.done)];
    }

    const wanted = hint?.order?.[kind];
    if (wanted && wanted.length > 0) {
      const byId = new Map(list.map((i) => [i.client_id, i]));
      const seen = new Set<string>();
      const ordered: PlanItem[] = [];

      for (const id of wanted) {
        const item = byId.get(id);
        if (item && !seen.has(id)) {
          ordered.push(item);
          seen.add(id);
        }
      }
      for (const item of list) {
        if (!seen.has(item.client_id)) ordered.push(item);
      }
      list = ordered;
    }

    const columns = kind === "note" ? noteColumns : 1;
    cells[kind] = list.map((item, index) => {
      const row = Math.floor(index / columns) + 1;
      const col = (index % columns) + 1;
      const label = kind === "note" ? `R${row}C${col}` : `#${index + 1}`;
      labels.set(item.client_id, label);
      return { item, row, col, label };
    });
  }

  return { noteColumns, cells, labels };
}

export function normaliseKind(value: unknown): BoardKind | null {
  if (typeof value !== "string") return null;
  return KIND_ALIASES[value.trim().toLowerCase()] ?? null;
}

function toInt(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isInteger(n) ? n : null;
}

export type Resolved =
  | { ok: true; item: PlanItem; label?: string }
  | { ok: false; reason: string };

/**
 * Finds the item an action is about, by id or by position.
 *
 * An id is tried first because it is exact. But a 36-character UUID copied by a
 * small model is exactly where transcription errors happen, so when the id does
 * not match, a row (and column) is a fully supported way to name the item.
 */
export function resolveTarget(
  layout: Layout,
  byId: Map<string, PlanItem>,
  ref: { client_id?: unknown; kind?: unknown; row?: unknown; col?: unknown }
): Resolved {
  const id = typeof ref.client_id === "string" ? ref.client_id.trim() : "";
  if (id) {
    const item = byId.get(id);
    if (item) return { ok: true, item, label: layout.labels.get(item.client_id) };
  }

  const kind = normaliseKind(ref.kind);
  const row = toInt(ref.row);

  if (kind && ADDRESSABLE.includes(kind) && row !== null) {
    const cells = layout.cells[kind] ?? [];

    if (kind === "note") {
      const col = toInt(ref.col);
      if (col === null || col < 1 || col > layout.noteColumns) {
        return {
          ok: false,
          reason: `column ${col ?? "?"} doesn't exist — the notes grid has ${layout.noteColumns} columns`,
        };
      }
      if (row < 1) return { ok: false, reason: `row ${row} doesn't exist` };

      const cell = cells[(row - 1) * layout.noteColumns + (col - 1)];
      if (!cell) {
        return { ok: false, reason: `there is no note at row ${row}, column ${col}` };
      }
      return { ok: true, item: cell.item, label: cell.label };
    }

    const cell = row >= 1 ? cells[row - 1] : undefined;
    if (!cell) {
      return { ok: false, reason: `there is no item #${row} in ${KIND_LABEL[kind]}` };
    }
    return { ok: true, item: cell.item, label: cell.label };
  }

  return {
    ok: false,
    reason: id ? "that id doesn't match any item" : "no item was identified",
  };
}

// --- operations --------------------------------------------------------------

export interface NewItem {
  client_id: string;
  kind: BoardKind;
  title: string;
  due_at: string | null;
  meta: BoardMeta;
  position: number;
}

export interface UpdatePatch {
  title?: string;
  due_at?: string | null;
  done?: boolean;
}

/**
 * One concrete, already-validated change. `desc` is the past-tense sentence
 * reported once it has run, written at plan time so reporting needs no lookup.
 *
 * Authorship is deliberately absent: whoever *runs* an op is the author of it,
 * which is what stops the assistant stamping changes as the wrong person.
 */
export type Op =
  | { op: "add"; desc: string; item: NewItem }
  | { op: "update"; desc: string; client_id: string; patch: UpdatePatch }
  | { op: "remove"; desc: string; client_id: string };

export interface Plan {
  /** Safe to run now. */
  immediate: Op[];
  /** Deletes, together with anything that must not run unless they do. */
  guarded: Op[];
  /** Things asked for that could not be done — shown, never swallowed. */
  problems: string[];
}

export function preview(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function cleanMeta(value: unknown): BoardMeta {
  if (!value || typeof value !== "object") return {};
  const raw = value as Record<string, unknown>;
  const meta: BoardMeta = {};

  if (typeof raw.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.date)) {
    meta.date = raw.date;
  }
  if (typeof raw.slot === "string" && MEAL_SLOTS.includes(raw.slot)) {
    meta.slot = raw.slot as BoardMeta["slot"];
  }
  if (typeof raw.qty === "string") meta.qty = raw.qty.slice(0, 80);
  return meta;
}

// --- dates, in the person's timezone --------------------------------------------
//
// The server runs in UTC, the person does not. "Today" and "the 14th" are only
// meaningful in *their* zone: at 1am in India it is still yesterday in UTC, and
// noon-UTC on a date is already the next day in New Zealand. So the browser
// sends its zone, and every date decision below is made in it.

/** A valid IANA zone name, else UTC. */
export function safeZone(tz: unknown): string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

function zoneParts(instantMs: number, tz: string) {
  const out: Record<string, number> = {};
  for (const p of new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(instantMs))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM-DD of an instant, as seen in `tz`. */
export function dayIn(instant: Date | string | number, tz: string): string {
  const p = zoneParts(new Date(instant).getTime(), tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** The instant at which the wall clock in `tz` reads the given local time. */
function zonedInstant(
  y: number,
  m: number,
  d: number,
  hh: number,
  mm: number,
  ss: number,
  tz: string
): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm, ss);
  const seen = zoneParts(guess, tz);
  const asIfUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second);
  return new Date(guess - (asIfUtc - guess));
}

/** Noon on `day` (YYYY-MM-DD) in `tz` — how the calendar anchors a dated entry. */
export function noonIn(day: string, tz: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return zonedInstant(y, m, d, 12, 0, 0, tz);
}

/** `day` plus `n` calendar days. Done at noon UTC so no DST shift can skip a day. */
export function addDaysISO(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10);
}

export function weekdayOf(day: string, style: "short" | "long" = "short"): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US", {
    weekday: style,
    timeZone: "UTC",
  });
}

function parseDue(value: unknown, tz: string): { iso: string | null; bad: boolean } {
  if (value === undefined || value === null || value === "") {
    return { iso: null, bad: false };
  }
  if (typeof value !== "string") return { iso: null, bad: true };
  const text = value.trim();

  // A bare date means "that day": noon in the person's zone, so no timezone can
  // roll it onto a neighbouring day. Matches how the calendar stores entries.
  // The round trip rejects dates that don't exist, like 2026-02-31.
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const date = noonIn(text, tz);
    return dayIn(date, tz) === text
      ? { iso: date.toISOString(), bad: false }
      : { iso: null, bad: true };
  }

  // A time with no zone on it means the person's local time, not the server's.
  const local = text.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (local) {
    const [y, m, d, hh, mm, ss] = local.slice(1).map((n) => Number(n ?? 0));
    const date = zonedInstant(y, m, d, hh, mm, ss, tz);
    return dayIn(date, tz) === `${local[1]}-${local[2]}-${local[3]}`
      ? { iso: date.toISOString(), bad: false }
      : { iso: null, bad: true };
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime())
    ? { iso: null, bad: true }
    : { iso: date.toISOString(), bad: false };
}

export interface PlanContext {
  items: PlanItem[];
  layout: Layout;
  /** Epoch ms, passed in so positions are deterministic under test. */
  now: number;
  /** The person's IANA timezone; dates the model gives are read in it. */
  tz?: string;
  newId?: () => string;
}

/**
 * Splits a model's action list into what may run now and what needs approval.
 *
 * Every id and position is checked against the real board. A reference that
 * resolves to nothing is reported back as a problem instead of being dropped,
 * so a mis-aimed request never looks like it worked.
 */
export function planActions(raw: unknown, ctx: PlanContext): Plan {
  const plan: Plan = { immediate: [], guarded: [], problems: [] };
  const byId = new Map(ctx.items.map((i) => [i.client_id, i]));
  const newId = ctx.newId ?? (() => globalThis.crypto.randomUUID());
  const tz = safeZone(ctx.tz);

  if (!Array.isArray(raw)) {
    plan.problems.push("I couldn't read my own action plan. Please try rephrasing.");
    return plan;
  }
  if (raw.length > MAX_ACTIONS) {
    plan.problems.push(
      `That's more than I'll do at once (limit ${MAX_ACTIONS}); I ignored the rest.`
    );
  }

  let seq = 0;
  const guardedRemoves = new Set<string>();
  const total = () => plan.immediate.length + plan.guarded.length;

  const nameOf = (item: PlanItem, label?: string) =>
    label ? `${label} “${preview(item.title, 40)}”` : `“${preview(item.title, 40)}”`;

  for (const entry of raw.slice(0, MAX_ACTIONS)) {
    if (!entry || typeof entry !== "object") continue;
    const a = entry as Record<string, unknown>;
    const action = typeof a.action === "string" ? a.action.trim().toLowerCase() : "";

    switch (action) {
      case "add": {
        const kind = normaliseKind(a.kind);
        const title = typeof a.title === "string" ? a.title.trim() : "";
        if (!kind) {
          plan.problems.push("I wasn't sure which board to add to.");
          break;
        }
        if (!title) {
          plan.problems.push(`I was asked to add to ${KIND_LABEL[kind]} but had nothing to write.`);
          break;
        }
        if (title.length > MAX_TITLE) {
          plan.problems.push("That text is too long for me to add.");
          break;
        }
        if (total() + 1 > MAX_OPS) break;

        const due = parseDue(a.due_at, tz);
        if (due.bad) plan.problems.push(`I couldn't read the date for “${preview(title, 30)}”, so I left it undated.`);

        plan.immediate.push({
          op: "add",
          desc: `Added “${preview(title, 40)}” to ${KIND_LABEL[kind]}`,
          item: {
            client_id: newId(),
            kind,
            title,
            due_at: due.iso,
            meta: cleanMeta(a.meta),
            position: ctx.now + seq++,
          },
        });
        break;
      }

      case "update":
      case "toggle": {
        const found = resolveTarget(ctx.layout, byId, a);
        if (!found.ok) {
          plan.problems.push(`Couldn't ${action} an item: ${found.reason}.`);
          break;
        }
        const { item, label } = found;
        const patch: UpdatePatch = {};

        if (action === "toggle") {
          // Resolved to an explicit value now, so running it twice cannot flip
          // it back.
          patch.done = !item.done;
        } else {
          if (typeof a.title === "string" && a.title.trim()) {
            if (item.title.length > MAX_LISTED) {
              plan.problems.push(
                `${nameOf(item, label)} is too long for me to rewrite safely, so I left its text alone.`
              );
            } else if (a.title.trim().length > MAX_TITLE) {
              plan.problems.push("That replacement text is too long.");
            } else {
              patch.title = a.title.trim();
            }
          }
          if (a.due_at !== undefined) {
            const due = parseDue(a.due_at, tz);
            if (due.bad) plan.problems.push(`I couldn't read that date for ${nameOf(item, label)}.`);
            else patch.due_at = due.iso;
          }
          if (typeof a.done === "boolean") patch.done = a.done;
        }

        if (Object.keys(patch).length === 0) {
          plan.problems.push(`There was nothing to change on ${nameOf(item, label)}.`);
          break;
        }
        if (total() + 1 > MAX_OPS) break;

        plan.immediate.push({
          op: "update",
          client_id: item.client_id,
          patch,
          desc:
            action === "toggle"
              ? `Marked ${nameOf(item, label)} ${patch.done ? "done" : "not done"}`
              : `Updated ${nameOf(item, label)}`,
        });
        break;
      }

      case "remove": {
        const found = resolveTarget(ctx.layout, byId, a);
        if (!found.ok) {
          plan.problems.push(`Couldn't delete an item: ${found.reason}.`);
          break;
        }
        if (guardedRemoves.has(found.item.client_id)) break;
        if (total() + 1 > MAX_OPS) break;

        guardedRemoves.add(found.item.client_id);
        plan.guarded.push({
          op: "remove",
          client_id: found.item.client_id,
          desc: `Deleted ${nameOf(found.item, found.label)}`,
        });
        break;
      }

      case "split": {
        const found = resolveTarget(ctx.layout, byId, a);
        if (!found.ok) {
          plan.problems.push(`Couldn't split an item: ${found.reason}.`);
          break;
        }
        const { item, label } = found;

        if (!ADDRESSABLE.includes(item.kind)) {
          plan.problems.push(`I can only split notes and list items, not ${KIND_LABEL[item.kind]} entries.`);
          break;
        }

        const parts = (Array.isArray(a.parts) ? a.parts : [])
          .filter((p): p is string => typeof p === "string")
          .map((p) => p.trim())
          .filter(Boolean);

        if (parts.length < 2) {
          plan.problems.push(`Splitting ${nameOf(item, label)} needs at least two pieces.`);
          break;
        }
        if (parts.length > MAX_PARTS) {
          plan.problems.push(`I won't split into more than ${MAX_PARTS} pieces at once.`);
          break;
        }
        if (parts.some((p) => p.length > MAX_TITLE)) {
          plan.problems.push("One of the pieces is too long.");
          break;
        }

        const keepOriginal = a.keep_original === true;

        // Deleting the original after splitting a text the model only saw part
        // of would delete the unseen part. Refuse rather than lose it.
        if (!keepOriginal && item.title.length > MAX_LISTED) {
          plan.problems.push(
            `${nameOf(item, label)} is too long for me to split and replace safely. Nothing was changed.`
          );
          break;
        }
        if (total() + parts.length + 1 > MAX_OPS) {
          plan.problems.push("That split is too big to do in one go.");
          break;
        }

        // New pieces take the original's place: strictly between it and the
        // next item, in order. Positions are doubles precisely so this needs no
        // renumbering of the rest of the board.
        const target = keepOriginal ? plan.immediate : plan.guarded;
        const base = item.position;
        parts.forEach((text, i) => {
          target.push({
            op: "add",
            desc: `Added “${preview(text, 40)}” to ${KIND_LABEL[item.kind]}`,
            item: {
              client_id: newId(),
              kind: item.kind,
              title: text,
              due_at: item.due_at,
              meta: {},
              position: base + (i + 1) / (parts.length + 1),
            },
          });
        });

        if (!keepOriginal && !guardedRemoves.has(item.client_id)) {
          guardedRemoves.add(item.client_id);
          plan.guarded.push({
            op: "remove",
            client_id: item.client_id,
            desc: `Deleted the original ${nameOf(item, label)}`,
          });
        }
        break;
      }

      default:
        if (action) plan.problems.push(`I don't know how to “${action}”.`);
    }
  }

  return plan;
}

// --- what the person is asked to approve ---------------------------------------

export interface ProposalLine {
  text: string;
  label?: string;
}

export interface ProposalView {
  heading: string;
  deletes: ProposalLine[];
  creates: ProposalLine[];
}

/**
 * The words on the approval card.
 *
 * Built from the real rows, not from anything the model wrote: the text a
 * person is shown beside "delete" is what is actually stored, so a model that
 * paraphrased — or was talked into something by a note's contents — cannot make
 * the card say something milder than what will happen.
 */
export function describeProposal(
  guarded: Op[],
  byId: Map<string, PlanItem>,
  layout: Layout
): ProposalView {
  const deletes: ProposalLine[] = [];
  const creates: ProposalLine[] = [];

  for (const op of guarded) {
    if (op.op === "remove") {
      const item = byId.get(op.client_id);
      deletes.push({
        label: layout.labels.get(op.client_id),
        text: item ? preview(item.title, 220) : "(item no longer exists)",
      });
    } else if (op.op === "add") {
      creates.push({ label: KIND_LABEL[op.item.kind], text: preview(op.item.title, 220) });
    }
  }

  const d = deletes.length;
  const c = creates.length;
  const noun = (n: number) => (n === 1 ? "item" : "items");

  let heading: string;
  if (c > 0 && d > 0) {
    heading = `Add ${c} new ${noun(c)} and delete ${d} ${noun(d)}?`;
  } else if (d > 0) {
    heading = `Delete ${d} ${noun(d)}?`;
  } else {
    heading = `Add ${c} ${noun(c)}?`;
  }

  return { heading, deletes, creates };
}

// --- the prompt ----------------------------------------------------------------

function quoted(text: string): string {
  // JSON quoting keeps a note containing quotes, newlines or something that
  // looks like prompt structure from breaking out of its own line.
  if (text.length <= MAX_LISTED) return JSON.stringify(text);
  return `${JSON.stringify(text.slice(0, MAX_LISTED))} [TRUNCATED — ${text.length - MAX_LISTED} more characters not shown]`;
}

/** The board, as the model sees it. */
export function renderBoards(
  items: PlanItem[],
  layout: Layout,
  names: Record<UserId, string>,
  tz: string = "UTC"
): string {
  const who = (i: PlanItem) => names[i.updated_by ?? i.author];
  const out: string[] = [];

  const notes = layout.cells.note ?? [];
  out.push(
    `### Notes (${notes.length}) — shown to the user as a grid with ${layout.noteColumns} columns. Rows and columns are 1-based.`
  );
  out.push(
    notes.length
      ? notes
          .map((c) => `- ${c.label} (id: ${c.item.client_id}, by: ${who(c.item)}): ${quoted(c.item.title)}`)
          .join("\n")
      : "None"
  );

  for (const kind of ["task", "discuss", "shop"] as const) {
    const cells = layout.cells[kind] ?? [];
    out.push(`\n### ${KIND_LABEL[kind]} (${cells.length}) — a single column, numbered from the top`);
    out.push(
      cells.length
        ? cells
            .map(
              (c) =>
                `- ${c.label} ${c.item.done ? "✅" : "⬜"} (id: ${c.item.client_id}, by: ${who(c.item)}): ${quoted(c.item.title)}`
            )
            .join("\n")
        : "None"
    );
  }

  const meals = items.filter((i) => i.kind === "meal").sort(byPosition);
  out.push(`\n### Meals (${meals.length})`);
  out.push(
    meals.length
      ? meals
          .map(
            (m) =>
              `- ${quoted(m.title)} for ${m.meta?.slot ?? "?"} on ${m.meta?.date ?? "?"} (id: ${m.client_id})`
          )
          .join("\n")
      : "None"
  );

  const events = items.filter((i) => i.kind === "event").sort(byPosition);
  out.push(`\n### Calendar Events (${events.length})`);
  out.push(
    events.length
      ? events
          .map(
            (e) =>
              `- ${e.done ? "✅" : "⬜"} ${quoted(e.title)} due: ${e.due_at ? dayIn(e.due_at, tz) : "no date"} (id: ${e.client_id})`
          )
          .join("\n")
      : "None"
  );

  return out.join("\n");
}
