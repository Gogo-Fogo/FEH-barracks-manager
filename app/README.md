# FEH Barracks Manager (Web App)

Initial shared web app scaffold using Next.js + Supabase auth baseline.

## Prerequisites

- Node.js 20+
- A Supabase project

## Environment setup

1. Copy env template:

```bash
cp .env.example .env.local
```

2. Fill values in `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Current routes

- `/` public landing page
- `/login` auth page (email sign in, sign up, Google, Discord, password reset email trigger)
- `/auth/callback` OAuth redirect handler for Supabase providers
- `/reset-password` reset target page used from Supabase email link
- `/barracks` protected page (requires logged-in user)

## What is implemented now

- Next.js app scaffold (TypeScript, App Router)
- Supabase browser/server clients
- Supabase middleware session refresh
- Auth form (email/password sign in + sign up + Google + Discord + reset email)
- Protected barracks shell and sign-out button
- Hero detail page, favorites/notes/team management, Aether Resort prototype

## Deployment readiness checklist (Vercel + Supabase)

1. **Supabase project (prod)**
   - Create a production Supabase project.
   - Run `app/supabase/schema.sql` in SQL Editor.
   - Confirm required tables exist (`heroes`, `user_barracks`, `user_favorites`, `user_notes`, `user_teams`, `user_hero_preferences`, `user_aether_resort_preferences`, `profiles`).

2. **Seed/import data**
   - Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` for prod.
   - Run `npm run import:heroes` from `app/` to upsert `db/index.json` heroes.

3. **Vercel project setup**
   - Import `app/` as the deploy root.
   - Set environment variables in Vercel (Production + Preview):
     - `NEXT_PUBLIC_SUPABASE_URL`
     - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
     - `SUPABASE_SERVICE_ROLE_KEY`

4. **Supabase Auth settings**
   - Add site URL (prod) and redirect URLs (including `/reset-password`).
   - If you want Google and Discord login, enable those providers in `Authentication -> Providers`.
   - Add these app callback URLs to Supabase's redirect allow list:
     - `http://localhost:3000/auth/callback`
     - `https://feh-barracks-manager.vercel.app/auth/callback`
   - In Google and Discord provider dashboards, register the Supabase callback URL shown on each provider page (usually `https://<project-ref>.supabase.co/auth/v1/callback`).
   - Verify password reset email flow reaches `https://<your-domain>/reset-password`.

5. **Post-deploy smoke test**
   - Sign up/sign in/sign out.
   - Trigger password reset and update password.
   - Verify barracks/favorites/notes/teams persist for current user.
   - Verify hero background + Aether Resort preferences persist.

6. **Ongoing ops (recommended)**
   - Add scheduled import refresh job (daily/weekly).
   - Add backup/export routine and free-tier usage checks.

## Supabase DB setup

1. Open Supabase SQL Editor.
2. Run `app/supabase/schema.sql`.

This creates:
- `heroes` (global catalog)
- `user_barracks` (per-user rows)
- `profiles` (optional profile)

## Import heroes from existing scraped index

After setting `.env.local` values:

```bash
npm run import:heroes
```

This reads `../db/index.json` and upserts hero records into `public.heroes`.
