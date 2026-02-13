import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..", "..");
const INDEX_PATH = path.join(ROOT, "db", "index.json");

function safeSlug(name) {
  return String(name || "")
    .replace(/[^a-z0-9]/gi, "_")
    .toLowerCase();
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
  const tierNum = Number.parseFloat(String(hero.tier ?? ""));

  return {
    hero_slug: safeSlug(hero.name),
    name: hero.name ?? "",
    source_url: hero.url ?? null,
    tier: Number.isFinite(tierNum) ? tierNum : null,
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
  for (let i = 0; i < heroRows.length; i += batchSize) {
    const batch = heroRows.slice(i, i + batchSize);
    const { error } = await supabase.from("heroes").upsert(batch, {
      onConflict: "hero_slug",
    });

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
