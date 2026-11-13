# Productivize — Roadmap: Scout v2 (job search, applications, career memory)

Status: **Phase 1 built** (worker + queue, JobSpy / curated career sites / Gmail label sources, live-streaming feed, Search & ask Scout). **Phase 2 built** (Interests + career memory, shared dashboards with email invites, Share to…, icon labels). Phases 3–6 start after a go-ahead.
Platforms: **Android + Windows first** (iPhone pieces that already exist stay as they are).

---

## Decisions log

| # | Decision | Choice |
|---|---|---|
| 1 | Where the background worker runs | **Both**: Oracle Cloud Always Free VM (24/7) + optional worker on our Windows PCs (residential IP, helps LinkedIn/Naukri) |
| 2 | Gmail | **Yes**, read only a **"Productivize" label in the main inbox** via IMAP + Gmail app password |
| 3 | Filling applications | **Option A**: our own Edge/Chrome extension fills forms in the user's browser and stops before Submit. Option B (local Playwright/Claude Code helper) stays a fallback |
| 4 | Overnight batch (MAQ AI first) | **02:00 IST** daily |
| 5 | Scout check-in questions | **Max 2/day, in-app only** (Today card + notification inbox); pending questions are mentioned in the morning brief, never as separate pushes |
| 6 | LinkedIn / Naukri | **Never automated while logged in.** Jobs come from public listings (JobSpy, low volume) and alert emails; applying there stays manual (copy-paste Apply sheet) |
| 7 | Submitting | **The user always presses Submit.** No auto-submit anywhere |
| 8 | Interests | **Everything**: career skills, learning topics and hobbies. Each gets a **strength** and a **job relevance (0–100)**; Scout searches for it at ≥70, counts it as a small bonus at 40–69 when a job mentions it, ignores it below 40. Overrides: *Use for jobs* / *Never use for jobs* |
| 9 | Sharing | **Copies.** Sharing never exposes the original; the shared dashboard holds its own copy that members can work on (tick, change status, comment) |
| 10 | Shared dashboards | **Invite anyone by email.** The app becomes invite-only: invitees get their own full private dashboard plus access to the shared dashboards they accept. Weekly progress is only visible between people who share a dashboard |
| 11 | Timing | Interests, sharing and icon labels ship **together with phase 2** (career memory) |
| 13 | Planning | Your **planning preferences** (bedtime, work hours, routines like reading after 22:30, notes) are hard rules for Plan my day, enforced after the AI answers |
| 14 | Health | **Push / Pull / Legs + Core** rotation, set logging with double progression, body weight with 7-day average and goal |
| 12 | UI | Every icon-only button gets a visible label on hover/focus, a long-press label on phones, and an accessible name |
| 15 | Chat (from two-chat) | Lives **inside each shared dashboard** as Chat + Board tabs, works for **any number of people**, keeps all two-chat features (offline outbox, photos, replies, reactions, mentions, pins, promises, saved/work messages, search, read receipts, typing, AI board assistant with approval). **Lists are replaced by the Board** (existing list items moved into Board → Tasks). No separate sign-in: Productivize's login covers it. A one-time script imports an existing two-chat history |
| 16 | Identity colours | Each member picks a colour **per dashboard**; no two members can share one (database-enforced). It colours their messages, board items, shared-feed cards and avatars **only inside Together**; the rest of the app keeps its theme |
| 17 | Personal memory | The AI keeps a list of short facts about you (timing, habits, how you work, likes, dislikes, beliefs, goals, life) with confidence and evidence. Your own words are used at once; learned patterns need ≥75 confidence or your yes (asked on Today, max 2 a day); they strengthen when seen again and fade when not. Learned time windows become hard routines only after you confirm. Used by Plan my day, learning suggestions and the Scout interview; never shared |
| 18 | Plan my day | Real durations (your estimate → your history → AI judgement), start a few minutes from now, re-plan any time with a typed change; times a plan set stay movable until you change them |
| 19 | Applications | No auto-submit and no extension yet: the app prepares answers (bank → profile → AI drafts for open questions only, "needs you" for facts) and the user submits. Reply emails update status by rules, never via AI |
| 20 | Learning map | After phase 3: a light "connect the dots" layer on existing learning data, not a tutor (LearnHarness covers deep tutoring) |

---

## Architecture

```
          Vercel app (UI, interactive AI, short API calls)      Supabase (Postgres + Realtime + Storage + pg_cron)
                     │                                                         ▲
                     └──────────── agent_jobs queue ───────────────────────────┤
                                                                               │
   Scout worker (Node/TS, Docker)  ◄───────────── polls / claims jobs ─────────┘
     • Oracle VM (always on)  +  Windows PC (when on; residential IP)
     • hourly fetch: ATS APIs, JobSpy (Python subprocess), Gmail label (IMAP), HN/remote boards, web search
     • on save: resolve apply link → read form fields → build application pack + tailored resume
     • 02:00 IST overnight batch on MAQ AI
     • Playwright for pages that need a browser

   Edge/Chrome extension (Windows) → fetches the pack for the open application page, fills it, waits for Submit,
                                      reports the submitted answers back.
   Android → "Apply sheet" with copy buttons.
```

Why a worker: Vercel Hobby functions stop after 300 s and can't host Python/JobSpy, a browser, or 30-minute MAQ jobs.

---

## 1. Hourly job fetching

**Tailored by the AI, cheap per hour**
- The AI rebuilds each user's **search plan** daily, and whenever the profile, career memory or 👍/👎 change:
  titles + synonyms, core skills, **emerging skills** (from career memory), locations, seniority, exclusions,
  companies, and **negative preferences** ("not interested" topics).
- The hourly run is deterministic: it asks every source only for jobs posted in the last ~2 hours (incremental cursors).
  The AI is used for scoring only, after dedupe → keyword filter → semantic (embedding) rank → full-description fetch.
- **Saved searches** from the Search page are added to the hourly fan-out.

**Sources (best first)**

| Source | Coverage | Method | Notes |
|---|---|---|---|
| Company career sites (Greenhouse, Lever, Ashby, Workday, SmartRecruiters) | Thousands of companies | Official public JSON | No blocking. Seed with career-ops' MIT company list + an India list + auto-discovery (exists) |
| JobSpy (open source, MIT) | LinkedIn, Indeed India, Naukri, Glassdoor | Python lib, **no login** | Low volume; LinkedIn throttles bursts and datacenter IPs → PC worker preferred for LinkedIn |
| Gmail "Productivize" label | LinkedIn/Naukri/Indeed alert emails | IMAP (imapflow) | Those sites' own matching; no scraping |
| Existing | HN Who is hiring, remote boards, Adzuna/Jooble/JSearch/SerpApi, web search, SearXNG | — | Already in the app |

---

## 2. Search & ask Scout (new page)

- Natural-language query → AI → structured search.
- Instant results from stored jobs (pgvector semantic search) first, then a **live search** across sources that streams results in.
- Results are ranked by fit to the signed-in user, with reasons and 👍/👎.
- **Save search** → joins hourly runs + alerts.
- Suggestion chips from the profile and career memory ("Fabric Data Engineer", "Analytics Engineer — remote", "Companies like X").
- Classic filters: location, remote, posted within, min score, company, source.
- Searches feed career memory, so repeated interests become facts.

---

## 3. Save → Prepare → Fill → Apply

**On save** (fast lane; MAQ if the fast providers are rate-limited):
1. Resolve the real apply URL. LinkedIn/Naukri "apply on company site" listings are followed through to the company's own page.
2. Detect the site type and read the form fields:
   - **Greenhouse:** `boards-api.greenhouse.io/v1/boards/{board}/jobs/{id}?questions=true`. Full schema, official, no auth.
   - **Ashby:** the documented job-posting info includes the form specification. Needs verifying without auth.
   - **Lever:** parse the apply page with the worker's browser (unofficial).
   - **Workday:** questions only appear after sign-in with that company, so we build a common Workday field set. Partial.
   - **LinkedIn Easy Apply / Naukri:** generic common questions only. Copy-paste.
3. Build the **application pack**: an ordered field list with answer, source (profile / answer bank / AI draft), confidence, and a "needs you" flag.
4. Generate a tailored resume version and cover letter.
5. Card status: `preparing → ready (N fields · M answered · K need you) → filled (awaiting your Submit) → applied`.

**Filling (extension, Windows)**
- Pair the extension once from Settings, which gives it a scoped token.
- On an application page it fetches the pack, fills the fields, uploads the resume version, highlights "needs you" fields, and stops.
- When you press Submit it snapshots the submitted values and detects the confirmation page → status `applied`, plus the follow-up task (already implemented).
- First Greenhouse, Lever and Ashby, then Workday. Generic forms get a best-effort label match.

**Apply sheet (fallback + Android)**: link, every field in order with a copy button, resume and cover letter downloads, then "Mark applied".

**Answer bank (profile, filled once)**
- **Contact:** legal name, email, phone, city, address (optional), LinkedIn/GitHub/portfolio.
- **Work:** company, title, total/relevant experience, current and expected pay (INR/USD), notice period, earliest start, reason for leaving.
- **Eligibility:** work authorization per country, sponsorship Y/N, relocation, locations, work mode.
- **Education:** degree, college, year, grade/CGPA.
- **Files:** master resume (private Supabase Storage) and default cover letter.
- **Reusable answers:** strengths, proud project, why this field, "how did you hear".
- **Optional demographic questions:** default "prefer not to say".
- **Learning:** every new question answered once is saved and reused.

---

## 4. Applied-jobs tracking

The per-application record includes:
- the apply URL and original posting, the site type, and **the resume version used** (stored PDF);
- the cover letter, and **the answers as submitted** (from the extension snapshot or the Apply sheet);
- a timeline (saved, prepared, filled, applied, reply, interview, offer/rejected) with notes and follow-ups.

Statuses also update automatically from email in the Gmail label: confirmations, rejections and interview invites. A weekly insight from the overnight batch shows which resume versions and job types get replies.

---

## 5. Stretch jobs → prompt for Claude / ChatGPT

- "Stretch" badge (≈ 40–70 score) and the button **"I want this anyway → tailor with Claude/ChatGPT"**.
- The free AI composes a detailed prompt containing:
  - the master resume text, full job description and identified gaps;
  - real projects and relevant current learning;
  - honesty rules (reframe, never invent, list gaps to close);
  - the output format (ATS-friendly Markdown sections).
- Buttons: **Copy prompt**, **Open Claude** (claude.ai), **Open ChatGPT** (chatgpt.com). The prompt is too long for URL prefill, and the page asks you to attach the resume file in that chat.
- **Paste the result back** → saved as that job's resume version → rendered to the same PDF → linked in the application record.

---

## 6. Career memory (the living profile)

**Signals**
- learning entries, flashcards, tasks and habits, Scout chats;
- 👍/👎 and reasons, saves and dismissals, applications and outcomes;
- searches, portfolio and profile edits, gaps found in job analyses.

**Facts**: kind (skill / interest / aversion / goal / constraint), state (e.g. learning · 6 sessions · 4h30m), confidence, evidence (links to sources), first/last seen, user confirmation (yes / no / not asked).

**Updating**
- **Instant:** a cheap AI extraction runs on each new signal.
- **Nightly at 02:00 IST (MAQ):** merge duplicates, reinforce repeated signals, fade stale ones, and promote learning → emerging skill. Then rebuild search plans and draft profile/portfolio suggestions.

**Check-in questions** (max 2/day, in-app)
- *"You've logged Fabric 6 times this month. Include Fabric/Power BI data roles?"* → Yes / Not interested / Later.
- *"You passed on 4 roles mentioning on-call. Exclude those?"*
- **Not interested** becomes a hard negative preference (search plan + ranking penalty + scoring prompt) and is never asked again.

**Autonomy rule**
- Internal knowledge (search weights, ranking, emerging keywords) updates automatically.
- Anything visible to others (portfolio, resume content) is proposed and applied with one tap.

**"What Scout knows about me" page**: every fact, its evidence, confidence, and edit / confirm / forget controls.

**Used by**: search plans, scoring, application answers, learning suggestions, stretch prompts, Scout chat.

---

## 6b. Shared dashboards ("Together")

- **Invite by email** from Together → New shared dashboard. New people get an email with a sign-up link (invite-only: no open sign-ups); existing users get an in-app + push invite. Accept / Decline.
- **Share to…** on tasks, jobs, learning entries, links, flashcards, interests and quick notes (and the Android share menu). Picks one or more dashboards, adds a note. Always a copy.
- **Inside a dashboard:** tabs for **Shared** (feed of shared items: tick tasks, move jobs along, comment, react), **Chat** (the two-chat app, for the whole group), **Board** (notes, tasks, discuss, shopping, meals, calendar; replaces shared lists) and **People & progress** (members, your colour, weekly progress). **Take a copy** saves an item into your own dashboard.
- Owners rename/delete and remove members; members leave. Realtime updates for everyone in the dashboard.

---

## 7. LLM lanes

| Lane | Examples | Order | Runs on |
|---|---|---|---|
| Interactive | Scout chat, Plan my day, single answers, NL search parsing | Groq → Cerebras → Gemini → OpenRouter → MAQ | Vercel |
| Hourly | Scoring batches, extraction from alert emails | Cerebras / Groq → Gemini → MAQ | Worker |
| On save | Application pack, tailored resume, stretch prompt | Fast providers; MAQ when rate-limited | Worker |
| Overnight 02:00 IST | Backlog re-score on full descriptions; packs/resumes for everything saved ("ready by morning"); memory consolidation; search-plan refresh; company notes; weekly market and reply insights | **MAQ first** → others | Worker |

All background AI work goes through **one Supabase queue** (`agent_jobs`): type, lane, priority, payload, status, attempts, run_after, lock, result, error. Failures retry later or fall to MAQ; nothing is lost.

---

## 8. UX and animation

- **Live job stream** each hour (Supabase Realtime), staggered fades.
- Saved cards **fly to the Saved tab**; a preparing progress ring with step text; a live "Scout is searching" source timeline.
- **Confetti** on Applied; Scout question cards slide in on Today.
- Libraries: `motion` (MIT) and `canvas-confetti` (ISC). All motion respects the OS reduce-motion setting.

---

## 9. Data model sketch (new / changed)

- `agent_jobs`: background queue (above).
- `worker_heartbeats`: worker status shown in the UI.
- `saved_searches`: user, query, structured plan, active, last_run_at.
- `answer_bank`: user, key, question text, answer, source, updated_at.
- `resume_versions`: user, job (nullable), kind (master / tailored / stretch_pasted), markdown, storage path.
- `application_packs`: job, site type, apply URL, fields (jsonb), resume version, cover letter, status, prepared_at.
- `application_events`: job, kind, at, source (manual / extension / email), data.
- `email_ingest`: message id (unique), user, kind (alert / reply), parsed data.
- `profile_facts`: career memory facts (above).
- `scout_questions`: user, fact, question, options, status, answer, asked_at.
- `jobs`: adds apply_url, ats, resume_version_id, submitted_answers.

---

## 10. Phases

1. ✅ **Worker + queue + sources**: JobSpy, career sites, Gmail label; live-streaming feed; Search & ask Scout page.
2. ✅ **Career memory + Interests + sharing**: Interests page (what Scout knows), check-in questions, job relevance feeding search and scoring; shared dashboards with email invites, Share to… everywhere, shared lists; icon labels.
3. ✅ **Applications** (without the extension): answer bank, Prepare application (Greenhouse forms read exactly, common questions elsewhere, AI drafts for open questions, "needs you" for facts), Apply sheet with copy buttons, Mark applied (snapshot + answer bank learning + follow-up), application history, email status updates by rules.
3b. **Learning map** (after phase 3, decided Nov 2026): link each learning entry to related topics with one small AI call, a topic map in Learning coloured by strength (minutes + flashcard recall), and "learn next" from job skill gaps. Deep tutoring stays in LearnHarness.
4. **Stretch prompts** + paste-back resume versions.
5. **Edge/Chrome extension** (Greenhouse, Lever, Ashby → Workday).
6. **02:00 IST MAQ batch** + animation polish.

## Setup this will add (per user)

- **Gmail:**
  - Settings → Forwarding and POP/IMAP → IMAP enabled.
  - Create a filter (e.g. `from:(jobalerts-noreply@linkedin.com OR naukri.com OR indeed.com) OR subject:(application OR interview)`) → apply label **Productivize**.
  - The worker uses the same Gmail **app password** as the email digests.
- **Oracle Cloud Always Free VM:** Docker + `docker compose up -d` for the worker. The SearXNG kit in `deploy/searxng` can share the VM.
- **Windows PC worker (optional):** `npm run worker`, started by Windows Task Scheduler at log-in.
- **Extension:** load it in Edge/Chrome, then pair it in Settings.

## Open items

- Verify Ashby's form specification without auth, and Lever apply-page parsing, on real postings.
- Measure how much JobSpy's LinkedIn source returns from the PC worker vs. the VM before relying on it.
- Workday: how far a common field set gets before account-specific questions.
