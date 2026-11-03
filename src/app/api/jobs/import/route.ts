import { z } from "zod";
import { chatJson } from "@/lib/ai/llm";
import { handle, HttpError, requireUser } from "@/lib/auth";
import { fetchFullDescription, pageTitle } from "@/lib/jobs/enrich";
import { dedupeKey, domainOf, hash, normalizeUrl } from "@/lib/jobs/normalize";
import { candidateBrief } from "@/lib/jobs/profile";
import type { JobProfile } from "@/lib/jobs/types";
import { readPage } from "@/lib/search/web";

export const maxDuration = 120;

const Body = z.object({
  url: z.string().url(),
  text: z.string().max(5000).optional(),
  status: z.enum(["new", "saved", "applied"]).default("saved"),
});

type Extracted = {
  is_job_posting: boolean;
  title: string;
  company: string | null;
  location: string | null;
  remote: boolean | null;
  salary: string | null;
  employment_type: string | null;
  summary: string;
  score: number;
  reasons: string[];
  concerns: string[];
};

/**
 * Adds a job from a link (phone share sheet, or pasted into the tracker): reads the
 * page, extracts the details with the LLM chain and scores it against your profile.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const { user, supabase } = await requireUser();
    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new HttpError(400, "Send a valid job URL");
    const url = normalizeUrl(parsed.data.url);

    const { data: existing } = await supabase.from("jobs").select("*").eq("url_hash", hash(url)).maybeSingle();
    if (existing) return { ok: true, job: existing, duplicate: true };

    const [{ data: jp }, raw] = await Promise.all([
      supabase.from("job_profiles").select("profile").eq("user_id", user.id).maybeSingle(),
      readPage(url, 12_000),
    ]);
    const description = (await fetchFullDescription(url)) ?? raw ?? parsed.data.text ?? "";
    const titleHint = pageTitle(raw) ?? parsed.data.text?.split("\n")[0] ?? url;

    let ex: Extracted | null = null;
    try {
      const { data } = await chatJson<Extracted>(
        {
          messages: [
            {
              role: "system",
              content: `Extract a job posting and judge its fit for the candidate. Return ONLY JSON:
{"is_job_posting":true,"title":"","company":null,"location":null,"remote":null,"salary":null,"employment_type":null,
"summary":"2-3 sentence summary of the role","score":0-100,"reasons":["max 3"],"concerns":["max 2"]}
Scoring: 90+ near-perfect, 75-89 strong, 60-74 decent, 40-59 stretch, <40 poor.`,
            },
            {
              role: "user",
              content: `CANDIDATE\n${candidateBrief((jp?.profile as JobProfile) ?? {}) || "(no profile yet)"}\n\nPAGE TITLE: ${titleHint}\nURL: ${url}\n\n${description.slice(0, 9000)}`,
            },
          ],
          temperature: 0.1,
          maxTokens: 1500,
          purpose: "job-import",
        },
        (v) => {
          const o = v as Partial<Extracted>;
          if (typeof o.title !== "string") throw new Error("no title");
          return o as Extracted;
        },
      );
      ex = data;
    } catch (e) {
      console.warn("[import] extraction failed:", (e as Error).message);
    }

    const title = (ex?.title || titleHint.replace(/\s*[|–-]\s*(LinkedIn|Naukri.*|Indeed.*|Glassdoor.*)$/i, "")).slice(0, 300);
    const company = ex?.company ?? null;
    const row = {
      user_id: user.id,
      source: "shared",
      url,
      url_hash: hash(url),
      dedupe_key: `${dedupeKey({ title, company, url })}`,
      title,
      company,
      company_domain: domainOf(url),
      location: ex?.location ?? null,
      remote: ex?.remote ?? null,
      salary: ex?.salary ?? null,
      employment_type: ex?.employment_type ?? null,
      description: (description || ex?.summary || "").slice(0, 12_000) || null,
      score: ex ? Math.max(0, Math.min(100, Math.round(Number(ex.score) || 0))) : null,
      verdict: ex ? (ex.score >= 75 ? "strong" : ex.score >= 60 ? "good" : "stretch") : null,
      reasons: (ex?.reasons ?? []).slice(0, 3),
      concerns: (ex?.concerns ?? []).slice(0, 2),
      status: parsed.data.status,
      applied_at: parsed.data.status === "applied" ? new Date().toISOString() : null,
      seen_at: new Date().toISOString(),
    };
    let { data: job, error } = await supabase.from("jobs").insert(row).select("*").single();
    if (error?.code === "23505") {
      // Same company + title already tracked under another link.
      ({ data: job, error } = await supabase.from("jobs").insert({ ...row, dedupe_key: `${row.dedupe_key}#${hash(url).slice(0, 6)}` }).select("*").single());
    }
    if (error) throw new HttpError(500, error.message);
    return { ok: true, job, extracted: !!ex, isJob: ex?.is_job_posting ?? null };
  });
}
