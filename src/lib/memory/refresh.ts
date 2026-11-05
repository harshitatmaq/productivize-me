import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { chatJson } from "@/lib/ai/llm";
import type { JobProfile } from "@/lib/jobs/types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  computeStrength,
  heuristicRelevance,
  mentions,
  relevanceBasis,
  stageFor,
  type Evidence,
  type InterestKind,
} from "./interests";

type Signal = Evidence & { text: string };
type Row = {
  id: string;
  name: string;
  kind: InterestKind;
  status: "active" | "suggested" | "not_interested";
  source: "manual" | "scout";
  job_use: "auto" | "always" | "never";
  job_relevance: number | null;
  relevance_basis: string | null;
  strength: number;
};

const DAY = 86_400_000;
const MAX_PENDING_QUESTIONS = 4;

/** Everything Scout learns from: learning log, finished tasks and focus time, flashcards, job feedback, searches. */
async function gatherSignals(admin: SupabaseClient, userId: string): Promise<Signal[]> {
  const since = new Date(Date.now() - 180 * DAY).toISOString();
  const [learning, tasks, cards, jobs, searches] = await Promise.all([
    admin.from("learning_entries").select("id, title, tags, minutes, content, created_at").eq("user_id", userId).gte("created_at", since).limit(400),
    admin
      .from("tasks")
      .select("id, title, tags, actual_minutes, completed_at")
      .eq("user_id", userId)
      .eq("status", "done")
      .gte("completed_at", since)
      .limit(800),
    admin.from("flashcards").select("id, front, tags, created_at").eq("user_id", userId).limit(500),
    admin.from("jobs").select("id, title, company, feedback, status, feedback_at, applied_at").eq("user_id", userId).or("feedback.not.is.null,applied_at.not.is.null").limit(300),
    admin.from("searches").select("id, query, created_at").eq("user_id", userId).gte("created_at", since).limit(100),
  ]);
  const out: Signal[] = [];
  for (const e of learning.data ?? [])
    out.push({
      type: "learning",
      id: e.id,
      label: `Learning: ${e.title}`,
      at: e.created_at,
      minutes: e.minutes ?? 0,
      text: `${e.title} ${(e.tags ?? []).join(" ")} ${(e.content ?? "").slice(0, 400)}`,
    });
  for (const t of tasks.data ?? [])
    out.push({ type: "task", id: t.id, label: `Done: ${t.title}`, at: t.completed_at, minutes: t.actual_minutes ?? 0, text: `${t.title} ${(t.tags ?? []).join(" ")}` });
  for (const c of cards.data ?? []) out.push({ type: "flashcard", id: c.id, label: `Flashcard: ${String(c.front).slice(0, 80)}`, at: c.created_at, text: `${c.front} ${(c.tags ?? []).join(" ")}` });
  for (const j of jobs.data ?? [])
    if (j.feedback === 1 || j.applied_at)
      out.push({ type: "job", id: j.id, label: `${j.applied_at ? "Applied" : "Liked"}: ${j.title}${j.company ? ` @ ${j.company}` : ""}`, at: j.applied_at ?? j.feedback_at, text: j.title });
  for (const s of searches.data ?? []) out.push({ type: "search", id: s.id, label: `Searched: ${s.query}`, at: s.created_at, text: s.query });
  return out;
}

function evidenceFor(name: string, signals: Signal[]): Evidence[] {
  return signals
    .filter((s) => mentions(s.text, name))
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))
    .map(({ type, id, label, at, minutes }) => ({ type, id, label: label.slice(0, 140), at, minutes }));
}

/** Ask the AI chain for new interests the evidence points to (names only; evidence is checked by us). */
async function suggestInterests(signals: Signal[], known: string[]): Promise<{ name: string; kind: InterestKind }[]> {
  const recent = signals
    .filter((s) => s.type !== "job" && s.type !== "flashcard")
    .slice(0, 120)
    .map((s) => `- ${s.label}`)
    .join("\n");
  if (!recent) return [];
  try {
    const { data } = await chatJson<{ interests: { name: string; kind: string }[] }>(
      {
        purpose: "memory-suggest",
        temperature: 0.2,
        maxTokens: 600,
        deadlineMs: 40_000,
        messages: [
          {
            role: "system",
            content:
              'You find a person\'s recurring interests from their activity log. Return JSON {"interests":[{"name":"short canonical name, e.g. Microsoft Fabric, System design, Photography, Guitar","kind":"career"|"learning"|"hobby"}]}. Only topics that appear at least twice. career = professional skill/tool; learning = topic they study; hobby = personal pastime. Max 6. Skip anything already known.',
          },
          { role: "user", content: `Known already (skip): ${known.join(", ") || "none"}\n\nActivity:\n${recent}` },
        ],
      },
      (v) => {
        const o = v as { interests?: unknown };
        if (!Array.isArray(o.interests)) throw new Error("no interests array");
        return o as { interests: { name: string; kind: string }[] };
      },
    );
    return data.interests
      .map((i) => ({ name: String(i.name ?? "").trim().slice(0, 60), kind: (["career", "learning", "hobby"].includes(i.kind) ? i.kind : "learning") as InterestKind }))
      .filter((i) => i.name.length >= 2);
  } catch {
    return [];
  }
}

/** Job relevance 0-100 for each interest against the person's target roles (AI, with an offline fallback). */
async function scoreRelevance(rows: Row[], profile: JobProfile): Promise<Map<string, { relevance: number; reason: string }>> {
  const out = new Map<string, { relevance: number; reason: string }>();
  if (!rows.length) return out;
  const targets = (profile.target_titles ?? []).join(", ") || profile.current_title || "their next role";
  try {
    const { data } = await chatJson<{ scores: { name: string; relevance: number; reason: string }[] }>(
      {
        purpose: "memory-relevance",
        temperature: 0,
        maxTokens: 900,
        deadlineMs: 40_000,
        messages: [
          {
            role: "system",
            content:
              'Rate how much each interest helps someone get the jobs they target, 0-100 (90+: core requirement of those roles; 70-89: commonly asked/strong plus; 40-69: occasionally useful; <40: unrelated). Hobbies are usually <30 unless clearly job-relevant (e.g. photography for a design role). Return JSON {"scores":[{"name":"…","relevance":0-100,"reason":"one short sentence"}]}.',
          },
          {
            role: "user",
            content: `Target roles: ${targets}\nTheir skills: ${(profile.skills ?? []).slice(0, 20).join(", ")}\n\nInterests:\n${rows.map((r) => `- ${r.name} (${r.kind})`).join("\n")}`,
          },
        ],
      },
      (v) => {
        const o = v as { scores?: unknown };
        if (!Array.isArray(o.scores)) throw new Error("no scores");
        return o as { scores: { name: string; relevance: number; reason: string }[] };
      },
    );
    for (const s of data.scores) {
      const row = rows.find((r) => r.name.toLowerCase() === String(s.name).toLowerCase());
      const n = Math.round(Number(s.relevance));
      if (row && Number.isFinite(n)) out.set(row.id, { relevance: Math.max(0, Math.min(100, n)), reason: String(s.reason ?? "").slice(0, 200) });
    }
  } catch {
    // fall through to the heuristic for anything missing
  }
  for (const r of rows) if (!out.has(r.id)) out.set(r.id, heuristicRelevance(r, profile));
  return out;
}

/** Title words you keep passing on (and never liked) → "hide these?" question. */
function repeatedDislikes(jobs: { title: string; feedback: number | null }[], profile: JobProfile): { term: string; count: number }[] {
  const tok = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9+#.]+/).filter((w) => w.length > 2));
  const keep = new Set([...(profile.target_titles ?? []), ...(profile.skills ?? [])].flatMap((s) => [...tok(s)]));
  const generic = new Set(["senior", "engineer", "developer", "lead", "manager", "associate", "analyst", "junior", "staff", "principal", "intern", "remote", "india", "the", "and", "for"]);
  const liked = new Set(jobs.filter((j) => j.feedback === 1).flatMap((j) => [...tok(j.title)]));
  const counts = new Map<string, number>();
  for (const j of jobs.filter((x) => x.feedback === -1)) for (const w of tok(j.title)) counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts]
    .filter(([w, n]) => n >= 3 && !liked.has(w) && !keep.has(w) && !generic.has(w))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([term, count]) => ({ term, count }));
}

export type MemoryResult = { suggested: string[]; updated: number; questions: number };

/**
 * Re-reads your activity: refreshes evidence/strength/stage for every interest,
 * proposes new ones (as suggestions you confirm), scores job relevance when your
 * target roles change, and queues a few check-in questions.
 */
export async function refreshMemory(userId: string, opts: { force?: boolean } = {}): Promise<MemoryResult> {
  const admin = supabaseAdmin();
  const [{ data: jp }, { data: rowsData }, signals] = await Promise.all([
    admin.from("job_profiles").select("profile, memory_at").eq("user_id", userId).maybeSingle(),
    admin.from("interests").select("id, name, kind, status, source, job_use, job_relevance, relevance_basis, strength").eq("user_id", userId),
    gatherSignals(admin, userId),
  ]);
  const profile = (jp?.profile ?? {}) as JobProfile;
  const memoryAt = jp?.memory_at ? Date.parse(jp.memory_at as string) : 0;
  const rows = (rowsData ?? []) as Row[];
  const result: MemoryResult = { suggested: [], updated: 0, questions: 0 };

  // 1. New suggestions — only when there's new activity, and only if the evidence really shows up twice.
  const fresh = signals.some((s) => s.at && Date.parse(s.at) > memoryAt);
  if (fresh || opts.force) {
    const ideas = await suggestInterests(signals, rows.map((r) => r.name));
    for (const idea of ideas) {
      if (rows.some((r) => r.name.toLowerCase() === idea.name.toLowerCase())) continue;
      if (evidenceFor(idea.name, signals).length < 2) continue;
      const { data } = await admin
        .from("interests")
        .insert({ user_id: userId, name: idea.name, kind: idea.kind, status: "suggested", source: "scout" })
        .select("id, name, kind, status, source, job_use, job_relevance, relevance_basis, strength")
        .maybeSingle();
      if (data) {
        rows.push(data as Row);
        result.suggested.push(idea.name);
      }
    }
  }

  // 2. Evidence → strength → stage, for everything.
  const inProfile = (name: string) => mentions([...(profile.skills ?? []), ...(profile.tools ?? [])].join(" | "), name);
  for (const r of rows) {
    const ev = evidenceFor(r.name, signals);
    const strength = computeStrength(ev, { manual: r.source === "manual", inProfile: inProfile(r.name) });
    await admin
      .from("interests")
      .update({
        evidence: ev.slice(0, 25),
        evidence_count: ev.length,
        minutes: ev.reduce((s, e) => s + (e.minutes ?? 0), 0),
        strength,
        stage: stageFor(strength),
        last_seen_at: ev[0]?.at ?? null,
      })
      .eq("id", r.id);
    r.strength = strength;
    result.updated++;
  }

  // 3. Job relevance — only for new interests or when target roles changed.
  const basis = relevanceBasis(profile);
  const stale = rows.filter((r) => r.status !== "not_interested" && (r.job_relevance === null || r.relevance_basis !== basis));
  if (stale.length) {
    const scores = await scoreRelevance(stale.slice(0, 30), profile);
    for (const [id, s] of scores) {
      await admin.from("interests").update({ job_relevance: s.relevance, relevance_reason: s.reason, relevance_basis: basis }).eq("id", id);
      const r = rows.find((x) => x.id === id);
      if (r) r.job_relevance = s.relevance;
    }
  }

  // 4. Check-in questions (shown max 2 a day in the app).
  const { data: qs } = await admin.from("memory_questions").select("kind, interest_id, term, status").eq("user_id", userId);
  const asked = (kind: string, key: string) => (qs ?? []).some((q) => q.kind === kind && (q.interest_id ?? q.term) === key);
  let pending = (qs ?? []).filter((q) => q.status === "pending").length;
  const ask = async (row: Record<string, unknown>) => {
    if (pending >= MAX_PENDING_QUESTIONS) return;
    const { error } = await admin.from("memory_questions").insert({ user_id: userId, ...row });
    if (!error) {
      pending++;
      result.questions++;
    }
  };
  for (const r of rows.filter((x) => x.status === "suggested").sort((a, b) => b.strength - a.strength)) {
    if (asked("confirm_interest", r.id)) continue;
    const ev = evidenceFor(r.name, signals);
    const mins = ev.reduce((s, e) => s + (e.minutes ?? 0), 0);
    await ask({
      kind: "confirm_interest",
      interest_id: r.id,
      question: `You've come back to ${r.name} ${ev.length} times${mins >= 30 ? ` (${Math.round(mins / 6) / 10}h)` : ""}. Is it one of your interests?`,
      detail: ev
        .slice(0, 3)
        .map((e) => e.label)
        .join(" · "),
    });
  }
  const target = (profile.target_titles ?? [])[0];
  for (const r of rows.filter((x) => x.status === "active" && x.job_use === "auto" && (x.job_relevance ?? 0) >= 55 && (x.job_relevance ?? 0) < 70)) {
    if (asked("job_use", r.id)) continue;
    await ask({
      kind: "job_use",
      interest_id: r.id,
      question: `${r.name} could help with ${target ? `${target} roles` : "your target roles"} (relevance ${r.job_relevance}). Should Scout look for jobs that use it?`,
    });
  }
  const { data: fb } = await admin.from("jobs").select("title, feedback").eq("user_id", userId).not("feedback", "is", null).gte("feedback_at", new Date(Date.now() - 90 * DAY).toISOString()).limit(200);
  const excluded = new Set((profile.exclude_keywords ?? []).map((x) => x.toLowerCase()));
  for (const d of repeatedDislikes((fb ?? []) as { title: string; feedback: number | null }[], profile)) {
    if (excluded.has(d.term) || asked("exclude_term", d.term)) continue;
    await ask({ kind: "exclude_term", term: d.term, question: `You passed on ${d.count} roles with “${d.term}” in the title. Hide those from now on?` });
  }

  await admin.from("job_profiles").update({ memory_at: new Date().toISOString() }).eq("user_id", userId);
  return result;
}

/** Applies an answer to a check-in question (called from the app). */
export async function answerQuestion(
  supabase: SupabaseClient,
  userId: string,
  questionId: string,
  answer: "yes" | "no" | "later",
): Promise<{ message: string }> {
  const { data: q } = await supabase.from("memory_questions").select("*").eq("id", questionId).maybeSingle();
  if (!q) throw new Error("Question not found");
  if (answer === "later") {
    await supabase.from("memory_questions").update({ snooze_until: new Date(Date.now() + 3 * DAY).toISOString(), shown_on: null }).eq("id", q.id);
    return { message: "I'll ask again in a few days." };
  }
  let message = "Got it.";
  if (q.kind === "confirm_interest" && q.interest_id) {
    await supabase.from("interests").update({ status: answer === "yes" ? "active" : "not_interested" }).eq("id", q.interest_id);
    message = answer === "yes" ? "Added to your interests." : "Noted — Scout won't suggest it or use it for jobs.";
  } else if (q.kind === "job_use" && q.interest_id) {
    await supabase.from("interests").update({ job_use: answer === "yes" ? "always" : "never" }).eq("id", q.interest_id);
    message = answer === "yes" ? "Scout will look for roles that use it." : "Scout won't use it for jobs.";
  } else if (q.kind === "exclude_term" && q.term && answer === "yes") {
    const { data: jp } = await supabase.from("job_profiles").select("profile").eq("user_id", userId).maybeSingle();
    const profile = (jp?.profile ?? {}) as JobProfile;
    const exclude = [...new Set([...(profile.exclude_keywords ?? []), q.term])];
    await supabase.from("job_profiles").update({ profile: { ...profile, exclude_keywords: exclude }, profile_updated_at: new Date().toISOString() }).eq("user_id", userId);
    message = `Roles with “${q.term}” in the title are hidden from now on.`;
  }
  await supabase.from("memory_questions").update({ status: "answered", answer, answered_at: new Date().toISOString() }).eq("id", q.id);
  return { message };
}
