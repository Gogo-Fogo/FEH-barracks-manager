# FEH Barracks Manager

A web app for managing a Fire Emblem Heroes unit collection, backed by a scraping pipeline that pulls hero data from Game8 and Fandom.

Full context files (read before working on specific areas):
- `context/workflow.md` — deployment, maintenance protocol, incident history, guardrails
- `context/selectors.md` — Game8 CSS selectors (update here first if scraping breaks)
- `context/todo.md` — roadmap and open items
- `context/schema_v1.json` — canonical unit JSON schema

---

## Project Structure

- `app/` — Next.js 16 + Supabase web app
- `scraper/` — Data scraping scripts
- `db/` — Scraped data (`index.json` + per-unit JSON + assets)
- `launcher/` — Desktop launcher wrapper
- `scripts/` — Maintenance/utility scripts (prefer these over one-liners)
- `context/` — AI context docs

---

## App (`app/`)

Next.js 16 + Turbopack, React 19, Supabase (auth + DB), Tailwind CSS 4.

**Deployment:** `main` branch → Vercel auto-deploy (production). Push to `main` = ships to prod.

**Dev server:** port 3000. Config in `.claude/launch.json` — start with `preview_start "app"` at session start.

**Smoke test (quick local validation):**
- `npm --prefix app run start -- --port 3022` (requires prior build)
- fallback: `npm --prefix app run dev -- --port 3022`

Key paths:
- `app/src/app/` — Next.js app router pages
- `app/src/components/` — Shared client components
- `app/src/lib/` — Shared utilities (`hero-typeahead.ts`, `hero-aliases.ts`)
- `app/src/app/api/` — API routes (fullbody/headshot image proxy)
- `app/supabase/schema.sql` — Full DB schema

**SSR hydration rule:** Never use `Math.random()`, `Date.now()`, or locale-nondeterministic values in SSR-visible initial render output. Always run `npm --prefix app run build` after editing client components.

---

## Scraper (`scraper/`)

Two-script pipeline — **keep them separate**, they manage IP rate limits independently:

1. **`Maintenance_Updater.js`** (Scout) — scans tier list, updates `db/index.json`
2. **`build_parser.js`** (Researcher) — deep scrapes individual unit pages into `db/units/`

Other scripts: asset downloaders (fullbody art, headshots, quotes, shared icons, banners) from Fandom and Game8.

**Scraping rules (see `context/selectors.md` for current selectors):**
- Target `div[class*="style-module__cardView"]` for Game8 lazy-loading container
- Use container `scrollTop` scrolling, not window scroll or keyboard
- Always mask user agent as standard Windows Chrome
- `protocolTimeout` ≥ 180000ms for deep scrapes

---

## Data Schema

- `db/index.json` — Master catalog: `[name, url, tier, weapon, move, rarity, hero_slug, ...]`
- `db/units/[hero_slug].json` — Per-unit detail (see `context/schema_v1.json` for full shape):
  - `raw_text_data` — Sanitized text dump
  - `recommended_build` — Structured skills JSON
  - `ivs` — Asset/Flaw recommendations
- `db/hero_aliases.json` — Alias mappings: `entries[]` (resolved) + `unresolved_aliases[]`

**Identity rule:** Game8 is canonical. Fandom identifiers (`fandom_base_name`, `fandom_file_title`) are metadata only — never overwrite unit identity with Fandom names.

---

## Alias System

- Alias source: `db/hero_aliases.json`
- App resolver: `app/src/lib/hero-aliases.ts`, `app/src/app/barracks/actions.ts`
- Validate: `npm run validate:hero-aliases` — emits `FOUND / ALIAS / MISS`
- Missing hero triage order: `db/index.json` → `db/units/` → `db/hero_aliases.json`

---

## Maintenance Protocol

Full protocol in `context/workflow.md`. Summary:

1. Scout: `node scraper/Maintenance_Updater.js`
2. Researcher: `node scraper/build_parser.js`
3. Coverage check: `npm run reconcile:index` (use instead of long `node -e` one-liners)
4. (Optional) Fandom pulls: fullbody → headshots → quotes (in that order)
5. Import to Supabase: `npm --prefix app run import:heroes`
6. Rarity safety check: verify `rarity_key` count in index before import
7. Smoke test, then `git status` + commit only intentional files

**Missing unit recovery:** `npm run reconcile:index [-- --archive-url=<url>]` then `build_parser.js --only=<slug>.json`

---

## Critical Guardrails

**P0 — No long `node -e` one-liners:**
- Use committed scripts in `scripts/` for repeatable tasks
- For quick one-offs: create `scripts/temp_<task>.js` → run → delete immediately
- If a one-liner hangs once, switch to script-file execution immediately

**`db/units/` is large — never load the whole folder:**
- Find files first: `Get-ChildItem -Name db/units | Where-Object { $_ -match 'byleth' }`
- Then read only the specific matched file(s)

**Git — non-interactive commands to avoid stuck sessions:**
- `git --no-pager diff -- <path>`
- `git --no-pager status --short`

**Commits:**
- Apply fixes directly to `main` — no AI-named branches in git history
- Run `git status` before every commit — confirm `db/units/` and failure logs are NOT staged
- Neutral, maintenance-focused commit messages

---

## Supabase / App Data Guardrails

- Store only lightweight metadata in Supabase (profiles, barracks, teams, notes, favorites, hero catalog)
- Do NOT upload large PNG archives to Supabase Storage (free-tier cost)
- RLS is strict by `auth.uid()` for all user-owned tables
- If Supabase auth domain changes (new Vercel alias), update Site URL + redirect URLs in Supabase Auth settings immediately
