-- =============================================================================
-- Productivize Me — 0002: semantic job matching, feedback, follow-ups, richer
-- recurrence + habits, focus sessions, FSRS flashcards, calendar feed, buddy view.
-- Run after 0001_init.sql (safe to re-run).
-- =============================================================================

create schema if not exists extensions;
create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- Jobs: feedback, embeddings, linked follow-up tasks
-- ---------------------------------------------------------------------------
alter table public.jobs add column if not exists feedback smallint check (feedback in (-1, 1));
alter table public.jobs add column if not exists feedback_at timestamptz;
alter table public.jobs add column if not exists feedback_reason text;
alter table public.jobs add column if not exists embedding extensions.vector(384);
alter table public.jobs add column if not exists embedding_model text;
alter table public.jobs add column if not exists semantic_score real;
alter table public.jobs add column if not exists follow_up_task_id uuid;
alter table public.jobs add column if not exists next_step_task_id uuid;

alter table public.job_profiles add column if not exists profile_embedding jsonb;
alter table public.job_profiles add column if not exists ats_discovery jsonb not null default '{}';

-- ---------------------------------------------------------------------------
-- Tasks: interval / weekday recurrence, habit series, focus time, job link
-- ---------------------------------------------------------------------------
alter table public.tasks add column if not exists recurrence_interval smallint not null default 1
  check (recurrence_interval between 1 and 365);
alter table public.tasks add column if not exists recurrence_days smallint[] not null default '{}';
alter table public.tasks add column if not exists series_id uuid;
alter table public.tasks add column if not exists actual_minutes integer not null default 0;
alter table public.tasks add column if not exists job_id uuid references public.jobs (id) on delete set null;

create index if not exists tasks_series_idx on public.tasks (user_id, series_id) where series_id is not null;
update public.tasks set series_id = id where recurrence is not null and series_id is null;

-- Next occurrence honouring an interval ("every 2 weeks") and chosen weekdays
-- (0 = Sunday … 6 = Saturday). Always lands strictly after p_today.
create or replace function public.next_recurrence_date(
  p_from date,
  p_rule text,
  p_today date,
  p_interval integer,
  p_days smallint[]
)
returns date
language plpgsql
immutable
as $$
declare
  d date := coalesce(p_from, p_today);
  n integer := greatest(coalesce(p_interval, 1), 1);
  anchor date;
  guard integer := 0;
begin
  if p_rule = 'weekly' and coalesce(array_length(p_days, 1), 0) > 0 then
    -- Monday of the starting week; only weeks that are a multiple of n away qualify.
    anchor := d - (extract(isodow from d)::int - 1);
    loop
      d := d + 1;
      guard := guard + 1;
      exit when guard > 5000;
      continue when not (extract(dow from d)::smallint = any (p_days));
      continue when (((d - (extract(isodow from d)::int - 1)) - anchor) / 7) % n <> 0;
      exit when d > p_today;
    end loop;
    return d;
  end if;

  loop
    d := case p_rule
      when 'daily' then d + n
      when 'weekdays' then case extract(isodow from d)::int when 5 then d + 3 when 6 then d + 2 else d + 1 end
      when 'weekly' then d + 7 * n
      when 'monthly' then (d + make_interval(months => n))::date
      when 'yearly' then (d + make_interval(years => n))::date
      else null end;
    guard := guard + 1;
    exit when d is null or d > p_today or guard > 5000;
  end loop;
  return d;
end;
$$;

-- Recurring tasks belong to a series (used by the Habits view).
create or replace function public.tasks_assign_series()
returns trigger
language plpgsql
as $$
begin
  if new.recurrence is not null and new.series_id is null then
    new.series_id := new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_assign_series on public.tasks;
create trigger tasks_assign_series
  before insert or update of recurrence on public.tasks
  for each row execute function public.tasks_assign_series();

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
      v_next := public.next_recurrence_date(
        coalesce(new.due_date, v_today), new.recurrence, v_today - 1,
        new.recurrence_interval, new.recurrence_days
      );
      insert into public.tasks (
        user_id, title, notes, due_date, due_time, priority, tags, estimate_minutes,
        recurrence, recurrence_interval, recurrence_days, series_id, reminder_at
      ) values (
        new.user_id, new.title, new.notes, v_next, new.due_time, new.priority, new.tags,
        new.estimate_minutes, new.recurrence, new.recurrence_interval, new.recurrence_days,
        coalesce(new.series_id, new.id),
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

-- ---------------------------------------------------------------------------
-- Jobs → automatic follow-up / next-step tasks
-- ---------------------------------------------------------------------------
create or replace function public.jobs_follow_up()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz text;
  v_today date;
  v_task uuid;
  v_label text;
  v_old_status text;
  v_old_step text;
  v_old_date date;
begin
  if tg_op = 'UPDATE' then
    v_old_status := old.status;
    v_old_step := old.next_step;
    v_old_date := old.next_step_date;
  end if;
  select timezone into v_tz from public.profiles where id = new.user_id;
  v_today := (now() at time zone coalesce(v_tz, 'UTC'))::date;
  v_label := new.title || coalesce(' @ ' || new.company, '');

  -- Applied → "Follow up" task a week later.
  if new.status = 'applied' and v_old_status is distinct from 'applied' and new.follow_up_task_id is null then
    insert into public.tasks (user_id, title, notes, due_date, priority, tags, job_id)
    values (
      new.user_id,
      'Follow up: ' || v_label,
      'No reply yet? Send a short, friendly follow-up to the recruiter or hiring manager.' ||
        case when new.url like 'http%' then E'\n' || new.url else '' end,
      v_today + 7, 3, array['jobs'], new.id
    )
    returning id into v_task;
    new.follow_up_task_id := v_task;
  end if;

  -- Any later stage closes the pending follow-up.
  if new.status in ('interviewing', 'offer', 'rejected', 'archived')
     and v_old_status is distinct from new.status
     and new.follow_up_task_id is not null then
    update public.tasks set status = 'dropped' where id = new.follow_up_task_id and status = 'todo';
  end if;

  -- Next step with a date → a task on that date (kept in sync).
  if new.next_step_date is not null
     and (new.next_step_date is distinct from v_old_date or new.next_step is distinct from v_old_step) then
    if new.next_step_task_id is not null
       and exists (select 1 from public.tasks where id = new.next_step_task_id and status = 'todo') then
      update public.tasks
         set due_date = new.next_step_date,
             title = coalesce(nullif(new.next_step, ''), 'Next step') || ': ' || v_label
       where id = new.next_step_task_id;
    else
      insert into public.tasks (user_id, title, due_date, priority, tags, job_id)
      values (new.user_id, coalesce(nullif(new.next_step, ''), 'Next step') || ': ' || v_label,
              new.next_step_date, 2, array['jobs'], new.id)
      returning id into v_task;
      new.next_step_task_id := v_task;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists jobs_follow_up on public.jobs;
create trigger jobs_follow_up
  before insert or update of status, next_step, next_step_date on public.jobs
  for each row execute function public.jobs_follow_up();

-- ---------------------------------------------------------------------------
-- Focus sessions (timer) — minutes roll up into tasks.actual_minutes
-- ---------------------------------------------------------------------------
create table if not exists public.focus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete set null,
  kind text not null default 'focus' check (kind in ('focus', 'pomodoro', 'stopwatch')),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  minutes integer not null check (minutes between 0 and 1440),
  created_at timestamptz not null default now()
);

create index if not exists focus_sessions_user_idx on public.focus_sessions (user_id, started_at desc);

create or replace function public.focus_sessions_rollup()
returns trigger
language plpgsql
as $$
begin
  if new.task_id is not null and new.minutes > 0 then
    update public.tasks set actual_minutes = actual_minutes + new.minutes where id = new.task_id;
  end if;
  return new;
end;
$$;

drop trigger if exists focus_sessions_rollup on public.focus_sessions;
create trigger focus_sessions_rollup
  after insert on public.focus_sessions
  for each row execute function public.focus_sessions_rollup();

-- ---------------------------------------------------------------------------
-- Flashcards (FSRS spaced repetition)
-- ---------------------------------------------------------------------------
create table if not exists public.flashcards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  entry_id uuid references public.learning_entries (id) on delete set null,
  front text not null check (char_length(front) between 1 and 1000),
  back text not null check (char_length(back) between 1 and 4000),
  tags text[] not null default '{}',
  card jsonb not null default '{}',
  due timestamptz not null default now(),
  reps integer not null default 0,
  lapses integer not null default 0,
  suspended boolean not null default false,
  last_reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists flashcards_due_idx on public.flashcards (user_id, due) where not suspended;

drop trigger if exists flashcards_updated_at on public.flashcards;
create trigger flashcards_updated_at
  before update on public.flashcards
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Profiles: private calendar feed + opt-in progress sharing
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists calendar_token text unique;
alter table public.profiles add column if not exists share_progress boolean not null default false;

-- Weekly numbers for everyone who opted in to sharing — only visible to people
-- who share too. Aggregates only: no task titles, notes or job details.
create or replace function public.buddy_stats(p_week_start date)
returns table (
  user_id uuid,
  name text,
  is_me boolean,
  tasks_done_week integer,
  tasks_done_today integer,
  tasks_open_today integer,
  learning_days_week integer,
  learning_goal integer,
  learning_streak integer,
  applications_week integer,
  focus_minutes_week integer,
  last_active timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select id from public.profiles where id = auth.uid() and share_progress
  ),
  people as (
    select p.*, (now() at time zone p.timezone)::date as today
    from public.profiles p
    where p.share_progress and exists (select 1 from me)
  )
  select
    p.id,
    coalesce(nullif(p.full_name, ''), split_part(p.email, '@', 1)),
    p.id = auth.uid(),
    (select count(*)::int from public.tasks t
      where t.user_id = p.id and t.status = 'done'
        and (t.completed_at at time zone p.timezone)::date between p_week_start and p.today),
    (select count(*)::int from public.tasks t
      where t.user_id = p.id and t.status = 'done'
        and (t.completed_at at time zone p.timezone)::date = p.today),
    (select count(*)::int from public.tasks t
      where t.user_id = p.id and t.status = 'todo' and t.due_date <= p.today),
    (select count(distinct l.entry_date)::int from public.learning_entries l
      where l.user_id = p.id and l.entry_date between p_week_start and p.today),
    p.learning_goal_per_week,
    (with recursive s(d, n) as (
        select case when exists (select 1 from public.learning_entries l where l.user_id = p.id and l.entry_date = p.today)
                    then p.today else p.today - 1 end, 0
        union all
        select s.d - 1, s.n + 1 from s
        where s.n < 400
          and exists (select 1 from public.learning_entries l where l.user_id = p.id and l.entry_date = s.d)
      )
      select max(n)::int from s),
    (select count(*)::int from public.jobs j
      where j.user_id = p.id and j.applied_at is not null
        and (j.applied_at at time zone p.timezone)::date between p_week_start and p.today),
    (select coalesce(sum(f.minutes), 0)::int from public.focus_sessions f
      where f.user_id = p.id and (f.started_at at time zone p.timezone)::date between p_week_start and p.today),
    greatest(
      (select max(updated_at) from public.tasks t where t.user_id = p.id),
      (select max(created_at) from public.learning_entries l where l.user_id = p.id)
    )
  from people p
  order by (p.id = auth.uid()) desc, 2;
$$;

-- ---------------------------------------------------------------------------
-- RLS + grants for the new tables / functions
-- ---------------------------------------------------------------------------
alter table public.focus_sessions enable row level security;
alter table public.flashcards enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['focus_sessions', 'flashcards']
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

grant select, insert, update, delete on public.focus_sessions, public.flashcards to authenticated;
grant all on public.focus_sessions, public.flashcards to service_role;
revoke all on function public.buddy_stats(date) from public, anon;
grant execute on function public.buddy_stats(date) to authenticated, service_role;
grant execute on function public.next_recurrence_date(date, text, date, integer, smallint[]) to authenticated, service_role;
