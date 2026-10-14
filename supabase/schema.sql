-- CodeSync database schema (PostgreSQL / Supabase)
-- Run this in the Supabase SQL editor (or `supabase db push`).

create extension if not exists "pgcrypto";

-- ───────────────────────── Profiles ─────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url text,
  color text not null default '#4f46e5',
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  palette text[] := array['#4f46e5','#0891b2','#059669','#d97706','#dc2626','#9333ea','#db2777','#2563eb'];
  name text;
begin
  name := coalesce(
    new.raw_user_meta_data->>'display_name',
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name',
    split_part(new.email, '@', 1)
  );
  insert into public.profiles (id, display_name, avatar_url, color)
  values (
    new.id, name, new.raw_user_meta_data->>'avatar_url',
    palette[1 + floor(random() * array_length(palette, 1))::int]
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────────────────── Rooms ─────────────────────────
create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                       -- short invite code
  name text not null check (char_length(name) between 1 and 80),
  default_language text not null default 'javascript',
  owner_id uuid not null references public.profiles(id) on delete cascade,
  runner_id uuid references public.profiles(id) on delete set null,  -- who may execute code
  created_at timestamptz not null default now()
);
create index if not exists rooms_owner_idx on public.rooms(owner_id);

create table if not exists public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'editor' check (role in ('owner','editor','viewer')),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index if not exists room_members_user_idx on public.room_members(user_id);

-- ───────────────────────── Files ─────────────────────────
create table if not exists public.room_files (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  parent_id uuid references public.room_files(id) on delete cascade,
  kind text not null default 'file' check (kind in ('file','folder')),
  name text not null check (char_length(name) between 1 and 64),
  language text not null default 'plaintext',
  initial_content text not null default '',        -- used once to seed an empty Yjs doc
  ydoc_state text,                                 -- base64 Yjs update (persisted CRDT state)
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists room_files_room_idx on public.room_files(room_id);
create unique index if not exists room_files_unique_name
  on public.room_files(room_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), name);

-- ───────────────────────── Annotations ─────────────────────────
create table if not exists public.annotations (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  file_id uuid not null references public.room_files(id) on delete cascade,
  line integer not null check (line >= 1),
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  resolved boolean not null default false,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists annotations_room_idx on public.annotations(room_id, created_at);
create index if not exists annotations_file_idx on public.annotations(file_id, line);

create table if not exists public.annotation_replies (
  id uuid primary key default gen_random_uuid(),
  annotation_id uuid not null references public.annotations(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists annotation_replies_idx on public.annotation_replies(annotation_id, created_at);

-- ───────────────────────── Executions ─────────────────────────
create table if not exists public.executions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  file_id uuid references public.room_files(id) on delete set null,
  started_by uuid references public.profiles(id) on delete set null,
  language text not null,
  status text not null default 'running' check (status in ('running','completed','failed')),
  exit_code integer,
  duration_ms integer,
  stdout text not null default '',
  stderr text not null default '',
  stdin text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists executions_room_idx on public.executions(room_id, created_at desc);

-- ───────────────────────── Activity feed ─────────────────────────
create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  type text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists activity_room_idx on public.activity_events(room_id, created_at desc);

-- ───────────────────────── Row level security ─────────────────────────
-- All reads/writes from the app go through the CodeSync server, which uses the
-- service-role key and enforces room permissions itself. RLS is enabled on every
-- table so the public anon/authenticated keys can never write room data directly.
alter table public.profiles           enable row level security;
alter table public.rooms              enable row level security;
alter table public.room_members       enable row level security;
alter table public.room_files         enable row level security;
alter table public.annotations        enable row level security;
alter table public.annotation_replies enable row level security;
alter table public.executions         enable row level security;
alter table public.activity_events    enable row level security;

create or replace function public.is_room_member(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.room_members where room_id = rid and user_id = auth.uid());
$$;

-- Defence in depth: members may read their own rooms' data directly; nobody may write.
drop policy if exists "profiles readable by self" on public.profiles;
create policy "profiles readable by self" on public.profiles for select using (id = auth.uid());
drop policy if exists "rooms readable by members" on public.rooms;
create policy "rooms readable by members" on public.rooms for select using (public.is_room_member(id));
drop policy if exists "members readable by members" on public.room_members;
create policy "members readable by members" on public.room_members for select using (public.is_room_member(room_id));
drop policy if exists "files readable by members" on public.room_files;
create policy "files readable by members" on public.room_files for select using (public.is_room_member(room_id));
drop policy if exists "annotations readable by members" on public.annotations;
create policy "annotations readable by members" on public.annotations for select using (public.is_room_member(room_id));
drop policy if exists "executions readable by members" on public.executions;
create policy "executions readable by members" on public.executions for select using (public.is_room_member(room_id));
drop policy if exists "activity readable by members" on public.activity_events;
create policy "activity readable by members" on public.activity_events for select using (public.is_room_member(room_id));
drop policy if exists "replies readable by members" on public.annotation_replies;
create policy "replies readable by members" on public.annotation_replies for select using (
  exists (select 1 from public.annotations a where a.id = annotation_id and public.is_room_member(a.room_id))
);

-- ───────────────────────── Room chat (added) ─────────────────────────
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_room_idx on public.chat_messages(room_id, created_at desc);
alter table public.chat_messages enable row level security;
drop policy if exists "chat readable by members" on public.chat_messages;
create policy "chat readable by members" on public.chat_messages for select using (public.is_room_member(room_id));
