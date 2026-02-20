import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..", "..");
const INDEX_PATH = path.join(ROOT, "db", "index.json");
const APP_ROOT = path.join(__dirname, "..");
const { loadEnvConfig } = nextEnv;

loadEnvConfig(APP_ROOT);

const unitFileCache = new Map();
const HERO_WEAPON_TYPES = new Set([
  "Sword",
  "Lance",
  "Axe",
  "Bow",
  "Dagger",
  "Tome",
  "Breath",
  "Beast",
  "Red Tome",
  "Blue Tome",
  "Green Tome",
  "Colorless Tome",
  "Red Bow",
  "Blue Bow",
  "Green Bow",
  "Colorless Bow",
  "Red Dagger",
  "Blue Dagger",
  "Green Dagger",
  "Colorless Dagger",
  "Staff",
  "Red Breath",
  "Blue Breath",
  "Green Breath",
  "Colorless Breath",
  "Red Beast",
  "Blue Beast",
  "Green Beast",
  "Colorless Beast",
]);
const HERO_MOVE_TYPES = new Set(["Infantry", "Armored", "Cavalry", "Flying"]);

function safeSlug(name) {
  return String(name || "")
    .replace(/[^a-z0-9]/gi, "_")
    .toLowerCase();
}

function normalizeRarity(tokens) {
  const unique = [];
  for (const token of tokens) {
    if (!unique.includes(token)) unique.push(token);
  }
  return unique.length ? unique.join("/") : null;
}

function parseRarityFromRawText(rawText) {
  if (!rawText) return null;

  const text = String(rawText).replace(/\s+/g, " ");
  const lower = text.toLowerCase();
  const rarityIndex = lower.indexOf(" rarity ");
  const searchWindow = rarityIndex >= 0 ? text.slice(rarityIndex, rarityIndex + 260) : text.slice(0, 260);

  const stars = [];
  const starWordPattern = /([1-5])\s*star/gi;
  let match;
  while ((match = starWordPattern.exec(searchWindow))) {
    stars.push(match[1]);
  }

  if (!stars.length) {
    const starSymbolPattern = /([1-5])\s*★/g;
    while ((match = starSymbolPattern.exec(searchWindow))) {
      stars.push(match[1]);
    }
  }

  return normalizeRarity(stars);
}

function readUnitFileBySlug(heroSlug) {
  const normalizedSlug = String(heroSlug || "").trim().toLowerCase();
  if (!normalizedSlug) return null;
  if (unitFileCache.has(normalizedSlug)) return unitFileCache.get(normalizedSlug);

  const unitPath = path.join(ROOT, "db", "units", `${normalizedSlug}.json`);
  try {
    const raw = fs.readFileSync(unitPath, "utf8");
    const parsed = JSON.parse(raw);
    unitFileCache.set(normalizedSlug, parsed);
    return parsed;
  } catch {
    unitFileCache.set(normalizedSlug, null);
    return null;
  }
}

function listUnitSlugs() {
  const unitsDir = path.join(ROOT, "db", "units");
  try {
    return fs
      .readdirSync(unitsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
      .map((entry) => entry.name.replace(/\.json$/i, "").toLowerCase())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function normalizeLegacyWeapon(weapon) {
  const trimmed = String(weapon || "").trim();
  if (!trimmed) return null;
  if (HERO_WEAPON_TYPES.has(trimmed)) return trimmed;

  const lower = trimmed.toLowerCase();
  if (lower === "bow") return "Colorless Bow";
  if (lower === "dagger") return "Colorless Dagger";
  if (lower === "tome") return "Colorless Tome";
  if (lower === "breath" || lower === "dragon") return "Colorless Breath";
  if (lower === "beast") return "Colorless Beast";

  return trimmed;
}

function cleanLegacyHeroName(name) {
  const text = String(name || "").replace(/\s+/g, " ").trim();
  if (!text) return "";

  return text
    .replace(/\s+Builds?\s+and\s+Best\s+Refine\b/gi, "")
    .replace(/\s+Best\s+Builds?\b/gi, "")
    .replace(/\s+Builds?\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeGuideTitle(name) {
  return /\b(builds?|best\s+refine|best\s+build|tier\s+list|ratings?)\b/i.test(
    String(name || "")
  );
}

function parseLegacyHeroMetadata(rawText) {
  const text = String(rawText || "");
  if (!text) return null;

  const heroMatch = text.match(
    /This is a ranking page for the hero\s+([^\.]+?)\s+from the game Fire Emblem Heroes/i
  );
  if (!heroMatch) return null;

  const weaponMoveMatch = text.match(
    /Color\s*\/\s*Weapon Type\s*\/\s*Move Type\s+[^\/\n]+\s*\/\s*([^\/\n]+?)\s*\/\s*(Infantry|Armored|Cavalry|Flying)/i
  );

  const tierMatch = text.match(/Overall Rating\s*([0-9]+(?:\.[0-9]+)?)\s*\/\s*10/i);
  const tier = tierMatch ? tierMatch[1] : null;

  return {
    heroName: cleanLegacyHeroName(heroMatch[1]),
    weapon: normalizeLegacyWeapon(weaponMoveMatch?.[1] || ""),
    move: weaponMoveMatch?.[2]?.trim() || null,
    tier,
    rarity: parseRarityFromRawText(text),
  };
}

function isLikelyHeroUnitRow(row) {
  const name = String(row?.name || "").trim();
  const url = String(row?.url || "").trim();
  const tag = String(row?.tag || "").trim();
  const weapon = String(row?.weapon || "").trim();
  const move = String(row?.move || "").trim();

  if (!name) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  if (tag === "Legacy ID Snipe") return false;

  const hasValidWeaponMove = HERO_WEAPON_TYPES.has(weapon) && HERO_MOVE_TYPES.has(move);
  return hasValidWeaponMove;
}

function buildSupplementalHeroCandidate(unitRow) {
  if (!unitRow) return null;

  const candidate = {
    ...unitRow,
    name: cleanLegacyHeroName(unitRow.name),
    url: String(unitRow.url || "").trim(),
    weapon: unitRow.weapon ?? null,
    move: unitRow.move ?? null,
    tier: unitRow.tier ?? null,
    tag: unitRow.tag ?? null,
  };

  if (String(candidate.tag || "").trim() === "Legacy ID Snipe") {
    const legacy = parseLegacyHeroMetadata(candidate.raw_text_data);
    if (!legacy) return null;

    if (looksLikeGuideTitle(candidate.name)) {
      candidate.name = cleanLegacyHeroName(legacy.heroName || candidate.name);
    }
    candidate.weapon = candidate.weapon || legacy.weapon || null;
    candidate.move = candidate.move || legacy.move || null;
    candidate.tier = candidate.tier ?? legacy.tier ?? null;
    candidate.rarity = candidate.rarity ?? legacy.rarity ?? null;
    candidate.tag = "Old Hero";
  }

  if (!isLikelyHeroUnitRow(candidate)) return null;
  return candidate;
}

function readIndex() {
  const raw = fs.readFileSync(INDEX_PATH, "utf8");
  const rows = JSON.parse(raw);

  if (!Array.isArray(rows)) {
    throw new Error("db/index.json is not an array");
  }

  return rows;
}

function toHeroRow(hero) {
  const heroSlug = String(hero.hero_slug || "").trim().toLowerCase() || safeSlug(hero.name);
  const unitFile = readUnitFileBySlug(heroSlug);
  const parsedRarity = parseRarityFromRawText(unitFile?.raw_text_data);
  const tierNum = Number.parseFloat(String(hero.tier ?? ""));

  return {
    hero_slug: heroSlug,
    name: hero.name ?? "",
    source_url: hero.url ?? null,
    tier: Number.isFinite(tierNum) ? tierNum : null,
    rarity: hero.rarity ?? parsedRarity,
    weapon: hero.weapon ?? null,
    move: hero.move ?? null,
    tag: hero.tag ?? null,
    img_url: hero.img_url ?? null,
    updated_at: new Date().toISOString(),
  };
}

async function run() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing env: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required"
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const indexRows = readIndex();
  const indexSlugs = new Set(
    indexRows.map((hero) => safeSlug(hero?.name)).filter(Boolean)
  );
  const indexUrls = new Set(
    indexRows.map((hero) => String(hero?.url || "").trim()).filter(Boolean)
  );

  const supplementalRows = [];
  const supplementalStats = {
    missingFromIndex: 0,
    added: 0,
    skippedNotLikelyHero: 0,
    skippedDuplicateUrl: 0,
  };

  for (const unitSlug of listUnitSlugs()) {
    if (indexSlugs.has(unitSlug)) continue;
    supplementalStats.missingFromIndex += 1;

    const unitRow = readUnitFileBySlug(unitSlug);
    const supplementalCandidate = buildSupplementalHeroCandidate(unitRow);

    if (!supplementalCandidate) {
      supplementalStats.skippedNotLikelyHero += 1;
      continue;
    }

    const unitUrl = String(supplementalCandidate?.url || "").trim();
    if (unitUrl && indexUrls.has(unitUrl)) {
      supplementalStats.skippedDuplicateUrl += 1;
      continue;
    }

    supplementalRows.push(supplementalCandidate);
    supplementalRows[supplementalRows.length - 1].hero_slug = unitSlug;
    supplementalStats.added += 1;
  }

  if (supplementalStats.missingFromIndex > 0) {
    console.warn(
      `WARN: ${supplementalStats.missingFromIndex} unit file(s) are missing from db/index.json. Supplemental import summary: added=${supplementalStats.added}, skipped_not_likely_hero=${supplementalStats.skippedNotLikelyHero}, skipped_duplicate_url=${supplementalStats.skippedDuplicateUrl}`
    );
  }

  const sourceRows = [...indexRows, ...supplementalRows];
  const heroRows = sourceRows.map(toHeroRow).filter((h) => h.hero_slug && h.name);

  const supplementalByUrl = supplementalRows
    .map((row) => ({
      hero_slug: String(row.hero_slug || "").trim().toLowerCase(),
      source_url: String(row.url || "").trim(),
    }))
    .filter((row) => row.hero_slug && row.source_url);

  for (const row of supplementalByUrl) {
    const { error: staleUrlError } = await supabase
      .from("heroes")
      .delete()
      .eq("source_url", row.source_url)
      .neq("hero_slug", row.hero_slug);

    if (staleUrlError) {
      console.warn(
        `WARN: stale duplicate cleanup failed for ${row.source_url}: ${staleUrlError.message}`
      );
    }
  }

  const { error: cleanupLegacyTagError } = await supabase
    .from("heroes")
    .delete()
    .eq("tag", "Legacy ID Snipe");

  if (cleanupLegacyTagError) {
    console.warn(`WARN: cleanup for Legacy ID Snipe rows failed: ${cleanupLegacyTagError.message}`);
  }

  const batchSize = 500;
  let warnedMissingRarityColumn = false;
  for (let i = 0; i < heroRows.length; i += batchSize) {
    const batch = heroRows.slice(i, i + batchSize);
    let { error } = await supabase.from("heroes").upsert(batch, {
      onConflict: "hero_slug",
    });

    if (error && String(error.message || "").includes("rarity")) {
      if (!warnedMissingRarityColumn) {
        console.warn("WARN: heroes.rarity column not found in DB. Retrying import without rarity field.");
        warnedMissingRarityColumn = true;
      }
      const withoutRarity = batch.map(({ rarity, ...rest }) => rest);
      ({ error } = await supabase.from("heroes").upsert(withoutRarity, {
        onConflict: "hero_slug",
      }));
    }

    if (error) {
      throw new Error(`Batch ${i}-${i + batch.length} failed: ${error.message}`);
    }

    console.log(`Imported ${Math.min(i + batch.length, heroRows.length)}/${heroRows.length}`);
  }

  console.log(`DONE: imported ${heroRows.length} heroes into public.heroes`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
