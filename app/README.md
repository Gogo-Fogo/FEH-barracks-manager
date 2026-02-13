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
- `/login` auth page (sign in / sign up)
- `/barracks` protected page (requires logged-in user)

## What is implemented now

- Next.js app scaffold (TypeScript, App Router)
- Supabase browser/server clients
- Supabase middleware session refresh
- Auth form (email/password sign in + sign up)
- Protected barracks shell and sign-out button

## Next planned implementation

- Database schema for global FEH data + user barracks data
- Hero browser/search page
- Barracks CRUD (add/remove/update hero entries)

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
