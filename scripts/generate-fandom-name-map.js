#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Generates app/src/lib/fandom-name-map.json
 *
 * Maps hero_slug → fandom_image_base_name using the canonical Fandom-style
 * hero name embedded in each unit's raw_text_data by Game8 (pattern:
 * "This is a ranking page for the hero {NAME} from the game Fire Emblem Heroes").
 *
 * This map is committed to git so it is available on Vercel where db/units/
 * is not deployed.  resolveFandomBaseBySlug() checks the map first, avoiding
 * the fuzzy-match failure that affects seasonal heroes (e.g. "Summer Tiki (Adult)"
 * → slug "summer_tiki__adult_" doesn't fuzzy-match "Tiki Summering Scion").
 *
 * Run after scraping new units:
 *   node scripts/generate-fandom-name-map.js
 */

const fs  = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const ROOT      = path.resolve(__dirname, "..");
const UNITS_DIR = path.join(ROOT, "db", "units");
const OUT_FILE  = path.join(ROOT, "app", "src", "lib", "fandom-name-map.json");

/**
 * Mirrors extractLegacyHeroNameFromRaw() in local-unit-data.ts
 */
function extractLegacyHeroName(rawText) {
  if (!rawText) return null;
  const match = String(rawText).match(
    /This is a ranking page for the hero\s+([^.]+?)\s+from the game Fire Emblem Heroes/i
  );
  if (!match?.[1]) return null;
  return match[1]
    .replace(/\s+Builds?\s+and\s+Best\s+Refine\b/gi, "")
    .replace(/\s+Best\s+Builds?\b/gi, "")
    .replace(/\s+Builds?\b/gi, "")
    .replace(/\s+/g, " ")
    .trim() || null;
}

/**
 * Converts a Fandom-style "First - Epithet" name to the image base name used
 * in Fandom file titles: "First Epithet" (space, no dash).
 * Mirrors toFandomImageBase() used by the headshot/fullbody scrapers.
 */
function toFandomImageBase(legacyName) {
  return legacyName.replace(/\s+-\s+/g, " ");
}

async function main() {
  if (!fs.existsSync(UNITS_DIR)) {
    console.error(`db/units/ not found at: ${UNITS_DIR}`);
    process.exit(1);
  }

  const entries = await fsp.readdir(UNITS_DIR, { withFileTypes: true });
  const unitFiles = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".json"))
    .map((e) => e.name);

  const map = {};
  let included = 0;
  let skipped  = 0;

  for (const filename of unitFiles) {
    const slug = filename.replace(/\.json$/i, "");
    try {
      const raw  = await fsp.readFile(path.join(UNITS_DIR, filename), "utf8");
      const unit = JSON.parse(raw);

      const legacyName = extractLegacyHeroName(unit.raw_text_data);
      if (!legacyName) { skipped++; continue; }

      map[slug] = toFandomImageBase(legacyName);
      included++;
    } catch {
      skipped++;
    }
  }

  // Stable alphabetical order for clean diffs
  const sorted = Object.fromEntries(
    Object.entries(map).sort(([a], [b]) => a.localeCompare(b))
  );

  await fsp.writeFile(OUT_FILE, JSON.stringify(sorted, null, 2) + "\n", "utf8");

  console.log(`Done. ${included} entries written to app/src/lib/fandom-name-map.json`);
  console.log(`      ${skipped} units skipped (no raw_text_data name pattern).`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
