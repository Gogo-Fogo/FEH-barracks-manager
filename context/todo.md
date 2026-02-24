# FEH Barracks App - TODO Roadmap

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
- [x] Re-run hero import: `npm --prefix app run import:heroes` (refresh catalog after latest scraper updates)
- [x] Run index-to-unit coverage sanity check before import:
  - `npm run reconcile:index`
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
- [x] P0: Enforce script-first anti-stuck execution for maintenance/audits (documented in workflow.md + CLAUDE.md; weekly protocol now uses `npm run reconcile:index` instead of node -e one-liner)
- [x] Add post-change art endpoint smoke test to release checklist (added to Pre-Push Checklist in workflow.md)
- [x] Add hydration safety review for hero detail client components:
  - FullbodyCarousel uses `isHydrated` guard with proper hook ordering
  - no `Math.random()` / `Date.now()` in SSR-visible render path
  - dead unreachable `return null` removed from `loadLocalRarityBySlug`
- [x] Add weekly alias triage step in maintenance (step 5a added to Manual Weekly Data Refresh Protocol in workflow.md)
- [x] Resolve current unresolved aliases backlog (16 entries, including `Luke Rowdy Squire`)
- [x] Backfill/enrich recovered legacy canonical heroes so details are populated (`raw_text_data`, `recommended_build`, `ivs`)
- [x] Fix Hero Browser catalog truncation (removed restrictive 200-row cap)
- [x] Add short post-incident runbook note for Windows-safe anti-stuck execution (temp script pattern)
- [x] Add deterministic index reconciliation utility for missing canonical units + explicit archive URL seeds (`scripts/reconcile-index-from-units.js`)
- [x] Verify recovery for missing archive URL `267116` (`tiki___naga_s_voice`) through index + Supabase import
- [x] Stabilize Team Builder edit workflow after repeated stuck patch attempts:
  - applied deterministic replacement for saved-team section in `app/src/app/barracks/page.tsx`
  - switched saved teams to table-style slot rows with headshots + editable hero IDs
  - validated with `npm --prefix app run build`
  - verified local serve on `http://localhost:3022`
