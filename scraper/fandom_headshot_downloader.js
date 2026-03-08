const fs = require('fs');
const path = require('path');
const https = require('https');

const DB_ROOT = path.join(__dirname, '../db');
const INDEX_PATH = path.join(DB_ROOT, 'index.json');
const OUT_ROOT = path.join(DB_ROOT, 'unit_assets/fandom/headshots');
const MANIFEST_DIR = path.join(DB_ROOT, 'unit_assets_manifest/fandom');
const MANIFEST_PATH = path.join(MANIFEST_DIR, 'headshots_manifest.json');
const FANDOM_NAME_MAP_PATH = path.join(__dirname, '../app/src/lib/fandom-name-map.json');

const COUNT_ARG = process.argv.find((a) => a.startsWith('--count='));
const ONLY_ARG = process.argv.find((a) => a.startsWith('--only='));
const LIMIT = COUNT_ARG ? Number(COUNT_ARG.replace('--count=', '')) : null;
const ONLY = ONLY_ARG
  ? new Set(
      ONLY_ARG.replace('--only=', '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    )
  : null;

const FANDOM_NAME_MAP = fs.existsSync(FANDOM_NAME_MAP_PATH)
  ? JSON.parse(fs.readFileSync(FANDOM_NAME_MAP_PATH, 'utf8'))
  : {};

function safeSlug(name) {
  return name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

function fandomPageTitleToBase(title) {
  return String(title || '')
    .replace(/_/g, ' ')
    .replace(/\s*:\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toDbRelativePath(absPath) {
  const rel = path.relative(DB_ROOT, absPath).replace(/\\/g, '/');
  return `db/${rel}`;
}

function normalizeKey(text) {
  const transliterated = String(text || '')
    .replace(/[ðÐ]/g, 'd')
    .replace(/[þÞ]/g, 'th')
    .replace(/[æÆ]/g, 'ae')
    .replace(/[œŒ]/g, 'oe')
    .replace(/[øØ]/g, 'o')
    .replace(/[łŁ]/g, 'l')
    .replace(/[’'`]/g, '');

  return text
    ? transliterated
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    : '';
}

function fandomFileBaseCandidates(base) {
  const values = new Set();
  const push = (value) => {
    const normalized = String(value || '').trim();
    if (normalized) values.add(normalized);
  };

  push(base);
  push(
    String(base || '')
      .replace(/[ðÐ]/g, 'd')
      .replace(/[þÞ]/g, 'th')
      .replace(/[æÆ]/g, 'ae')
      .replace(/[œŒ]/g, 'oe')
      .replace(/[øØ]/g, 'o')
      .replace(/[łŁ]/g, 'l')
      .replace(/[óòôöõÓÒÔÖÕ]/g, 'o')
      .replace(/[áàâäãÁÀÂÄÃ]/g, 'a')
      .replace(/[éèêëÉÈÊË]/g, 'e')
      .replace(/[íìîïÍÌÎÏ]/g, 'i')
      .replace(/[úùûüÚÙÛÜ]/g, 'u')
      .replace(/[ýÿÝ]/g, 'y')
      .replace(/[’'`]/g, '')
  );

  return [...values];
}

function buildLookupKeys(text) {
  const keys = new Set();
  const push = (value) => {
    const key = normalizeKey(value);
    if (key) keys.add(key);
  };

  push(text);

  const noParens = String(text || '').replace(/\([^)]*\)/g, ' ');
  push(noParens);

  const noGenderTokens = noParens.replace(/\b(female|male|f|m)\b/gi, ' ');
  push(noGenderTokens);

  return [...keys];
}

function clearDir(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  for (const entry of fs.readdirSync(dirPath)) {
    const full = path.join(dirPath, entry);
    if (fs.statSync(full).isFile()) fs.unlinkSync(full);
  }
}

function readExistingManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function mergeManifestForOnlyRun(manifest, selectedSlugs) {
  if (!ONLY) return manifest;

  const existing = readExistingManifest();
  if (!existing) return manifest;

  const keepItem = (entry) => !selectedSlugs.has(String(entry?.game8_slug || '').toLowerCase());

  return {
    ...existing,
    updated_at: manifest.updated_at,
    source: manifest.source,
    dataset: manifest.dataset,
    items: [...(existing.items || []).filter(keepItem), ...manifest.items],
    missing_mapping: [
      ...(existing.missing_mapping || []).filter(keepItem),
      ...manifest.missing_mapping,
    ],
  };
}

function apiGetJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on('error', reject);
  });
}

function downloadFile(url, outPath) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        const out = fs.createWriteStream(outPath);
        res.pipe(out);
        out.on('finish', () => out.close(resolve));
        out.on('error', reject);
      })
      .on('error', reject);
  });
}

async function getAllFaceFcBases() {
  let imcontinue = '';
  const seen = new Set();

  while (true) {
    const url =
      'https://feheroes.fandom.com/api.php?action=query&format=json&titles=List_of_Heroes&prop=images&imlimit=500' +
      (imcontinue ? `&imcontinue=${encodeURIComponent(imcontinue)}` : '');

    const json = await apiGetJson(url);
    const page = Object.values((json.query && json.query.pages) || {})[0] || {};

    for (const image of page.images || []) {
      const title = image.title || '';
      const match = title.match(/^File:(.+) Face FC\.(webp|png|jpg|jpeg)$/i);
      if (!match) continue;
      seen.add(match[1]);
    }

    imcontinue = json.continue && json.continue.imcontinue ? json.continue.imcontinue : '';
    if (!imcontinue) break;
  }

  let cmcontinue = '';
  while (true) {
    const url =
      'https://feheroes.fandom.com/api.php?action=query&format=json&list=categorymembers&cmtitle=' +
      encodeURIComponent('Category:Heroes') +
      '&cmlimit=500' +
      (cmcontinue ? `&cmcontinue=${encodeURIComponent(cmcontinue)}` : '');

    const json = await apiGetJson(url);
    const rows = (json.query && json.query.categorymembers) || [];

    for (const row of rows) {
      if (Number(row && row.ns) !== 0) continue;
      const base = fandomPageTitleToBase(row && row.title);
      if (base) seen.add(base);
    }

    cmcontinue = json.continue && json.continue.cmcontinue ? json.continue.cmcontinue : '';
    if (!cmcontinue) break;
  }

  return [...seen];
}

async function getImageInfo(fileTitle) {
  const url =
    'https://feheroes.fandom.com/api.php?action=query&format=json&prop=imageinfo&iiprop=url|size|mime&titles=' +
    encodeURIComponent(fileTitle);
  const json = await apiGetJson(url);
  const page = Object.values((json.query && json.query.pages) || {})[0] || {};
  return page.imageinfo && page.imageinfo[0] ? page.imageinfo[0] : null;
}

async function resolveHeadshotInfo(fandomBase) {
  for (const baseCandidate of fandomFileBaseCandidates(fandomBase)) {
    for (const ext of ['webp', 'png', 'jpg', 'jpeg']) {
      const title = `File:${baseCandidate} Face FC.${ext}`;
      const info = await getImageInfo(title);
      if (info && info.url) return { info, title };
    }
  }
  return null;
}

async function main() {
  fs.mkdirSync(OUT_ROOT, { recursive: true });
  fs.mkdirSync(MANIFEST_DIR, { recursive: true });

  const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
  const selected = index
    .filter((hero) => !ONLY || ONLY.has(safeSlug(hero.name)))
    .slice(0, LIMIT || index.length);
  const selectedSlugs = new Set(selected.map((hero) => safeSlug(hero.name)));

  const fandomBases = await getAllFaceFcBases();
  const baseByKey = new Map();
  for (const base of fandomBases) {
    baseByKey.set(normalizeKey(base), base);
  }

  const manifest = {
    updated_at: new Date().toISOString(),
    source: 'fandom',
    dataset: 'headshots',
    total_heroes_targeted: selected.length,
    items: [],
    missing_mapping: [],
  };

  for (const hero of selected) {
    const game8Slug = safeSlug(hero.name);
    const mappedBase = String(FANDOM_NAME_MAP[game8Slug] || '').trim();
    const fandomBase = (
      (mappedBase && (baseByKey.get(normalizeKey(mappedBase)) || mappedBase)) ||
      buildLookupKeys(hero.name)
      .map((key) => baseByKey.get(key))
      .find(Boolean)
    );
    if (!fandomBase) {
      manifest.missing_mapping.push({ game8_name: hero.name, game8_slug: game8Slug });
      console.log(`MISS map: ${hero.name}`);
      continue;
    }

    const resolved = await resolveHeadshotInfo(fandomBase);
    if (!resolved) {
      console.log(`MISS headshot: ${hero.name}`);
      continue;
    }

    const heroDir = path.join(OUT_ROOT, game8Slug);
    fs.mkdirSync(heroDir, { recursive: true });
    clearDir(heroDir);

    const ext = resolved.info.mime?.includes('png')
      ? 'png'
      : resolved.info.mime?.includes('jpeg')
        ? 'jpg'
        : 'webp';
    const outName = `fandom_${game8Slug}_headshot.${ext}`;
    const outPath = path.join(heroDir, outName);

    await downloadFile(resolved.info.url, outPath);

    manifest.items.push({
      source: 'fandom',
      type: 'headshot',
      game8_name: hero.name,
      game8_slug: game8Slug,
      fandom_base_name: fandomBase,
      fandom_file_title: resolved.title,
      mime: resolved.info.mime,
      width: resolved.info.width,
      height: resolved.info.height,
      source_url: resolved.info.url,
      local_path: toDbRelativePath(outPath),
    });

    console.log(`${hero.name}: saved 1/1`);
  }

  const finalManifest = mergeManifestForOnlyRun(manifest, selectedSlugs);
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(finalManifest, null, 2));
  console.log(`DONE headshots items=${finalManifest.items.length} missing_maps=${finalManifest.missing_mapping.length}`);
  console.log(`manifest ${MANIFEST_PATH.replace(/\\/g, '/')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
