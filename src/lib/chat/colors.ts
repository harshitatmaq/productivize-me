/**
 * Identity colours for shared dashboards and their chat.
 *
 * Each person picks one per dashboard; nobody in the same dashboard can have
 * the same one (enforced by a unique index). Everything they add — messages,
 * notes, tasks, promises — wears it, the same on everyone's screen.
 * Only used inside Together (shared dashboards + chat), never app-wide.
 *
 * The CSS classes `who-<id>` (globals.css) set --who / --who-soft /
 * --who-ink / --who-note for light and dark themes.
 */
export const IDENTITY_COLORS = [
  { id: "green", label: "Green", swatch: "#2f7d5d" },
  { id: "purple", label: "Purple", swatch: "#6b4fa8" },
  { id: "blue", label: "Blue", swatch: "#2f6fb8" },
  { id: "coral", label: "Coral", swatch: "#c2553a" },
  { id: "amber", label: "Amber", swatch: "#a86f0c" },
  { id: "teal", label: "Teal", swatch: "#12828a" },
  { id: "pink", label: "Pink", swatch: "#b8457e" },
  { id: "slate", label: "Slate", swatch: "#556275" },
  { id: "olive", label: "Olive", swatch: "#6b7a2a" },
  { id: "indigo", label: "Indigo", swatch: "#4c57c9" },
] as const;

export type ColorId = (typeof IDENTITY_COLORS)[number]["id"];

const FALLBACK: ColorId = "slate";
let registry = new Map<string, string>();
let names = new Map<string, string>();
let me = "";

/** Called by the chat/board with the dashboard's people; used by ownerClasses(). */
export function setPeopleColors(people: { id: string; color: string | null; name?: string }[], meId?: string) {
  registry = new Map(people.map((p) => [p.id, p.color ?? FALLBACK]));
  names = new Map(people.map((p) => [p.id, p.name ?? ""]));
  if (meId) me = meId;
}

export const currentMe = () => me;

/** Board sorting: "mine first" or grouped by person (me first, then by name). */
export function personRank(userId: string, mode: "mine" | "person"): string {
  if (userId === me) return "0";
  return mode === "mine" ? "1" : `1${(names.get(userId) ?? userId).toLowerCase()}`;
}

export function colorOf(userId: string | null | undefined): string {
  return (userId && registry.get(userId)) || FALLBACK;
}

export const whoClass = (userId: string | null | undefined) => `who-${colorOf(userId)}`;
