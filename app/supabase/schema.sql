-- FEH Barracks Manager - initial schema
-- Run this in Supabase SQL Editor for your project.

create extension if not exists "pgcrypto";

-- Global hero catalog (shared/read-only for normal app users)
create table if not exists public.heroes (
  hero_slug text primary key,
  name text not null,
  source_url text,
  tier numeric,
  weapon text,
  move text,
  tag text,
  img_url text,
  updated_at timestamptz not null default now()
);

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
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, hero_slug)
);

create index if not exists user_barracks_user_idx on public.user_barracks (user_id);
create index if not exists user_barracks_hero_idx on public.user_barracks (hero_slug);

-- Optional profile table for display settings
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.heroes enable row level security;
alter table public.user_barracks enable row level security;
alter table public.profiles enable row level security;

-- heroes: readable by authenticated users, write via service role/import script only
drop policy if exists "heroes_select_authenticated" on public.heroes;
create policy "heroes_select_authenticated"
  on public.heroes for select
  to authenticated
  using (true);

-- user_barracks: users can only manage their own rows
drop policy if exists "user_barracks_select_own" on public.user_barracks;
create policy "user_barracks_select_own"
  on public.user_barracks for select
  to authenticated
  using (auth.uid() = user_id);

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

-- profiles: users can only manage their own profile
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

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
