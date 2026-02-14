const fs = require('fs');
const path = require('path');
const https = require('https');

const DB_ROOT = path.join(__dirname, '../db');
const INDEX_PATH = path.join(DB_ROOT, 'index.json');
const OUT_ROOT = path.join(DB_ROOT, 'quotes/fandom');
const MANIFEST_DIR = path.join(DB_ROOT, 'unit_assets_manifest/fandom');
const MANIFEST_PATH = path.join(MANIFEST_DIR, 'quotes_manifest.json');

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

function safeSlug(name) {
  return name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
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

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r/g, '')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

async function getAllQuotePages() {
  let cmcontinue = '';
  const pages = [];

  while (true) {
    const url =
      'https://feheroes.fandom.com/api.php?action=query&format=json&list=categorymembers&cmtitle=' +
      encodeURIComponent('Category:Quote_pages') +
      '&cmlimit=500' +
      (cmcontinue ? `&cmcontinue=${encodeURIComponent(cmcontinue)}` : '');

    const json = await apiGetJson(url);
    const rows = (json.query && json.query.categorymembers) || [];
    for (const row of rows) {
      if (row && row.title) pages.push(row.title);
    }

    cmcontinue = json.continue && json.continue.cmcontinue ? json.continue.cmcontinue : '';
    if (!cmcontinue) break;
  }

  return pages;
}

async function getParsedPageHtml(title) {
  const url =
    'https://feheroes.fandom.com/api.php?action=parse&format=json&prop=text&page=' +
    encodeURIComponent(title);
  const json = await apiGetJson(url);
  return json && json.parse && json.parse.text ? json.parse.text['*'] || '' : '';
}

async function main() {
  fs.mkdirSync(OUT_ROOT, { recursive: true });
  fs.mkdirSync(MANIFEST_DIR, { recursive: true });

  const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
  const selected = index
    .filter((hero) => !ONLY || ONLY.has(safeSlug(hero.name)))
    .slice(0, LIMIT || index.length);

  const quoteTitles = await getAllQuotePages();
  const quoteByKey = new Map();
  for (const title of quoteTitles) {
    const base = title.replace(/\/Quotes$/i, '').trim();
    quoteByKey.set(normalizeKey(base), title);
  }

  const manifest = {
    updated_at: new Date().toISOString(),
    source: 'fandom',
    dataset: 'quotes',
    total_heroes_targeted: selected.length,
    items: [],
    missing_mapping: [],
  };

  for (const hero of selected) {
    const slug = safeSlug(hero.name);
    const key = normalizeKey(hero.name);
    const quoteTitle = quoteByKey.get(key);

    if (!quoteTitle) {
      manifest.missing_mapping.push({ game8_name: hero.name, game8_slug: slug });
      console.log(`MISS quote-map: ${hero.name}`);
      continue;
    }

    const html = await getParsedPageHtml(quoteTitle);
    const text = stripHtml(html);
    if (!text) {
      console.log(`MISS quote-text: ${hero.name}`);
      continue;
    }

    const outPath = path.join(OUT_ROOT, `${slug}.json`);
    const payload = {
      source: 'fandom',
      game8_name: hero.name,
      game8_slug: slug,
      fandom_quote_page: quoteTitle,
      extracted_at: new Date().toISOString(),
      quote_text: text,
    };

    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));

    manifest.items.push({
      source: 'fandom',
      type: 'quotes',
      game8_name: hero.name,
      game8_slug: slug,
      fandom_quote_page: quoteTitle,
      local_path: outPath.replace(/\\/g, '/'),
      text_length: text.length,
    });

    console.log(`${hero.name}: quotes saved`);
  }

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`DONE quotes items=${manifest.items.length} missing_maps=${manifest.missing_mapping.length}`);
  console.log(`manifest ${MANIFEST_PATH.replace(/\\/g, '/')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
