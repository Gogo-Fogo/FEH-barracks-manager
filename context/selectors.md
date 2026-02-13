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
