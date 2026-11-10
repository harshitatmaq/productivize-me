-- =============================================================================
-- Productivize Me — 0005: everything after 0004, in one file.
--
-- Run this ONE file in the Supabase SQL Editor after 0001–0004. It is safe to
-- run again (also if you already ran an older 0005/0006 file). It contains:
--
--   Part 1 · Planning preferences + Health (PPL + Core workouts, progression,
--            body weight)
--   Part 2 · Together: Chat + Board in every shared dashboard, per-person
--            colours, private chat-images bucket, Realtime
--   Part 3 · Personal memory (what the AI learns about how you work, what you
--            like and believe) + re-plannable "Plan my day" times
-- =============================================================================

-- #############################################################################
-- Part 1 · Planning preferences + Health
-- #############################################################################

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

-- #############################################################################
-- Part 2 · Together: Chat + Board, per-person colours
-- #############################################################################

-- ---------------------------------------------------------------------------
-- Identity colour per person per dashboard. Two people in one dashboard can
-- never share a colour (unique index). New members get the first free one.
-- ---------------------------------------------------------------------------
alter table public.space_members add column if not exists color text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'space_members_color_check') then
    alter table public.space_members add constraint space_members_color_check
      check (color is null or color in ('green', 'purple', 'blue', 'coral', 'amber', 'teal', 'pink', 'slate', 'olive', 'indigo'));
  end if;
end $$;
create unique index if not exists space_members_color_idx on public.space_members (space_id, color) where color is not null;

create or replace function public.space_free_color(p_space uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select c from unnest(array['green', 'purple', 'blue', 'coral', 'amber', 'teal', 'pink', 'slate', 'olive', 'indigo']) with ordinality as t(c, n)
  where not exists (select 1 from public.space_members m where m.space_id = p_space and m.color = t.c)
  order by n
  limit 1;
$$;

create or replace function public.space_member_color()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.color is null then
    new.color := public.space_free_color(new.space_id);
  end if;
  return new;
end;
$$;
drop trigger if exists space_members_color on public.space_members;
create trigger space_members_color before insert on public.space_members for each row execute function public.space_member_color();

-- Existing members get colours too.
do $$
declare
  r record;
begin
  for r in select space_id, user_id from public.space_members where color is null order by joined_at loop
    update public.space_members set color = public.space_free_color(r.space_id) where space_id = r.space_id and user_id = r.user_id;
  end loop;
end $$;

-- Members may change their own colour (the unique index refuses a taken one).
grant update (last_seen_at, color) on public.space_members to authenticated;

-- space_people now also returns each person's colour.
drop function if exists public.space_people(uuid);
create or replace function public.space_people(p_space uuid)
returns table (user_id uuid, name text, email text, role text, joined_at timestamptz, color text)
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id, coalesce(nullif(p.full_name, ''), split_part(p.email, '@', 1)), p.email, m.role, m.joined_at, m.color
  from public.space_members m
  join public.profiles p on p.id = m.user_id
  where m.space_id = p_space and public.is_space_member(p_space)
  order by m.role = 'owner' desc, m.joined_at;
$$;
revoke all on function public.space_people(uuid), public.space_free_color(uuid) from public, anon;
grant execute on function public.space_people(uuid), public.space_free_color(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------------
create table if not exists public.chat_messages (
  id           uuid primary key default gen_random_uuid(),
  space_id     uuid not null references public.spaces (id) on delete cascade,
  -- Idempotency key made by the sender before the first attempt (offline outbox).
  client_id    text not null unique,
  sender       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body         text check (char_length(body) <= 8000),
  image_path   text,
  image_width  int,
  image_height int,
  kind         text not null default 'normal' check (kind in ('normal', 'saved', 'work')),
  -- client_id of the message this answers (lets a reply be queued offline).
  reply_to     text,
  -- Who it pings (resolved at send time).
  mentions     uuid[] not null default '{}',
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  search_vector tsvector generated always as (to_tsvector('english', coalesce(body, ''))) stored,
  constraint chat_messages_has_content check (body is not null or image_path is not null)
);
create index if not exists chat_messages_space_idx on public.chat_messages (space_id, created_at desc);
create index if not exists chat_messages_kind_idx on public.chat_messages (space_id, kind, created_at desc) where kind <> 'normal';
create index if not exists chat_messages_reply_idx on public.chat_messages (reply_to) where reply_to is not null;
create index if not exists chat_messages_search_idx on public.chat_messages using gin (search_vector);
create index if not exists chat_messages_mentions_idx on public.chat_messages using gin (mentions) where cardinality(mentions) > 0;

create table if not exists public.chat_reactions (
  message_id uuid not null references public.chat_messages (id) on delete cascade,
  space_id   uuid not null references public.spaces (id) on delete cascade,
  sender     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  emoji      text not null check (char_length(emoji) <= 16),
  created_at timestamptz not null default now(),
  primary key (message_id, sender, emoji)
);
create index if not exists chat_reactions_message_idx on public.chat_reactions (message_id);

-- Per person per dashboard: read watermark and "clear chat" watermark.
create table if not exists public.chat_read_state (
  space_id       uuid not null references public.spaces (id) on delete cascade,
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  last_read_at   timestamptz not null default now(),
  cleared_before timestamptz,
  primary key (space_id, user_id)
);

create table if not exists public.chat_pins (
  message_id        uuid primary key references public.chat_messages (id) on delete cascade,
  space_id          uuid not null references public.spaces (id) on delete cascade,
  message_client_id text not null,
  excerpt           text not null default '',
  author            uuid not null,
  pinned_by         uuid not null default auth.uid(),
  created_at        timestamptz not null default now()
);
create index if not exists chat_pins_space_idx on public.chat_pins (space_id, created_at desc);

create table if not exists public.chat_promises (
  message_id        uuid primary key references public.chat_messages (id) on delete cascade,
  space_id          uuid not null references public.spaces (id) on delete cascade,
  message_client_id text not null,
  body              text not null default '',
  promiser          uuid not null,
  marked_by         uuid not null default auth.uid(),
  kept              boolean not null default false,
  kept_at           timestamptz,
  due_at            timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists chat_promises_space_idx on public.chat_promises (space_id, created_at desc);

-- Children always carry their message's dashboard.
create or replace function public.chat_child_space()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select space_id into new.space_id from public.chat_messages where id = new.message_id;
  if new.space_id is null then
    raise exception 'message not found';
  end if;
  return new;
end;
$$;
do $$
declare
  t text;
begin
  foreach t in array array['chat_reactions', 'chat_pins', 'chat_promises']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_space', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.chat_child_space()', t || '_space', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Board: notes, tasks, discuss, shopping, meals, calendar — one shape.
-- ---------------------------------------------------------------------------
create table if not exists public.board_items (
  id         uuid primary key default gen_random_uuid(),
  space_id   uuid not null references public.spaces (id) on delete cascade,
  client_id  text not null unique,
  kind       text not null check (kind in ('note', 'task', 'discuss', 'shop', 'meal', 'event')),
  -- Creator; drives the colour. updated_by: last editor (an edit becomes theirs).
  author     uuid not null default auth.uid(),
  updated_by uuid,
  title      text not null default '' check (char_length(title) <= 8000),
  done       boolean not null default false,
  due_at     timestamptz,
  meta       jsonb not null default '{}',
  position   double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists board_items_space_idx on public.board_items (space_id, kind, position) where deleted_at is null;
create index if not exists board_items_due_idx on public.board_items (space_id, due_at) where deleted_at is null and due_at is not null;
drop trigger if exists board_items_updated_at on public.board_items;
create trigger board_items_updated_at before update on public.board_items for each row execute function public.set_updated_at();

-- Lists from 0004 become Board tasks (Lists is replaced by the Board).
insert into public.board_items (space_id, client_id, kind, author, title, done, position, meta, created_at)
select li.space_id, 'list-' || li.id, 'task', coalesce(li.created_by, s.owner_id), li.text, li.done, li.sort,
       jsonb_build_object('list', l.title), li.created_at
from public.space_list_items li
join public.space_lists l on l.id = li.list_id
join public.spaces s on s.id = li.space_id
on conflict (client_id) do nothing;

-- Cached Open Graph previews. Server-only (no policies).
create table if not exists public.link_previews (
  url         text primary key,
  title       text,
  description text,
  image_url   text,
  site_name   text,
  failed      boolean not null default false,
  fetched_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Search (websearch syntax), respecting your own "clear chat".
-- ---------------------------------------------------------------------------
create or replace function public.chat_search(p_space uuid, p_query text, p_limit int default 40)
returns setof public.chat_messages
language sql
stable
security invoker
set search_path = public
as $$
  select m.*
  from public.chat_messages m
  left join public.chat_read_state r on r.space_id = m.space_id and r.user_id = auth.uid()
  where m.space_id = p_space
    and m.deleted_at is null
    and m.search_vector @@ websearch_to_tsquery('english', p_query)
    and (r.cleared_before is null or m.created_at > r.cleared_before)
  order by m.created_at desc
  limit least(greatest(p_limit, 1), 100);
$$;
grant execute on function public.chat_search(uuid, text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.chat_messages enable row level security;
alter table public.chat_reactions enable row level security;
alter table public.chat_read_state enable row level security;
alter table public.chat_pins enable row level security;
alter table public.chat_promises enable row level security;
alter table public.board_items enable row level security;
alter table public.link_previews enable row level security;

drop policy if exists "members read" on public.chat_messages;
create policy "members read" on public.chat_messages for select to authenticated using (public.is_space_member(space_id));
drop policy if exists "members send as themselves" on public.chat_messages;
create policy "members send as themselves" on public.chat_messages for insert to authenticated
  with check (sender = (select auth.uid()) and public.is_space_member(space_id));
drop policy if exists "edit own" on public.chat_messages;
create policy "edit own" on public.chat_messages for update to authenticated
  using (sender = (select auth.uid()) and public.is_space_member(space_id))
  with check (sender = (select auth.uid()) and public.is_space_member(space_id));

drop policy if exists "members read" on public.chat_reactions;
create policy "members read" on public.chat_reactions for select to authenticated using (public.is_space_member(space_id));
drop policy if exists "react as yourself" on public.chat_reactions;
create policy "react as yourself" on public.chat_reactions for insert to authenticated
  with check (sender = (select auth.uid()) and public.is_space_member(space_id));
drop policy if exists "remove own" on public.chat_reactions;
create policy "remove own" on public.chat_reactions for delete to authenticated using (sender = (select auth.uid()));

drop policy if exists "members read" on public.chat_read_state;
create policy "members read" on public.chat_read_state for select to authenticated using (public.is_space_member(space_id));
drop policy if exists "own row" on public.chat_read_state;
create policy "own row" on public.chat_read_state for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_space_member(space_id));
drop policy if exists "own row update" on public.chat_read_state;
create policy "own row update" on public.chat_read_state for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and public.is_space_member(space_id));

do $$
declare
  t text;
begin
  foreach t in array array['chat_pins', 'chat_promises']
  loop
    execute format('drop policy if exists "members read" on public.%I', t);
    execute format('create policy "members read" on public.%I for select to authenticated using (public.is_space_member(space_id))', t);
    execute format('drop policy if exists "members delete" on public.%I', t);
    execute format('create policy "members delete" on public.%I for delete to authenticated using (public.is_space_member(space_id))', t);
  end loop;
end $$;
drop policy if exists "pin as yourself" on public.chat_pins;
create policy "pin as yourself" on public.chat_pins for insert to authenticated
  with check (pinned_by = (select auth.uid()) and public.is_space_member(space_id));
drop policy if exists "mark as yourself" on public.chat_promises;
create policy "mark as yourself" on public.chat_promises for insert to authenticated
  with check (marked_by = (select auth.uid()) and public.is_space_member(space_id));
drop policy if exists "members tick" on public.chat_promises;
create policy "members tick" on public.chat_promises for update to authenticated
  using (public.is_space_member(space_id)) with check (public.is_space_member(space_id));

drop policy if exists "members read" on public.board_items;
create policy "members read" on public.board_items for select to authenticated using (public.is_space_member(space_id));
drop policy if exists "members add as themselves" on public.board_items;
create policy "members add as themselves" on public.board_items for insert to authenticated
  with check (author = (select auth.uid()) and public.is_space_member(space_id));
-- Anyone in the dashboard may edit any item; the edit is credited to them.
drop policy if exists "members edit" on public.board_items;
create policy "members edit" on public.board_items for update to authenticated
  using (public.is_space_member(space_id))
  with check (public.is_space_member(space_id) and (updated_by is null or updated_by = (select auth.uid())));
drop policy if exists "members delete" on public.board_items;
create policy "members delete" on public.board_items for delete to authenticated using (public.is_space_member(space_id));

grant select, insert, update on public.chat_messages, public.chat_read_state, public.board_items to authenticated;
grant select, insert, delete on public.chat_reactions, public.chat_pins to authenticated;
grant select, insert, update, delete on public.chat_promises to authenticated;
grant delete on public.board_items to authenticated;
grant all on public.chat_messages, public.chat_reactions, public.chat_read_state, public.chat_pins, public.chat_promises,
  public.board_items, public.link_previews to service_role;

-- ---------------------------------------------------------------------------
-- Photos: private bucket; objects live under <space_id>/…
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public) values ('chat-images', 'chat-images', false) on conflict (id) do nothing;
    execute 'drop policy if exists "chat images: members read" on storage.objects';
    execute $p$create policy "chat images: members read" on storage.objects for select to authenticated
      using (bucket_id = 'chat-images' and public.is_space_member(((storage.foldername(name))[1])::uuid))$p$;
    execute 'drop policy if exists "chat images: members upload" on storage.objects';
    execute $p$create policy "chat images: members upload" on storage.objects for insert to authenticated
      with check (bucket_id = 'chat-images' and public.is_space_member(((storage.foldername(name))[1])::uuid))$p$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
alter table public.board_items replica identity full;
alter table public.chat_read_state replica identity full;
alter table public.chat_pins replica identity full;
alter table public.chat_promises replica identity full;
alter table public.chat_reactions replica identity full;

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['chat_messages', 'chat_reactions', 'chat_read_state', 'chat_pins', 'chat_promises', 'board_items']
    loop
      begin
        execute format('alter publication supabase_realtime add table public.%I', t);
      exception when duplicate_object then
        null;
      end;
    end loop;
  end if;
end $$;

-- #############################################################################
-- Part 3 · Personal memory + re-plannable plan times
-- #############################################################################

-- Learning can be switched off in Settings; existing memories are still used.
alter table public.profiles add column if not exists memory_learning boolean not null default true;
alter table public.profiles add column if not exists memory_learned_at timestamptz;

-- The time "Plan my day" gave a task. While due_time still equals it, the time
-- belongs to the plan and a new plan may move it; once you change the time
-- yourself it is fixed.
alter table public.tasks add column if not exists planned_time time;

-- ---------------------------------------------------------------------------
-- Things the AI knows about you. One short statement each.
-- ---------------------------------------------------------------------------
create table if not exists public.user_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null default 'habit'
    check (kind in ('schedule', 'habit', 'work_style', 'like', 'dislike', 'value', 'goal', 'life')),
  statement text not null check (char_length(statement) between 3 and 240),
  -- Normalised statement, so the same thing isn't stored twice.
  key text not null check (char_length(key) between 1 and 240),
  -- 0-100. Statements you made yourself start high; learned ones grow with evidence.
  confidence integer not null default 60 check (confidence between 0 and 100),
  -- active: used by the AI · suggested: waiting for you to confirm · rejected: "not true", never suggested again
  status text not null default 'active' check (status in ('active', 'suggested', 'rejected')),
  -- you: you said or wrote it · learned: noticed from how you use the app
  source text not null default 'learned' check (source in ('you', 'learned')),
  -- Pinned facts are always given to the AI and never weakened automatically.
  pinned boolean not null default false,
  evidence jsonb not null default '[]',
  evidence_count integer not null default 0,
  -- Optional time window this implies ({label, keywords, start, end, days}); becomes a
  -- planning routine when you accept it.
  routine jsonb,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists user_facts_user_key_idx on public.user_facts (user_id, key);
create index if not exists user_facts_user_status_idx on public.user_facts (user_id, status, confidence desc);
drop trigger if exists user_facts_updated_at on public.user_facts;
create trigger user_facts_updated_at before update on public.user_facts for each row execute function public.set_updated_at();

-- What you tell the AI in your own words (Scout chat, Search & ask, plan
-- changes, "Remember this"), waiting for the daily learning pass.
create table if not exists public.memory_inbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source text not null check (char_length(source) between 1 and 40),
  text text not null check (char_length(text) between 1 and 2000),
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists memory_inbox_user_idx on public.memory_inbox (user_id, processed_at, created_at desc);

-- Check-in questions can now confirm a learned fact, or turn one into a routine.
alter table public.memory_questions add column if not exists fact_id uuid references public.user_facts (id) on delete cascade;
alter table public.memory_questions drop constraint if exists memory_questions_kind_check;
alter table public.memory_questions add constraint memory_questions_kind_check
  check (kind in ('confirm_interest', 'job_use', 'exclude_term', 'confirm_fact', 'fact_routine'));
drop index if exists public.memory_questions_open_idx;
create unique index if not exists memory_questions_open_idx
  on public.memory_questions (user_id, kind, coalesce(interest_id::text, fact_id::text, term)) where status = 'pending';

-- ---------------------------------------------------------------------------
-- RLS: your own rows only.
-- ---------------------------------------------------------------------------
alter table public.user_facts enable row level security;
alter table public.memory_inbox enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['user_facts', 'memory_inbox']
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

grant select, insert, update, delete on public.user_facts, public.memory_inbox to authenticated;
grant all on public.user_facts, public.memory_inbox to service_role;
