-- =============================================================================
-- Productivize Me — 0003: Scout worker (job queue, heartbeats, atomic source
-- claims), natural-language searches, semantic search over stored jobs, and
-- realtime streaming of new jobs. Run after 0002 (safe to re-run).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Searches (Search & ask Scout). saved = true → included in the hourly runs.
-- ---------------------------------------------------------------------------
create table if not exists public.searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  query text not null check (char_length(query) between 1 and 500),
  plan jsonb not null default '{}',
  saved boolean not null default false,
  alerts boolean not null default true,
  result_count integer not null default 0,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists searches_user_idx on public.searches (user_id, created_at desc);

drop trigger if exists searches_updated_at on public.searches;
create trigger searches_updated_at
  before update on public.searches
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Jobs: where to apply, which ATS, which search found it
-- ---------------------------------------------------------------------------
alter table public.jobs add column if not exists apply_url text;
alter table public.jobs add column if not exists ats text;
alter table public.jobs add column if not exists search_id uuid references public.searches (id) on delete set null;

create index if not exists jobs_search_idx on public.jobs (search_id) where search_id is not null;

alter table public.job_search_runs add column if not exists worker text;
alter table public.job_search_runs add column if not exists search_id uuid references public.searches (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Background job queue, processed by the Scout worker(s)
-- ---------------------------------------------------------------------------
create table if not exists public.agent_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  type text not null,
  lane text not null default 'fast' check (lane in ('fast', 'batch', 'overnight')),
  priority smallint not null default 5,
  payload jsonb not null default '{}',
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'error', 'cancelled')),
  attempts smallint not null default 0,
  max_attempts smallint not null default 3,
  run_after timestamptz not null default now(),
  locked_by text,
  locked_at timestamptz,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_jobs_ready_idx on public.agent_jobs (status, lane, priority, run_after);
create index if not exists agent_jobs_user_idx on public.agent_jobs (user_id, created_at desc);

drop trigger if exists agent_jobs_updated_at on public.agent_jobs;
create trigger agent_jobs_updated_at
  before update on public.agent_jobs
  for each row execute function public.set_updated_at();

-- Atomically hands the next ready job to one worker. Jobs stuck "running" for
-- 20 minutes (crashed worker) become claimable again.
create or replace function public.claim_agent_job(p_worker text, p_types text[], p_lanes text[] default array['fast', 'batch', 'overnight'])
returns setof public.agent_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id
    from public.agent_jobs
   where type = any (p_types)
     and lane = any (p_lanes)
     and run_after <= now()
     and attempts < max_attempts
     and (status = 'queued' or (status = 'running' and locked_at < now() - interval '20 minutes'))
   order by priority, run_after, created_at
   limit 1
   for update skip locked;
  if v_id is null then
    return;
  end if;
  return query
    update public.agent_jobs
       set status = 'running', locked_by = p_worker, locked_at = now(), attempts = attempts + 1
     where id = v_id
    returning *;
end;
$$;

-- Atomically claims a periodic source (e.g. "<user>:jobspy_linkedin") if its
-- interval has passed, so two workers never fetch the same thing twice.
create or replace function public.claim_source(p_key text, p_minutes integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean;
begin
  insert into public.source_state (key, last_run_at, data)
  values (p_key, now(), '{}')
  on conflict (key) do update
     set last_run_at = now()
   where public.source_state.last_run_at is null
      or public.source_state.last_run_at < now() - make_interval(mins => greatest(p_minutes, 0))
  returning true into v_claimed;
  return coalesce(v_claimed, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Worker heartbeats (shown in the app: which workers are online)
-- ---------------------------------------------------------------------------
create table if not exists public.worker_heartbeats (
  name text primary key,
  capabilities text[] not null default '{}',
  info jsonb not null default '{}',
  started_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Emails read from the "Productivize" Gmail label (dedupe + later status tracking)
-- ---------------------------------------------------------------------------
create table if not exists public.email_ingest (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  message_id text not null,
  kind text not null default 'other' check (kind in ('alert', 'reply', 'other')),
  sender text,
  subject text,
  received_at timestamptz,
  parsed jsonb not null default '{}',
  created_at timestamptz not null default now(),
  constraint email_ingest_user_message unique (user_id, message_id)
);

-- ---------------------------------------------------------------------------
-- Semantic search over the signed-in user's stored jobs
-- ---------------------------------------------------------------------------
create index if not exists jobs_embedding_idx on public.jobs
  using hnsw (embedding extensions.vector_cosine_ops);

create or replace function public.match_jobs(p_embedding text, p_model text, p_count integer default 40)
returns table (id uuid, similarity real)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select j.id, (1 - (j.embedding <=> p_embedding::extensions.vector))::real as similarity
    from public.jobs j
   where j.user_id = auth.uid()
     and j.embedding is not null
     and j.embedding_model = p_model
     and j.status <> 'archived'
   order by j.embedding <=> p_embedding::extensions.vector
   limit least(greatest(p_count, 1), 200);
$$;

-- ---------------------------------------------------------------------------
-- RLS + grants
-- ---------------------------------------------------------------------------
alter table public.searches enable row level security;
alter table public.agent_jobs enable row level security;
alter table public.worker_heartbeats enable row level security;
alter table public.email_ingest enable row level security;

drop policy if exists "own rows" on public.searches;
create policy "own rows" on public.searches
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Users can watch (not create) their own background jobs; the server enqueues them.
drop policy if exists "read own jobs" on public.agent_jobs;
create policy "read own jobs" on public.agent_jobs
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Everyone signed in can see which workers are online (no secrets are stored here).
drop policy if exists "read heartbeats" on public.worker_heartbeats;
create policy "read heartbeats" on public.worker_heartbeats
  for select to authenticated
  using (true);

drop policy if exists "read own emails" on public.email_ingest;
create policy "read own emails" on public.email_ingest
  for select to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.searches to authenticated;
grant select on public.agent_jobs, public.worker_heartbeats, public.email_ingest to authenticated;
grant all on public.searches, public.agent_jobs, public.worker_heartbeats, public.email_ingest to service_role;
revoke all on function public.claim_agent_job(text, text[], text[]) from public, anon, authenticated;
revoke all on function public.claim_source(text, integer) from public, anon, authenticated;
grant execute on function public.claim_agent_job(text, text[], text[]) to service_role;
grant execute on function public.claim_source(text, integer) to service_role;
grant execute on function public.match_jobs(text, text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: stream new jobs, run progress and queue status to the app
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['jobs', 'job_search_runs', 'agent_jobs']
    loop
      begin
        execute format('alter publication supabase_realtime add table public.%I', t);
      exception when duplicate_object then
        null;
      end;
    end loop;
  end if;
end;
$$;
