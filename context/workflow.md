# FEH Vault Workflow

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
