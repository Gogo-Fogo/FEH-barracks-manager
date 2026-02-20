const fs = require("fs");
const path = require("path");

const UNIT_DIR = path.join(__dirname, "..", "db", "units");
const ALIAS_FILE = path.join(__dirname, "..", "db", "hero_aliases.json");

const QUERY_LIST = [
  "Fjorm New Traditions",
  "Tiki Summering Scion",
  "Azura Young Songstress",
  "Camilla Spring Princess",
  "Cordelia Perfect Bride",
  "Corrin Enjoying Tradition",
  "Amelia Rose of the War",
  "Olivia Festival Dancer",
  "Kagero Spring Ninja",
  "Sakura Loving Priestess",
  "Siegbert Future King",
  "Marth Altean Groom",
  "Eliwood Devoted Love",
  "Titania Mighty Mercenary",
  "Kagero Beverage Ninja",
  "Xander Student Swimmer",
  "Sanaki Begnion's Apostle",
  "Delthea Free Spirit",
  "Alm Hero of Prophecy",
  "Celica Imprisoned Soul",
  "Olivia Blushing Beauty",
  "Marth Enigmatic Blade",
  "Luke Rowdy Squire",
  "Eldigan Lionheart",
  "Canas Wisdom Seeker",
  "Shiro Raw Talent",
  "Hardin Dark Emperor",
  "Quan Luminous Lancer",
  "Barst The Hatchet",
  "Dorcas Serene Warrior",
  "Spring Exalt Chrom",
  "Hector General of Ostia",
  "Naga's voice",
];

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
}

function canonicalSlugFromEntry(entry) {
  const explicit = String(entry?.canonical_slug || "").trim().toLowerCase();
  if (explicit) return explicit;
  return slugify(entry?.canonical_name || "");
}

function loadUnits() {
  const bySlug = new Map();
  const byNormalized = new Map();

  const files = fs.readdirSync(UNIT_DIR).filter((file) => file.endsWith(".json"));
  for (const file of files) {
    try {
      const unit = JSON.parse(fs.readFileSync(path.join(UNIT_DIR, file), "utf8"));
      const slug = file.replace(/\.json$/i, "");
      const name = String(unit?.name || slug);
      bySlug.set(slug, name);
      byNormalized.set(normalize(name), { slug, name });
      byNormalized.set(normalize(slug), { slug, name });
    } catch {
      // ignore malformed rows
    }
  }

  return { bySlug, byNormalized };
}

function loadAliasLookup() {
  const lookup = new Map();
  if (!fs.existsSync(ALIAS_FILE)) return lookup;

  const parsed = JSON.parse(fs.readFileSync(ALIAS_FILE, "utf8"));
  for (const entry of parsed?.entries || []) {
    const slug = canonicalSlugFromEntry(entry);
    if (!slug) continue;

    const register = (value) => {
      const key = normalize(value);
      if (key && !lookup.has(key)) lookup.set(key, slug);
    };

    register(slug);
    register(entry.canonical_name || "");
    for (const alias of entry.aliases || []) register(alias);
  }

  return lookup;
}

function main() {
  const { bySlug, byNormalized } = loadUnits();
  const aliasLookup = loadAliasLookup();

  const found = [];
  const alias = [];
  const missing = [];

  for (const query of QUERY_LIST) {
    const key = normalize(query);
    const direct = byNormalized.get(key);
    if (direct) {
      found.push({ query, slug: direct.slug, name: direct.name });
      continue;
    }

    const aliasSlug = aliasLookup.get(key);
    if (aliasSlug && bySlug.has(aliasSlug)) {
      alias.push({ query, slug: aliasSlug, name: bySlug.get(aliasSlug) });
      continue;
    }

    missing.push(query);
  }

  console.log(`FOUND_COUNT=${found.length}`);
  for (const row of found) {
    console.log(`FOUND | ${row.query} => ${row.name} (${row.slug})`);
  }

  console.log(`ALIAS_COUNT=${alias.length}`);
  for (const row of alias) {
    console.log(`ALIAS | ${row.query} => ${row.name} (${row.slug})`);
  }

  console.log(`MISSING_COUNT=${missing.length}`);
  for (const row of missing) {
    console.log(`MISS | ${row}`);
  }
}

main();
