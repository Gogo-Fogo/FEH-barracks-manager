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
  const unitPath = path.join(ROOT, "db", "units", `${heroSlug}.json`);
  try {
    const raw = fs.readFileSync(unitPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
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
  const heroSlug = safeSlug(hero.name);
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
  const heroRows = indexRows.map(toHeroRow).filter((h) => h.hero_slug && h.name);

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
