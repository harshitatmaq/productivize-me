# Scout worker

A small Node process that does the job searching the Vercel app can't do on its own:

- **JobSpy** — public listings from LinkedIn, Naukri, Indeed and Glassdoor (no login, ever).
- **Curated career sites** — 114 public Greenhouse / Lever / Ashby / Workable / SmartRecruiters boards (from the MIT-licensed [career-ops](https://github.com/santifer/career-ops) list) plus India-focused product companies it discovers daily.
- **Gmail job alerts** — reads only your `Productivize` label (LinkedIn/Naukri/Indeed alerts, recruiter replies) over IMAP.
- **Queue** — "Search now" and *Search & ask* run here first, and stream results into the app live.

The app works without a worker (hourly web + job-board search from Vercel). When a worker is online, the hourly Vercel cron hands the search to it. You can run one on your **Windows PC**, on a free **Oracle Cloud VM**, or both: sources are claimed atomically, so two workers never repeat each other's work.

> First run [`supabase/migrations/0003_scout_worker.sql`](../supabase/migrations/0003_scout_worker.sql) in the Supabase SQL editor. Without it the worker logs `heartbeat failed … did you run 0003?`.

## Configuration

The worker reads two files from the repository:

| File | What |
| --- | --- |
| `.env.local` | The same file the app uses: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY`, AI keys, search keys. |
| `worker/.env` | Worker-only settings. Copy [`worker/.env.example`](.env.example). |

`worker/.env` settings:

- `WORKER_NAME` — how it appears in **Jobs → Activity** (e.g. `harshit-pc`, `oracle-vm`).
- `JOBSPY_SITES` — which sites to read. A home PC is best for `linkedin` (cloud IPs get blocked quickly); a VM is fine for `indeed,naukri,glassdoor`.
- `GMAIL_ACCOUNTS` — `you@gmail.com:app password` pairs, comma-separated. The password never leaves this file.
- `JOBSPY_PYTHON` — only if Python isn't `py` (Windows) / `python3` (Linux).

Both files are git-ignored. Never commit them.

## Windows PC

1. Install **Node.js 22 LTS** ([nodejs.org](https://nodejs.org)) and **Python 3.11+** ([python.org](https://www.python.org/downloads/), tick *Add python.exe to PATH*).
2. In the repository folder (PowerShell):
   ```powershell
   npm install
   py -m pip install -r worker\requirements.txt
   copy worker\.env.example worker\.env
   notepad worker\.env
   ```
   Set `WORKER_NAME=<your-name>-pc` and `JOBSPY_SITES=linkedin,indeed,naukri`. Make sure `.env.local` is filled in.
3. Test one pass:
   ```powershell
   npm run worker:once
   ```
   You should see `Scout worker … starting` and, a minute later, a run in **Jobs → Activity** with your worker's name.
4. Keep it running: `npm run worker` (Ctrl+C stops it after the current search).
5. Start it automatically when you log in (PowerShell, from the repository folder):
   ```powershell
   schtasks /Create /TN "Productivize Scout" /SC ONLOGON /RL LIMITED /TR "\"$PWD\worker\start-worker.cmd\""
   ```
   Remove it with `schtasks /Delete /TN "Productivize Scout" /F`.

The worker only searches while the PC is awake. Add an Oracle VM for 24/7 searching.

## Oracle Cloud VM (Always Free, 24/7)

Use the same VM as SearXNG if you set that up ([deploy/searxng](../deploy/searxng/README.md)) — an Ampere A1 (ARM) or AMD micro instance with Ubuntu works.

```bash
# once: Docker
curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker $USER && newgrp docker

git clone https://github.com/harshitatmaq/productivize-me.git && cd productivize-me
nano .env.local                      # paste the app's settings
cp worker/.env.example worker/.env && nano worker/.env   # WORKER_NAME=oracle-vm, JOBSPY_SITES=indeed,naukri,glassdoor
docker compose -f worker/docker-compose.yml up -d --build
docker compose -f worker/docker-compose.yml logs -f
```

Update later with `git pull && docker compose -f worker/docker-compose.yml up -d --build`.

## Gmail label (once per person)

1. In Gmail, create a label named **Productivize**.
2. Paste this into the Gmail search box → *Show search options* → **Create filter** → *Apply the label: Productivize* (leave *Skip the Inbox* off) → tick *Also apply to matching conversations*:
   ```
   from:(jobalerts-noreply@linkedin.com OR jobs-listings@linkedin.com OR naukri.com OR indeed.com OR glassdoor.com OR instahyre.com OR foundit.in OR iimjobs.com OR hirist.tech OR wellfound.com OR cutshort.io OR greenhouse.io OR lever.co OR ashbyhq.com OR myworkday.com OR smartrecruiters.com)
   ```
   (Also shown with a copy button in **Settings → Job search**.)
3. Create an app password at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) (2-Step Verification must be on) and add it to `GMAIL_ACCOUNTS` in `worker/.env` on **one** worker.
4. Turn on job alerts on LinkedIn/Naukri/Indeed for your target roles — the worker picks them up every 30 minutes.

The worker opens only that label, read-only, and stores the sender, subject and job links it found (never the full email).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `heartbeat failed … 0003` | Run migration 0003 in Supabase. |
| `jobspy_linkedin: … 429` / blocked | LinkedIn rate-limits cloud IPs. Keep `linkedin` on the PC worker only. |
| `python-jobspy is not installed` / `'py' is not recognized` | Install Python and run the `pip install` step, or set `JOBSPY_PYTHON` to the full path of `python.exe`. |
| Gmail: `Invalid credentials` | Use an app password, not your Google password; spaces in it are fine. |
| Gmail: `label not found` | The label must be named exactly `Productivize` (or set `GMAIL_LABEL`). |
| Nothing happens | The worker only runs searches for users whose Scout profile is *ready* and hourly search is on (Settings → Job search). |
