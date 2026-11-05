"use client";

import { useSyncExternalStore } from "react";
import type { ShareInput } from "@/lib/queries/spaces";
import type { Flashcard, Interest, Job, LearningEntry, SpaceItem, Task } from "@/lib/types";
import { sb } from "@/lib/queries/client";
import { api } from "@/lib/utils";

// ---------------------------------------------------------------------------
// A tiny global store so any button anywhere can open the "Share to…" dialog.
// ---------------------------------------------------------------------------
let current: ShareInput | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function openShare(input: ShareInput) {
  current = input;
  emit();
}
export function closeShare() {
  current = null;
  emit();
}
export function useShareRequest(): ShareInput | null {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => current,
    () => null,
  );
}

// ---------------------------------------------------------------------------
// What gets copied for each kind of thing (never private fields like notes on a job you applied to).
// ---------------------------------------------------------------------------
export const shareTask = (t: Task): ShareInput => ({
  kind: "task",
  title: t.title,
  body: t.notes,
  sourceId: t.id,
  payload: { due_date: t.due_date, due_time: t.due_time, priority: t.priority, tags: t.tags, estimate_minutes: t.estimate_minutes },
});

export const shareJob = (j: Job): ShareInput => ({
  kind: "job",
  title: j.company ? `${j.title} · ${j.company}` : j.title,
  body: j.description?.slice(0, 4000) ?? null,
  sourceId: j.id,
  payload: {
    title: j.title,
    company: j.company,
    location: j.location,
    remote: j.remote,
    salary: j.salary,
    url: j.url,
    apply_url: j.apply_url,
    company_domain: j.company_domain,
    posted_at: j.posted_at,
    score: j.score,
  },
});

export const shareLearning = (e: LearningEntry, cards: Pick<Flashcard, "front" | "back" | "tags">[] = []): ShareInput => ({
  kind: "learning",
  title: e.title,
  body: e.content,
  sourceId: e.id,
  payload: { tags: e.tags, minutes: e.minutes, resources: e.resources, entry_date: e.entry_date, cards: cards.map(({ front, back, tags }) => ({ front, back, tags })) },
});

export const shareFlashcards = (title: string, cards: Pick<Flashcard, "front" | "back" | "tags">[]): ShareInput => ({
  kind: "flashcards",
  title,
  payload: { cards: cards.map(({ front, back, tags }) => ({ front, back, tags })) },
});

export const shareInterest = (i: Interest): ShareInput => ({
  kind: "interest",
  title: i.name,
  sourceId: i.id,
  body: i.notes,
  payload: { name: i.name, kind: i.kind, stage: i.stage },
});

export const shareLink = (url: string, title?: string): ShareInput => ({ kind: "link", title: title?.trim() || url, payload: { url } });
export const shareNote = (text: string): ShareInput => ({ kind: "note", title: text.split("\n")[0].slice(0, 200) || "Note", body: text });

// ---------------------------------------------------------------------------
// "Take a copy": save a shared item into your own dashboard.
// ---------------------------------------------------------------------------
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

async function sha(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

export const COPY_LABEL: Record<SpaceItem["kind"], string> = {
  task: "Add to my tasks",
  job: "Save to my tracker",
  learning: "Add to my tasks",
  link: "Add to my tasks",
  flashcards: "Add to my flashcards",
  interest: "Add to my interests",
  note: "Add to my tasks",
};

/** Copies a shared item into your own data. Returns where it went. */
export async function takeCopy(item: SpaceItem, from: string): Promise<{ where: string; href: string }> {
  const p = item.payload as Record<string, unknown>;
  const client = sb();
  const tagFrom = `from-${from.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  switch (item.kind) {
    case "job": {
      const url = (p.url as string) || "";
      if (/^https?:\/\//.test(url)) {
        const r = await api<{ duplicate?: boolean }>("/api/jobs/import", {
          json: { url, text: `${p.title ?? item.title}\n${p.company ?? ""}\n${p.location ?? ""}\n${item.body ?? ""}`.slice(0, 5000), status: "saved" },
        });
        return { where: r.duplicate ? "Already in your tracker" : "Saved to your tracker (scored for you)", href: "/jobs?tab=tracker" };
      }
      const manual = `manual://shared/${item.id}`;
      const { error } = await client.from("jobs").insert({
        title: (p.title as string) ?? item.title,
        company: (p.company as string) ?? null,
        location: (p.location as string) ?? null,
        url: manual,
        url_hash: await sha(manual),
        dedupe_key: `shared:${item.id}`,
        source: "manual",
        status: "saved",
        description: item.body,
      });
      if (error && !/duplicate/.test(error.message)) throw new Error(error.message);
      return { where: "Saved to your tracker", href: "/jobs?tab=tracker" };
    }
    case "flashcards":
    case "learning": {
      const cards = (p.cards as { front: string; back: string; tags?: string[] }[] | undefined) ?? [];
      if (item.kind === "flashcards" || cards.length) {
        if (cards.length) {
          const { error } = await client.from("flashcards").insert(cards.map((c) => ({ front: c.front, back: c.back, tags: [...(c.tags ?? []), tagFrom] })));
          if (error) throw new Error(error.message);
        }
        if (item.kind === "flashcards") return { where: `${cards.length} flashcards added`, href: "/learning" };
      }
      const links = ((p.resources as { url: string; title?: string }[] | undefined) ?? []).map((r) => `- ${r.title ?? r.url}: ${r.url}`).join("\n");
      const { error } = await client.from("tasks").insert({
        title: `Learn: ${item.title}`.slice(0, 300),
        notes: [item.body, links, `Shared by ${from}`].filter(Boolean).join("\n\n"),
        due_date: todayStr(),
        tags: [...((p.tags as string[]) ?? []).slice(0, 4), tagFrom],
      });
      if (error) throw new Error(error.message);
      return { where: cards.length ? `Added to today's tasks + ${cards.length} flashcards` : "Added to today's tasks", href: "/" };
    }
    case "interest": {
      const { error } = await client.from("interests").insert({
        name: (p.name as string) ?? item.title,
        kind: (p.kind as string) ?? "learning",
        stage: "curious",
        notes: `Suggested by ${from}`,
      });
      if (error && !/duplicate|unique/.test(error.message)) throw new Error(error.message);
      return { where: error ? "Already in your interests" : "Added to your interests", href: "/interests" };
    }
    default: {
      const due = (p.due_date as string | null) ?? null;
      const { error } = await client.from("tasks").insert({
        title: item.kind === "link" ? `Read: ${item.title}`.slice(0, 300) : item.title,
        notes: [item.body, item.kind === "link" ? (p.url as string) : null, `Shared by ${from}`].filter(Boolean).join("\n\n"),
        due_date: due && due >= todayStr() ? due : todayStr(),
        due_time: (p.due_time as string | null) ?? null,
        priority: (p.priority as number | undefined) ?? 4,
        tags: [...((p.tags as string[]) ?? []).filter((t) => !t.startsWith("from-")).slice(0, 4), tagFrom],
        estimate_minutes: (p.estimate_minutes as number | null) ?? null,
      });
      if (error) throw new Error(error.message);
      return { where: "Added to your tasks", href: "/" };
    }
  }
}
