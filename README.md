# Productivize

A calm, Linear-style productivity app for two people, built only on open-source tools and free tiers:

- **Today** (default page): tasks with natural-language quick add, priorities, tags, estimates, recurring tasks and reminders. Unfinished tasks **carry forward**: you get an end-of-day notification and choose to carry them to tomorrow, reschedule, finish or drop them.
- **Upcoming & Calendar**: plan the week or month; reminders show up on the calendar.
- **Reminders**: one-off, daily, weekday, weekly, monthly and yearly reminders, plus a built-in rhythm (morning brief, end-of-day review, learning nudge, weekly and monthly reviews).
- **Jobs**: **Scout**, an AI agent, interviews you (or reads your resume) and builds a search profile. It then searches job boards, company career pages and the web **every hour**, scores each role against you, and alerts you to strong matches. Includes an application tracker (Saved → Applied → Interviewing → Offer) and one-click "tailor with AI" (resume bullets, cover letter, interview prep).
- **Learning**: a daily learning log with a 5-days-a-week goal, streaks, a heatmap, spaced-repetition revisits, an AI weekly recap with a quiz, and one-click **Continue in ChatGPT / Claude** with your notes pre-filled. You get a nudge on days you haven't logged.
- **Portfolio**: your professional home page with a live preview. It can be drafted from your job profile and published at `/p/<your-name>`.
- **Mobile**: an installable PWA with push notifications on Android, iPhone (iOS 16.4+, after "Add to Home Screen") and desktop. Daily and weekly email digests are included too.
- **Habits**: every repeating task ("every 2 weeks", "every mon, wed and fri") is a habit with a streak, a 4-week grid and a completion rate.
- **Focus timer & Plan my day**: Pomodoro or stopwatch per task (estimate vs. actual time), and an AI plan that orders the rest of your day into time blocks.
- **Voice quick-add, calendar feed, share-to-app**: speak a task; subscribe to your tasks and reminders in Google/Apple Calendar; on Android, share a job from LinkedIn/Naukri straight into the tracker.
- **Smarter job search**: semantic matching (free embeddings), 👍/👎 that teach Scout your taste, full descriptions read before scoring, Hacker News "Who is hiring?", Workday career sites, auto-discovered boards for your dream companies, follow-up tasks a week after you apply, and a tailored one-click resume PDF.
- **Flashcards**: turn learning entries into FSRS spaced-repetition cards; job-search gaps become learning suggestions.
- **Together**: shared dashboards you invite people to by email. Each one has a live **Chat** (photos, replies, reactions, @mentions, pins, promises, saved and work messages, search, offline sending, read receipts, typing), a shared **Board** (notes, tasks, discuss, shopping, meals, calendar, plus an AI assistant that can add or change items after you approve), copies of anything you *Share to…*, and each other's weekly numbers. Inside a dashboard everyone picks their own colour (no two people can share one), so you can see at a glance who wrote or added what. The rest of the app keeps the normal theme.
- **Planning preferences** (Settings): wake-up time, bedtime, work hours, best focus time and routines such as *Reading & journaling 22:30–23:30*. *Plan my day* treats them as hard rules (and moves anything the AI misplaces), and quick add suggests a routine's time for matching tasks. Describe a habit in your own words and *Remember* turns it into a routine.
- **Health**: Push / Pull / Legs + Core workouts — today's training day from your rotation, a set logger with last-session numbers and double-progression suggestions, strength charts and PRs, a 4-week streak view, and body weight with a 7-day average, weekly trend and goal.
- **Interests**: what Scout knows about you — career skills, learning topics and hobbies, each with a strength (from your activity) and a job relevance score that decides whether Scout uses it for job search. Scout suggests new ones and asks short check-in questions (max 2 a day).

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
2. In **SQL Editor**, paste and run [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql), then [`0002_more_features.sql`](supabase/migrations/0002_more_features.sql), then [`0003_scout_worker.sql`](supabase/migrations/0003_scout_worker.sql), then [`0004_sharing_interests.sql`](supabase/migrations/0004_sharing_interests.sql), then [`0005_planning_health.sql`](supabase/migrations/0005_planning_health.sql), then [`0006_chat.sql`](supabase/migrations/0006_chat.sql). All are safe to re-run. 0006 also creates the private `chat-images` storage bucket and adds the chat tables to Supabase Realtime.
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
| Jina | [jina.ai](https://jina.ai) | Optional; better page reading + embeddings |
| SearXNG | self-hosted, see [deploy/searxng](deploy/searxng/README.md) | Optional; unlimited web search on a free Oracle VM |

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

### 6. Optional extras

- **Semantic matching** works automatically once `GEMINI_API_KEY` or `JINA_API_KEY` is set. Prefer no third-party embeddings? Deploy the included Supabase Edge Function:
  ```bash
  supabase functions deploy embed --no-verify-jwt
  supabase secrets set EMBED_SECRET=<same value as CRON_SECRET>
  ```
  Then set `EMBED_FUNCTION_ENABLED=true` and `EMBEDDINGS_PROVIDER_ORDER=supabase`.
- **Unlimited web search:** [deploy/searxng](deploy/searxng/README.md) (Oracle Cloud Always Free + Caddy).
- **Calendar:** Settings → Calendar feed → *Add to Google Calendar* / *Open in Apple Calendar*.
- **Together:** create a shared dashboard and invite the other person by email (Together → New shared dashboard). Invite emails go out through the Gmail SMTP settings above; without them the app shows a one-time link you can send yourself. Turn on *Share my weekly progress* to see each other's totals.
- **Chat and Board** need nothing extra beyond migration 0006: Supabase Realtime and Storage are on by default in new projects. If live updates never arrive, check **Database → Publications → supabase_realtime** lists `chat_messages`, `board_items` and the other `chat_*` tables. Optional: set `CHAT_PROPOSAL_SECRET` (any long random string) to sign the board assistant's approval cards; without it the app uses `SUPABASE_SECRET_KEY`.
- **Bringing over an existing two-chat history** (one-time, additive, safe to re-run). In your own terminal, never in a chat or a file you commit:
  ```bash
  # PowerShell: $env:OLD_SUPABASE_URL="https://<old-project>.supabase.co"; $env:OLD_SUPABASE_SERVICE_ROLE_KEY="<old service_role key>"
  node --env-file=.env.local scripts/import-two-chat.mjs --a you@example.com --b them@example.com --name "Us" --dry-run
  node --env-file=.env.local scripts/import-two-chat.mjs --a you@example.com --b them@example.com --name "Us"
  ```
  `--a` / `--b` are the Productivize emails of two-chat's person A and B (both accounts must exist), `--name` creates the dashboard, or pass `--space <id>` to fill one you already share. Messages, photos, reactions, pins, promises, read receipts and the board all come across.
- **Invite links** expire after Supabase's email-link lifetime (default 1 hour; you can raise it to 24 hours in Supabase under **Authentication → Sign In / Providers → Email** (Email OTP expiration)). An expired link is fine: the sign-in page has *Email me a sign-in link*.

### 7. Scout worker (recommended for job search)

The app searches the web and job boards every hour on its own. Run the **Scout worker** on your Windows PC and/or a free Oracle VM to add LinkedIn, Naukri, Indeed and Glassdoor listings (public, never logged in), 100+ curated company career sites, your Gmail job-alert label, and live results for *Jobs → Search & ask*:

```bash
npm run worker:once   # one pass to test
npm run worker        # keep running
```

Setup for Windows, Oracle (Docker) and the Gmail label: [worker/README.md](worker/README.md). Its status shows in **Jobs → Activity**.

### 8. Phones

- **Android (Chrome):** open the site → ⋮ → **Install app** → open it → **Settings → Enable notifications**.
- **iPhone (Safari, iOS 16.4+):** Share → **Add to Home Screen** → open it from the Home Screen → **Settings → Enable notifications**. iOS only allows web push for installed apps.
- **Share to the app (Android):** after installing, LinkedIn/Naukri/Chrome's Share menu lists *Productivize*. Shared job links land in the tracker, already scored. (iOS doesn't support share targets for web apps; paste the link into Jobs → Tracker → Add application instead.)
- Use the same login on your laptop and phone. Every device you enable receives notifications, and Settings lists them.

## How the pieces work

**Carry forward.** At your end-of-day time (default 21:00, set it on the Reminders page) you get *"3 tasks not finished today. Carry them forward?"* with a **Carry all to tomorrow** button (Android/desktop), or tap to open a review where you decide per task. Overdue tasks also show a banner on Today. Carried tasks keep a `carried ×N` badge and their original date. Prefer no prompts? Turn on **Carry forward automatically**.

**Scout and the hourly search.**
1. The onboarding chat collects your profile. The agent asks at most two questions per turn and fills the profile in the background as you answer.
2. Each day the profile becomes a *search plan*: titles, synonyms, keywords, locations and web queries.
3. Every hour, each source that's due is queried. Free APIs are rate-limited politely, and paid-tier-with-free-quota APIs are **paced** so a monthly quota lasts the whole month.
4. Results are normalized and de-duplicated (by URL and by company + title) against everything you've already seen.
5. A keyword pre-filter keeps ~120 candidates. Embeddings re-rank them by meaning and towards jobs like the ones you 👍 (and away from 👎). The top ~8 get their full description fetched, then the LLM chain scores the best ~30 from 0–100, with your feedback in the prompt.
6. Matches at or above your alert score (default 75) trigger a push notification.

**LLM fallback.** Every provider speaks the OpenAI `/chat/completions` format. On a rate limit (429), outage, timeout or invalid JSON, the chain moves to the provider's next model, then the next provider. Rate-limited models cool down so later calls skip them. To change the order, set `LLM_PROVIDER_ORDER`.

**Learning nudges.** At your learning reminder time (default 21:30), if nothing is logged for today, you get a nudge that knows your weekly goal (e.g. *"3/5 this week. You need every remaining day."*). You can stop the nudges once the goal is met.

## Security

- Every table has Row Level Security: each user can only read or write their own rows. The public portfolio is readable only when you publish it.
- Sign-ups are disabled in Supabase. Access is `ALLOWED_EMAILS` plus people invited to a shared dashboard (their account is marked `app_metadata.access = "invited"` by the server), enforced by the proxy and by every API route.
- Shared dashboards only ever hold copies; chat messages can only be sent as yourself and edited by their author, board items record who last changed them, chat photos sit in a private bucket readable only by that dashboard's members, and the board assistant can only delete after you approve a signed card; row-level security limits every shared table to its members, and weekly progress is only visible between people who share a dashboard.
- API keys live only in server environment variables. The browser only gets the Supabase publishable key and the VAPID public key.
- Cron endpoints require `CRON_SECRET`.

## Development

```bash
npm test          # unit + database tests (migrations on in-process Postgres, recurrence, FSRS, ICS, parsing, LLM fallback…)
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
  components/chat        Together → Chat and Board (ported from two-chat, one dashboard at a time)
  lib/chat               chat outbox + offline mirror, realtime, board, assistant ops, identity colours
  lib/ai                 LLM providers + fallback chain + JSON extraction
  lib/search             web search chain + page reader
  lib/jobs               sources, normalization, profile agent, scoring, pipeline
  lib/cron/tick.ts       reminders, digests, carry-forward and learning nudges
  lib/notify             push, email, templates
supabase/                schema migration + pg_cron schedule
public/sw.js             service worker (push, notification actions, offline page)
```

To add an LLM provider, add an entry in `src/lib/ai/providers.ts` and its id to `LLM_PROVIDER_ORDER`. To add a job source, implement a `JobSource` in `src/lib/jobs/sources.ts`.
