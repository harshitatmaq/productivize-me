import { z } from "zod";
import { chatJson } from "@/lib/ai/llm";
import { handle, HttpError, requireUser } from "@/lib/auth";

export const maxDuration = 90;

const Body = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** AI recap of a range of learning-log entries, with a short quiz. */
export async function POST(request: Request) {
  return handle(async () => {
    const { supabase } = await requireUser();
    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new HttpError(400, "Invalid request");
    const { data: entries } = await supabase
      .from("learning_entries")
      .select("entry_date, title, content, tags, questions")
      .gte("entry_date", parsed.data.from)
      .lte("entry_date", parsed.data.to)
      .order("entry_date");
    if (!entries?.length) throw new HttpError(404, "No learning entries in that range yet.");
    const notes = entries
      .map((e) => `## ${e.entry_date} — ${e.title}${e.tags?.length ? ` [${e.tags.join(", ")}]` : ""}\n${(e.content ?? "").slice(0, 1200)}${e.questions ? `\nOpen questions: ${e.questions}` : ""}`)
      .join("\n\n")
      .slice(0, 14_000);
    const { data, provider } = await chatJson<{
      summary: string;
      themes: string[];
      gaps: string[];
      next_steps: string[];
      quiz: { q: string; a: string }[];
    }>(
      {
        messages: [
          {
            role: "system",
            content: `You are a supportive learning coach. Read the learner's notes and return ONLY JSON:
{"summary":"3-4 sentence recap in second person","themes":["main themes"],"gaps":["misconceptions or thin spots worth revisiting"],
"next_steps":["3 concrete next things to learn or build"],"quiz":[{"q":"question testing understanding","a":"short answer"}]} (4-6 quiz items).`,
          },
          { role: "user", content: notes },
        ],
        temperature: 0.4,
        maxTokens: 2000,
        purpose: "learning-recap",
      },
      (v) => {
        const o = v as Record<string, unknown>;
        if (typeof o.summary !== "string") throw new Error("missing summary");
        const arr = (x: unknown) => (Array.isArray(x) ? x.map(String) : []);
        return {
          summary: o.summary,
          themes: arr(o.themes),
          gaps: arr(o.gaps),
          next_steps: arr(o.next_steps),
          quiz: Array.isArray(o.quiz)
            ? (o.quiz as Record<string, unknown>[]).map((q) => ({ q: String(q.q ?? ""), a: String(q.a ?? "") })).filter((q) => q.q)
            : [],
        };
      },
    );
    return { ok: true, recap: data, provider, count: entries.length };
  });
}
