-- =============================================================================
-- Productivize Me — 0004: shared dashboards (invite by email), "Share to…",
-- Interests + career memory (check-in questions), interest matches on jobs.
-- Run after 0003 (safe to re-run).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Shared dashboards ("spaces"). Everyone keeps their own private dashboard;
-- a space only holds what members explicitly share into it (copies).
-- ---------------------------------------------------------------------------
create table if not exists public.spaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  emoji text not null default '🤝' check (char_length(emoji) <= 16),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.space_members (
  space_id uuid not null references public.spaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz,
  primary key (space_id, user_id)
);
create index if not exists space_members_user_idx on public.space_members (user_id);

create table if not exists public.space_invites (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  email text not null check (email = lower(email) and email like '%@%'),
  invited_by uuid default auth.uid() references auth.users (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'revoked')),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);
create unique index if not exists space_invites_pending_idx on public.space_invites (space_id, email) where status = 'pending';
create index if not exists space_invites_email_idx on public.space_invites (email) where status = 'pending';

-- Things shared into a space. Always a copy (payload); the original stays private.
create table if not exists public.space_items (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  kind text not null check (kind in ('task', 'job', 'learning', 'link', 'flashcards', 'interest', 'note')),
  title text not null check (char_length(title) between 1 and 300),
  body text check (char_length(body) <= 20000),
  payload jsonb not null default '{}',
  note text check (char_length(note) <= 2000),
  shared_by uuid default auth.uid() references auth.users (id) on delete set null,
  source_id uuid,
  -- Members can work on the dashboard's copy (tick a task, move a job along).
  done boolean not null default false,
  done_by uuid references auth.users (id) on delete set null,
  done_at timestamptz,
  status text check (char_length(status) <= 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists space_items_space_idx on public.space_items (space_id, created_at desc);

create table if not exists public.space_comments (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  item_id uuid not null references public.space_items (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists space_comments_item_idx on public.space_comments (item_id, created_at);

create table if not exists public.space_reactions (
  item_id uuid not null references public.space_items (id) on delete cascade,
  space_id uuid not null references public.spaces (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  emoji text not null check (emoji in ('👍', '❤️', '🎉', '👀', '🔥')),
  created_at timestamptz not null default now(),
  primary key (item_id, user_id, emoji)
);

-- Shared lists everyone in the space can edit and tick off.
create table if not exists public.space_lists (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  sort double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.space_list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.space_lists (id) on delete cascade,
  space_id uuid not null references public.spaces (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 300),
  done boolean not null default false,
  done_by uuid references auth.users (id) on delete set null,
  done_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  sort double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists space_list_items_list_idx on public.space_list_items (list_id, sort);

do $$
declare
  t text;
begin
  foreach t in array array['spaces', 'space_items', 'space_lists', 'space_list_items']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Helpers (security definer so RLS policies don't recurse)
-- ---------------------------------------------------------------------------
create or replace function public.my_email()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(email) from auth.users where id = auth.uid();
$$;

create or replace function public.is_space_member(p_space uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.space_members m where m.space_id = p_space and m.user_id = auth.uid());
$$;

create or replace function public.is_space_owner(p_space uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.spaces s where s.id = p_space and s.owner_id = auth.uid());
$$;

create or replace function public.has_space_invite(p_space uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.space_invites i
    where i.space_id = p_space and i.status = 'pending' and i.email = public.my_email()
  );
$$;

-- The owner becomes a member as soon as the space exists.
create or replace function public.space_add_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.space_members (space_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (space_id, user_id) do update set role = 'owner';
  return new;
end;
$$;
drop trigger if exists spaces_add_owner on public.spaces;
create trigger spaces_add_owner after insert on public.spaces for each row execute function public.space_add_owner();

-- Child rows always inherit space_id from their parent (no cross-space smuggling).
create or replace function public.space_child_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name in ('space_comments', 'space_reactions') then
    select space_id into new.space_id from public.space_items where id = new.item_id;
  elsif tg_table_name = 'space_list_items' then
    select space_id into new.space_id from public.space_lists where id = new.list_id;
  end if;
  if new.space_id is null then
    raise exception 'parent not found';
  end if;
  return new;
end;
$$;
do $$
declare
  t text;
begin
  foreach t in array array['space_comments', 'space_reactions', 'space_list_items']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_sync', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.space_child_sync()', t || '_sync', t);
  end loop;
end;
$$;

-- Ticking something off records who did it.
create or replace function public.space_mark_done()
returns trigger
language plpgsql
as $$
begin
  if new.done and not coalesce(old.done, false) then
    new.done_by := auth.uid();
    new.done_at := now();
  elsif not new.done then
    new.done_by := null;
    new.done_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists space_items_done on public.space_items;
create trigger space_items_done before update on public.space_items for each row execute function public.space_mark_done();
drop trigger if exists space_list_items_done on public.space_list_items;
create trigger space_list_items_done before update on public.space_list_items for each row execute function public.space_mark_done();

-- ---------------------------------------------------------------------------
-- Invites: accept / decline (the invitee is matched by their account email)
-- ---------------------------------------------------------------------------
create or replace function public.accept_space_invite(p_invite uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.space_invites;
  who text;
begin
  select * into inv from public.space_invites where id = p_invite and status = 'pending' and email = public.my_email();
  if inv.id is null then
    raise exception 'Invite not found or already answered';
  end if;
  insert into public.space_members (space_id, user_id, role) values (inv.space_id, auth.uid(), 'member')
  on conflict (space_id, user_id) do nothing;
  update public.space_invites set status = 'accepted', responded_at = now() where id = inv.id;
  -- Any other pending invites to the same space for this email are now moot.
  update public.space_invites set status = 'accepted', responded_at = now()
    where space_id = inv.space_id and email = inv.email and status = 'pending';
  if inv.invited_by is not null then
    select coalesce(nullif(full_name, ''), email) into who from public.profiles where id = auth.uid();
    insert into public.notifications (user_id, kind, title, body, url, dedupe_key)
    select inv.invited_by, 'space', who || ' joined ' || s.name, 'You can now share things with each other there.',
           '/together?space=' || s.id, 'space-join:' || inv.id
    from public.spaces s where s.id = inv.space_id
    on conflict (user_id, dedupe_key) do nothing;
  end if;
  return inv.space_id;
end;
$$;

create or replace function public.decline_space_invite(p_invite uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.space_invites set status = 'declined', responded_at = now()
  where id = p_invite and status = 'pending' and email = public.my_email();
$$;

-- Names of the people in a space (profiles stay private otherwise).
-- (0006 adds a colour column; dropping first keeps re-runs in any order working.)
drop function if exists public.space_people(uuid);
create or replace function public.space_people(p_space uuid)
returns table (user_id uuid, name text, email text, role text, joined_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id, coalesce(nullif(p.full_name, ''), split_part(p.email, '@', 1)), p.email, m.role, m.joined_at
  from public.space_members m
  join public.profiles p on p.id = m.user_id
  where m.space_id = p_space and public.is_space_member(p_space)
  order by m.role = 'owner' desc, m.joined_at;
$$;

-- Server-side lookup when inviting (service role only).
create or replace function public.auth_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Weekly progress: now only between people who share a dashboard. (With
-- invites, "everyone who opted in" could include strangers.)
-- ---------------------------------------------------------------------------
drop function if exists public.buddy_stats(date);
create or replace function public.buddy_stats(p_week_start date, p_space uuid default null)
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
  circle as (
    select auth.uid() as id
    union
    select m2.user_id
    from public.space_members m1
    join public.space_members m2 on m2.space_id = m1.space_id
    where m1.user_id = auth.uid() and (p_space is null or m1.space_id = p_space)
  ),
  people as (
    select p.*, (now() at time zone p.timezone)::date as today
    from public.profiles p
    where p.share_progress and exists (select 1 from me) and p.id in (select id from circle)
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
-- Interests + career memory
-- ---------------------------------------------------------------------------
create table if not exists public.interests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  kind text not null default 'learning' check (kind in ('career', 'learning', 'hobby')),
  stage text not null default 'curious' check (stage in ('curious', 'learning', 'using', 'strong')),
  -- How much this really is your interest (from evidence), 0-100.
  strength integer not null default 0 check (strength between 0 and 100),
  -- How much it helps with the jobs you target, 0-100 (null = not scored yet).
  job_relevance integer check (job_relevance between 0 and 100),
  relevance_reason text,
  relevance_basis text,
  job_use text not null default 'auto' check (job_use in ('auto', 'always', 'never')),
  status text not null default 'active' check (status in ('active', 'suggested', 'not_interested')),
  source text not null default 'manual' check (source in ('manual', 'scout')),
  evidence jsonb not null default '[]',
  evidence_count integer not null default 0,
  minutes integer not null default 0,
  notes text check (char_length(notes) <= 2000),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists interests_user_name_idx on public.interests (user_id, lower(name));
drop trigger if exists interests_updated_at on public.interests;
create trigger interests_updated_at before update on public.interests for each row execute function public.set_updated_at();

-- Check-in questions from Scout (max 2 a day, in-app only).
create table if not exists public.memory_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  interest_id uuid references public.interests (id) on delete cascade,
  kind text not null check (kind in ('confirm_interest', 'job_use', 'exclude_term')),
  question text not null,
  detail text,
  term text,
  status text not null default 'pending' check (status in ('pending', 'answered', 'dismissed')),
  answer text,
  snooze_until timestamptz,
  shown_on date,
  created_at timestamptz not null default now(),
  answered_at timestamptz
);
create unique index if not exists memory_questions_open_idx on public.memory_questions (user_id, kind, coalesce(interest_id::text, term)) where status = 'pending';

alter table public.jobs add column if not exists interest_matches jsonb not null default '[]';
alter table public.job_profiles add column if not exists memory_at timestamptz;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.spaces enable row level security;
alter table public.space_members enable row level security;
alter table public.space_invites enable row level security;
alter table public.space_items enable row level security;
alter table public.space_comments enable row level security;
alter table public.space_reactions enable row level security;
alter table public.space_lists enable row level security;
alter table public.space_list_items enable row level security;
alter table public.interests enable row level security;
alter table public.memory_questions enable row level security;

drop policy if exists "members read" on public.spaces;
create policy "members read" on public.spaces for select to authenticated
  using (owner_id = (select auth.uid()) or public.is_space_member(id) or public.has_space_invite(id));
drop policy if exists "create own" on public.spaces;
create policy "create own" on public.spaces for insert to authenticated with check (owner_id = (select auth.uid()));
drop policy if exists "owner edits" on public.spaces;
create policy "owner edits" on public.spaces for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
drop policy if exists "owner deletes" on public.spaces;
create policy "owner deletes" on public.spaces for delete to authenticated using (owner_id = (select auth.uid()));

drop policy if exists "members read" on public.space_members;
create policy "members read" on public.space_members for select to authenticated using (public.is_space_member(space_id));
drop policy if exists "leave or remove" on public.space_members;
create policy "leave or remove" on public.space_members for delete to authenticated
  using ((user_id = (select auth.uid()) and role <> 'owner') or (public.is_space_owner(space_id) and role <> 'owner'));
drop policy if exists "own last seen" on public.space_members;
create policy "own last seen" on public.space_members for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "members and invitee read" on public.space_invites;
create policy "members and invitee read" on public.space_invites for select to authenticated
  using (public.is_space_member(space_id) or email = public.my_email());
drop policy if exists "members invite" on public.space_invites;
create policy "members invite" on public.space_invites for insert to authenticated
  with check (public.is_space_member(space_id) and invited_by = (select auth.uid()) and status = 'pending');
drop policy if exists "members revoke" on public.space_invites;
create policy "members revoke" on public.space_invites for update to authenticated
  using (public.is_space_member(space_id)) with check (public.is_space_member(space_id) and status in ('pending', 'revoked'));

do $$
declare
  t text;
begin
  foreach t in array array['space_items', 'space_lists', 'space_list_items']
  loop
    execute format('drop policy if exists "members read" on public.%I', t);
    execute format('create policy "members read" on public.%I for select to authenticated using (public.is_space_member(space_id))', t);
    execute format('drop policy if exists "members add" on public.%I', t);
    execute format('create policy "members add" on public.%I for insert to authenticated with check (public.is_space_member(space_id))', t);
    execute format('drop policy if exists "members edit" on public.%I', t);
    execute format('create policy "members edit" on public.%I for update to authenticated using (public.is_space_member(space_id)) with check (public.is_space_member(space_id))', t);
  end loop;
end;
$$;
drop policy if exists "author or owner deletes" on public.space_items;
create policy "author or owner deletes" on public.space_items for delete to authenticated
  using (public.is_space_member(space_id) and (shared_by = (select auth.uid()) or public.is_space_owner(space_id)));
drop policy if exists "members delete" on public.space_lists;
create policy "members delete" on public.space_lists for delete to authenticated using (public.is_space_member(space_id));
drop policy if exists "members delete" on public.space_list_items;
create policy "members delete" on public.space_list_items for delete to authenticated using (public.is_space_member(space_id));

drop policy if exists "members read" on public.space_comments;
create policy "members read" on public.space_comments for select to authenticated using (public.is_space_member(space_id));
drop policy if exists "members comment" on public.space_comments;
create policy "members comment" on public.space_comments for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_space_member(space_id));
drop policy if exists "own delete" on public.space_comments;
create policy "own delete" on public.space_comments for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists "members read" on public.space_reactions;
create policy "members read" on public.space_reactions for select to authenticated using (public.is_space_member(space_id));
drop policy if exists "members react" on public.space_reactions;
create policy "members react" on public.space_reactions for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_space_member(space_id));
drop policy if exists "own delete" on public.space_reactions;
create policy "own delete" on public.space_reactions for delete to authenticated using (user_id = (select auth.uid()));

do $$
declare
  t text;
begin
  foreach t in array array['interests', 'memory_questions']
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

grant select, insert, update, delete on public.spaces, public.space_items, public.space_comments, public.space_reactions,
  public.space_lists, public.space_list_items, public.interests, public.memory_questions to authenticated;
grant select, delete on public.space_members to authenticated;
grant update (last_seen_at) on public.space_members to authenticated;
grant select, insert, update on public.space_invites to authenticated;
grant all on public.spaces, public.space_members, public.space_invites, public.space_items, public.space_comments,
  public.space_reactions, public.space_lists, public.space_list_items, public.interests, public.memory_questions to service_role;

revoke all on function public.my_email(), public.is_space_member(uuid), public.is_space_owner(uuid), public.has_space_invite(uuid),
  public.accept_space_invite(uuid), public.decline_space_invite(uuid), public.space_people(uuid),
  public.auth_user_id_by_email(text), public.buddy_stats(date, uuid) from public, anon;
grant execute on function public.my_email(), public.is_space_member(uuid), public.is_space_owner(uuid), public.has_space_invite(uuid),
  public.accept_space_invite(uuid), public.decline_space_invite(uuid), public.space_people(uuid),
  public.buddy_stats(date, uuid) to authenticated, service_role;
grant execute on function public.auth_user_id_by_email(text) to service_role;

-- ---------------------------------------------------------------------------
-- Realtime: shared dashboards update live for everyone in them
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['space_items', 'space_comments', 'space_reactions', 'space_lists', 'space_list_items', 'space_members', 'space_invites']
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
