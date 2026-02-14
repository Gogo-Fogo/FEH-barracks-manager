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
2. Review failures and fix/retry if needed:
   - `db/failed_maintenance_units.json`
   - `db/failed_build_parser_units.json`
3. (Optional, when asset refresh is desired) run Fandom pulls in order:
   - `node scraper/fandom_fullbody_downloader.js`
   - `node scraper/fandom_headshot_downloader.js`
   - `node scraper/fandom_quotes_downloader.js`
4. Validate Fandom source/path isolation:
   - `node -e "const fs=require('fs');const p=['fullbody','headshots','quotes'];for(const d of p){const m=JSON.parse(fs.readFileSync('g:/Workspace/MyTools/FEH-barracks-manager/db/unit_assets_manifest/fandom/'+d+'_manifest.json','utf8'));const bad=(m.items||[]).filter(i=>i.source!=='fandom'||!(i.local_path||'').includes('/fandom/'));console.log(d,'items=',m.items.length,'missing=',(m.missing_mapping||[]).length,'bad=',bad.length);}"`
5. Sync app catalog to Supabase:
   - `npm --prefix app run import:heroes`
6. Smoke test hosted app (Vercel):
   - heroes list/detail, auth, barracks CRUD, preferences
7. Repo hygiene before push:
   - `git status`
   - ensure generated/local artifacts (especially `db/units/` and failure logs) are not unintentionally staged
8. Commit + push only intentional maintenance changes.

9. Refresh banner pull-guide data (for summon recommendation context):
   - `npm run scrape:banner-guides`
   - seed URLs live in `db/banner_pull_seed_urls.json`
   - output file: `db/banner_pull_guides.json` (local generated file)

10. Export account AI context when needed:
   - Compact: `/api/ai-export`
   - Full guides: `/api/ai-export?mode=full`
   - Export now includes banner pull-guide sections when `db/banner_pull_guides.json` exists.

Notes:
- This protocol updates shared hero/catalog data; it does not modify user-owned profile/barracks data.
- Keep Game8 identity canonical; never rename unit identity from Fandom labels.

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
  - hero metadata (name/weapon/move/tier/url pointers)
- Do **not** upload large local PNG archives into Supabase Storage under current free-tier strategy.
- Keep row-level security strict by `auth.uid()` for all user-owned tables.

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
