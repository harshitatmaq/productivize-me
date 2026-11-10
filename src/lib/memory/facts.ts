/**
 * Personal memory: short statements about how you like to work, what you like
 * and what you believe in. Pure functions (shared by the server, UI and tests).
 *
 * - "You" facts come from your own words and start trusted.
 * - "Learned" facts come from how you use the app; they need evidence, start as
 *   suggestions you confirm unless the evidence is strong, grow when they're seen
 *   again, and fade when they stop being true.
 */
import { matchRoutine, type Routine } from "@/lib/planning";

export type FactKind = "schedule" | "habit" | "work_style" | "like" | "dislike" | "value" | "goal" | "life";
export const FACT_KINDS: { id: FactKind; label: string; hint: string }[] = [
  { id: "schedule", label: "Timing", hint: "When you like to do things" },
  { id: "habit", label: "Habits", hint: "What you tend to do" },
  {
    id: "work_style",
    label: "How you work",
    hint: "Session length, breaks, focus",
  },
  { id: "like", label: "Likes", hint: "Things you enjoy or prefer" },
  { id: "dislike", label: "Dislikes", hint: "Things to avoid" },
  { id: "value", label: "Beliefs & values", hint: "What matters to you" },
  { id: "goal", label: "Goals", hint: "What you're working towards" },
  { id: "life", label: "Life", hint: "Context that shapes your days" },
];
const KIND_IDS = new Set(FACT_KINDS.map((k) => k.id));

export type FactEvidence = { label: string; at: string };
export type Fact = {
  id: string;
  kind: FactKind;
  statement: string;
  key: string;
  confidence: number;
  status: "active" | "suggested" | "rejected";
  source: "you" | "learned";
  pinned: boolean;
  evidence: FactEvidence[];
  evidence_count: number;
  routine: Omit<Routine, "id"> | null;
  last_seen_at: string | null;
  created_at?: string;
  updated_at?: string;
};

/** Learned facts at or above this are used straight away; below it they're asked about first. */
export const AUTO_ACTIVE = 75;
/** Learned facts below this aren't worth keeping. */
export const MIN_KEEP = 45;
/** Unseen learned facts start fading after this many days. */
export const FADE_AFTER_DAYS = 45;

const STOP = new Set(
  "a an the and or but of to in on at for with by from is are be being been usually often always tends tend likes like prefers prefer they their them he she his her you your i my me around about after before during every each most mostly".split(
    " ",
  ),
);

/** Normalised form used to spot the same statement twice ("Reads after 22:30" ≈ "reads after 22:30."). */
export function factKey(statement: string): string {
  const words = statement
    .toLowerCase()
    .replace(/[^a-z0-9:+# ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w));
  return ([...new Set(words)].sort().join(" ") || statement.toLowerCase().trim()).slice(0, 240);
}

/** How sure, in words, for prompts and the UI. */
export function confidenceWord(c: number): "sure" | "likely" | "maybe" {
  return c >= 85 ? "sure" : c >= 60 ? "likely" : "maybe";
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const isTime = (s: unknown): s is string => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

export function sanitizeRoutine(r: unknown): Omit<Routine, "id"> | null {
  const o = (r ?? null) as Record<string, unknown> | null;
  if (!o || !isTime(o.start) || !isTime(o.end) || typeof o.label !== "string" || !o.label.trim()) return null;
  return {
    label: o.label.trim().slice(0, 60),
    keywords: (Array.isArray(o.keywords) ? o.keywords : [])
      .map((k) => String(k).trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 15),
    start: o.start,
    end: o.end,
    days: (Array.isArray(o.days) ? o.days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
  };
}

/** What the AI proposes after reading your activity and words. */
export type FactProposal = {
  /** An existing fact this confirms. */
  id?: string;
  statement: string;
  kind?: string;
  confidence?: number;
  /** True only when you said it yourself. */
  stated?: boolean;
  evidence?: string;
  routine?: unknown;
  /** An existing fact this one shows is no longer true. */
  contradicts?: string;
};

export type FactOp = { op: "insert"; row: Omit<Fact, "id"> } | { op: "update"; id: string; patch: Partial<Fact> } | { op: "delete"; id: string };

/**
 * Turns proposals into database changes, following the trust rules:
 * your own words → active; learned ≥75 → active; 45–74 → suggested; below → dropped.
 * Rejected facts are never brought back; pinned and "you" facts are never weakened by learning.
 */
export function planFactUpdates(existing: Fact[], proposals: FactProposal[], opts: { now: string; weaken?: { id: string; reason?: string }[] }): FactOp[] {
  const ops: FactOp[] = [];
  const byId = new Map(existing.map((f) => [f.id, f]));
  const byKey = new Map(existing.map((f) => [f.key, f]));
  const touched = new Map<string, Partial<Fact>>();
  const patch = (f: Fact, p: Partial<Fact>) => touched.set(f.id, { ...(touched.get(f.id) ?? {}), ...p });
  const current = (f: Fact) => ({ ...f, ...(touched.get(f.id) ?? {}) }) as Fact;
  const ev = (label: string | undefined): FactEvidence[] => (label?.trim() ? [{ label: label.trim().slice(0, 160), at: opts.now }] : []);
  const weaken = (f: Fact, by: number) => {
    const c = current(f);
    if (c.pinned || c.source === "you" || c.status === "rejected") return;
    const confidence = clamp(c.confidence - by);
    if (confidence < MIN_KEEP - 5) {
      touched.delete(f.id);
      ops.push({ op: "delete", id: f.id });
      byId.delete(f.id);
    } else
      patch(f, {
        confidence,
        ...(c.status === "active" && confidence < 60 ? { status: "suggested" as const } : {}),
      });
  };

  for (const p of proposals.slice(0, 12)) {
    const statement = String(p.statement ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 240);
    if (statement.length < 3) continue;
    const key = factKey(statement);
    const kind = (KIND_IDS.has(p.kind as FactKind) ? p.kind : "habit") as FactKind;
    const proposed = clamp(Number.isFinite(Number(p.confidence)) ? Number(p.confidence) : 60);
    const routine = sanitizeRoutine(p.routine);

    if (p.contradicts && byId.has(p.contradicts)) weaken(byId.get(p.contradicts)!, p.stated ? 60 : 25);

    const match = (p.id && byId.get(p.id)) || byKey.get(key);
    if (match && byId.has(match.id)) {
      const c = current(match);
      if (c.status === "rejected") continue;
      const confidence = p.stated ? Math.max(c.confidence, 90) : clamp(Math.max(c.confidence, c.confidence * 0.6 + proposed * 0.4) + 5);
      const evidence = [...ev(p.evidence), ...c.evidence].slice(0, 12);
      patch(match, {
        confidence,
        evidence,
        evidence_count: c.evidence_count + 1,
        last_seen_at: opts.now,
        ...(c.status === "suggested" && (p.stated || confidence >= AUTO_ACTIVE) ? { status: "active" as const } : {}),
        ...(p.stated ? { source: "you" as const } : {}),
        ...(routine && !c.routine ? { routine } : {}),
      });
      continue;
    }

    const confidence = p.stated ? Math.max(proposed, 90) : proposed;
    if (!p.stated && confidence < MIN_KEEP) continue;
    const row: Omit<Fact, "id"> = {
      kind,
      statement,
      key,
      confidence,
      status: p.stated || confidence >= AUTO_ACTIVE ? "active" : "suggested",
      source: p.stated ? "you" : "learned",
      pinned: false,
      evidence: ev(p.evidence),
      evidence_count: 1,
      routine,
      last_seen_at: opts.now,
    };
    ops.push({ op: "insert", row });
    byKey.set(key, { ...row, id: `new:${key}` } as Fact);
  }

  for (const w of opts.weaken ?? []) {
    const f = byId.get(w.id);
    if (f) weaken(f, 15);
  }

  // Fade learned facts that haven't been seen for a while.
  const fadeBefore = Date.parse(opts.now) - FADE_AFTER_DAYS * 86_400_000;
  for (const f of existing) {
    if (!byId.has(f.id) || touched.has(f.id)) continue;
    if (f.source !== "learned" || f.pinned || f.status === "rejected") continue;
    if (f.last_seen_at && Date.parse(f.last_seen_at) < fadeBefore) weaken(f, 5);
  }

  for (const [id, p] of touched) if (byId.has(id)) ops.push({ op: "update", id, patch: p });
  return ops;
}

const KINDS_FOR: Record<"planning" | "jobs" | "learning" | "general", FactKind[]> = {
  planning: ["schedule", "habit", "work_style", "dislike", "value", "goal", "life"],
  jobs: ["like", "dislike", "value", "goal", "work_style", "life"],
  learning: ["like", "goal", "habit", "schedule", "work_style", "value"],
  general: ["schedule", "habit", "work_style", "like", "dislike", "value", "goal", "life"],
};

/** The lines an AI prompt gets: active facts for this purpose, pinned and most certain first. */
export function factLines(facts: Fact[], purpose: keyof typeof KINDS_FOR, max = 20): string[] {
  const kinds = new Set(KINDS_FOR[purpose]);
  return facts
    .filter((f) => f.status === "active" && (kinds.has(f.kind) || f.pinned))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || Number(b.source === "you") - Number(a.source === "you") || b.confidence - a.confidence)
    .slice(0, max)
    .map((f) => `${f.statement}${f.source === "you" ? " (they said so)" : ` (${confidenceWord(f.confidence)}, noticed ${f.evidence_count}×)`}`);
}

// ---------------------------------------------------------------------------
// Behaviour digest: turns raw activity into a few factual sentences.
// ---------------------------------------------------------------------------

export type ActivityInput = {
  tz: string;
  done: {
    title: string;
    tags?: string[] | null;
    completed_at: string | null;
    actual_minutes?: number | null;
  }[];
  carried: { title: string; tags?: string[] | null; carry_count: number }[];
  focus: { started_at: string; minutes: number }[];
  workouts: { date: string; status: string; created_at: string }[];
  learning: { created_at: string; minutes?: number | null; title: string }[];
  routines?: Routine[];
};

const DAY_NAMES = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

function localParts(iso: string, tz: string): { hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  return {
    hour,
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd),
  };
}

const hh = (h: number) => `${String(((h % 24) + 24) % 24).padStart(2, "0")}:00`;

/** The 3-hour window holding most of these hours, if it holds at least `min` of them. */
export function peakWindow(hours: number[], min = 0.6, width = 3): { from: number; to: number; share: number; count: number } | null {
  if (hours.length < 4) return null;
  let best = { from: 0, count: 0 };
  for (let s = 0; s < 24; s++) {
    const count = hours.filter((h) => (h - s + 24) % 24 < width).length;
    if (count > best.count) best = { from: s, count };
  }
  const share = best.count / hours.length;
  return share >= min
    ? {
        from: best.from,
        to: (best.from + width) % 24,
        share,
        count: best.count,
      }
    : null;
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const TOPIC_STOP = new Set(
  "the a an and or to of for in on at with my do get make finish start call send email check update review new task tasks day days today tomorrow week up out about from".split(
    " ",
  ),
);
function topics(title: string, tags?: string[] | null): string[] {
  const words = title
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter((w) => w.length > 2 && !TOPIC_STOP.has(w) && !/^\d+$/.test(w));
  return [...new Set([...(tags ?? []).map((t) => `#${t.toLowerCase()}`), ...words])];
}

/** Factual sentences about patterns in the last couple of months (no guesses — the AI interprets them). */
export function digestActivity(a: ActivityInput): string[] {
  const out: string[] = [];
  const done = a.done.filter((t) => t.completed_at);
  const at = (iso: string) => localParts(iso, a.tz);

  // When tasks get finished overall.
  const allHours = done.map((t) => at(t.completed_at!).hour);
  const overall = peakWindow(allHours, 0.4, 4);
  if (overall) out.push(`Finishes most tasks between ${hh(overall.from)} and ${hh(overall.to)} (${overall.count} of ${allHours.length}).`);
  if (done.length >= 10) {
    const byDay = Array(7).fill(0) as number[];
    for (const t of done) byDay[at(t.completed_at!).weekday]++;
    const weekend = byDay[0] + byDay[6];
    if (weekend / done.length < 0.08) out.push(`Rarely finishes tasks at the weekend (${weekend} of ${done.length}).`);
  }

  // Topics: when they get done, how long they take.
  const groups = new Map<string, { hours: number[]; minutes: number[] }>();
  for (const t of done) {
    const { hour } = at(t.completed_at!);
    for (const k of topics(t.title, t.tags)) {
      const g = groups.get(k) ?? { hours: [], minutes: [] };
      g.hours.push(hour);
      if (t.actual_minutes && t.actual_minutes > 0) g.minutes.push(t.actual_minutes);
      groups.set(k, g);
    }
  }
  const ranked = [...groups].filter(([, g]) => g.hours.length >= 4).sort((x, y) => y[1].hours.length - x[1].hours.length);
  let topicLines = 0;
  for (const [k, g] of ranked) {
    if (topicLines >= 6) break;
    const w = peakWindow(g.hours, 0.65);
    const typical = g.minutes.length >= 3 ? median(g.minutes) : 0;
    if (!w && !typical) continue;
    out.push(
      `Tasks about “${k}”: ${g.hours.length} done${w ? `, ${w.count} of them between ${hh(w.from)} and ${hh(w.to)}` : ""}${typical ? `, usually taking about ${typical} min` : ""}.`,
    );
    topicLines++;
  }

  // Routines that don't match what actually happens.
  for (const r of a.routines ?? []) {
    const matched = done.filter((t) => matchRoutine(t, [r]));
    if (matched.length < 4) continue;
    const start = Number(r.start.slice(0, 2));
    const end = Number(r.end.slice(0, 2)) + (r.end.slice(3) === "00" ? 0 : 1);
    const inside = matched.filter((t) => {
      const h = at(t.completed_at!).hour;
      return end > start ? h >= start && h <= end : h >= start || h <= end;
    }).length;
    if (inside / matched.length < 0.4) {
      const w = peakWindow(
        matched.map((t) => at(t.completed_at!).hour),
        0.5,
      );
      out.push(
        `Their routine “${r.label}” is set for ${r.start}–${r.end}, but only ${inside} of ${matched.length} matching tasks were finished then${w ? `; most were finished between ${hh(w.from)} and ${hh(w.to)}` : ""}.`,
      );
    }
  }

  // Focus sessions.
  if (a.focus.length >= 4) {
    const w = peakWindow(
      a.focus.map((f) => at(f.started_at).hour),
      0.55,
    );
    out.push(
      `Focus sessions: ${a.focus.length}, usually about ${median(a.focus.map((f) => f.minutes))} min${w ? `, mostly started between ${hh(w.from)} and ${hh(w.to)}` : ""}.`,
    );
  }

  // Workouts.
  const trained = a.workouts.filter((w) => w.status === "done");
  if (trained.length >= 4) {
    const byDay = Array(7).fill(0) as number[];
    for (const w of trained) byDay[new Date(`${w.date}T12:00:00Z`).getUTCDay()]++;
    const top = byDay
      .map((n, d) => ({ n, d }))
      .filter((x) => x.n >= Math.max(2, trained.length / 7))
      .sort((x, y) => y.n - x.n)
      .slice(0, 4)
      .map((x) => DAY_NAMES[x.d]);
    const w = peakWindow(
      trained.map((x) => at(x.created_at).hour),
      0.6,
    );
    out.push(
      `Logged ${trained.length} workouts${top.length ? `, mostly on ${top.join(", ")}` : ""}${w ? `, usually logged between ${hh(w.from)} and ${hh(w.to)}` : ""}.`,
    );
  }

  // Learning.
  if (a.learning.length >= 4) {
    const w = peakWindow(
      a.learning.map((l) => at(l.created_at).hour),
      0.6,
    );
    const mins = a.learning.map((l) => l.minutes ?? 0).filter((m) => m > 0);
    out.push(
      `Logged learning ${a.learning.length} times${w ? `, mostly between ${hh(w.from)} and ${hh(w.to)}` : ""}${mins.length >= 3 ? `, about ${median(mins)} min each` : ""}.`,
    );
  }

  // Things that keep getting pushed back.
  const pushed = new Map<string, number>();
  for (const t of a.carried.filter((x) => x.carry_count >= 3)) for (const k of topics(t.title, t.tags)) pushed.set(k, (pushed.get(k) ?? 0) + 1);
  const worst = [...pushed]
    .filter(([, n]) => n >= 2)
    .sort((x, y) => y[1] - x[1])
    .slice(0, 3);
  for (const [k, n] of worst) out.push(`Keeps postponing tasks about “${k}” (${n} open tasks carried forward 3+ times).`);

  return out.slice(0, 18);
}
