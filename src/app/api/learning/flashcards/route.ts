import { z } from "zod";
import { chatJson } from "@/lib/ai/llm";
import { handle, HttpError, requireUser } from "@/lib/auth";
import { newCard } from "@/lib/fsrs";

export const maxDuration = 90;

const Body = z.object({ entryId: z.string().uuid(), count: z.number().int().min(2).max(12).default(6) });

/** Turns a learning-log entry into spaced-repetition flashcards. */
export async function POST(request: Request) {
  return handle(async () => {
    const { supabase } = await requireUser();
    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new HttpError(400, "Invalid request");
    const { data: entry } = await supabase.from("learning_entries").select("id, title, content, questions, tags").eq("id", parsed.data.entryId).single();
    if (!entry) throw new HttpError(404, "Entry not found");
    if (!(entry.content ?? "").trim() && !entry.title) throw new HttpError(422, "Add some notes to this entry first.");

    const { data: cards } = await chatJson<{ front: string; back: string }[]>(
      {
        messages: [
          {
            role: "system",
            content: `Write ${parsed.data.count} high-quality flashcards from the learner's notes.
Each card tests ONE idea; front is a precise question (not yes/no), back is a short, correct answer (1-3 sentences or a tiny code snippet).
Prefer "why/how/when" over trivia. Fix mistakes in the notes rather than copying them.
Return ONLY JSON: {"cards":[{"front":"…","back":"…"}]}`,
          },
          { role: "user", content: `Topic: ${entry.title}\n\n${(entry.content ?? "").slice(0, 6000)}${entry.questions ? `\n\nOpen questions: ${entry.questions}` : ""}` },
        ],
        temperature: 0.3,
        maxTokens: 2000,
        purpose: "flashcards",
      },
      (v) => {
        const arr = Array.isArray(v) ? v : (v as { cards?: unknown }).cards;
        if (!Array.isArray(arr)) throw new Error("no cards");
        return (arr as { front?: unknown; back?: unknown }[])
          .map((c) => ({ front: String(c.front ?? "").trim().slice(0, 1000), back: String(c.back ?? "").trim().slice(0, 4000) }))
          .filter((c) => c.front && c.back);
      },
    );
    if (!cards.length) throw new HttpError(502, "The AI didn't return usable cards — try again.");
    const now = new Date();
    const rows = cards.map((c) => ({ ...c, entry_id: entry.id, tags: entry.tags, card: newCard(now), due: now.toISOString() }));
    const { data, error } = await supabase.from("flashcards").insert(rows).select("*");
    if (error) throw new HttpError(500, error.message);
    return { ok: true, cards: data };
  });
}
