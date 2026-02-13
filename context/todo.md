# FEH Barracks App - TODO Roadmap

Last updated: 2026-02-13

## Goal
Build a shared FEH Barracks app that is accessible to you and your friend, with safe data boundaries between Game8 unit data and Fandom assets.

---

## Phase 0 - Product Decisions
- [ ] Confirm stack for v1:
  - Frontend: Next.js
  - Backend/Auth/DB: Supabase
  - Hosting: Vercel + Supabase
- [ ] Define v1 scope (must-have only):
  - Auth (signup/login/logout)
  - Hero browser/search
  - Personal barracks CRUD
  - Notes/favorites
- [ ] Decide if v1 needs invite-only access or open signup.

## Phase 1 - Project Setup
- [ ] Create app scaffold under `app/` (or `web/` if preferred).
- [ ] Add environment config template (`.env.example`) for Supabase keys.
- [ ] Add baseline UI shell + protected route guard.
- [ ] Add lint/format/test scripts.

## Phase 2 - Auth and User Model
- [ ] Implement email/password auth flow.
- [ ] Add password reset flow.
- [ ] Create profile table linked to auth user id.
- [ ] Enforce RLS for user-owned tables.

## Phase 3 - Data Model (Global + User)
- [ ] Create global tables for heroes/build metadata (read-only to normal users).
- [ ] Create user tables:
  - `user_barracks`
  - `user_favorites`
  - `user_notes`
  - `user_teams` (optional v1.1)
- [ ] Index common query fields (name slug, weapon, move, tier).

## Phase 4 - Data Ingestion
- [ ] Define importer from:
  - `db/index.json`
  - `db/units/*.json`
  - `db/unit_assets_manifest/*`
- [ ] Preserve source boundaries:
  - Game8 identity fields remain canonical
  - Fandom fields remain source metadata only
- [ ] Add upsert script for repeatable syncs.

## Phase 5 - Core Screens
- [ ] Login / Signup pages
- [ ] Hero list with filters (weapon/move/tier)
- [ ] Hero detail page
- [ ] My Barracks page (add/remove/edit entries)
- [ ] Notes + favorites UX

## Phase 6 - Ops / Deployment
- [ ] Deploy web app to Vercel.
- [ ] Configure Supabase production project.
- [ ] Add scheduled data refresh job (daily/weekly).
- [ ] Add backup/export policy.

## Phase 7 - Quality & Security
- [ ] Add API validation and error boundaries.
- [ ] Add rate limits/basic abuse protection.
- [ ] Verify no generated local artifacts are committed.
- [ ] Add neutral maintenance-focused release notes format.

---

## Immediate Next Step
- [ ] Start with **Phase 1 scaffold + Phase 2 auth baseline** in this repo.
