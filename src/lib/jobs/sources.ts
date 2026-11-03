import "server-only";

import { env, envInt } from "@/lib/env";
import { webSearch } from "@/lib/search/web";
import { paceAllows, recordCall } from "@/lib/usage";
import { domainOf, formatSalary, looksLikeListingPage, stripHtml } from "./normalize";
import type { RawJob, SearchPlan, WatchCompany, WebQuery } from "./types";

export type SourceContext = {
  plan: SearchPlan;
  watch: WatchCompany[];
  /** Manual "search now": skip interval and pacing checks. */
  manual: boolean;
  /** Rotating cursor (persisted per user+source) so each run tries different queries. */
  cursor: number;
  log: (msg: string) => void;
};

export type JobSource = {
  id: string;
  label: string;
  kind: "free" | "key" | "search" | "ats";
  /** Minimum minutes between runs per user (be polite to free APIs). */
  minIntervalMin: number;
  configured: () => boolean;
  signupUrl?: string;
  fetch: (ctx: SourceContext) => Promise<RawJob[]>;
};

const UA = "ProductivizeMe/1.0 (personal job tracker; +https://github.com/harshitatmaq/productivize-me)";

async function getJson<T>(url: string, init: RequestInit = {}, timeoutMs = 20_000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      headers: { "User-Agent": UA, Accept: "application/json", ...(init.headers ?? {}) },
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

const pick = <T,>(arr: T[], cursor: number, n: number): T[] => {
  if (arr.length <= n) return arr;
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(arr[(cursor + i) % arr.length]);
  return out;
};

const wantsRemote = (plan: SearchPlan) => plan.remote !== "onsite";
const toIso = (v: string | number | null | undefined) => {
  if (v === null || v === undefined || v === "") return null;
  const d = typeof v === "number" ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

// ----------------------------------------------------------------------------
// Free, key-less job boards
// ----------------------------------------------------------------------------

const remotive: JobSource = {
  id: "remotive",
  label: "Remotive (remote)",
  kind: "free",
  minIntervalMin: 360,
  configured: () => true,
  async fetch({ plan, cursor }) {
    if (!wantsRemote(plan)) return [];
    const out: RawJob[] = [];
    for (const q of pick(plan.titles, cursor, 2)) {
      const data = await getJson<{ jobs?: Record<string, unknown>[] }>(
        `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(q)}&limit=40`,
      );
      for (const j of data.jobs ?? []) {
        out.push({
          source: "remotive",
          external_id: String(j.id),
          url: String(j.url),
          title: String(j.title),
          company: (j.company_name as string) ?? null,
          company_logo: (j.company_logo as string) ?? null,
          location: (j.candidate_required_location as string) ?? "Remote",
          remote: true,
          employment_type: (j.job_type as string) ?? null,
          salary: (j.salary as string) || null,
          description: stripHtml(j.description as string),
          posted_at: toIso(j.publication_date as string),
          tags: (j.tags as string[]) ?? [],
        });
      }
    }
    return out;
  },
};

const arbeitnow: JobSource = {
  id: "arbeitnow",
  label: "Arbeitnow (EU + remote)",
  kind: "free",
  minIntervalMin: 120,
  configured: () => true,
  async fetch() {
    const data = await getJson<{ data?: Record<string, unknown>[] }>("https://www.arbeitnow.com/api/job-board-api");
    return (data.data ?? []).map((j) => ({
      source: "arbeitnow",
      external_id: String(j.slug),
      url: String(j.url),
      title: String(j.title),
      company: (j.company_name as string) ?? null,
      location: (j.location as string) ?? null,
      remote: Boolean(j.remote),
      employment_type: ((j.job_types as string[]) ?? []).join(", ") || null,
      description: stripHtml(j.description as string),
      posted_at: toIso(j.created_at as number),
      tags: (j.tags as string[]) ?? [],
    }));
  },
};

const remoteok: JobSource = {
  id: "remoteok",
  label: "Remote OK",
  kind: "free",
  minIntervalMin: 180,
  configured: () => true,
  async fetch({ plan }) {
    if (!wantsRemote(plan)) return [];
    const data = await getJson<Record<string, unknown>[]>("https://remoteok.com/api");
    return data
      .filter((j) => j && j.id && j.position)
      .map((j) => ({
        source: "remoteok",
        external_id: String(j.id),
        url: String(j.url ?? j.apply_url),
        title: String(j.position),
        company: (j.company as string) ?? null,
        company_logo: (j.company_logo as string) || (j.logo as string) || null,
        location: (j.location as string) || "Remote",
        remote: true,
        salary: formatSalary(j.salary_min as number, j.salary_max as number, "USD", "year"),
        description: stripHtml(j.description as string),
        posted_at: toIso((j.date as string) ?? (j.epoch as number)),
        tags: (j.tags as string[]) ?? [],
      }));
  },
};

const himalayas: JobSource = {
  id: "himalayas",
  label: "Himalayas (remote)",
  kind: "free",
  minIntervalMin: 180,
  configured: () => true,
  async fetch({ plan, cursor }) {
    if (!wantsRemote(plan)) return [];
    const out: RawJob[] = [];
    for (const q of pick(plan.titles, cursor, 2)) {
      const data = await getJson<{ jobs?: Record<string, unknown>[] }>(
        `https://himalayas.app/jobs/api/search?q=${encodeURIComponent(q)}&sort=recent`,
      );
      for (const j of data.jobs ?? []) {
        const restrictions = (j.locationRestrictions as string[]) ?? [];
        out.push({
          source: "himalayas",
          external_id: String(j.guid ?? j.applicationLink),
          url: String(j.applicationLink ?? j.guid),
          title: String(j.title),
          company: (j.companyName as string) ?? null,
          company_logo: (j.companyLogo as string) ?? null,
          location: restrictions.length ? `Remote (${restrictions.join(", ")})` : "Remote (worldwide)",
          remote: true,
          employment_type: (j.employmentType as string) ?? null,
          salary: formatSalary(j.minSalary as number, j.maxSalary as number, j.currency as string, "year"),
          description: stripHtml((j.description as string) ?? (j.excerpt as string)),
          posted_at: toIso(j.pubDate as number),
          tags: (j.categories as string[]) ?? [],
        });
      }
    }
    return out;
  },
};

const jobicy: JobSource = {
  id: "jobicy",
  label: "Jobicy (remote)",
  kind: "free",
  minIntervalMin: 360,
  configured: () => true,
  async fetch({ plan, cursor }) {
    if (!wantsRemote(plan)) return [];
    const tag = (pick(plan.keywords.length ? plan.keywords : plan.titles, cursor, 1)[0] ?? "").toLowerCase();
    const data = await getJson<{ jobs?: Record<string, unknown>[] }>(
      `https://jobicy.com/api/v2/remote-jobs?count=50${tag ? `&tag=${encodeURIComponent(tag)}` : ""}`,
    );
    return (data.jobs ?? []).map((j) => ({
      source: "jobicy",
      external_id: String(j.id),
      url: String(j.url),
      title: decodeTitle(String(j.jobTitle)),
      company: (j.companyName as string) ?? null,
      company_logo: (j.companyLogo as string) ?? null,
      location: `Remote (${(j.jobGeo as string) ?? "anywhere"})`,
      remote: true,
      employment_type: Array.isArray(j.jobType) ? (j.jobType as string[]).join(", ") : ((j.jobType as string) ?? null),
      salary: formatSalary(j.annualSalaryMin as number, j.annualSalaryMax as number, j.salaryCurrency as string, "year"),
      description: stripHtml((j.jobDescription as string) ?? (j.jobExcerpt as string)),
      posted_at: toIso(j.pubDate as string),
      tags: Array.isArray(j.jobIndustry) ? (j.jobIndustry as string[]) : [],
    }));
  },
};

function decodeTitle(s: string) {
  return stripHtml(s, 300);
}

// ----------------------------------------------------------------------------
// Free-tier APIs that need a key
// ----------------------------------------------------------------------------

const ADZUNA_COUNTRIES = new Set([
  "gb", "us", "at", "au", "be", "br", "ca", "ch", "de", "es", "fr", "in", "it", "mx", "nl", "nz", "pl", "sg", "za",
]);

const adzuna: JobSource = {
  id: "adzuna",
  label: "Adzuna",
  kind: "key",
  minIntervalMin: 60,
  configured: () => !!(env("ADZUNA_APP_ID") && env("ADZUNA_APP_KEY")),
  signupUrl: "https://developer.adzuna.com",
  async fetch({ plan, cursor, manual, log }) {
    const countries = plan.countries.filter((c) => ADZUNA_COUNTRIES.has(c)).slice(0, 2);
    if (!countries.length) return [];
    const out: RawJob[] = [];
    const limit = envInt("ADZUNA_DAILY_LIMIT", 200);
    for (const country of countries) {
      for (const what of pick(plan.titles, cursor, 1)) {
        if (!manual && !(await paceAllows("jobs:adzuna", limit, "day"))) {
          log("adzuna: paced");
          return out;
        }
        const u = new URL(`https://api.adzuna.com/v1/api/jobs/${country}/search/1`);
        u.searchParams.set("app_id", env("ADZUNA_APP_ID")!);
        u.searchParams.set("app_key", env("ADZUNA_APP_KEY")!);
        u.searchParams.set("results_per_page", "50");
        u.searchParams.set("what", what);
        u.searchParams.set("max_days_old", "7");
        u.searchParams.set("sort_by", "date");
        const where = plan.locations.find((l) => !/remote/i.test(l));
        if (where && plan.remote !== "remote") u.searchParams.set("where", where.split(",")[0]);
        const data = await getJson<{ results?: Record<string, unknown>[] }>(u.toString());
        await recordCall("jobs:adzuna", "day");
        for (const j of data.results ?? []) {
          const company = j.company as { display_name?: string } | undefined;
          const location = j.location as { display_name?: string } | undefined;
          out.push({
            source: "adzuna",
            external_id: String(j.id),
            url: String(j.redirect_url),
            title: stripHtml(String(j.title), 300),
            company: company?.display_name ?? null,
            location: location?.display_name ?? null,
            remote: /remote/i.test(`${j.title} ${j.description}`) || null,
            employment_type: (j.contract_time as string) ?? null,
            salary: formatSalary(j.salary_min as number, j.salary_max as number, null, "year"),
            description: stripHtml(j.description as string),
            posted_at: toIso(j.created as string),
          });
        }
      }
    }
    return out;
  },
};

const jooble: JobSource = {
  id: "jooble",
  label: "Jooble",
  kind: "key",
  minIntervalMin: 120,
  configured: () => !!env("JOOBLE_API_KEY"),
  signupUrl: "https://jooble.org/api/about",
  async fetch({ plan, cursor, manual, log }) {
    if (!manual && !(await paceAllows("jobs:jooble", envInt("JOOBLE_MONTHLY_LIMIT", 450)))) {
      log("jooble: paced");
      return [];
    }
    const keywords = pick(plan.titles, cursor, 1)[0] ?? plan.keywords[0];
    const location = plan.remote === "remote" ? "Remote" : (plan.locations[0] ?? "");
    const data = await getJson<{ jobs?: Record<string, unknown>[] }>(`https://jooble.org/api/${env("JOOBLE_API_KEY")}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keywords, location, page: "1" }),
    });
    await recordCall("jobs:jooble");
    return (data.jobs ?? []).map((j) => ({
      source: "jooble",
      external_id: String(j.id),
      url: String(j.link),
      title: stripHtml(String(j.title), 300),
      company: (j.company as string) || null,
      location: (j.location as string) || null,
      remote: /remote/i.test(`${j.title} ${j.location}`) || null,
      employment_type: (j.type as string) || null,
      salary: (j.salary as string) || null,
      description: stripHtml(j.snippet as string),
      posted_at: toIso(j.updated as string),
    }));
  },
};

const jsearch: JobSource = {
  id: "jsearch",
  label: "JSearch (LinkedIn, Indeed, Glassdoor… via RapidAPI)",
  kind: "key",
  minIntervalMin: 240,
  configured: () => !!env("RAPIDAPI_KEY"),
  signupUrl: "https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch",
  async fetch({ plan, cursor, manual, log }) {
    if (!manual && !(await paceAllows("jobs:jsearch", envInt("JSEARCH_MONTHLY_LIMIT", 180)))) {
      log("jsearch: paced");
      return [];
    }
    const title = pick(plan.titles, cursor, 1)[0];
    const where = plan.remote === "remote" ? "remote" : (plan.locations[0] ?? "");
    const u = new URL("https://jsearch.p.rapidapi.com/search");
    u.searchParams.set("query", `${title}${where ? ` in ${where}` : ""}`);
    u.searchParams.set("page", "1");
    u.searchParams.set("num_pages", "1");
    u.searchParams.set("date_posted", "3days");
    if (plan.countries[0]) u.searchParams.set("country", plan.countries[0]);
    if (plan.remote === "remote") u.searchParams.set("work_from_home", "true");
    const data = await getJson<{ data?: Record<string, unknown>[] }>(u.toString(), {
      headers: { "X-RapidAPI-Key": env("RAPIDAPI_KEY")!, "X-RapidAPI-Host": "jsearch.p.rapidapi.com" },
    });
    await recordCall("jobs:jsearch");
    return (data.data ?? []).map((j) => ({
      source: `jsearch${j.job_publisher ? `:${String(j.job_publisher).toLowerCase()}` : ""}`,
      external_id: String(j.job_id),
      url: String(j.job_apply_link ?? j.job_google_link),
      title: String(j.job_title),
      company: (j.employer_name as string) ?? null,
      company_logo: (j.employer_logo as string) ?? null,
      company_domain: domainOf(j.employer_website as string),
      location: [j.job_city, j.job_state, j.job_country].filter(Boolean).join(", ") || null,
      remote: Boolean(j.job_is_remote),
      employment_type: (j.job_employment_type as string) ?? null,
      salary: formatSalary(
        j.job_min_salary as number,
        j.job_max_salary as number,
        (j.job_salary_currency as string) ?? null,
        (j.job_salary_period as string) ?? null,
      ),
      description: stripHtml(j.job_description as string),
      posted_at: toIso(j.job_posted_at_datetime_utc as string),
    }));
  },
};

const serpapi: JobSource = {
  id: "serpapi",
  label: "Google Jobs (via SerpApi)",
  kind: "key",
  minIntervalMin: 240,
  configured: () => !!env("SERPAPI_API_KEY"),
  signupUrl: "https://serpapi.com/users/sign_up",
  async fetch({ plan, cursor, manual, log }) {
    if (!manual && !(await paceAllows("jobs:serpapi", envInt("SERPAPI_MONTHLY_LIMIT", 230)))) {
      log("serpapi: paced");
      return [];
    }
    const title = pick(plan.titles, cursor, 1)[0];
    const where = plan.remote === "remote" ? "remote" : (plan.locations[0] ?? "");
    const u = new URL("https://serpapi.com/search.json");
    u.searchParams.set("engine", "google_jobs");
    u.searchParams.set("q", `${title}${where ? ` ${where}` : ""}`);
    u.searchParams.set("hl", "en");
    if (plan.countries[0]) u.searchParams.set("gl", plan.countries[0]);
    u.searchParams.set("api_key", env("SERPAPI_API_KEY")!);
    const data = await getJson<{ jobs_results?: Record<string, unknown>[] }>(u.toString(), {}, 30_000);
    await recordCall("jobs:serpapi");
    return (data.jobs_results ?? []).map((j) => {
      const ext = (j.detected_extensions as Record<string, unknown>) ?? {};
      const apply = (j.apply_options as { link: string }[] | undefined)?.[0]?.link;
      return {
        source: `google:${String(j.via ?? "jobs").replace(/^via\s+/i, "").toLowerCase()}`,
        external_id: String(j.job_id),
        url: String(apply ?? j.share_link),
        title: String(j.title),
        company: (j.company_name as string) ?? null,
        company_logo: (j.thumbnail as string) ?? null,
        location: (j.location as string) ?? null,
        remote: Boolean(ext.work_from_home) || null,
        employment_type: (ext.schedule_type as string) ?? null,
        salary: (ext.salary as string) ?? null,
        description: stripHtml(j.description as string),
        posted_at: parseRelative(ext.posted_at as string),
      };
    });
  },
};

/** "3 days ago" -> ISO date. */
export function parseRelative(s: string | undefined): string | null {
  if (!s) return null;
  if (/today|just now/i.test(s)) return new Date().toISOString();
  if (/yesterday/i.test(s)) return new Date(Date.now() - 86_400_000).toISOString();
  const m = s.match(/(\d+)\s*(minute|hour|day|week|month)/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const ms = { minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000, month: 2_592_000_000 }[unit] ?? 0;
  return new Date(Date.now() - n * ms).toISOString();
}

// ----------------------------------------------------------------------------
// Web search across job sites (Tavily → Serper → Brave → Exa → SearXNG)
// ----------------------------------------------------------------------------

export const DOMAIN_GROUPS: Record<NonNullable<WebQuery["domains"]>, string[]> = {
  india: [
    "linkedin.com",
    "naukri.com",
    "instahyre.com",
    "cutshort.io",
    "wellfound.com",
    "foundit.in",
    "hirist.tech",
    "iimjobs.com",
  ],
  ats: [
    "boards.greenhouse.io",
    "job-boards.greenhouse.io",
    "jobs.lever.co",
    "jobs.ashbyhq.com",
    "apply.workable.com",
    "jobs.smartrecruiters.com",
    "myworkdayjobs.com",
  ],
  global: ["linkedin.com", "indeed.com", "glassdoor.com", "wellfound.com", "builtin.com", "welcometothejungle.com"],
  startups: ["wellfound.com", "workatastartup.com", "ycombinator.com", "cutshort.io", "otta.com"],
  remote: ["weworkremotely.com", "remote.co", "wellfound.com", "workingnomads.com", "remoteok.com", "himalayas.app"],
};

function cleanSearchTitle(title: string): { title: string; company: string | null } {
  // "Data Engineer - Acme | LinkedIn", "Acme hiring Data Engineer in Pune | LinkedIn"
  let t = title.replace(/\s*[|–-]\s*(LinkedIn|Naukri(\.com)?|Indeed|Glassdoor|Wellfound|Instahyre|Cutshort|foundit)\s*$/i, "");
  const hiring = t.match(/^(.+?)\s+hiring\s+(.+?)(?:\s+in\s+.+)?$/i);
  if (hiring) return { title: hiring[2].trim(), company: hiring[1].trim() };
  const at = t.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
  if (at) return { title: at[1].trim(), company: at[2].trim() };
  const dash = t.split(/\s+[-–|]\s+/);
  if (dash.length >= 2) {
    t = dash[0];
    return { title: t.trim(), company: dash[1].trim() };
  }
  return { title: t.trim(), company: null };
}

const web: JobSource = {
  id: "web",
  label: "Web search (LinkedIn, Naukri, Wellfound, career pages…)",
  kind: "search",
  minIntervalMin: 55,
  configured: () => !!(env("TAVILY_API_KEY") || env("SERPER_API_KEY") || env("BRAVE_API_KEY") || env("EXA_API_KEY") || env("SEARXNG_URL")),
  async fetch({ plan, cursor, manual, log }) {
    const queries = plan.web_queries.length
      ? plan.web_queries
      : plan.titles.slice(0, 3).map((t) => ({ q: `${t} job ${plan.locations[0] ?? ""}`.trim(), domains: "ats" as const }));
    const perRun = manual ? 3 : envInt("WEB_QUERIES_PER_RUN", env("SEARXNG_URL") ? 6 : 2);
    const out: RawJob[] = [];
    for (const wq of pick(queries, cursor, perRun)) {
      const domains = wq.domains ? DOMAIN_GROUPS[wq.domains] : [];
      const { results, provider, errors } = await webSearch({
        query: wq.q,
        maxResults: 10,
        recency: "week",
        domains,
        ignorePace: manual,
      });
      if (errors.length) log(`web: ${errors.join("; ")}`);
      for (const r of results) {
        if (looksLikeListingPage(r.title, r.url)) continue;
        const { title, company } = cleanSearchTitle(r.title);
        out.push({
          source: `web:${provider ?? "search"}`,
          url: r.url,
          title,
          company,
          company_domain: domainOf(r.url),
          description: r.snippet,
          posted_at: r.publishedAt && !Number.isNaN(Date.parse(r.publishedAt)) ? new Date(r.publishedAt).toISOString() : null,
          needs_extraction: true,
        });
      }
    }
    return out;
  },
};

// ----------------------------------------------------------------------------
// Hacker News "Ask HN: Who is hiring?" (monthly thread, free Algolia API)
// ----------------------------------------------------------------------------

const ROLE_WORDS = /\b(engineer|developer|scientist|manager|designer|analyst|architect|sre|devops|lead|intern|researcher|programmer|consultant|specialist|head of|director|founding)\b/i;

/** "Acme | Senior Backend Engineer | Remote (US) | $150k" → structured fields. */
export function parseHnPosting(firstLine: string): { company: string; title: string; location: string | null; remote: boolean } | null {
  const parts = firstLine.split("|").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const company = parts[0].replace(/\(.*?\)/g, "").trim();
  const title = parts.slice(1).find((p) => ROLE_WORDS.test(p)) ?? parts[1];
  const location = parts.slice(1).find((p) => p !== title && /remote|onsite|on-site|hybrid|,|\b[A-Z]{2}\b|india|bangalore|bengaluru|london|berlin|york|francisco|europe|usa|us\b/i.test(p)) ?? null;
  return { company, title: title.slice(0, 200), location, remote: /remote/i.test(firstLine) };
}

const hn: JobSource = {
  id: "hn",
  label: "Hacker News — Who is hiring?",
  kind: "free",
  minIntervalMin: 720,
  configured: () => true,
  async fetch({ plan }) {
    const stories = await getJson<{ hits?: { objectID: string; title: string }[] }>(
      "https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=10",
    );
    const story = (stories.hits ?? []).find((h) => /who is hiring/i.test(h.title));
    if (!story) return [];
    const comments = await getJson<{ hits?: { objectID: string; comment_text?: string; parent_id?: number; created_at?: string }[] }>(
      `https://hn.algolia.com/api/v1/search?tags=comment,story_${story.objectID}&hitsPerPage=1000`,
    );
    const words = [...plan.titles, ...plan.keywords].flatMap((t) => t.toLowerCase().split(/\s+/)).filter((w) => w.length > 2);
    const out: RawJob[] = [];
    for (const c of comments.hits ?? []) {
      if (String(c.parent_id) !== story.objectID || !c.comment_text) continue;
      const text = stripHtml(c.comment_text, 4000);
      const lower = text.toLowerCase();
      if (!words.some((w) => lower.includes(w))) continue;
      const parsed = parseHnPosting(text.split("\n")[0]);
      if (!parsed) continue;
      out.push({
        source: "hn",
        external_id: c.objectID,
        url: `https://news.ycombinator.com/item?id=${c.objectID}`,
        title: parsed.title,
        company: parsed.company,
        location: parsed.location,
        remote: parsed.remote,
        description: text,
        posted_at: c.created_at ?? null,
      });
    }
    return out;
  },
};

// ----------------------------------------------------------------------------
// Company career pages on public ATS APIs (no key)
// ----------------------------------------------------------------------------

async function fetchAts(c: WatchCompany): Promise<RawJob[]> {
  const name = c.name ?? c.slug;
  switch (c.ats) {
    case "greenhouse": {
      const d = await getJson<{ jobs?: Record<string, unknown>[] }>(
        `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(c.slug)}/jobs?content=true`,
      );
      return (d.jobs ?? []).map((j) => ({
        source: "greenhouse",
        external_id: String(j.id),
        url: String(j.absolute_url),
        title: String(j.title),
        company: (j.company_name as string) ?? name,
        location: (j.location as { name?: string })?.name ?? null,
        remote: /remote/i.test((j.location as { name?: string })?.name ?? ""),
        description: stripHtml(j.content as string),
        posted_at: toIso((j.first_published as string) ?? (j.updated_at as string)),
      }));
    }
    case "lever": {
      const d = await getJson<Record<string, unknown>[]>(
        `https://api.lever.co/v0/postings/${encodeURIComponent(c.slug)}?mode=json`,
      );
      return d.map((j) => {
        const cat = (j.categories as Record<string, string>) ?? {};
        return {
          source: "lever",
          external_id: String(j.id),
          url: String(j.hostedUrl),
          title: String(j.text),
          company: name,
          location: cat.location ?? null,
          remote: j.workplaceType === "remote" || /remote/i.test(cat.location ?? ""),
          employment_type: cat.commitment ?? null,
          description: String(j.descriptionPlain ?? "").slice(0, 4000),
          posted_at: toIso(j.createdAt as number),
        };
      });
    }
    case "ashby": {
      const d = await getJson<{ jobs?: Record<string, unknown>[] }>(
        `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(c.slug)}?includeCompensation=true`,
      );
      return (d.jobs ?? []).map((j) => ({
        source: "ashby",
        external_id: String(j.id),
        url: String(j.jobUrl),
        title: String(j.title),
        company: name,
        location: (j.location as string) ?? null,
        remote: Boolean(j.isRemote),
        employment_type: (j.employmentType as string) ?? null,
        salary: ((j.compensation as Record<string, string>) ?? {}).compensationTierSummary ?? null,
        description: String(j.descriptionPlain ?? "").slice(0, 4000),
        posted_at: toIso(j.publishedAt as string),
      }));
    }
    case "workable": {
      const d = await getJson<{ name?: string; jobs?: Record<string, unknown>[] }>(
        `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(c.slug)}`,
      );
      return (d.jobs ?? []).map((j) => ({
        source: "workable",
        external_id: String(j.shortcode),
        url: String(j.url ?? j.shortlink),
        title: String(j.title),
        company: d.name ?? name,
        location: [j.city, j.country].filter(Boolean).join(", ") || null,
        remote: Boolean(j.telecommuting),
        employment_type: (j.employment_type as string) ?? null,
        description: stripHtml(j.description as string),
        posted_at: toIso(j.published_on as string),
      }));
    }
    case "workday": {
      const [host, site] = c.slug.split("/");
      const tenant = host.split(".")[0];
      const out: RawJob[] = [];
      const queries = [...new Set((c as WatchCompany & { queries?: string[] }).queries ?? [""])].slice(0, 2);
      for (const searchText of queries) {
        const d = await getJson<{ jobPostings?: Record<string, unknown>[] }>(`https://${host}/wday/cxs/${tenant}/${site}/jobs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText }),
        });
        for (const j of d.jobPostings ?? []) {
          if (!j.externalPath) continue;
          out.push({
            source: "workday",
            external_id: String(j.externalPath),
            url: `https://${host}/${site}${j.externalPath}`,
            title: String(j.title),
            company: name,
            location: (j.locationsText as string) ?? null,
            remote: /remote/i.test(String(j.locationsText ?? "")),
            posted_at: parseRelative(j.postedOn as string),
          });
        }
      }
      return out;
    }
    case "smartrecruiters": {
      const d = await getJson<{ content?: Record<string, unknown>[] }>(
        `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(c.slug)}/postings?limit=100`,
      );
      return (d.content ?? []).map((j) => {
        const loc = (j.location as Record<string, unknown>) ?? {};
        return {
          source: "smartrecruiters",
          external_id: String(j.id),
          url: `https://jobs.smartrecruiters.com/${c.slug}/${j.id}`,
          title: String(j.name),
          company: ((j.company as Record<string, string>) ?? {}).name ?? name,
          location: [loc.city, loc.country].filter(Boolean).join(", ") || null,
          remote: Boolean(loc.remote),
          posted_at: toIso(j.releasedDate as string),
        };
      });
    }
  }
}

const ats: JobSource = {
  id: "ats",
  label: "Watched companies (Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Workday)",
  kind: "ats",
  minIntervalMin: 120,
  configured: () => true,
  async fetch({ watch, log, plan }) {
    // Workday boards are searched by title instead of listing everything.
    const withQueries = watch.slice(0, 30).map((c) => (c.ats === "workday" ? { ...c, queries: plan.titles.slice(0, 2) } : c));
    const results = await Promise.allSettled(withQueries.map(fetchAts));
    const out: RawJob[] = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") out.push(...r.value);
      else log(`ats ${watch[i].ats}/${watch[i].slug}: ${(r.reason as Error).message}`);
    });
    return out;
  },
};

export const JOB_SOURCES: JobSource[] = [web, jsearch, serpapi, adzuna, jooble, ats, hn, remotive, himalayas, remoteok, jobicy, arbeitnow];

export function jobSourceSummary() {
  return JOB_SOURCES.map((s) => ({
    id: s.id,
    label: s.label,
    kind: s.kind,
    configured: s.configured(),
    minIntervalMin: s.minIntervalMin,
    signupUrl: s.signupUrl,
  }));
}
