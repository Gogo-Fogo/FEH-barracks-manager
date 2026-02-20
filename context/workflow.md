# FEH Vault Workflow

## App Product Direction (Current)
- Shared app mode is **cloud-synced metadata**:
  - Supabase auth + synced user data (`barracks`, `teams`, `notes`, `favorites`, profile settings)
- Heavy art assets are **not** stored in Supabase for now (free-tier cost control).
- App should consume image pointers (`img_url` / manifest references) while preserving local scraped archive as canonical backup.
- Packaged local desktop mode remains a fallback path, but not primary for current milestone.

## Deployment/Usage Mode (Current)
- Production app is now deployed on Vercel (Next.js app root: `app/`).
- Friends should use the deployed Vercel URL for normal usage.
- `main` branch is the production source of truth:
  - push to `main` -> Vercel auto-builds -> production updates after successful deploy.
- Local `npm --prefix app run dev` is now for development/testing only, not required for normal app usage.

## Supabase Auth URL Configuration (Hosted)
- In Supabase Auth URL settings, `Site URL` must match active deployed Vercel domain.
- Allowed redirect URLs should include at minimum:
  - `<vercel-domain>/reset-password`
  - `<vercel-domain>/login`
- If the deployed domain changes (new Vercel alias/custom domain), update Site URL + redirects immediately.

## Recommended Dev Flow (Post-Deploy)
1. Develop/test locally:
   - `npm --prefix app run dev`
2. Commit and push changes.
3. Let Vercel deploy automatically from GitHub.
4. Validate on live URL (auth + core CRUD flows).
5. For safer releases, prefer branch-based preview deploys before merging to `main`.

## Manual Weekly Data Refresh Protocol (Recommended)
Use this when you want controlled, human-reviewed updates instead of fully automated scraping.

1. Refresh source data locally (Scout -> Researcher):
   - `node scraper/Maintenance_Updater.js`
   - `node scraper/build_parser.js`
2. Run index-to-unit coverage sanity check (prevents hidden catalog omissions):
   - `node -e "const fs=require('fs');const safe=s=>String(s||'').replace(/[^a-z0-9]/gi,'_').toLowerCase();const idx=JSON.parse(fs.readFileSync('db/index.json','utf8'));const idxSet=new Set(idx.map(h=>safe(h.name)).filter(Boolean));const unitSlugs=fs.readdirSync('db/units',{withFileTypes:true}).filter(e=>e.isFile()&&/\.json$/i.test(e.name)).map(e=>e.name.replace(/\.json$/i,'').toLowerCase());const missing=unitSlugs.filter(s=>!idxSet.has(s));console.log('index_rows',idx.length,'unit_files',unitSlugs.length,'missing_from_index',missing.length);if(missing.length)console.log('sample_missing',missing.slice(0,20));"`
3. Review failures and fix/retry if needed:
   - `db/failed_maintenance_units.json`
   - `db/failed_build_parser_units.json`
4. (Optional, when asset refresh is desired) run Fandom pulls in order:
   - `node scraper/fandom_fullbody_downloader.js`
   - `node scraper/fandom_headshot_downloader.js`
   - `node scraper/fandom_quotes_downloader.js`
5. Validate Fandom source/path isolation:
   - `node -e "const fs=require('fs');const p=['fullbody','headshots','quotes'];for(const d of p){const m=JSON.parse(fs.readFileSync('g:/Workspace/MyTools/FEH-barracks-manager/db/unit_assets_manifest/fandom/'+d+'_manifest.json','utf8'));const bad=(m.items||[]).filter(i=>i.source!=='fandom'||!(i.local_path||'').includes('/fandom/'));console.log(d,'items=',m.items.length,'missing=',(m.missing_mapping||[]).length,'bad=',bad.length);}"`
6. Sync app catalog to Supabase:
   - `npm --prefix app run import:heroes`
7. Smoke test hosted app (Vercel):
   - heroes list/detail, auth, barracks CRUD, preferences
8. Repo hygiene before push:
   - `git status`
   - ensure generated/local artifacts (especially `db/units/` and failure logs) are not unintentionally staged
9. Commit + push only intentional maintenance changes.

10. Refresh banner pull-guide data (for summon recommendation context):
   - `npm run scrape:banner-guides`
   - seed URLs live in `db/banner_pull_seed_urls.json`
   - output file: `db/banner_pull_guides.json` (local generated file)

11. Export account AI context when needed:
   - Compact: `/api/ai-export`
   - Full guides: `/api/ai-export?mode=full`
   - Export now includes banner pull-guide sections when `db/banner_pull_guides.json` exists.

Notes:
- This protocol updates shared hero/catalog data; it does not modify user-owned profile/barracks data.
- Keep Game8 identity canonical; never rename unit identity from Fandom labels.

## Legacy Title / Canonical Name Mismatch (Important)
- Game8 remains the canonical identity source for hero names and URLs.
- If a requested hero title is historical/community wording (or a prior alias), it may not appear in the current Game8 tier-list feed under that exact title even after a full refresh.
- In this repo, a full validation run (Scout + Researcher) can complete successfully while some legacy title requests still remain unresolved as canonical Game8 names.

Recommended handling:
1. Do **not** overwrite canonical `name` with legacy wording.
2. Treat unresolved legacy names as an alias-mapping problem first, not a scraper failure.
3. If product UX needs old naming support, keep a separate lookup alias map (legacy -> canonical) in app/search logic.
4. Only add targeted/manual recovery when a trusted source URL/title mapping is available.

Implementation notes (current repo):
- Alias source file: `db/hero_aliases.json`
  - `entries[]` holds curated mappings: `canonical_slug`, `canonical_name`, `aliases[]`.
  - `unresolved_aliases[]` tracks requests still not confidently mapped.
- Barracks add flow supports aliases through server-side resolver:
  - `app/src/lib/hero-aliases.ts`
  - `app/src/app/barracks/actions.ts`
  - `app/src/components/add-hero-typeahead.tsx`
- Validation utility:
  - `npm run validate:hero-aliases`
  - Emits `FOUND / ALIAS / MISS` so unresolved names can be reviewed and promoted into `entries[]` when confidence is high.

## Normal Maintenance Run
1. Run Scout:
   - `node scraper/Maintenance_Updater.js`
2. Check summary output:
   - scanned / updated / skipped / failed
3. If failures occurred, inspect:
   - `db/failed_maintenance_units.json`
4. Run Researcher:
   - `node scraper/build_parser.js`
5. If failures occurred, inspect:
   - `db/failed_build_parser_units.json`

## New Hero Release Day
1. Run Scout first to refresh `db/index.json` and create/update unit files.
2. Confirm new heroes appear in `db/index.json`.
3. Run Researcher to enrich missing `raw_text_data` / `recommended_build`.
4. Re-run Researcher once if transient failures occurred.
5. Commit updated files once failure logs are empty or reviewed.

## Failure Recovery
- `ProtocolError` / timeout:
  - re-run script (retry/backoff is already built-in).
- Selector breakage:
  - validate selectors against live page,
  - update `context/selectors.md`,
  - patch scripts using updated selectors.
- Corrupt JSON file:
  - inspect the file in `db/units/`,
  - repair or regenerate from Scout + Researcher.

## Guardrails
- Keep the two-script architecture:
  - Scout: index and discovery
  - Researcher: deep enrichment
- Use container-focused scrolling on tier list container.
- Keep Windows Chrome user agent and protocol timeout (180000ms+) for deep runs.

## App Data Guardrails (Supabase)
- Store only lightweight synced data in Supabase:
  - user profiles, barracks entries, team comps, notes, favorites
  - hero metadata (name/weapon/move/tier/tag/rarity/url pointers)
- Do **not** upload large local PNG archives into Supabase Storage under current free-tier strategy.
- Keep row-level security strict by `auth.uid()` for all user-owned tables.

## Recent App UX Updates (2026-02)
- Barracks now includes:
  - Team Builder section moved above Notes
  - clarified "Hero ID" wording (formerly "slug")
  - favorites list scroll container for long lists
  - explicit account-bound sync copy for Teams/Notes
- Added Barracks Library screen:
  - `/barracks/library`
  - filter/sort/favorite-only browsing for owned heroes
  - icon-driven weapon/move/rarity display + tier labels
- Hero Browser / Barracks / Library include rarity-star text rendering where rarity data exists.

## Rarity Data Note
- Rarity icons are sourced from Fandom shared assets (`db/unit_assets/fandom/shared/rarity/`).
- App rendering can only show correct per-hero rarity when rarity metadata exists in `public.heroes`.
- Current importer supports schema compatibility fallback when `heroes.rarity` is missing, but fallback mode may omit rarity values.
- Preferred maintenance path:
  1. ensure Supabase schema includes `public.heroes.rarity`
  2. run `npm --prefix app run import:heroes`
  3. verify rarity values are populated before UI validation.

### Incident Note (2026-02-20): Rarity/Stars Disappeared Site-Wide
- Symptom:
  - Rarity stars/icons disappeared across Heroes/Barracks/Library.
- Confirmed cause:
  - `db/index.json` lost `rarity` fields after commit `b928808` (`rarity_key` dropped from 1105 to 0).
  - Alias-search changes were **not** the cause.
- Recovery used:
  1. `npm run scrape:fandom-rarities` (restores `rarity`/`rarities` into `db/index.json`)
  2. `npm --prefix app run import:heroes`
- Important warning:
  - If importer logs `heroes.rarity column not found ... retrying without rarity`, Supabase is discarding rarity on import.
  - In that case UI depends on local fallback (`db/index.json`) only.

### Rarity Safety Checklist (Run before push/deploy)
1. Check local index has rarity:
   - `node -e "const fs=require('fs');const rows=JSON.parse(fs.readFileSync('db/index.json','utf8'));let has=0;for(const r of rows){if(Object.prototype.hasOwnProperty.call(r,'rarity'))has++;}console.log('rows',rows.length,'rarity_key',has);"`
2. If `rarity_key` is low/zero, immediately run:
   - `npm run scrape:fandom-rarities`
3. Re-import heroes:
   - `npm --prefix app run import:heroes`
4. Confirm importer did **not** drop rarity due to missing DB column.

### Incident Note (2026-02-20): Hero in `db/units` Missing from Hero Browser
- Symptom:
  - `db/units/byleth___of_the_academy.json` existed, but hero did not appear in Hero Browser.
- Confirmed cause:
  - Hero Browser reads Supabase `public.heroes`.
  - Import pipeline previously sourced catalog rows from `db/index.json` only.
  - The Byleth unit file existed, but `db/index.json` did not include that hero row, so import omitted it.
- Fix applied:
  - `app/scripts/import-heroes.mjs` now supplements index-driven import with any missing `db/units/*.json` rows (slug not present in index), and logs a warning count.
- Follow-up inconsistency audit (same day):
  - `missing_from_index` count was 254 unit files.
  - An initial strict filter recovered only 4 rows, which was too narrow for legacy hero pages.
  - Importer now parses legacy hero rank-page metadata and recovers additional valid hero rows while still skipping guide/skill junk pages.
  - Current supplemental import summary after hardening:
    - `added=106`
    - `skipped_not_likely_hero=83`
    - `skipped_duplicate_url=65`
  - This specifically restores many older seasonal/legacy heroes (including aliases like Fjorm New Traditions, Spring Exalt Chrom, etc.) that were absent from `db/index.json`.
- Import hardening (global fix):
  - Supplemental unit import now includes **only likely hero rows** (valid hero URL + hero-like weapon/move or hero tag hints).
  - Explicitly excludes `Legacy ID Snipe` rows from supplemental catalog import.
  - Dedupes supplemental rows against index by URL.
  - Performs cleanup delete of lingering `Legacy ID Snipe` rows in Supabase `public.heroes` before upsert.
- Prevention:
  1. Run the index-to-unit coverage sanity check during maintenance (see protocol step 2).
  2. Treat non-zero `missing_from_index` as data drift that must be reviewed before release/import validation.
  3. Keep Scout as primary canonical source, but do not let temporary index drift hide valid unit files from app catalog import.

### Incident Note (2026-02-20): Hero Art Missing Even When Fandom URL Exists
- Symptom:
  - Some heroes (example: Abel / Adrift Corrin) showed missing fullbody/headshot art in browser.
  - Direct endpoint checks showed valid Fandom URLs, but browser rendering was inconsistent when endpoint returned redirects.
- Confirmed cause:
  - Art API fallback returned external `302` redirects (`static.wikia.nocookie.net` / other remote sources).
  - Browser/runtime behavior can fail or be inconsistent with cross-origin/hotlink redirect chains.
- Fix applied:
  - `app/src/app/api/fullbody/[heroSlug]/route.ts`
  - `app/src/app/api/headshots/[heroSlug]/route.ts`
  - Both routes now proxy remote image bytes server-side and return same-origin `200 image/*` responses when local files are missing.
- Required fallback order (do not change):
  1. local fandom asset in `db/unit_assets/fandom/...`
  2. remote Fandom source via resolver (`loadFandom*UrlBySlug`)
  3. legacy unit `img_url`
  4. SVG placeholder
- Verification commands (post-change):
  - Header check:
    - `curl -I "http://localhost:3022/api/fullbody/<heroSlug>?pose=portrait"`
    - `curl -I "http://localhost:3022/api/headshots/<heroSlug>"`
  - Content check (must end as `200 image/*`):
    - `curl -L -o NUL -w "%{http_code} %{content_type} %{size_download}\n" "http://localhost:3022/api/fullbody/<heroSlug>?pose=portrait"`
    - `curl -L -o NUL -w "%{http_code} %{content_type} %{size_download}\n" "http://localhost:3022/api/headshots/<heroSlug>"`

### Incident Note (2026-02-20): Hydration Mismatch on Hero Detail
- Symptom:
  - React hydration mismatch on `/heroes/[heroSlug]` around `FullbodyCarousel`.
- Confirmed causes/fixes:
  1. Non-deterministic initial state (`Math.random`) in client component state init.
  2. Additional hydration hardening needed for art panel render path.
- Guardrails:
  - Never use `Math.random()`, `Date.now()`, or locale-sensitive dynamic formatting in SSR-visible initial render output.
  - Keep initial client state deterministic.
  - If hydration guard is used, keep hook ordering valid (declare hooks before conditional return).
  - Run build after any hero detail/client component edit:
    - `npm --prefix app run build`

### Alias / Missing-Hero Triage Guardrail (Luke Example)
- If a hero is reported missing (e.g., "Luke Rowdy Squire"), verify in this order:
  1. `db/index.json` contains canonical row.
  2. `db/units/` contains matching slug file.
  3. `db/hero_aliases.json` maps alias -> canonical slug.
- Current known state example:
  - `Luke Rowdy Squire` is in `unresolved_aliases` (not canonicalized yet), and not present in current `db/index.json`/`db/units`.
- Use Windows-safe lookup commands (do not rely on `grep`):
  - `Get-ChildItem -Name db/units | Where-Object { $_ -match 'luke' }`
  - `npm run validate:hero-aliases`

### Context-Safety Guardrail (`db/units` is large)
- Never load the entire `db/` or `db/units/` folder into AI context.
- For hero lookups, always locate candidate filenames first with terminal filtering, then read only specific file(s).
- Windows-safe examples:
  - `Get-ChildItem -Name db/units | Where-Object { $_ -match 'byleth' }`
  - `Get-ChildItem -Name db/units | Where-Object { $_ -match 'corrin' }`
- After match, read only targeted files, e.g.:
  - `db/units/adrift_corrin__f_.json`
  - never batch-read all unit JSON files during triage.

## Asset Data Conventions (Token-Efficient)
- Keep text/metadata retrieval separate from binary images.
- Primary AI retrieval target should remain:
  - `db/units/*.json`
- If image metadata is needed, read only lightweight manifests:
  - `db/unit_assets_manifest/*.json`
- Store binary assets under source/type folders:
  - `db/unit_assets/fandom/fullbody/<unit_slug>/`
  - `db/unit_assets/fandom/headshots/<unit_slug>/`
  - `db/quotes/fandom/<unit_slug>.json`
- Do not put large image URL arrays directly into `raw_text_data`.
- In each unit JSON, reference assets via:
  - `assets_ref: "unit_assets_manifest/<unit_slug>.json"`

## Cross-Source Naming Guardrail (Game8 vs Fandom)
- Treat Game8 and Fandom as separate truth domains.
- Unit identity key is always Game8-derived:
  - `game8_name`
  - `game8_slug` (safe slug from unit name)
- Fandom identifiers are stored only as source metadata fields:
  - `fandom_base_name`
  - `fandom_file_title`
  - `fandom_quote_page`
- Every Fandom manifest item must include:
  - `source: "fandom"`
  - source-local path under `/fandom/`.
- Never overwrite `db/units/*.json` naming with Fandom names.
- If no confident cross-source match exists, log to `missing_mapping` and skip.

## Fandom Full-Body Test Script
- Script:
  - `node scraper/fandom_fullbody_downloader.js`
- Purpose:
  - Downloads original (non-scaled) Fandom full-body state art:
    - portrait (`Face`), attack (`BtlFace`), special (`BtlFace C`), damage (`BtlFace D`)

## Fandom Bulk Pull (Run In This Order)
1. Full-body art:
   - `node scraper/fandom_fullbody_downloader.js`
2. Headshots:
   - `node scraper/fandom_headshot_downloader.js`
3. Quotes:
   - `node scraper/fandom_quotes_downloader.js`

Expected outputs:
- `db/unit_assets/fandom/fullbody/<unit_slug>/`
- `db/unit_assets/fandom/headshots/<unit_slug>/`
- `db/quotes/fandom/<unit_slug>.json`
- `db/unit_assets_manifest/fandom/fullbody_manifest.json`
- `db/unit_assets_manifest/fandom/headshots_manifest.json`
- `db/unit_assets_manifest/fandom/quotes_manifest.json`

Post-run verification:
- `node -e "const fs=require('fs');const p=['fullbody','headshots','quotes'];for(const d of p){const m=JSON.parse(fs.readFileSync('g:/Workspace/MyTools/FEH-barracks-manager/db/unit_assets_manifest/fandom/'+d+'_manifest.json','utf8'));const bad=(m.items||[]).filter(i=>i.source!=='fandom'||!(i.local_path||'').includes('/fandom/'));console.log(d,'items=',m.items.length,'missing=',(m.missing_mapping||[]).length,'bad=',bad.length);}"`

Interpretation:
- `bad=0` means source/path isolation is intact.
- non-zero `missing_mapping` means unresolved Game8→Fandom name mapping entries were skipped intentionally (safe behavior).

## Fandom Shared Assets Script
- Script:
  - `node scraper/fandom_shared_assets_downloader.js`
- Purpose:
  - Builds shared/general icon library and manifest for reusable FEH UI assets.
- Current buckets:
  - `db/unit_assets/fandom/shared/move/`
  - `db/unit_assets/fandom/shared/rarity/`
  - `db/unit_assets/fandom/shared/weapon_misc/`
- Manifest:
  - `db/unit_assets_manifest/shared_icons.json`

## Pre-Push Checklist
1. Run `git status` and confirm only intended source/config files are staged.
2. Confirm `db/units/` and failure logs are not staged.
3. Keep commit messages concise and maintenance-focused.
4. If needed, run focused validation before push:
   - `node scraper/Maintenance_Updater.js`
   - `node scraper/build_parser.js --only=<unit_file>.json`
