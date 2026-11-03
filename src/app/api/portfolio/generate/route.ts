import { chatJson } from "@/lib/ai/llm";
import { handle, requireUser } from "@/lib/auth";
import type { JobProfile } from "@/lib/jobs/types";
import { portfolioFromProfile, type PortfolioData } from "@/lib/portfolio";

export const maxDuration = 120;

/**
 * Drafts portfolio content from the job profile. Uses the LLM chain to polish
 * the copy; falls back to a direct mapping if no provider answers.
 */
export async function POST() {
  return handle(async () => {
    const { user, supabase } = await requireUser();
    const [{ data: jp }, { data: me }] = await Promise.all([
      supabase.from("job_profiles").select("profile, resume_text").eq("user_id", user.id).maybeSingle(),
      supabase.from("profiles").select("full_name, email").eq("id", user.id).maybeSingle(),
    ]);
    const profile = (jp?.profile as JobProfile) ?? {};
    const base = portfolioFromProfile(profile, { name: me?.full_name ?? undefined, email: me?.email ?? undefined });
    try {
      const { data } = await chatJson<Partial<PortfolioData>>(
        {
          messages: [
            {
              role: "system",
              content: `You write crisp, confident personal-portfolio copy (no clichés, no buzzword soup).
Improve the draft: a punchy headline (max 12 words), an "about" of 3 short paragraphs in first person,
group skills into 3-5 named groups, and rewrite experience highlights as impact-first bullets (keep facts; don't invent numbers).
If the resume mentions projects, list them. Return ONLY JSON with the same shape as the draft.`,
            },
            { role: "user", content: `DRAFT\n${JSON.stringify(base)}\n\nRESUME\n${(jp?.resume_text ?? "").slice(0, 8000)}` },
          ],
          temperature: 0.5,
          maxTokens: 3500,
          purpose: "portfolio",
        },
        (v) => {
          if (!v || typeof v !== "object") throw new Error("bad json");
          return v as Partial<PortfolioData>;
        },
      );
      return { ok: true, data: { ...base, ...data, links: { ...base.links, ...(data.links ?? {}) } }, ai: true };
    } catch {
      return { ok: true, data: base, ai: false };
    }
  });
}
