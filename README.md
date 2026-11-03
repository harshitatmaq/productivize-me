# Productivize

A calm, Linear-style productivity app for two people, built only on open-source tools and free tiers:

- **Today** (default page): tasks with natural-language quick add, priorities, tags, estimates, recurring tasks and reminders. Unfinished tasks **carry forward**: you get an end-of-day notification and choose to carry them to tomorrow, reschedule, finish or drop them.
- **Upcoming & Calendar**: plan the week or month; reminders show up on the calendar.
- **Reminders**: one-off, daily, weekday, weekly, monthly and yearly reminders, plus a built-in rhythm (morning brief, end-of-day review, learning nudge, weekly and monthly reviews).
- **Jobs**: **Scout**, an AI agent, interviews you (or reads your resume) and builds a search profile. It then searches job boards, company career pages and the web **every hour**, scores each role against you, and alerts you to strong matches. Includes an application tracker (Saved → Applied → Interviewing → Offer) and one-click "tailor with AI" (resume bullets, cover letter, interview prep).
- **Learning**: a daily learning log with a 5-days-a-week goal, streaks, a heatmap, spaced-repetition revisits, an AI weekly recap with a quiz, and one-click **Continue in ChatGPT / Claude** with your notes pre-filled. You get a nudge on days you haven't logged.
- **Portfolio**: your professional home page with a live preview. It can be drafted from your job profile and published at `/p/<your-name>`.
- **Mobile**: an installable PWA with push notifications on Android, iPhone (iOS 16.4+, after "Add to Home Screen") and desktop. Daily and weekly email digests are included too.

## Stack

| Layer | Choice (all open source / free tier) |
| --- | --- |
| App | Next.js 16 (App Router, Cache Components), React 19, TypeScript |
| UI | Tailwind CSS 4, Radix primitives, cmdk (⌘K), lucide icons, Inter, sonner |
| Data | Supabase Postgres + Auth with Row Level Security, TanStack Query |
| Scheduler | Supabase `pg_cron` + `pg_net` (every 5 min for reminders, hourly for jobs) |
| Push / email | Web Push (VAPID, `web-push`), any SMTP via `nodemailer` |
| AI | OpenAI-compatible fallback chain: Groq → Cerebras → Gemini → OpenRouter → Mistral → MAQ AI |
| Job sources | Web search (Tavily → Serper → Brave → Exa → SearXNG), JSearch, Google Jobs (SerpApi), Adzuna, Jooble, Remotive, Remote OK, Himalayas, Jobicy, Arbeitnow, plus Greenhouse/Lever/Ashby/Workable/SmartRecruiters career pages |
| Hosting | Vercel Hobby (free) or any Node host |

```
 phone / laptop (PWA) ──► Next.js on Vercel ──► Supabase (Postgres + Auth, RLS)
        ▲                       │  ▲
   web push + email             │  └── pg_cron calls /api/cron/tick (5 min) and /api/cron/jobs (hourly)
        └───────────────────────┘
                                ├── LLM chain: Groq → Cerebras → Gemini → OpenRouter → Mistral → MAQ AI
                                └── job boards, ATS career pages, web search (budget-paced)
```

## Setup (about 20 minutes)

### 1. Supabase (free)

1. Create a project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, paste and run [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql). It's safe to re-run.
3. **Authentication → Sign In / Providers → Email**: keep Email enabled and **turn off "Allow new users to sign up"**. Only accounts you create can log in.
4. Create the two accounts, either in **Authentication → Users → Add user** (tick "Auto confirm") or from the command line after step 3 below:
   ```bash
   npm run create-user -- you@example.com 'a-strong-password' "Your Name"
   ```
5. From **Project Settings → API**, copy the Project URL, the **publishable** (anon) key and the **secret** (service_role) key.

### 2. Keys (all free)

| What | Where | Notes |
| --- | --- | --- |
| VAPID keys (push) | `npm run vapid` | Public key → `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, private → `VAPID_PRIVATE_KEY` |
| Groq | [console.groq.com/keys](https://console.groq.com/keys) | Fast; first in the chain |
| Cerebras | [cloud.cerebras.ai](https://cloud.cerebras.ai) | Fast, generous daily tokens |
| Gemini | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | Optional |
| OpenRouter | [openrouter.ai/keys](https://openrouter.ai/keys) | Uses `:free` models |
| Mistral | [console.mistral.ai](https://console.mistral.ai/api-keys) | Optional |
| MAQ AI | your endpoint | OpenAI-compatible; always last |
| Tavily | [app.tavily.com](https://app.tavily.com) | Main web search (~1,000 free credits/month) |
| Serper / Brave / Exa | [serper.dev](https://serper.dev), [brave](https://api-dashboard.search.brave.com), [exa.ai](https://dashboard.exa.ai) | Optional fallbacks |
| JSearch (RapidAPI) | [rapidapi.com → JSearch](https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch) | Optional; LinkedIn/Indeed/Glassdoor/Naukri postings |
| SerpApi | [serpapi.com](https://serpapi.com) | Optional; Google Jobs |
| Adzuna / Jooble | [developer.adzuna.com](https://developer.adzuna.com), [jooble.org/api](https://jooble.org/api/about) | Optional; India, US, UK and more |
| Gmail SMTP | Google Account → Security → App passwords | For email digests |

Free-tier limits change; check each provider's pricing page. You only need **one** LLM key and **one** search key to start. Remotive, Remote OK, Himalayas, Jobicy, Arbeitnow and company career pages need no key at all.

### 3. Run locally

```bash
cp .env.example .env.local   # fill in the values
npm install
npm run dev
```

Open http://localhost:3000 and sign in. To test push locally, run `NEXT_PUBLIC_SW_IN_DEV=1 npx next dev --experimental-https`, because push needs HTTPS and a service worker.

### 4. Deploy to Vercel (free)

1. Import this repo at [vercel.com/new](https://vercel.com/new).
2. Add every variable from `.env.example` that you filled in. Set `NEXT_PUBLIC_APP_URL` to your Vercel URL.
3. Deploy. Long-running routes (job search) use up to 300 s, which the Hobby plan allows.

### 5. Turn on the scheduler

Vercel's free plan only allows daily cron jobs, so the schedule runs inside Supabase instead (free):

1. Open [`supabase/cron.sql`](supabase/cron.sql) and set your deployed URL and the same `CRON_SECRET`.
2. Run it in the Supabase SQL editor.
3. Check it with `select * from cron.job_run_details order by start_time desc limit 10;`.

This calls `/api/cron/tick` every 5 minutes (reminders, morning brief, end-of-day carry-forward prompt, learning nudge, weekly/monthly review) and `/api/cron/jobs` every hour. You can also trigger them by hand:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://your-app.vercel.app/api/cron/tick
```

The [GitHub Actions workflow](.github/workflows/scheduler.yml) is a manual alternative, and [cron-job.org](https://cron-job.org) works as well.

### 6. Phones

- **Android (Chrome):** open the site → ⋮ → **Install app** → open it → **Settings → Enable notifications**.
- **iPhone (Safari, iOS 16.4+):** Share → **Add to Home Screen** → open it from the Home Screen → **Settings → Enable notifications**. iOS only allows web push for installed apps.
- Use the same login on your laptop and phone. Every device you enable receives notifications, and Settings lists them.

## How the pieces work

**Carry forward.** At your end-of-day time (default 21:00, set it on the Reminders page) you get *"3 tasks not finished today. Carry them forward?"* with a **Carry all to tomorrow** button (Android/desktop), or tap to open a review where you decide per task. Overdue tasks also show a banner on Today. Carried tasks keep a `carried ×N` badge and their original date. Prefer no prompts? Turn on **Carry forward automatically**.

**Scout and the hourly search.**
1. The onboarding chat collects your profile. The agent asks at most two questions per turn and fills the profile in the background as you answer.
2. Each day the profile becomes a *search plan*: titles, synonyms, keywords, locations and web queries.
3. Every hour, each source that's due is queried. Free APIs are rate-limited politely, and paid-tier-with-free-quota APIs are **paced** so a monthly quota lasts the whole month.
4. Results are normalized and de-duplicated (by URL and by company + title) against everything you've already seen.
5. A cheap keyword pre-filter picks the most promising ~30. The LLM chain then scores each one 0–100 with reasons and concerns, and cleans up messy search results.
6. Matches at or above your alert score (default 75) trigger a push notification.

**LLM fallback.** Every provider speaks the OpenAI `/chat/completions` format. On a rate limit (429), outage, timeout or invalid JSON, the chain moves to the provider's next model, then the next provider. Rate-limited models cool down so later calls skip them. To change the order, set `LLM_PROVIDER_ORDER`.

**Learning nudges.** At your learning reminder time (default 21:30), if nothing is logged for today, you get a nudge that knows your weekly goal (e.g. *"3/5 this week. You need every remaining day."*). You can stop the nudges once the goal is met.

## Security

- Every table has Row Level Security: each user can only read or write their own rows. The public portfolio is readable only when you publish it.
- Sign-ups are disabled in Supabase, and `ALLOWED_EMAILS` is enforced by the proxy and by every API route.
- API keys live only in server environment variables. The browser only gets the Supabase publishable key and the VAPID public key.
- Cron endpoints require `CRON_SECRET`.

## Development

```bash
npm test          # unit tests (time zones, recurrence, quick-add parsing, dedupe, LLM fallback, budgets)
npm run typecheck
npm run lint
npm run build
```

```
src/
  app/(app)/…            pages: Today (/), upcoming, calendar, reminders, jobs, learning, portfolio, settings
  app/api/…              route handlers: cron, push, tasks, jobs, resume, learning, portfolio, status
  app/p/[slug]           public portfolio
  components/…           UI (shell, tasks, planner, jobs, learning, portfolio, settings, ui primitives)
  lib/ai                 LLM providers + fallback chain + JSON extraction
  lib/search             web search chain + page reader
  lib/jobs               sources, normalization, profile agent, scoring, pipeline
  lib/cron/tick.ts       reminders, digests, carry-forward and learning nudges
  lib/notify             push, email, templates
supabase/                schema migration + pg_cron schedule
public/sw.js             service worker (push, notification actions, offline page)
```

To add an LLM provider, add an entry in `src/lib/ai/providers.ts` and its id to `LLM_PROVIDER_ORDER`. To add a job source, implement a `JobSource` in `src/lib/jobs/sources.ts`.
