import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { chatJson } from "@/lib/ai/llm";
import { notify } from "@/lib/notify";
import { describePrefs, sanitizePrefs, type PlanningPrefs } from "@/lib/planning";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { digestActivity, factLines, planFactUpdates, sanitizeRoutine, type Fact, type FactOp, type FactProposal } from "./facts";

const DAY = 86_400_000;
const FACT_COLS = "id, kind, statement, key, confidence, status, source, pinned, evidence, evidence_count, routine, last_seen_at";
const MAX_PENDING_QUESTIONS = 4;

/**
 * Remembers something you told the AI in your own words, for the next learning
 * pass. Cheap (no AI call) and silent: it never blocks or fails the request.
 */
export async function noteForMemory(supabase: SupabaseClient, userId: string, source: string, text: string): Promise<void> {
  const clean = text.trim().slice(0, 2000);
  if (clean.length < 8) return;
  try {
    const { data: p } = await supabase.from("profiles").select("memory_learning").eq("id", userId).maybeSingle();
    if (p && p.memory_learning === false) return;
    await supabase.from("memory_inbox").insert({ user_id: userId, source, text: clean });
  } catch {
    // memory is best-effort (and the table may not exist before migration 0005)
  }
}

export async function loadFacts(supabase: SupabaseClient, userId: string): Promise<Fact[]> {
  const { data, error } = await supabase.from("user_facts").select(FACT_COLS).eq("user_id", userId).limit(200);
  if (error) return [];
  return (data ?? []) as Fact[];
}

/** What the AI should know about you for this kind of request, as prompt lines. */
export async function memoryContext(
  supabase: SupabaseClient,
  userId: string,
  purpose: "planning" | "jobs" | "learning" | "general",
  max = 20,
): Promise<string[]> {
  return factLines(await loadFacts(supabase, userId), purpose, max);
}

async function applyOps(admin: SupabaseClient, userId: string, ops: FactOp[]): Promise<{ inserted: Fact[]; updated: string[] }> {
  const inserted: Fact[] = [];
  const updated: string[] = [];
  for (const o of ops) {
    if (o.op === "insert") {
      const { data } = await admin
        .from("user_facts")
        .upsert({ ...o.row, user_id: userId }, { onConflict: "user_id,key", ignoreDuplicates: true })
        .select(FACT_COLS)
        .maybeSingle();
      if (data) inserted.push(data as Fact);
    } else if (o.op === "update") {
      await admin.from("user_facts").update(o.patch).eq("id", o.id).eq("user_id", userId);
      updated.push(o.id);
    } else {
      await admin.from("user_facts").delete().eq("id", o.id).eq("user_id", userId);
    }
  }
  return { inserted, updated };
}

/** Adds a routine to your planning preferences (a routine with the same name is replaced). */
export async function addRoutine(supabase: SupabaseClient, userId: string, routine: unknown): Promise<boolean> {
  const r = sanitizeRoutine(routine);
  if (!r) return false;
  const { data: me } = await supabase.from("profiles").select("planning").eq("id", userId).maybeSingle();
  const current = sanitizePrefs(me?.planning);
  const next = sanitizePrefs({
    ...current,
    routines: [...(current.routines ?? []).filter((x) => x.label.toLowerCase() !== r.label.toLowerCase()), { ...r, id: `r${Date.now().toString(36)}` }],
  });
  const { error } = await supabase.from("profiles").update({ planning: next }).eq("id", userId);
  return !error;
}

/** Things you state directly ("I believe…", "I prefer…") are saved straight away as your own. */
export async function saveStatedFacts(
  supabase: SupabaseClient,
  userId: string,
  facts: { statement: string; kind?: string }[],
  evidence: string,
): Promise<Fact[]> {
  if (!facts.length) return [];
  const existing = await loadFacts(supabase, userId);
  const ops = planFactUpdates(
    existing,
    facts.map((f) => ({
      statement: f.statement,
      kind: f.kind,
      stated: true,
      confidence: 95,
      evidence,
    })),
    { now: new Date().toISOString() },
  ).filter((o) => o.op !== "delete");
  return (await applyOps(supabase, userId, ops)).inserted;
}

type LearnOut = {
  facts?: FactProposal[];
  weaken?: { id: string; reason?: string }[];
};

const LEARN_SYSTEM = `You maintain a short, accurate memory of one person so their productivity app can plan days the way they like.
You get: their current planning settings, what you already know (with ids), statements they rejected, factual activity patterns, and things they said to the app's AI.
Return ONLY JSON: {"facts":[{"id":"existing id when this confirms a known fact, else omit","statement":"short, third person, present tense, max 120 chars, e.g. 'Reads at night, usually after 22:30'","kind":"schedule|habit|work_style|like|dislike|value|goal|life","confidence":0-100,"stated":true|false,"evidence":"what shows it, max 100 chars","routine":{"label":"…","keywords":["words in matching task titles"],"start":"HH:MM","end":"HH:MM","days":[]} or null,"contradicts":"id of a known fact this shows is no longer true, or omit"}],"weaken":[{"id":"…","reason":"…"}]}
Rules:
- Only what the input supports. No flattery, no psychology, no guesses about health, religion, politics or relationships unless they said it themselves.
- stated=true ONLY when they said it in their own words (then it may be a value or belief). Patterns in activity are stated=false.
- Confidence for patterns: 2-3 occurrences 45-60; clear repeated pattern 65-80; overwhelming 85+.
- Add "routine" only for a clear recurring time window tied to a kind of task (e.g. reading 22:30-23:30). Times 24h.
- If something they said or did contradicts a known fact, set "contradicts". Put known facts with evidence against them in "weaken".
- Never repeat a rejected statement or a close variant. Don't restate their planning settings as facts.
- At most 8 facts. Prefer confirming known facts (give their id) over near-duplicates.`;

export type LearnResult = {
  added: number;
  suggested: number;
  confirmed: number;
  questions: number;
  skipped?: string;
};

/**
 * The daily learning pass: reads your recent activity and what you told the AI,
 * and updates what it knows about you (with confidence and evidence).
 */
export async function learnPreferences(userId: string, opts: { force?: boolean } = {}): Promise<LearnResult> {
  const admin = supabaseAdmin();
  const result: LearnResult = {
    added: 0,
    suggested: 0,
    confirmed: 0,
    questions: 0,
  };
  const { data: profile } = await admin
    .from("profiles")
    .select("id, email, timezone, planning, memory_learning, memory_learned_at, notify_push, notify_email")
    .eq("id", userId)
    .maybeSingle();
  if (!profile) return { ...result, skipped: "no profile" };
  if (profile.memory_learning === false && !opts.force) return { ...result, skipped: "learning is off" };

  const tz = (profile.timezone as string) || "Asia/Kolkata";
  const prefs = sanitizePrefs(profile.planning) as PlanningPrefs;
  const since = new Date(Date.now() - 60 * DAY).toISOString();
  const lastRun = profile.memory_learned_at ? Date.parse(profile.memory_learned_at as string) : 0;

  const [done, carried, focus, workouts, learning, inbox, facts] = await Promise.all([
    admin.from("tasks").select("title, tags, completed_at, actual_minutes").eq("user_id", userId).eq("status", "done").gte("completed_at", since).limit(600),
    admin.from("tasks").select("title, tags, carry_count").eq("user_id", userId).eq("status", "todo").gte("carry_count", 3).limit(100),
    admin.from("focus_sessions").select("started_at, minutes").eq("user_id", userId).gte("started_at", since).limit(300),
    admin.from("workouts").select("date, status, created_at").eq("user_id", userId).gte("created_at", since).limit(120),
    admin.from("learning_entries").select("created_at, minutes, title").eq("user_id", userId).gte("created_at", since).limit(200),
    admin
      .from("memory_inbox")
      .select("id, source, text, created_at")
      .eq("user_id", userId)
      .is("processed_at", null)
      .order("created_at", { ascending: false })
      .limit(60),
    loadFacts(admin, userId),
  ]);

  const newActivity = [...(done.data ?? []).map((t) => t.completed_at as string), ...(learning.data ?? []).map((l) => l.created_at as string)].some(
    (at) => at && Date.parse(at) > lastRun,
  );
  const said = inbox.data ?? [];
  if (!opts.force && !said.length && !newActivity && Date.now() - lastRun < 7 * DAY) {
    await admin.from("profiles").update({ memory_learned_at: new Date().toISOString() }).eq("id", userId);
    return { ...result, skipped: "nothing new" };
  }

  const patterns = digestActivity({
    tz,
    done: done.data ?? [],
    carried: carried.data ?? [],
    focus: focus.data ?? [],
    workouts: workouts.data ?? [],
    learning: learning.data ?? [],
    routines: prefs.routines,
  });
  if (!patterns.length && !said.length) {
    await admin.from("profiles").update({ memory_learned_at: new Date().toISOString() }).eq("id", userId);
    return { ...result, skipped: "not enough activity yet" };
  }

  const known = facts.filter((f) => f.status !== "rejected");
  const rejected = facts.filter((f) => f.status === "rejected").map((f) => f.statement);
  let out: LearnOut = {};
  try {
    const { data } = await chatJson<LearnOut>(
      {
        purpose: "memory-learn",
        temperature: 0.1,
        maxTokens: 1400,
        deadlineMs: 50_000,
        messages: [
          { role: "system", content: LEARN_SYSTEM },
          {
            role: "user",
            content: [
              `Their planning settings:\n${
                describePrefs(prefs, new Date().getDay())
                  .map((l) => `- ${l}`)
                  .join("\n") || "- none"
              }`,
              `Known facts:\n${known.map((f) => `- [${f.id}] (${f.source}, ${f.status}, ${f.confidence}) ${f.statement}`).join("\n") || "- none"}`,
              `Rejected (never suggest again):\n${rejected.map((s) => `- ${s}`).join("\n") || "- none"}`,
              `Activity patterns (last 60 days, their time zone):\n${patterns.map((l) => `- ${l}`).join("\n") || "- not enough activity"}`,
              `What they said to the app's AI (newest first):\n${said.map((s) => `- [${s.source}] ${String(s.text).slice(0, 400)}`).join("\n") || "- nothing new"}`,
            ].join("\n\n"),
          },
        ],
      },
      (v) => {
        const o = v as LearnOut;
        if (!Array.isArray(o.facts) && !Array.isArray(o.weaken)) throw new Error("no facts");
        return o;
      },
    );
    out = data;
  } catch (e) {
    return {
      ...result,
      skipped: `AI unavailable: ${(e as Error).message.slice(0, 120)}`,
    };
  }

  const now = new Date().toISOString();
  const ops = planFactUpdates(facts, out.facts ?? [], {
    now,
    weaken: out.weaken,
  });
  const { inserted, updated } = await applyOps(admin, userId, ops);
  result.added = inserted.filter((f) => f.status === "active").length;
  result.suggested = inserted.filter((f) => f.status === "suggested").length;
  result.confirmed = updated.length;

  // Ask about suggestions, and offer routines for timing facts (max 2 shown a day, via Today's check-ins).
  const { data: qs } = await admin.from("memory_questions").select("kind, fact_id, status").eq("user_id", userId);
  let pending = (qs ?? []).filter((q) => q.status === "pending").length;
  const asked = (kind: string, id: string) => (qs ?? []).some((q) => q.kind === kind && q.fact_id === id);
  const refreshed = await loadFacts(admin, userId);
  const routines = (prefs.routines ?? []).map((r) => r.label.toLowerCase());
  for (const f of refreshed.sort((a, b) => b.confidence - a.confidence)) {
    if (pending >= MAX_PENDING_QUESTIONS) break;
    if (f.status === "suggested" && !asked("confirm_fact", f.id)) {
      const { error } = await admin.from("memory_questions").insert({
        user_id: userId,
        kind: "confirm_fact",
        fact_id: f.id,
        question: `I've noticed: ${f.statement}. Is that right?`,
        detail: f.evidence[0]?.label ?? null,
      });
      if (!error) {
        pending++;
        result.questions++;
      }
    } else if (
      f.status === "active" &&
      f.source === "learned" &&
      f.routine &&
      !routines.includes(f.routine.label.toLowerCase()) &&
      !asked("fact_routine", f.id)
    ) {
      const { error } = await admin.from("memory_questions").insert({
        user_id: userId,
        kind: "fact_routine",
        fact_id: f.id,
        question: `${f.statement}. Should Plan my day keep ${f.routine.start}–${f.routine.end} for “${f.routine.label}”?`,
        detail: f.evidence[0]?.label ?? null,
      });
      if (!error) {
        pending++;
        result.questions++;
      }
    }
  }

  if (said.length)
    await admin
      .from("memory_inbox")
      .update({ processed_at: now })
      .in(
        "id",
        said.map((s) => s.id),
      );
  await admin
    .from("memory_inbox")
    .delete()
    .eq("user_id", userId)
    .lt("created_at", new Date(Date.now() - 30 * DAY).toISOString());
  await admin.from("profiles").update({ memory_learned_at: now }).eq("id", userId);

  const fresh = inserted.filter((f) => f.status === "active" && f.source === "learned");
  if (fresh.length) {
    await notify(
      {
        id: userId,
        email: profile.email as string | null,
        notify_push: false,
        notify_email: false,
      } as Parameters<typeof notify>[0],
      {
        kind: "memory",
        dedupeKey: `memory:${now.slice(0, 10)}`,
        title: fresh.length === 1 ? "Learned something about how you work" : `Learned ${fresh.length} things about how you work`,
        body: fresh
          .slice(0, 3)
          .map((f) => f.statement)
          .join(" · "),
        url: "/settings#memory",
      },
    ).catch(() => {});
  }
  return result;
}
