const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const INDEX_PATH = path.join(ROOT, 'db', 'index.json');
const ALIAS_PATH = path.join(ROOT, 'db', 'hero_aliases.json');
const UNITS_DIR = path.join(ROOT, 'db', 'units');

function safeSlug(value) {
  return String(value || '')
    .replace(/[^a-z0-9]/gi, '_')
    .toLowerCase();
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function extractArchiveId(url) {
  const m = String(url || '').match(/\/archives\/(\d+)/i);
  return m ? Number.parseInt(m[1], 10) : null;
}

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number.parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(Number.parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function normalizeRarity(tokens) {
  const unique = [];
  for (const token of tokens) {
    if (!unique.includes(token)) unique.push(token);
  }
  return unique.length ? unique.join('/') : null;
}

function parseRarityFromRawText(rawText) {
  if (!rawText) return null;

  const text = String(rawText).replace(/\s+/g, ' ');
  const lower = text.toLowerCase();
  const rarityIndex = lower.indexOf(' rarity ');
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

function normalizeLegacyWeapon(weapon) {
  const trimmed = String(weapon || '').trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  if (lower === 'bow') return 'Colorless Bow';
  if (lower === 'dagger') return 'Colorless Dagger';
  if (lower === 'tome') return 'Colorless Tome';
  if (lower === 'breath' || lower === 'dragon') return 'Colorless Breath';
  if (lower === 'beast') return 'Colorless Beast';

  return trimmed;
}

function cleanLegacyHeroName(name) {
  const text = String(name || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';

  return text
    .replace(/\s+Builds?\s+and\s+Best\s+Refine\b/gi, '')
    .replace(/\s+Best\s+Builds?\b/gi, '')
    .replace(/\s+Builds?\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseLegacyHeroMetadata(rawText) {
  const text = String(rawText || '');
  if (!text) return null;

  const heroMatch = text.match(
    /This is a ranking page for the hero\s+([^\.]+?)\s+from the game Fire Emblem Heroes/i
  );

  const weaponMoveMatch = text.match(
    /Color\s*\/\s*Weapon Type\s*\/\s*Move Type\s+[^\/\n]+\s*\/\s*([^\/\n]+?)\s*\/\s*(Infantry|Armored|Cavalry|Flying)/i
  );

  const tierMatch = text.match(/Overall Rating\s*([0-9]+(?:\.[0-9]+)?)\s*\/\s*10/i);

  return {
    heroName: heroMatch ? cleanLegacyHeroName(decodeHtmlEntities(heroMatch[1])) : null,
    weapon: normalizeLegacyWeapon(weaponMoveMatch?.[1] || ''),
    move: weaponMoveMatch?.[2]?.trim() || null,
    tier: tierMatch ? tierMatch[1] : null,
    rarity: parseRarityFromRawText(text),
  };
}

function readUnitBySlug(slug) {
  const filePath = path.join(UNITS_DIR, `${slug}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function buildIndexRowFromUnit(unit, slug, fallbackName) {
  const legacy = parseLegacyHeroMetadata(unit?.raw_text_data);
  const name =
    cleanLegacyHeroName(unit?.name) ||
    cleanLegacyHeroName(legacy?.heroName) ||
    cleanLegacyHeroName(fallbackName) ||
    slug;

  const url = String(unit?.url || '').trim();
  if (!url || !/^https:\/\/game8\.co\/games\/fire-emblem-heroes\/archives\/\d+$/i.test(url)) {
    return null;
  }

  const tier = unit?.tier ?? legacy?.tier ?? null;
  const weapon = unit?.weapon || legacy?.weapon || null;
  const move = unit?.move || legacy?.move || null;
  const tag = unit?.tag === 'Legacy ID Snipe' ? 'Old Hero' : unit?.tag || 'Old Hero';
  const rarity = unit?.rarity ?? legacy?.rarity ?? parseRarityFromRawText(unit?.raw_text_data);

  return {
    name,
    url,
    tier,
    img_url: unit?.img_url || '',
    weapon,
    move,
    tag,
    hero_slug: slug,
    rarity,
    archive_id: extractArchiveId(url),
    discovered_via: unit?.discovered_via || 'alias_canonical_backfill',
    discovered_at: unit?.discovered_at || new Date().toISOString(),
  };
}

function upsertIndexRow(indexRows, newRow) {
  const byUrl = indexRows.findIndex((row) => String(row?.url || '') === String(newRow.url || ''));
  if (byUrl >= 0) {
    indexRows[byUrl] = {
      ...indexRows[byUrl],
      ...newRow,
    };
    return 'updated_url';
  }

  const slug = String(newRow.hero_slug || '').toLowerCase();
  if (slug) {
    const bySlug = indexRows.findIndex(
      (row) => String(row?.hero_slug || safeSlug(row?.name)).toLowerCase() === slug
    );
    if (bySlug >= 0) {
      indexRows[bySlug] = {
        ...indexRows[bySlug],
        ...newRow,
      };
      return 'updated_slug';
    }
  }

  indexRows.push(newRow);
  return 'added';
}

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }

        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => resolve(body));
      })
      .on('error', reject);
  });
}

function extractArchiveMeta(url, html) {
  const titleRaw = (html.match(/<title>([^<]+)<\/title>/i) || [])[1] || '';
  const title = decodeHtmlEntities(titleRaw)
    .replace(/\s*\|\s*Fire Emblem Heroes.*$/i, '')
    .replace(/\s+Builds and Best IVs.*$/i, '')
    .trim();

  const plain = decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );

  const heroLine = plain.match(
    /This is a ranking page for the hero\s+([^\.]+?)\s+from the game Fire Emblem Heroes/i
  );

  const heroName = cleanLegacyHeroName(heroLine?.[1] || '') || title;
  const slug = safeSlug(heroName);
  const legacy = parseLegacyHeroMetadata(plain);
  const image = decodeHtmlEntities(
    (html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || [])[1] || ''
  );

  return {
    name: heroName,
    slug,
    url,
    tier: legacy?.tier ?? null,
    weapon: legacy?.weapon ?? null,
    move: legacy?.move ?? null,
    img_url: image,
    rarity: legacy?.rarity ?? null,
  };
}

function upsertUnitFileFromArchive(meta) {
  const slug = meta.slug;
  const filePath = path.join(UNITS_DIR, `${slug}.json`);
  const existing = readJson(filePath, null) || {};

  const merged = {
    ...existing,
    name: meta.name,
    url: meta.url,
    tier: existing.tier ?? meta.tier ?? null,
    img_url: existing.img_url || meta.img_url || '',
    weapon: existing.weapon || meta.weapon || null,
    move: existing.move || meta.move || null,
    tag: existing.tag && existing.tag !== 'Legacy ID Snipe' ? existing.tag : 'Old Hero',
    archive_id: extractArchiveId(meta.url),
    discovered_via: existing.discovered_via || 'archive_url_backfill',
    discovered_at: existing.discovered_at || new Date().toISOString(),
  };

  writeJson(filePath, merged);
  return { slug, filePath, created: !fs.existsSync(filePath) };
}

function parseArchiveUrlArgs(argv) {
  return argv
    .filter((arg) => arg.startsWith('--archive-url='))
    .map((arg) => arg.replace('--archive-url=', '').trim())
    .filter(Boolean);
}

async function main() {
  const args = process.argv.slice(2);
  const archiveUrls = parseArchiveUrlArgs(args);

  const indexRows = readJson(INDEX_PATH, []);
  const aliasData = readJson(ALIAS_PATH, { entries: [] });
  const aliasEntries = Array.isArray(aliasData.entries) ? aliasData.entries : [];

  const stats = {
    aliasMissingBefore: 0,
    aliasAdded: 0,
    aliasUpdated: 0,
    aliasSkippedMissingUnit: 0,
    archivesRequested: archiveUrls.length,
    archivesAddedOrUpdated: 0,
    archiveUnitsCreatedOrUpdated: 0,
  };

  const indexSlugSet = new Set(
    indexRows.map((row) => String(row?.hero_slug || safeSlug(row?.name)).toLowerCase()).filter(Boolean)
  );

  for (const entry of aliasEntries) {
    const slug = String(entry?.canonical_slug || '').toLowerCase();
    if (!slug) continue;
    if (indexSlugSet.has(slug)) continue;

    stats.aliasMissingBefore += 1;
    const unit = readUnitBySlug(slug);
    if (!unit) {
      stats.aliasSkippedMissingUnit += 1;
      continue;
    }

    const row = buildIndexRowFromUnit(unit, slug, entry?.canonical_name);
    if (!row) {
      stats.aliasSkippedMissingUnit += 1;
      continue;
    }

    const action = upsertIndexRow(indexRows, row);
    if (action.startsWith('updated')) stats.aliasUpdated += 1;
    if (action === 'added') stats.aliasAdded += 1;
    indexSlugSet.add(slug);
  }

  for (const url of archiveUrls) {
    if (!/^https:\/\/game8\.co\/games\/fire-emblem-heroes\/archives\/\d+$/i.test(url)) {
      console.log(`SKIP_INVALID_URL=${url}`);
      continue;
    }

    const html = await fetchHtml(url);
    const meta = extractArchiveMeta(url, html);
    const unitWrite = upsertUnitFileFromArchive(meta);
    stats.archiveUnitsCreatedOrUpdated += 1;

    const unit = readUnitBySlug(meta.slug);
    const row = buildIndexRowFromUnit(unit, meta.slug, meta.name) || {
      name: meta.name,
      url: meta.url,
      tier: meta.tier,
      img_url: meta.img_url,
      weapon: meta.weapon,
      move: meta.move,
      tag: 'Old Hero',
      hero_slug: meta.slug,
      rarity: meta.rarity,
      archive_id: extractArchiveId(meta.url),
      discovered_via: 'archive_url_backfill',
      discovered_at: new Date().toISOString(),
    };

    const action = upsertIndexRow(indexRows, row);
    if (action === 'added' || action.startsWith('updated')) {
      stats.archivesAddedOrUpdated += 1;
    }

    console.log(`ARCHIVE_SEEDED url=${url} slug=${meta.slug} unit_file=${path.basename(unitWrite.filePath)}`);
  }

  writeJson(INDEX_PATH, indexRows);

  console.log('RECONCILE_COMPLETE');
  console.log(`INDEX_ROWS=${indexRows.length}`);
  console.log(`ALIAS_MISSING_BEFORE=${stats.aliasMissingBefore}`);
  console.log(`ALIAS_ADDED=${stats.aliasAdded}`);
  console.log(`ALIAS_UPDATED=${stats.aliasUpdated}`);
  console.log(`ALIAS_SKIPPED_MISSING_UNIT=${stats.aliasSkippedMissingUnit}`);
  console.log(`ARCHIVES_REQUESTED=${stats.archivesRequested}`);
  console.log(`ARCHIVES_ADDED_OR_UPDATED=${stats.archivesAddedOrUpdated}`);
  console.log(`ARCHIVE_UNITS_CREATED_OR_UPDATED=${stats.archiveUnitsCreatedOrUpdated}`);
}

main().catch((error) => {
  console.error(`RECONCILE_ERROR=${error.message}`);
  process.exit(1);
});
