# Game8 FEH Selectors (Ground Truth)

Last updated: 2026-02-13

## Tier List Page
- URL: `https://game8.co/games/fire-emblem-heroes/archives/242267`
- Lazy-load container (focus target):
  - `div[class*="style-module__cardView"]`

## Tier Card Selectors
- Card item:
  - `div[class*="style-module__cardItem"]`
- Name link:
  - `a[class*="style-module__cardNameLink"]`
- Tier text:
  - `div[class*="style-module__cardText"]`
- Card image:
  - `img[class*="style-module__cardImage"]`
- Weapon/Move/Tag pills:
  - `span[class*="style-module__iconWithTextText"]`

## Unit Detail Page Selectors
- Main content (preferred/fallback):
  - `.p-entry__body`
  - `.l-mainContents`
- Build section heading:
  - find first `h2`/`h3` that includes `Build`
- Build table:
  - first sibling `TABLE` after the matching heading
- IV table heuristic:
  - any `table` where text contains `Asset`

## Notes
- These are CSS-module substring selectors and may change after site deploys.
- If scraping breaks, re-validate this file first, then update both scripts.
- Tier list scrolling should prioritize **container `scrollTop`** on `cardView`.
- The tier-list page can display `Showing: <N> items` while the lazy-loaded DOM still fails to materialize every hero card.
- Do **not** treat card snapshots from `archives/242267` as exhaustive catalog discovery, even after long scroll loops.
- Use Game8 tier-list scrolling for current-feed discovery only; use Fandom `List_of_Heroes` for full-catalog coverage audits/backfill.

## Full-Catalog Discovery Guardrail
- Canonical discovery gap:
  - `https://game8.co/games/fire-emblem-heroes/archives/242267`
  - Even when the page advertises a large total item count, lazy loading can miss historical heroes in the rendered card list.
- Coverage/backfill source:
  - `https://feheroes.fandom.com/wiki/List_of_Heroes`
- Recovery pattern:
  1. Enumerate the full Fandom hero list.
  2. Resolve each Fandom name to the corresponding Game8 hero archive page.
  3. Keep Game8 URL/name/slug as canonical identity.
  4. Use alias/name-map handling for Fandom-vs-Game8 naming mismatches.
- Asset note:
  - Fandom hero pages are also the preferred fallback source for headshots plus portrait / attack / special / damaged art variants when Game8 discovery missed the hero.

## Asset Storage Layout (AI-efficient)
- Keep unit text data and image binaries separated to reduce AI retrieval token usage.
- Unit JSON stays in:
  - `db/units/<unit_slug>.json`
- Asset manifest pointer lives in unit JSON as:
  - `assets_ref: "unit_assets_manifest/<unit_slug>.json"`
- Asset manifests (small JSON metadata only):
  - `db/unit_assets_manifest/<unit_slug>.json`
- Binary images (not for normal AI text retrieval):
  - `db/unit_assets/fandom/fullbody/<unit_slug>/`
  - `db/unit_assets/fandom/headshots/<unit_slug>/`

## Fandom Asset / Quote Mapping Notes
- Fandom pull scripts use Game8 unit names/slugs as canonical identity keys.
- Do not rename unit identity in `db/units/*.json` based on Fandom labels.
- Fandom-specific labels belong only in source metadata:
  - `fandom_base_name`
  - `fandom_file_title`
  - `fandom_quote_page`
- If Game8→Fandom mapping is uncertain, scripts must skip and log entry to `missing_mapping`.

## Fandom Pipelines (Ordered Run)
1. Full-body art:
   - `node scraper/fandom_fullbody_downloader.js`
2. Headshots:
   - `node scraper/fandom_headshot_downloader.js`
3. Quotes:
   - `node scraper/fandom_quotes_downloader.js`

Verification (source and path safety):
- `node -e "const fs=require('fs');const p=['fullbody','headshots','quotes'];for(const d of p){const m=JSON.parse(fs.readFileSync('g:/Workspace/MyTools/FEH-barracks-manager/db/unit_assets_manifest/fandom/'+d+'_manifest.json','utf8'));const bad=(m.items||[]).filter(i=>i.source!=='fandom'||!(i.local_path||'').includes('/fandom/'));console.log(d,'items=',m.items.length,'missing=',(m.missing_mapping||[]).length,'bad=',bad.length);}"`
