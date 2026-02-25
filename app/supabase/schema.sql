-- FEH Barracks Manager - initial schema
-- Run this in Supabase SQL Editor for your project.

create extension if not exists "pgcrypto";

-- Global hero catalog (shared/read-only for normal app users)
create table if not exists public.heroes (
  hero_slug text primary key,
  name text not null,
  source_url text,
  tier numeric,
  rarity text,
  weapon text,
  move text,
  tag text,
  img_url text,
  updated_at timestamptz not null default now()
);

-- Backward-compat guardrail for older projects that were created
-- before `heroes.rarity` existed.
alter table public.heroes
  add column if not exists rarity text;

create index if not exists heroes_name_idx on public.heroes (name);
create index if not exists heroes_weapon_idx on public.heroes (weapon);
create index if not exists heroes_move_idx on public.heroes (move);

-- Per-user barracks records
create table if not exists public.user_barracks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  hero_slug text not null references public.heroes(hero_slug) on delete cascade,
  hero_name text not null,
  merges integer not null default 0,
  copies_owned integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, hero_slug)
);

alter table public.user_barracks
  add column if not exists copies_owned integer not null default 0;

create index if not exists user_barracks_user_idx on public.user_barracks (user_id);
create index if not exists user_barracks_hero_idx on public.user_barracks (hero_slug);

-- Per-user favorites
create table if not exists public.user_favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  hero_slug text not null references public.heroes(hero_slug) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, hero_slug)
);

create index if not exists user_favorites_user_idx on public.user_favorites (user_id);

-- Per-user standalone notes
create table if not exists public.user_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  hero_slug text references public.heroes(hero_slug) on delete set null,
  title text not null,
  content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_notes_user_idx on public.user_notes (user_id);

-- Per-user team presets
create table if not exists public.user_teams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  slots jsonb not null default '[]'::jsonb,
  slot_labels jsonb not null default '["","","",""]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_teams_user_idx on public.user_teams (user_id);

-- Per-user hero visual preferences (e.g. selected background on hero detail page)
create table if not exists public.user_hero_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  hero_slug text not null references public.heroes(hero_slug) on delete cascade,
  background_name text,
  updated_at timestamptz not null default now(),
  primary key (user_id, hero_slug)
);

create index if not exists user_hero_preferences_user_idx on public.user_hero_preferences (user_id);
create index if not exists user_hero_preferences_hero_idx on public.user_hero_preferences (hero_slug);

-- Per-user Aether Resort preferences
create table if not exists public.user_aether_resort_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  slots jsonb not null default '[]'::jsonb,
  background_name text,
  updated_at timestamptz not null default now()
);

create index if not exists user_aether_resort_preferences_user_idx
  on public.user_aether_resort_preferences (user_id);

-- Optional profile table for display settings
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_hero_slug text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists avatar_hero_slug text;

-- Social: friend requests and relationships
create table if not exists public.user_friendships (
  id            uuid primary key default gen_random_uuid(),
  requester_id  uuid not null references auth.users(id) on delete cascade,
  addressee_id  uuid not null references auth.users(id) on delete cascade,
  status        text not null default 'pending'
                  check (status in ('pending', 'accepted')),
  created_at    timestamptz not null default now(),
  unique (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);

create index if not exists user_friendships_requester_idx on public.user_friendships (requester_id);
create index if not exists user_friendships_addressee_idx on public.user_friendships (addressee_id);

alter table public.heroes enable row level security;
alter table public.user_barracks enable row level security;
alter table public.user_favorites enable row level security;
alter table public.user_notes enable row level security;
alter table public.user_teams enable row level security;
alter table public.user_hero_preferences enable row level security;
alter table public.user_aether_resort_preferences enable row level security;
alter table public.profiles enable row level security;
alter table public.user_friendships enable row level security;

-- heroes: readable by authenticated users, write via service role/import script only
drop policy if exists "heroes_select_authenticated" on public.heroes;
create policy "heroes_select_authenticated"
  on public.heroes for select
  to authenticated
  using (true);

-- user_barracks: own rows + accepted friends (for tavern leaderboard)
drop policy if exists "user_barracks_select_own" on public.user_barracks;
create policy "user_barracks_select_own"
  on public.user_barracks for select
  to authenticated
  using (
    auth.uid() = user_id or
    exists (
      select 1 from public.user_friendships
      where status = 'accepted'
        and ((requester_id = auth.uid() and addressee_id = user_barracks.user_id)
          or (addressee_id = auth.uid() and requester_id = user_barracks.user_id))
    )
  );

drop policy if exists "user_barracks_insert_own" on public.user_barracks;
create policy "user_barracks_insert_own"
  on public.user_barracks for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "user_barracks_update_own" on public.user_barracks;
create policy "user_barracks_update_own"
  on public.user_barracks for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "user_barracks_delete_own" on public.user_barracks;
create policy "user_barracks_delete_own"
  on public.user_barracks for delete
  to authenticated
  using (auth.uid() = user_id);

-- user_favorites: own rows + accepted friends (for tavern leaderboard)
drop policy if exists "user_favorites_select_own" on public.user_favorites;
create policy "user_favorites_select_own"
  on public.user_favorites for select
  to authenticated
  using (
    auth.uid() = user_id or
    exists (
      select 1 from public.user_friendships
      where status = 'accepted'
        and ((requester_id = auth.uid() and addressee_id = user_favorites.user_id)
          or (addressee_id = auth.uid() and requester_id = user_favorites.user_id))
    )
  );

drop policy if exists "user_favorites_insert_own" on public.user_favorites;
create policy "user_favorites_insert_own"
  on public.user_favorites for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "user_favorites_delete_own" on public.user_favorites;
create policy "user_favorites_delete_own"
  on public.user_favorites for delete
  to authenticated
  using (auth.uid() = user_id);

-- user_notes: users can only manage their own rows
drop policy if exists "user_notes_select_own" on public.user_notes;
create policy "user_notes_select_own"
  on public.user_notes for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "user_notes_insert_own" on public.user_notes;
create policy "user_notes_insert_own"
  on public.user_notes for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "user_notes_update_own" on public.user_notes;
create policy "user_notes_update_own"
  on public.user_notes for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "user_notes_delete_own" on public.user_notes;
create policy "user_notes_delete_own"
  on public.user_notes for delete
  to authenticated
  using (auth.uid() = user_id);

-- user_teams: own rows + accepted friends (for tavern)
drop policy if exists "user_teams_select_own" on public.user_teams;
create policy "user_teams_select_own"
  on public.user_teams for select
  to authenticated
  using (
    auth.uid() = user_id or
    exists (
      select 1 from public.user_friendships
      where status = 'accepted'
        and ((requester_id = auth.uid() and addressee_id = user_teams.user_id)
          or (addressee_id = auth.uid() and requester_id = user_teams.user_id))
    )
  );

drop policy if exists "user_teams_insert_own" on public.user_teams;
create policy "user_teams_insert_own"
  on public.user_teams for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "user_teams_update_own" on public.user_teams;
create policy "user_teams_update_own"
  on public.user_teams for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "user_teams_delete_own" on public.user_teams;
create policy "user_teams_delete_own"
  on public.user_teams for delete
  to authenticated
  using (auth.uid() = user_id);

-- user_hero_preferences: users can only manage their own rows
drop policy if exists "user_hero_preferences_select_own" on public.user_hero_preferences;
create policy "user_hero_preferences_select_own"
  on public.user_hero_preferences for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "user_hero_preferences_insert_own" on public.user_hero_preferences;
create policy "user_hero_preferences_insert_own"
  on public.user_hero_preferences for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "user_hero_preferences_update_own" on public.user_hero_preferences;
create policy "user_hero_preferences_update_own"
  on public.user_hero_preferences for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "user_hero_preferences_delete_own" on public.user_hero_preferences;
create policy "user_hero_preferences_delete_own"
  on public.user_hero_preferences for delete
  to authenticated
  using (auth.uid() = user_id);

-- user_aether_resort_preferences: users can only manage their own row
drop policy if exists "user_aether_resort_preferences_select_own" on public.user_aether_resort_preferences;
create policy "user_aether_resort_preferences_select_own"
  on public.user_aether_resort_preferences for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "user_aether_resort_preferences_insert_own" on public.user_aether_resort_preferences;
create policy "user_aether_resort_preferences_insert_own"
  on public.user_aether_resort_preferences for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "user_aether_resort_preferences_update_own" on public.user_aether_resort_preferences;
create policy "user_aether_resort_preferences_update_own"
  on public.user_aether_resort_preferences for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "user_aether_resort_preferences_delete_own" on public.user_aether_resort_preferences;
create policy "user_aether_resort_preferences_delete_own"
  on public.user_aether_resort_preferences for delete
  to authenticated
  using (auth.uid() = user_id);

-- profiles: all authenticated users can read (required for friend search + tavern display)
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- user_friendships: RLS
drop policy if exists "friendships_select_own" on public.user_friendships;
create policy "friendships_select_own"
  on public.user_friendships for select
  to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

drop policy if exists "friendships_insert_own" on public.user_friendships;
create policy "friendships_insert_own"
  on public.user_friendships for insert
  to authenticated
  with check (auth.uid() = requester_id);

drop policy if exists "friendships_update_addr" on public.user_friendships;
create policy "friendships_update_addr"
  on public.user_friendships for update
  to authenticated
  using (auth.uid() = addressee_id);

drop policy if exists "friendships_delete_own" on public.user_friendships;
create policy "friendships_delete_own"
  on public.user_friendships for delete
  to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- ─── Tavern global chat ──────────────────────────────────────────────────────
-- Run this block in Supabase SQL Editor to enable the chat feature.

create table if not exists public.tavern_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_hero_slug text,
  content text not null,
  created_at timestamptz not null default now(),
  constraint tavern_messages_content_length check (char_length(content) between 1 and 500)
);

create index if not exists tavern_messages_created_idx
  on public.tavern_messages (created_at desc);

alter table public.tavern_messages enable row level security;

drop policy if exists "tavern_messages_select" on public.tavern_messages;
create policy "tavern_messages_select"
  on public.tavern_messages for select
  to authenticated
  using (true);

drop policy if exists "tavern_messages_insert" on public.tavern_messages;
create policy "tavern_messages_insert"
  on public.tavern_messages for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "tavern_messages_delete_own" on public.tavern_messages;
create policy "tavern_messages_delete_own"
  on public.tavern_messages for delete
  to authenticated
  using (auth.uid() = user_id);
