t# FEH Barracks App - TODO Roadmap

Last updated: 2026-02-20

## Goal
Build a shared FEH Barracks app that is accessible to you and your friend, with safe data boundaries between Game8 unit data and Fandom assets.

## Agreed Direction (2026-02-13)
- [x] Keep **Supabase** for auth + synced user metadata (profiles, barracks, teams, settings).
- [x] Keep heavy art assets **out of Supabase storage** for now (cost control).
- [x] Use metadata + URL pointers for image delivery while preserving local scraped archive.
- [ ] Re-evaluate packaged local desktop build later if cloud sync is no longer desired.

---

## Phase 0 - Product Decisions
- [x] Confirm stack for v1:
  - Frontend: Next.js
  - Backend/Auth/DB: Supabase
  - Hosting: Vercel + Supabase
- [x] Define v1 scope (must-have only):
  - Auth (signup/login/logout)
  - Hero browser/search
  - Personal barracks CRUD
  - Notes/favorites
- [ ] Decide if v1 needs invite-only access or open signup.

## Phase 1 - Project Setup
- [x] Create app scaffold under `app/` (or `web/` if preferred).
- [x] Add environment config template (`.env.example`) for Supabase keys.
- [x] Add baseline UI shell + protected route guard.
- [x] Add lint/format/test scripts.

## Phase 2 - Auth and User Model
- [x] Implement email/password auth flow.
- [x] Add password reset flow.
- [x] Create profile table linked to auth user id.
- [x] Enforce RLS for user-owned tables.

## Phase 3 - Data Model (Global + User)
- [x] Create global tables for heroes/build metadata (read-only to normal users).
- [x] Create user tables:
  - [x] `user_barracks`
  - [x] `user_favorites`
  - [x] `user_notes`
  - [x] `user_teams` (optional v1.1)
- [x] Add user preference tables for visual sync:
  - [x] `user_hero_preferences`
  - [x] `user_aether_resort_preferences`
- [x] Index common query fields (name slug, weapon, move, tier).

## Phase 4 - Data Ingestion
- [~] Define importer from:
  - [x] `db/index.json`
  - [~] `db/units/*.json` (importer now supplements missing index entries from unit files)
  - [ ] `db/unit_assets_manifest/*`
- [x] Preserve source boundaries:
  - Game8 identity fields remain canonical
  - Fandom fields remain source metadata only
- [x] Add upsert script for repeatable syncs.
- [x] Add compatibility fallback for Supabase schema drift (`heroes.rarity` may be absent in older DBs).

## Phase 5 - Core Screens
- [x] Login / Signup pages
- [x] Hero list with filters (weapon/move/tier)
- [x] Hero detail page
- [x] My Barracks page (add/remove/edit entries)
- [x] Notes + favorites UX
- [x] Team builder UX (create/save/edit team comps)
- [x] Aether Resort prototype page with account/local persistence fallback
- [x] Barracks Library page (`/barracks/library`) with filter/sort and favorite-only mode
- [~] Rarity display reliability across all pages (icon endpoint validated; source rarity coverage still needs stronger ingestion)

## Phase 6 - Ops / Deployment
- [x] Deploy web app to Vercel.
- [ ] Configure Supabase production project.
- [~] Add scheduled data refresh job (daily/weekly).
- [ ] Add backup/export policy.
- [ ] Add budget guardrails for Supabase free tier (alerts/usage checks).

## Phase 7 - Quality & Security
- [ ] Add API validation and error boundaries.
- [ ] Add rate limits/basic abuse protection.
- [ ] Verify no generated local artifacts are committed.
- [ ] Add neutral maintenance-focused release notes format.

---

## Immediate Next Step
- [ ] Run Supabase SQL: `app/supabase/schema.sql` (on dedicated production Supabase project if splitting envs)
- [x] Fill `app/.env.local` (Supabase URL, anon key, service role key)
- [ ] Re-run hero import: `npm --prefix app run import:heroes` (refresh catalog after latest scraper updates)
- [ ] Run index-to-unit coverage sanity check before import:
  - `node -e "const fs=require('fs');const safe=s=>String(s||'').replace(/[^a-z0-9]/gi,'_').toLowerCase();const idx=JSON.parse(fs.readFileSync('db/index.json','utf8'));const idxSet=new Set(idx.map(h=>safe(h.name)).filter(Boolean));const unitSlugs=fs.readdirSync('db/units',{withFileTypes:true}).filter(e=>e.isFile()&&/\.json$/i.test(e.name)).map(e=>e.name.replace(/\.json$/i,'').toLowerCase());const missing=unitSlugs.filter(s=>!idxSet.has(s));console.log('index_rows',idx.length,'unit_files',unitSlugs.length,'missing_from_index',missing.length);if(missing.length)console.log('sample_missing',missing.slice(0,20));"`
- [ ] Add GitHub Actions repo secrets for scheduled import (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`)
- [ ] Verify Supabase migration includes newest tables/policies (`user_hero_preferences`, `user_aether_resort_preferences`)
- [x] Polish Team Builder UX (validation, duplicate-slot guard, better slot picker, moved above Notes)
- [x] Polish Notes/Favorites UX (empty states, quick actions, consistency with heroes page, long-list scroll)
- [x] Implement password reset flow
- [x] Prep deployment checklist (Vercel + Supabase prod + scheduled refresh)
- [x] Configure Supabase Auth URL settings for deployed Vercel domain (site URL + reset/login redirects)
- [x] Add weekly GitHub Actions workflow file for hero import (`.github/workflows/weekly-hero-import.yml`)
- [ ] Add deterministic rarity ingestion source (prefer explicit field/source manifest over weak text heuristics)

---

## Incident Hardening (2026-02-20)
- [ ] Add post-change art endpoint smoke test to release checklist:
  - `curl -I "http://localhost:3022/api/fullbody/<heroSlug>?pose=portrait"`
  - `curl -I "http://localhost:3022/api/headshots/<heroSlug>"`
  - `curl -L -o NUL -w "%{http_code} %{content_type} %{size_download}\n" ...` should end as `200 image/*`
- [ ] Add hydration safety review for hero detail client components:
  - no `Math.random()` / `Date.now()` / locale-nondeterministic SSR-visible initial render values
  - preserve valid hook ordering when adding hydration guards
- [ ] Add weekly alias triage step in maintenance:
  - run `npm run validate:hero-aliases`
  - review `db/hero_aliases.json -> unresolved_aliases`
  - promote confident mappings into `entries[]`
- [ ] Resolve current unresolved aliases backlog (16 entries, including `Luke Rowdy Squire`)
