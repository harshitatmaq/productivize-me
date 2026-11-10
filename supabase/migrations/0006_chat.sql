-- =============================================================================
-- Productivize Me — 0006: Chat + Board inside shared dashboards (ported from
-- two-chat), and identity colours per person per dashboard.
-- Run after 0005 (safe to re-run).
--
-- Every row belongs to a shared dashboard (space) and is visible only to its
-- members (is_space_member from 0004). People are Productivize accounts.
-- =============================================================================

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
