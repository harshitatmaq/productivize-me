/**
 * Hard fit rules, applied before (and after) AI scoring so obviously wrong jobs
 * never reach your board: too many years asked, too senior a title, or remote
 * only in countries you can't work in. Pure functions.
 */
import type { JobProfile, RawJob } from "./types";

export type Requirements = { min_years?: number; max_years?: number; level?: "intern" | "junior" | "mid" | "senior" | "lead"; restricted_to?: string[] };

const YEARS_PATTERNS: RegExp[] = [
  /(\d{1,2})\s*(?:\+|plus)\s*(?:years?|yrs?)/gi, // 3+ years
  /(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\s*(?:years?|yrs?)/gi, // 3-5 years
  /(?:minimum|min\.?|at least|atleast)\s*(?:of\s*)?(\d{1,2})\s*(?:years?|yrs?)/gi, // minimum 3 years
  /(\d{1,2})\s*(?:or more|and above)\s*(?:years?|yrs?)/gi, // 3 or more years
  /(\d{1,2})\s*(?:years?|yrs?)\s*(?:of\s*)?(?:\w+\s){0,4}?experience/gi, // 3 years of professional experience
];

/** The experience the posting asks for, e.g. "3+ years" → {min: 3}. Takes the lowest stated minimum. */
export function requiredYears(text: string | null | undefined): { min: number; max?: number } | null {
  if (!text) return null;
  const t = text.slice(0, 12_000);
  let best: { min: number; max?: number } | null = null;
  for (const re of YEARS_PATTERNS) {
    re.lastIndex = 0;
    for (let m = re.exec(t); m; m = re.exec(t)) {
      const min = Number(m[1]);
      const max = m[2] ? Number(m[2]) : undefined;
      if (!Number.isFinite(min) || min > 20 || (max !== undefined && (max < min || max > 30))) continue;
      // Ignore "the company has 10+ years in business"-style mentions.
      const around = t.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60).toLowerCase();
      if (/(company|founded|in business|history|serving|customers|clients)/.test(around) && !/experience|work/.test(around)) continue;
      if (!best || min < best.min) best = { min, max };
    }
  }
  return best;
}

/** Seniority implied by the title. */
export function titleLevel(title: string): Requirements["level"] | null {
  const t = title.toLowerCase();
  if (/\b(intern|internship|trainee|apprentice)\b/.test(t)) return "intern";
  if (/\b(junior|jr\.?|entry[- ]level|graduate|fresher|associate|sde[- ]?(?:i|1)|level 1|l1)\b/.test(t)) return "junior";
  if (/\b(lead|principal|staff|head|director|vp|manager|architect)\b/.test(t)) return "lead";
  if (/\b(senior|sr\.?|sde[- ]?(?:iii|3)|level 3|l3)\b/.test(t)) return "senior";
  return null;
}

/** Job-board level labels ("Mid-level", "Mid-Senior level", "Entry level") → our levels. */
export function boardLevel(label: string | null | undefined): Requirements["level"] | null {
  if (!label) return null;
  const l = label.toLowerCase();
  if (/intern/.test(l)) return "intern";
  if (/entry|junior|associate|graduate/.test(l)) return "junior";
  if (/director|executive|lead|principal|staff/.test(l)) return "lead";
  if (/senior/.test(l)) return "senior";
  if (/mid/.test(l)) return "mid";
  return null;
}

const COUNTRY_NAMES: Record<string, string[]> = {
  in: ["india"],
  us: ["united states", "usa", "us only", "u.s.", "us citizen", "us green card", "green card holder", "us work"],
  gb: ["united kingdom", "uk"],
  ca: ["canada"],
  de: ["germany"],
  nl: ["netherlands"],
  ie: ["ireland"],
  sg: ["singapore"],
  ae: ["united arab emirates", "uae", "dubai"],
  au: ["australia"],
};
const OPEN_REGIONS = /worldwide|anywhere|global|international|any location|remote$/i;

/** Countries/regions a remote posting is limited to, from the board's field or "Remote (United States, Canada)". */
export function locationRestrictions(job: Pick<RawJob, "location" | "remote">, fromBoard?: string[]): string[] {
  if (fromBoard?.length) return fromBoard.map((s) => s.trim()).filter(Boolean);
  const m = (job.location ?? "").match(/remote\s*\(([^)]+)\)/i);
  if (!m) return [];
  const parts = m[1].split(/,|\/|;|\bor\b/).map((s) => s.trim()).filter(Boolean);
  return parts.some((p) => OPEN_REGIONS.test(p)) ? [] : parts;
}

/** Can the candidate work in at least one of these places? */
export function canWorkIn(restrictedTo: string[], profile: JobProfile): boolean {
  if (!restrictedTo.length) return true;
  const own = new Set((profile.countries ?? []).map((c) => c.toLowerCase()));
  const names = [...own].flatMap((c) => COUNTRY_NAMES[c] ?? [c]);
  // Cities in the profile imply the country (Bengaluru → India).
  if ((profile.locations ?? []).some((l) => /india|bangalore|bengaluru|pune|hyderabad|mumbai|delhi|gurgaon|gurugram|noida|chennai|kolkata|ahmedabad/i.test(l))) names.push("india");
  const auth = (profile.work_authorization ?? "").toLowerCase();
  return restrictedTo.some((r) => {
    const x = r.toLowerCase();
    if (/apac|asia|anywhere|worldwide|global/.test(x) && names.includes("india")) return true;
    if (names.some((n) => x.includes(n))) return true;
    // Explicit authorization in the profile ("US citizen", "EU work permit", "authorized in Canada").
    // "needs visa sponsorship for the US" is not authorization.
    if (!auth || /sponsor|need(s)? (a )?visa|require(s)? (a )?visa/.test(auth)) return false;
    return Object.values(COUNTRY_NAMES).some((aliases) => aliases.some((a) => x.includes(a)) && aliases.some((a) => auth.includes(a)));
  });
}

export type FitGate = { verdict: "ok" | "stretch" | "block"; reasons: string[]; cap?: number; requirements: Requirements };

/** What the posting asks for: years (from its text), level (board field or title) and countries. */
export function readRequirements(job: RawJob): Requirements {
  const req: Requirements = {};
  const ry = requiredYears(`${job.title}\n${job.description ?? ""}`);
  if (ry) {
    req.min_years = ry.min;
    if (ry.max) req.max_years = ry.max;
  }
  const level = boardLevel(job.board_level) ?? titleLevel(job.title);
  if (level) req.level = level;
  const restricted = locationRestrictions(job, job.board_restrictions);
  if (restricted.length) req.restricted_to = restricted;
  return req;
}

/**
 * Judges requirements against your profile. "block" never reaches the board;
 * "stretch" is capped. Years rules only apply when your profile says how many years you have.
 */
export function judge(req: Requirements, profile: JobProfile): Omit<FitGate, "requirements"> {
  const reasons: string[] = [];
  const years = typeof profile.years_experience === "number" ? profile.years_experience : null;
  const wantsSenior = (profile.seniority ?? []).some((s) => /senior|lead|staff|principal|manager|director/i.test(s));
  let verdict: FitGate["verdict"] = "ok";
  let cap: number | undefined;
  if (req.restricted_to?.length && !canWorkIn(req.restricted_to, profile)) {
    verdict = "block";
    reasons.push(`Only hires in ${req.restricted_to.slice(0, 3).join(", ")}`);
  }
  if (years !== null && !wantsSenior) {
    if (req.min_years != null && req.min_years >= years + 3) {
      verdict = "block";
      reasons.push(`Asks for ${req.min_years}+ years; you have ${years}`);
    } else if (req.min_years != null && req.min_years > years + 1) {
      if (verdict !== "block") verdict = "stretch";
      cap = 55;
      reasons.push(`Asks for ${req.min_years}+ years; you have ${years}`);
    }
    if ((req.level === "senior" || req.level === "lead") && years < 3) {
      verdict = "block";
      reasons.push(`${req.level === "lead" ? "Lead/principal" : "Senior"} level; you have ${years} year${years === 1 ? "" : "s"}`);
    } else if (req.level === "mid" && years < 2 && verdict === "ok") {
      verdict = "stretch";
      cap = 60;
      reasons.push(`Mid-level role; you have ${years} year${years === 1 ? "" : "s"}`);
    }
  }
  return { verdict, reasons, cap };
}

/** Reads the posting's requirements and judges them against your profile. */
export function fitGate(job: RawJob, profile: JobProfile): FitGate {
  const requirements = readRequirements(job);
  return { ...judge(requirements, profile), requirements };
}

/** One line for the AI scorer: what this posting asks for. */
export function describeRequirements(r: Requirements): string | undefined {
  const parts = [
    r.min_years != null ? `asks ${r.min_years}${r.max_years ? `-${r.max_years}` : "+"} years` : "",
    r.level ? `${r.level} level` : "",
    r.restricted_to?.length ? `only hires in ${r.restricted_to.join(", ")}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join("; ") : undefined;
}

/**
 * What a 👎 reason should change in your profile, so Scout stops showing similar jobs.
 * Returns the profile patch and a sentence for the toast, or null when nothing applies.
 */
export function ruleFromDislike(reason: string, job: { title: string; company: string | null }, profile: JobProfile): { patch: Partial<JobProfile>; message: string } | null {
  const exclude = profile.exclude_keywords ?? [];
  const add = (word: string) => (exclude.some((x) => x.toLowerCase() === word) ? null : [...exclude, word]);
  if (reason === "Not this company" && job.company) {
    const avoid = profile.avoid_companies ?? [];
    if (avoid.some((c) => c.toLowerCase() === job.company!.toLowerCase())) return null;
    return { patch: { avoid_companies: [...avoid, job.company] }, message: `Won't show ${job.company} again` };
  }
  if (reason === "Too senior") {
    const word = job.title.toLowerCase().match(/\b(senior|sr|staff|principal|lead|head|director|manager|architect)\b/)?.[1];
    const next = word ? add(word) : null;
    if (next) return { patch: { exclude_keywords: next }, message: `Hiding titles with “${word}”${typeof profile.years_experience === "number" ? "" : " — set your years of experience in Profile too"}` };
    return typeof profile.years_experience === "number" ? null : { patch: {}, message: "Set your years of experience in Profile so Scout can hide roles asking for more" };
  }
  if (reason === "Too junior") {
    const word = job.title.toLowerCase().match(/\b(intern|internship|trainee|junior|jr|graduate|fresher|entry)\b/)?.[1];
    const next = word ? add(word) : null;
    return next ? { patch: { exclude_keywords: next }, message: `Hiding titles with “${word}”` } : null;
  }
  if (reason === "Location / remote" && !(profile.countries ?? []).length) {
    const india = (profile.locations ?? []).some((l) => /india|bangalore|bengaluru|pune|hyderabad|mumbai|delhi|gurgaon|gurugram|noida|chennai/i.test(l));
    return india ? { patch: { countries: ["in"] }, message: "Set your country to India — remote roles limited to other countries are hidden now" } : { patch: {}, message: "Add your country in Profile so Scout hides remote roles limited to other countries" };
  }
  return null;
}
