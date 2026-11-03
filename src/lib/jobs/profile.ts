import "server-only";

import { chatJson, type ChatMessage } from "@/lib/ai/llm";
import type { JobProfile, RemotePreference, SearchPlan, WebQuery } from "./types";

export type OnboardingTurn = { role: "user" | "assistant"; content: string; at?: string };

export type OnboardingReply = {
  reply: string;
  done: boolean;
  progress: number;
  profile_patch: Partial<JobProfile>;
  suggestions?: string[];
};

const PROFILE_FIELDS = `name, headline, summary, current_title, years_experience (number), skills[], tools[], domains[],
experience[{title, company, start, end, location, highlights[]}], education[{degree, school, year}], certifications[],
target_titles[], seniority[] (intern|junior|mid|senior|lead|staff|principal|manager|director), locations[] (cities),
countries[] (ISO-3166 alpha-2 lowercase, e.g. "in", "us"), remote ("remote"|"hybrid"|"onsite"|"any"), open_to_relocate (bool),
work_authorization, salary_expectation, notice_period, job_types[] (full-time|part-time|contract|internship|freelance),
industries[], company_preferences, target_companies[], avoid_companies[], include_keywords[], exclude_keywords[],
must_haves[], deal_breakers[], languages[], links{linkedin, github, portfolio, other}, notes`;

const ONBOARDING_SYSTEM = `You are "Scout", a warm, sharp career coach and senior technical recruiter.
You are interviewing the user to build a precise job-search profile. A background agent will use it to search
the web every hour for jobs that truly fit them, so detail matters.

How to interview:
- Ask at most 2 short, specific questions per turn. Never repeat a question that is already answered.
- If the user shares a resume, extract everything you can from it first, summarise what you understood in 2-3 bullets,
  and only ask about gaps.
- Cover, roughly in this order: current role & years of experience; core skills / stack (and proficiency);
  2-3 proudest achievements with numbers; target roles/titles and seniority; industries or problem spaces they care about;
  preferred locations, remote/hybrid/onsite, relocation; work authorization / visa; expected compensation (with currency)
  and notice period; company size/stage preferences; dream companies and companies to avoid; deal-breakers;
  job types (full-time, contract, internship). Adapt to the person: students, career-switchers and senior leaders need different questions.
- Offer 2-4 quick-reply suggestions the user can tap (short phrases) when it helps.
- When the profile has enough to search well (target titles, skills, seniority, location/remote at minimum),
  tell them you're ready and set done=true. They can always keep refining.
- Be encouraging and concise. Use markdown sparingly (bold, short lists).

Always reply with ONLY a JSON object:
{
  "reply": "your next message to the user (markdown allowed)",
  "done": false,
  "progress": 0-100 (how complete the profile is),
  "profile_patch": { ...only fields you learned or corrected this turn... },
  "suggestions": ["quick reply 1", "quick reply 2"]
}
Allowed profile fields: ${PROFILE_FIELDS}`;

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return typeof v === "string" && v.trim() ? [v.trim()] : undefined;
  const out = v.map((x) => (typeof x === "string" ? x.trim() : String(x ?? "").trim())).filter(Boolean);
  return out.length ? out : undefined;
}

/** Defensive cleanup of whatever the model returned. */
export function sanitizeProfile(input: unknown): Partial<JobProfile> {
  if (!input || typeof input !== "object") return {};
  const p = input as Record<string, unknown>;
  const out: Partial<JobProfile> = {};
  const str = (k: keyof JobProfile) => {
    const v = p[k as string];
    if (typeof v === "string" && v.trim()) (out as Record<string, unknown>)[k] = v.trim();
  };
  const arr = (k: keyof JobProfile) => {
    const v = asStringArray(p[k as string]);
    if (v) (out as Record<string, unknown>)[k] = v;
  };
  (["name", "headline", "summary", "current_title", "work_authorization", "salary_expectation", "notice_period",
    "company_preferences", "notes"] as const).forEach(str);
  (["skills", "tools", "domains", "certifications", "target_titles", "seniority", "locations", "job_types", "industries",
    "target_companies", "avoid_companies", "include_keywords", "exclude_keywords", "must_haves", "deal_breakers",
    "languages"] as const).forEach(arr);
  const countries = asStringArray(p.countries);
  if (countries) out.countries = countries.map((c) => c.toLowerCase().slice(0, 2));
  if (typeof p.years_experience === "number" || typeof p.years_experience === "string") {
    const n = Number.parseFloat(String(p.years_experience));
    if (Number.isFinite(n)) out.years_experience = n;
  }
  if (typeof p.remote === "string" && ["remote", "hybrid", "onsite", "any"].includes(p.remote)) {
    out.remote = p.remote as RemotePreference;
  }
  if (typeof p.open_to_relocate === "boolean") out.open_to_relocate = p.open_to_relocate;
  if (Array.isArray(p.experience)) {
    out.experience = (p.experience as Record<string, unknown>[])
      .filter((e) => e && (e.title || e.company))
      .map((e) => ({
        title: String(e.title ?? ""),
        company: String(e.company ?? ""),
        start: e.start ? String(e.start) : undefined,
        end: e.end ? String(e.end) : undefined,
        location: e.location ? String(e.location) : undefined,
        highlights: asStringArray(e.highlights) ?? [],
      }));
  }
  if (Array.isArray(p.education)) {
    out.education = (p.education as Record<string, unknown>[])
      .filter((e) => e && (e.degree || e.school))
      .map((e) => ({ degree: String(e.degree ?? ""), school: String(e.school ?? ""), year: e.year ? String(e.year) : undefined }));
  }
  if (p.links && typeof p.links === "object") {
    const l = p.links as Record<string, unknown>;
    out.links = Object.fromEntries(
      Object.entries(l).filter(([, v]) => typeof v === "string" && v.trim()),
    ) as JobProfile["links"];
  }
  return out;
}

/** Merge a patch into a profile: scalars overwrite, arrays union (case-insensitive). */
export function mergeProfile(base: JobProfile, patch: Partial<JobProfile>): JobProfile {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null) continue;
    const cur = out[k];
    if (Array.isArray(v) && Array.isArray(cur) && v.every((x) => typeof x === "string")) {
      const seen = new Set((cur as string[]).map((x) => x.toLowerCase()));
      out[k] = [...(cur as string[]), ...(v as string[]).filter((x) => !seen.has(x.toLowerCase()))];
    } else if (k === "links" && typeof v === "object" && typeof cur === "object") {
      out[k] = { ...(cur as object), ...(v as object) };
    } else {
      out[k] = v;
    }
  }
  return out as JobProfile;
}

export async function onboardingTurn(params: {
  history: OnboardingTurn[];
  profile: JobProfile;
  resumeText?: string | null;
}): Promise<OnboardingReply & { provider: string }> {
  const messages: ChatMessage[] = [
    { role: "system", content: ONBOARDING_SYSTEM },
    {
      role: "system",
      content: `Profile collected so far (JSON):\n${JSON.stringify(params.profile).slice(0, 6000)}${
        params.resumeText ? `\n\nResume text (may be partial):\n${params.resumeText.slice(0, 9000)}` : ""
      }`,
    },
    ...params.history.slice(-16).map((t) => ({ role: t.role, content: t.content.slice(0, 6000) })),
  ];
  if (params.history.length === 0) {
    messages.push({
      role: "user",
      content: "Hi! Please start the interview. Introduce yourself in one line and ask your first question(s).",
    });
  }
  const { data, provider } = await chatJson<OnboardingReply>(
    { messages, temperature: 0.5, maxTokens: 1800, purpose: "onboarding" },
    (v) => {
      const o = v as Record<string, unknown>;
      if (typeof o.reply !== "string" || !o.reply.trim()) throw new Error("missing reply");
      return {
        reply: o.reply,
        done: Boolean(o.done),
        progress: Math.max(0, Math.min(100, Number(o.progress) || 0)),
        profile_patch: sanitizeProfile(o.profile_patch),
        suggestions: asStringArray(o.suggestions)?.slice(0, 4),
      };
    },
  );
  return { ...data, provider };
}

/** Turns the whole conversation + resume into a clean, complete profile. */
export async function synthesizeProfile(params: {
  history: OnboardingTurn[];
  profile: JobProfile;
  resumeText?: string | null;
}): Promise<JobProfile> {
  const transcript = params.history.map((t) => `${t.role.toUpperCase()}: ${t.content}`).join("\n").slice(-14000);
  const { data } = await chatJson<Partial<JobProfile>>(
    {
      messages: [
        {
          role: "system",
          content: `You turn a career intake interview into a precise, complete JSON job-search profile.
Infer sensible values (e.g. seniority from years of experience, countries from cities, include_keywords from skills),
write a crisp 1-line headline and a 3-4 sentence first-person summary, and keep facts accurate — never invent employers or numbers.
Return ONLY a JSON object with these fields: ${PROFILE_FIELDS}`,
        },
        {
          role: "user",
          content: `Current profile JSON:\n${JSON.stringify(params.profile)}\n\nResume:\n${(params.resumeText ?? "(none)").slice(0, 9000)}\n\nInterview transcript:\n${transcript}`,
        },
      ],
      temperature: 0.2,
      maxTokens: 3500,
      purpose: "profile-synthesis",
    },
    (v) => sanitizeProfile(v),
  );
  return mergeProfile(params.profile, data);
}

/** A ~1k character description of the candidate used in scoring prompts. */
export function candidateBrief(p: JobProfile): string {
  const parts = [
    p.headline && `Headline: ${p.headline}`,
    p.current_title && `Current: ${p.current_title}${p.years_experience ? `, ${p.years_experience} yrs experience` : ""}`,
    p.target_titles?.length && `Targets: ${p.target_titles.join(", ")}`,
    p.seniority?.length && `Seniority: ${p.seniority.join(", ")}`,
    p.skills?.length && `Skills: ${p.skills.slice(0, 30).join(", ")}`,
    p.domains?.length && `Domains: ${p.domains.join(", ")}`,
    (p.locations?.length || p.remote) &&
      `Location: ${(p.locations ?? []).join(", ") || "flexible"}; work mode: ${p.remote ?? "any"}${p.open_to_relocate ? "; open to relocate" : ""}`,
    p.work_authorization && `Work authorization: ${p.work_authorization}`,
    p.salary_expectation && `Expected pay: ${p.salary_expectation}`,
    p.job_types?.length && `Job types: ${p.job_types.join(", ")}`,
    p.industries?.length && `Industries: ${p.industries.join(", ")}`,
    p.must_haves?.length && `Must-haves: ${p.must_haves.join("; ")}`,
    p.deal_breakers?.length && `Deal-breakers: ${p.deal_breakers.join("; ")}`,
    p.avoid_companies?.length && `Avoid companies: ${p.avoid_companies.join(", ")}`,
  ].filter(Boolean);
  return parts.join("\n").slice(0, 1800);
}

/** Deterministic plan used when the LLM is unavailable. */
export function fallbackPlan(p: JobProfile): SearchPlan {
  const titles = (p.target_titles?.length ? p.target_titles : [p.current_title ?? ""]).filter(Boolean).slice(0, 5);
  const locations = (p.locations ?? []).slice(0, 4);
  const countries = (p.countries ?? []).slice(0, 3);
  const india = countries.includes("in") || locations.some((l) => /india|bangalore|bengaluru|pune|hyderabad|mumbai|delhi|gurgaon|gurugram|noida|chennai/i.test(l));
  const web_queries: WebQuery[] = [];
  for (const t of titles.slice(0, 3)) {
    const loc = locations[0] ?? (p.remote === "remote" ? "remote" : "");
    web_queries.push({ q: `${t} ${loc} hiring`.trim(), domains: india ? "india" : "global" });
    web_queries.push({ q: `${t} ${loc}`.trim(), domains: "ats" });
  }
  if (p.remote === "remote" || p.remote === "any") web_queries.push({ q: `${titles[0] ?? ""} remote`, domains: "remote" });
  return {
    titles,
    keywords: [...(p.include_keywords ?? []), ...(p.skills ?? [])].slice(0, 12),
    locations,
    countries,
    remote: p.remote ?? "any",
    exclude: p.exclude_keywords ?? [],
    web_queries,
  };
}

export async function buildSearchPlan(p: JobProfile): Promise<SearchPlan> {
  const fallback = fallbackPlan(p);
  try {
    const { data } = await chatJson<SearchPlan>(
      {
        messages: [
          {
            role: "system",
            content: `You are a sourcing expert. Design an hourly job-search plan for this candidate.
Return ONLY JSON:
{
 "titles": [4-7 job titles to search, including common synonyms recruiters use],
 "keywords": [8-12 must-match skills/keywords],
 "locations": [cities/regions, or "Remote"],
 "countries": [ISO alpha-2 lowercase],
 "remote": "remote"|"hybrid"|"onsite"|"any",
 "exclude": [title words that disqualify a job, e.g. "intern" for seniors, "senior" for freshers],
 "web_queries": [8-12 objects {"q": "short natural search query for single job postings", "domains": "india"|"ats"|"global"|"startups"|"remote"}]
}
Web queries should target individual postings (e.g. "Senior Backend Engineer Golang Bengaluru"), vary titles/locations/angles,
and use "india" for Indian job boards, "ats" for company career pages (Greenhouse/Lever/Ashby/Workday), "startups", "remote" or "global".`,
          },
          { role: "user", content: candidateBrief(p) },
        ],
        temperature: 0.3,
        maxTokens: 1500,
        purpose: "search-plan",
      },
      (v) => {
        const o = v as Record<string, unknown>;
        const titles = asStringArray(o.titles);
        if (!titles?.length) throw new Error("no titles");
        const wq = Array.isArray(o.web_queries)
          ? (o.web_queries as Record<string, unknown>[])
              .map((q) => (typeof q === "string" ? { q } : { q: String(q.q ?? ""), domains: q.domains as WebQuery["domains"] }))
              .filter((q) => q.q.trim())
          : [];
        return {
          titles: titles.slice(0, 8),
          keywords: asStringArray(o.keywords)?.slice(0, 15) ?? fallback.keywords,
          locations: asStringArray(o.locations) ?? fallback.locations,
          countries: (asStringArray(o.countries) ?? fallback.countries).map((c) => c.toLowerCase().slice(0, 2)),
          remote: (["remote", "hybrid", "onsite", "any"].includes(String(o.remote)) ? o.remote : fallback.remote) as RemotePreference,
          exclude: asStringArray(o.exclude) ?? fallback.exclude,
          web_queries: wq.length ? wq.slice(0, 14) : fallback.web_queries,
        };
      },
    );
    return data;
  } catch (e) {
    console.warn("[jobs] search plan via LLM failed, using fallback:", (e as Error).message);
    return fallback;
  }
}
