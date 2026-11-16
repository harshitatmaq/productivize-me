/**
 * Learning map: the topics you've learned, how they connect, how strong each is,
 * and what to learn next. Pure (computed in the browser from your own data).
 */

export type MapEntry = { id: string; title: string; entry_date: string; minutes: number | null; topics?: string[] };
export type MapLink = { from_topic: string; to_topic: string; kind: "prereq" | "related"; why?: string | null };
export type MapCard = { entry_id: string | null; tags: string[]; reps: number; lapses: number };
export type MapInterest = { name: string; job_relevance: number | null; status: string };

export type MapNode = {
  id: string;
  label: string;
  minutes: number;
  entries: { id: string; title: string; entry_date: string }[];
  /** 0-1 share of this topic's flashcards you remember well; null without cards. */
  recall: number | null;
  /** 0 (not learned yet) … 1 (strong). */
  strength: number;
  learned: boolean;
  /** Job relevance from your interests (0-100), when known. */
  relevance: number | null;
};
export type MapEdge = { from: string; to: string; kind: "prereq" | "related"; why?: string | null };

const norm = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ");

export function buildGraph(input: { entries: MapEntry[]; links: MapLink[]; cards: MapCard[]; interests: MapInterest[] }): { nodes: MapNode[]; edges: MapEdge[] } {
  const nodes = new Map<string, MapNode>();
  const node = (label: string) => {
    const id = norm(label);
    if (!nodes.has(id)) nodes.set(id, { id, label: label.trim(), minutes: 0, entries: [], recall: null, strength: 0, learned: false, relevance: null });
    return nodes.get(id)!;
  };
  const topicsOfEntry = new Map<string, string[]>();
  for (const e of input.entries) {
    const ts = (e.topics ?? []).filter(Boolean);
    topicsOfEntry.set(e.id, ts.map(norm));
    for (const t of ts) {
      const n = node(t);
      n.minutes += (e.minutes ?? 0) / Math.max(1, ts.length);
      n.entries.push({ id: e.id, title: e.title, entry_date: e.entry_date });
      n.learned = true;
    }
  }
  const edges: MapEdge[] = [];
  const seen = new Set<string>();
  for (const l of input.links) {
    const a = node(l.from_topic).id;
    const b = node(l.to_topic).id;
    if (a === b || seen.has(`${a}>${b}`)) continue;
    seen.add(`${a}>${b}`);
    edges.push({ from: a, to: b, kind: l.kind, why: l.why });
  }
  // Flashcard recall per topic (cards made from an entry, or tagged with the topic).
  const recall = new Map<string, { good: number; total: number }>();
  for (const c of input.cards) {
    const ts = new Set([...(c.entry_id ? (topicsOfEntry.get(c.entry_id) ?? []) : []), ...c.tags.map(norm).filter((t) => nodes.has(t))]);
    for (const t of ts) {
      const r = recall.get(t) ?? { good: 0, total: 0 };
      r.total++;
      if (c.reps > 0 && c.lapses <= Math.max(1, c.reps / 3)) r.good++;
      recall.set(t, r);
    }
  }
  const relevance = new Map(input.interests.filter((i) => i.status !== "not_interested").map((i) => [norm(i.name), i.job_relevance]));
  for (const n of nodes.values()) {
    const r = recall.get(n.id);
    n.recall = r && r.total ? r.good / r.total : null;
    n.relevance = relevance.get(n.id) ?? null;
    if (n.learned) {
      const time = Math.min(1, Math.log1p(n.minutes) / Math.log1p(600)); // ~10h is "a lot"
      const practice = Math.min(1, n.entries.length / 5);
      n.strength = Math.min(1, 0.15 + 0.35 * time + 0.2 * practice + 0.3 * (n.recall ?? 0.5));
    }
  }
  return { nodes: [...nodes.values()], edges };
}

export type NextTopic = { topic: string; score: number; reasons: string[] };

/**
 * What to learn next: topics you haven't learned that build on what you have,
 * that show up in your job skill gaps, or that matter for your target roles.
 */
export function learnNext(graph: { nodes: MapNode[]; edges: MapEdge[] }, gaps: string[], max = 3): NextTopic[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const gapText = gaps.join(" \n ").toLowerCase();
  const out: NextTopic[] = [];
  for (const n of graph.nodes) {
    if (n.learned) continue;
    const prereqs = graph.edges.filter((e) => e.to === n.id && e.kind === "prereq").map((e) => byId.get(e.from)!).filter(Boolean);
    const ready = prereqs.filter((p) => p.learned && p.strength >= 0.35);
    const escaped = n.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const inGaps = n.id.length >= 3 ? (gapText.match(new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "g")) ?? []).length : 0;
    if (!ready.length && !inGaps) continue;
    const reasons: string[] = [];
    if (ready.length) reasons.push(`builds on ${ready.slice(0, 2).map((p) => p.label).join(" and ")}`);
    if (inGaps) reasons.push(`in ${inGaps} job skill gap${inGaps > 1 ? "s" : ""}`);
    if (n.relevance != null && n.relevance >= 60) reasons.push(`job relevance ${n.relevance}`);
    out.push({ topic: n.label, score: ready.length * 2 + inGaps * 1.5 + (n.relevance ?? 0) / 50, reasons });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, max);
}

/** Simple, deterministic force layout (no library): positions within w×h. */
export function layoutGraph(nodes: MapNode[], edges: MapEdge[], w: number, h: number, iterations = 220): Map<string, { x: number; y: number }> {
  const n = nodes.length;
  const pos = new Map<string, { x: number; y: number; vx: number; vy: number }>();
  nodes.forEach((node, i) => {
    const a = (i / Math.max(1, n)) * Math.PI * 2;
    const r = Math.min(w, h) * (node.learned ? 0.25 : 0.4);
    pos.set(node.id, { x: w / 2 + Math.cos(a) * r, y: h / 2 + Math.sin(a) * r, vx: 0, vy: 0 });
  });
  const k = Math.min(110, Math.sqrt((w * h) / Math.max(1, n)) * 0.45);
  for (let it = 0; it < iterations; it++) {
    const cool = 1 - it / iterations;
    for (let i = 0; i < n; i++) {
      const a = pos.get(nodes[i].id)!;
      for (let j = i + 1; j < n; j++) {
        const b = pos.get(nodes[j].id)!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        const d2 = Math.max(dx * dx + dy * dy, 0.01);
        const f = (k * k) / d2;
        dx *= f;
        dy *= f;
        a.vx += dx;
        a.vy += dy;
        b.vx -= dx;
        b.vy -= dy;
      }
    }
    for (const e of edges) {
      const a = pos.get(e.from);
      const b = pos.get(e.to);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
      const f = (d - k) * 0.12;
      a.vx += (dx / d) * f;
      a.vy += (dy / d) * f;
      b.vx -= (dx / d) * f;
      b.vy -= (dy / d) * f;
    }
    for (const p of pos.values()) {
      p.vx += (w / 2 - p.x) * 0.04;
      p.vy += (h / 2 - p.y) * 0.04;
      const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      const limit = 12 * cool + 0.5;
      if (speed > limit) {
        p.vx = (p.vx / speed) * limit;
        p.vy = (p.vy / speed) * limit;
      }
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.5;
      p.vy *= 0.5;
    }
  }
  // Scale the result to fit the box, leaving room for labels around each dot.
  const xs = [...pos.values()].map((p) => p.x);
  const ys = [...pos.values()].map((p) => p.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const fit = (v: number, lo: number, hi: number, a: number, b: number) => (hi - lo < 1 ? (a + b) / 2 : a + ((v - lo) / (hi - lo)) * (b - a));
  return new Map([...pos].map(([id, p]) => [id, { x: fit(p.x, minX, maxX, 70, w - 70), y: fit(p.y, minY, maxY, 30, h - 24) }]));
}
