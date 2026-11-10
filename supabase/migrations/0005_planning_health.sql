-- =============================================================================
-- Productivize Me — 0005: planning preferences (used by "Plan my day" and
-- time suggestions) and Health (Push/Pull/Legs + Core workouts, progression,
-- body weight). Run after 0004 (safe to re-run).
-- =============================================================================

-- Planning preferences: wake/sleep, work hours, focus peak, routines
-- ("reading & journaling after 22:30"), free-text notes. Health settings:
-- unit, rotation order, weekly goal, goal weight.
alter table public.profiles add column if not exists planning jsonb not null default '{}';
alter table public.profiles add column if not exists health jsonb not null default '{}';

-- ---------------------------------------------------------------------------
-- Routine template: the exercises for each training day.
-- ---------------------------------------------------------------------------
create table if not exists public.exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  day_type text not null check (day_type in ('push', 'pull', 'legs', 'core')),
  -- weight_reps: kg × reps · reps: bodyweight reps (weight optional) · time: seconds
  measure text not null default 'weight_reps' check (measure in ('weight_reps', 'reps', 'time')),
  target_sets smallint not null default 3 check (target_sets between 1 and 10),
  reps_min smallint not null default 8 check (reps_min between 1 and 600),
  reps_max smallint not null default 12 check (reps_max between 1 and 600),
  increment numeric(6, 2) not null default 2.5 check (increment >= 0),
  sort double precision not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (reps_max >= reps_min)
);
create index if not exists exercises_user_idx on public.exercises (user_id, day_type, sort);

-- One entry per day: done / rest / skipped, with its training day.
create table if not exists public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  day_type text check (day_type in ('push', 'pull', 'legs', 'core', 'other')),
  status text not null default 'done' check (status in ('done', 'rest', 'skipped')),
  duration_min smallint check (duration_min between 0 and 600),
  notes text check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, date)
);
create index if not exists workouts_user_date_idx on public.workouts (user_id, date desc);

create table if not exists public.workout_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  workout_id uuid not null references public.workouts (id) on delete cascade,
  exercise_id uuid references public.exercises (id) on delete set null,
  exercise_name text not null check (char_length(exercise_name) between 1 and 80),
  set_no smallint not null default 1,
  reps smallint check (reps between 0 and 600),
  weight numeric(7, 2) check (weight >= 0),
  created_at timestamptz not null default now()
);
create index if not exists workout_sets_workout_idx on public.workout_sets (workout_id, set_no);
create index if not exists workout_sets_exercise_idx on public.workout_sets (user_id, exercise_id, created_at desc);

-- Body weight (and optional body fat / waist), one row per day.
create table if not exists public.body_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  weight numeric(6, 2) check (weight > 0 and weight < 700),
  body_fat numeric(4, 1) check (body_fat between 1 and 80),
  waist numeric(5, 1) check (waist > 0 and waist < 400),
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, date)
);

do $$
declare
  t text;
begin
  foreach t in array array['exercises', 'workouts', 'body_metrics']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t);
  end loop;
end;
$$;

-- A set always belongs to its owner's workout.
create or replace function public.workout_set_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.workouts w where w.id = new.workout_id and w.user_id = new.user_id) then
    raise exception 'workout not found';
  end if;
  return new;
end;
$$;
drop trigger if exists workout_sets_owner on public.workout_sets;
create trigger workout_sets_owner before insert or update on public.workout_sets for each row execute function public.workout_set_owner();

alter table public.exercises enable row level security;
alter table public.workouts enable row level security;
alter table public.workout_sets enable row level security;
alter table public.body_metrics enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['exercises', 'workouts', 'workout_sets', 'body_metrics']
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

grant select, insert, update, delete on public.exercises, public.workouts, public.workout_sets, public.body_metrics to authenticated;
grant all on public.exercises, public.workouts, public.workout_sets, public.body_metrics to service_role;
