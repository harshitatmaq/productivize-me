-- =============================================================================
-- Productivize Me — initial schema
-- Run this once in the Supabase SQL editor (or `supabase db push`).
-- Every user-owned table is protected by Row Level Security: a signed-in user
-- can only ever see and change their own rows. Background jobs (cron) use the
-- service-role key, which bypasses RLS.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles (one row per auth user, created automatically on sign-up)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  timezone text not null default 'Asia/Kolkata',
  week_starts_on smallint not null default 1 check (week_starts_on between 0 and 6),
  -- Built-in reminder schedule (local time in `timezone`)
  morning_brief_enabled boolean not null default true,
  day_start_time time not null default '08:00',
  eod_review_enabled boolean not null default true,
  day_end_time time not null default '21:00',
  learning_reminder_enabled boolean not null default true,
  learning_reminder_time time not null default '21:30',
  learning_goal_per_week smallint not null default 5 check (learning_goal_per_week between 1 and 7),
  learning_skip_when_goal_met boolean not null default false,
  weekly_review_enabled boolean not null default true,
  monthly_review_enabled boolean not null default true,
  auto_carry_forward boolean not null default false,
  -- Channels
  notify_push boolean not null default true,
  notify_email boolean not null default true,
  email_daily_digest boolean not null default true,
  email_weekly_review boolean not null default true,
  email_alerts boolean not null default false,
  -- Jobs
  job_search_enabled boolean not null default true,
  job_alert_min_score smallint not null default 75 check (job_alert_min_score between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for users that already exist.
insert into public.profiles (id, email, full_name)
select u.id, u.email, split_part(u.email, '@', 1)
from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 500),
  notes text,
  due_date date,
  due_time time,
  priority smallint not null default 4 check (priority between 1 and 4),
  tags text[] not null default '{}',
  status text not null default 'todo' check (status in ('todo', 'done', 'dropped')),
  completed_at timestamptz,
  sort_order double precision not null default extract(epoch from now()),
  estimate_minutes integer check (estimate_minutes is null or estimate_minutes between 0 and 1440),
  reminder_at timestamptz,
  reminder_sent_at timestamptz,
  recurrence text check (recurrence in ('daily', 'weekdays', 'weekly', 'monthly', 'yearly')),
  recurrence_spawned boolean not null default false,
  carry_count integer not null default 0,
  original_due_date date,
  last_carried_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tasks_user_due_idx on public.tasks (user_id, due_date);
create index if not exists tasks_user_status_idx on public.tasks (user_id, status);
create index if not exists tasks_reminder_idx on public.tasks (reminder_at)
  where reminder_sent_at is null and status = 'todo';

create or replace trigger tasks_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- Next date for a recurring task, rolled forward so it is never in the past.
create or replace function public.next_recurrence_date(p_from date, p_rule text, p_today date)
returns date
language plpgsql
immutable
as $$
declare
  d date := coalesce(p_from, p_today);
  guard int := 0;
begin
  loop
    d := case p_rule
      when 'daily' then d + 1
      when 'weekdays' then case extract(isodow from d)::int
                             when 5 then d + 3
                             when 6 then d + 2
                             else d + 1 end
      when 'weekly' then d + 7
      when 'monthly' then (d + interval '1 month')::date
      when 'yearly' then (d + interval '1 year')::date
      else null end;
    guard := guard + 1;
    exit when d is null or d > p_today or guard > 1000;
  end loop;
  return d;
end;
$$;

-- Keeps completed_at in sync and spawns the next occurrence of recurring tasks.
create or replace function public.tasks_on_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz text;
  v_today date;
  v_next date;
begin
  if new.status = 'done' and (old.status is distinct from 'done') then
    new.completed_at := coalesce(new.completed_at, now());
    if new.recurrence is not null and not old.recurrence_spawned then
      select timezone into v_tz from public.profiles where id = new.user_id;
      v_today := (now() at time zone coalesce(v_tz, 'UTC'))::date;
      v_next := public.next_recurrence_date(coalesce(new.due_date, v_today), new.recurrence, v_today - 1);
      insert into public.tasks (
        user_id, title, notes, due_date, due_time, priority, tags, estimate_minutes,
        recurrence, reminder_at
      ) values (
        new.user_id, new.title, new.notes, v_next, new.due_time, new.priority, new.tags,
        new.estimate_minutes, new.recurrence,
        case when new.reminder_at is not null and new.due_date is not null
             then new.reminder_at + (v_next - new.due_date) * interval '1 day'
             else null end
      );
      new.recurrence_spawned := true;
    end if;
  elsif new.status = 'todo' and old.status is distinct from 'todo' then
    new.completed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_status_change on public.tasks;
create trigger tasks_status_change
  before update of status on public.tasks
  for each row execute function public.tasks_on_status_change();

-- Carry unfinished tasks forward.
--   p_ids   : explicit task ids, or null for "everything unfinished up to p_until"
--   p_user  : defaults to the signed-in user; RLS still applies for normal users
create or replace function public.carry_tasks(
  p_to date,
  p_ids uuid[] default null,
  p_until date default null,
  p_user uuid default auth.uid()
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.tasks t
     set original_due_date = coalesce(t.original_due_date, t.due_date),
         due_date = p_to,
         carry_count = t.carry_count + 1,
         last_carried_at = now(),
         reminder_at = case
           when t.reminder_at is not null and t.due_date is not null
             then t.reminder_at + (p_to - t.due_date) * interval '1 day'
           else t.reminder_at end,
         reminder_sent_at = case when t.reminder_at is not null then null else t.reminder_sent_at end
   where t.user_id = p_user
     and t.status = 'todo'
     and t.due_date is not null
     and t.due_date < p_to
     and (
       (p_ids is not null and t.id = any (p_ids))
       or (p_ids is null and p_until is not null and t.due_date <= p_until)
     );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Custom reminders (once / daily / weekdays / weekly / monthly / yearly)
-- ---------------------------------------------------------------------------
create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  notes text,
  frequency text not null default 'daily'
    check (frequency in ('once', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly')),
  time_of_day time not null default '09:00',
  days_of_week smallint[] not null default '{}',
  day_of_month smallint check (day_of_month is null or day_of_month between 1 and 31),
  month_of_year smallint check (month_of_year is null or month_of_year between 1 and 12),
  start_date date not null default current_date,
  next_fire_at timestamptz,
  last_fired_at timestamptz,
  active boolean not null default true,
  url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reminders_due_idx on public.reminders (next_fire_at) where active;

create or replace trigger reminders_updated_at
  before update on public.reminders
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Push subscriptions (one per device/browser)
-- ---------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  device_label text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- ---------------------------------------------------------------------------
-- Notifications (in-app inbox + de-duplication log for push/email)
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null,
  dedupe_key text not null default gen_random_uuid()::text,
  title text not null,
  body text,
  url text,
  data jsonb not null default '{}',
  channels text[] not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_user_dedupe_key unique (user_id, dedupe_key)
);

create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Learning log
-- ---------------------------------------------------------------------------
create table if not exists public.learning_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  entry_date date not null default current_date,
  title text not null check (char_length(title) between 1 and 300),
  content text,
  tags text[] not null default '{}',
  minutes integer check (minutes is null or minutes between 0 and 1440),
  resources jsonb not null default '[]',
  confidence smallint check (confidence is null or confidence between 1 and 5),
  questions text,
  review_count integer not null default 0,
  last_reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists learning_user_date_idx on public.learning_entries (user_id, entry_date desc);

create or replace trigger learning_entries_updated_at
  before update on public.learning_entries
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Job search: profile built by the onboarding agent
-- ---------------------------------------------------------------------------
create table if not exists public.job_profiles (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  status text not null default 'new' check (status in ('new', 'onboarding', 'ready')),
  profile jsonb not null default '{}',
  resume_text text,
  chat jsonb not null default '[]',
  search_plan jsonb not null default '{}',
  search_plan_at timestamptz,
  profile_updated_at timestamptz,
  watch_companies jsonb not null default '[]',
  disabled_sources text[] not null default '{}',
  last_search_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace trigger job_profiles_updated_at
  before update on public.job_profiles
  for each row execute function public.set_updated_at();

-- Jobs found by the hourly search (and ones added manually)
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source text not null default 'manual',
  external_id text,
  url text not null,
  url_hash text not null,
  dedupe_key text not null,
  title text not null,
  company text,
  company_domain text,
  company_logo text,
  location text,
  remote boolean,
  employment_type text,
  seniority text,
  salary text,
  description text,
  posted_at timestamptz,
  score smallint check (score is null or score between 0 and 100),
  verdict text,
  reasons jsonb not null default '[]',
  concerns jsonb not null default '[]',
  tags text[] not null default '{}',
  status text not null default 'new'
    check (status in ('new', 'saved', 'applied', 'interviewing', 'offer', 'rejected', 'archived')),
  seen_at timestamptz,
  applied_at timestamptz,
  next_step text,
  next_step_date date,
  notes text,
  analysis jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jobs_user_url_hash unique (user_id, url_hash),
  constraint jobs_user_dedupe_key unique (user_id, dedupe_key)
);

create index if not exists jobs_user_status_idx on public.jobs (user_id, status, score desc);
create index if not exists jobs_user_created_idx on public.jobs (user_id, created_at desc);

create or replace trigger jobs_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

create table if not exists public.job_search_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  trigger text not null default 'cron',
  status text not null default 'running' check (status in ('running', 'ok', 'partial', 'error', 'skipped')),
  stats jsonb not null default '{}',
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists job_search_runs_user_idx on public.job_search_runs (user_id, started_at desc);

-- ---------------------------------------------------------------------------
-- Portfolio
-- ---------------------------------------------------------------------------
create table if not exists public.portfolios (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  slug text unique check (slug is null or slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  is_public boolean not null default false,
  data jsonb not null default '{}',
  accent text not null default 'violet',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace trigger portfolios_updated_at
  before update on public.portfolios
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Server-only bookkeeping (no RLS policies => only the service role can touch)
-- ---------------------------------------------------------------------------
create table if not exists public.api_usage (
  provider text not null,
  period text not null,
  count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (provider, period)
);

create table if not exists public.source_state (
  key text primary key,
  last_run_at timestamptz,
  data jsonb not null default '{}'
);

create or replace function public.increment_api_usage(p_provider text, p_period text, p_amount integer default 1)
returns integer
language sql
security definer
set search_path = public
as $$
  insert into public.api_usage (provider, period, count, updated_at)
  values (p_provider, p_period, p_amount, now())
  on conflict (provider, period)
  do update set count = public.api_usage.count + excluded.count, updated_at = now()
  returning count;
$$;

revoke all on function public.increment_api_usage(text, text, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.tasks enable row level security;
alter table public.reminders enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notifications enable row level security;
alter table public.learning_entries enable row level security;
alter table public.job_profiles enable row level security;
alter table public.jobs enable row level security;
alter table public.job_search_runs enable row level security;
alter table public.portfolios enable row level security;
alter table public.api_usage enable row level security;
alter table public.source_state enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

do $$
declare
  t text;
begin
  foreach t in array array[
    'tasks', 'reminders', 'push_subscriptions', 'notifications', 'learning_entries',
    'job_profiles', 'jobs', 'job_search_runs', 'portfolios'
  ]
  loop
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))',
      t
    );
  end loop;
end;
$$;

-- Anyone (even signed out) may read a portfolio that its owner made public.
drop policy if exists "public portfolios are readable" on public.portfolios;
create policy "public portfolios are readable" on public.portfolios
  for select to anon, authenticated
  using (is_public);

-- Explicit grants (newer Supabase projects no longer expose new tables by default).
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on
  public.profiles, public.tasks, public.reminders, public.push_subscriptions,
  public.notifications, public.learning_entries, public.job_profiles, public.jobs,
  public.job_search_runs, public.portfolios
  to authenticated;
grant select on public.portfolios to anon;
grant all on all tables in schema public to service_role;
grant execute on function public.carry_tasks(date, uuid[], date, uuid) to authenticated, service_role;
grant execute on function public.next_recurrence_date(date, text, date) to authenticated, service_role;
grant execute on function public.increment_api_usage(text, text, integer) to service_role;
