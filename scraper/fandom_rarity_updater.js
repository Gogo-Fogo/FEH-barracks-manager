const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const LIST_URL = 'https://feheroes.fandom.com/wiki/List_of_Heroes';
const INDEX_FILE = path.join(__dirname, '../db/index.json');
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function normalizeDisplayName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’'`]/g, '')
    .replace(/[–—−]/g, '-')
    .replace(/\s*:\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function nameToKey(name) {
  return normalizeDisplayName(name).replace(/[^a-z0-9]+/g, '');
}

function nameCandidates(name) {
  const normalized = normalizeDisplayName(name);
  const parts = normalized.split(' - ');
  const candidates = new Set([nameToKey(normalized)]);

  if (parts.length >= 2) {
    const lead = parts[0];
    const tail = parts.slice(1).join(' - ');
    const noParenLead = lead.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();

    if (noParenLead && noParenLead !== lead) {
      candidates.add(nameToKey(`${noParenLead} - ${tail}`));
    }
  }

  return Array.from(candidates).filter(Boolean);
}

function parseRarityCell(rarityCell) {
  const stars = new Set();
  const traits = new Set();

  const imgs = Array.from(rarityCell.querySelectorAll('img'));
  for (const img of imgs) {
    const raw =
      img.getAttribute('data-image-name') ||
      img.getAttribute('alt') ||
      img.getAttribute('src') ||
      '';
    const match = raw.match(/rarity[_\s-]*([1-5](?:\.5)?)/i);
    if (!match) continue;

    if (match[1] === '4.5') {
      stars.add(4);
      stars.add(5);
    } else {
      stars.add(Number(match[1]));
    }
  }

  const text = rarityCell.textContent.replace(/\s+/g, ' ').trim();
  if (/\blegendary\b/i.test(text)) traits.add('Legendary');
  if (/\bmythic\b/i.test(text)) traits.add('Mythic');

  const starList = Array.from(stars).sort((a, b) => a - b);
  return [...starList, ...Array.from(traits)];
}

function rarityTextFromArray(rarities) {
  const starValues = rarities.filter((r) => typeof r === 'number');
  const traits = rarities.filter((r) => typeof r === 'string');

  const starText = starValues.length ? starValues.join('/') : '';
  if (!traits.length) return starText || null;
  return [starText, ...traits].filter(Boolean).join(' ');
}

async function scrapeFandomRarityMap() {
  const response = await fetch(LIST_URL, {
    headers: { 'User-Agent': USER_AGENT },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch fandom list (${response.status})`);
  }

  const html = await response.text();
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const rows = Array.from(doc.querySelectorAll('table tr')).slice(1);

  const rarityMap = new Map();
  for (const row of rows) {
    const tds = row.querySelectorAll('td');
    if (tds.length < 7) continue;

    const heroName = (tds[1]?.textContent || '').replace(/\s+/g, ' ').trim();
    const rarityCell = tds[6];
    if (!heroName || !rarityCell) continue;

    const rarities = parseRarityCell(rarityCell);
    if (!rarities.length) continue;

    rarityMap.set(nameToKey(heroName), rarities);
  }

  return rarityMap;
}

async function run() {
  console.log('🔄 Scraping rarity data from FEH Fandom...');
  const rarityMap = await scrapeFandomRarityMap();
  console.log(`📦 Parsed ${rarityMap.size} rarity rows from fandom list.`);

  const indexRaw = fs.readFileSync(INDEX_FILE, 'utf8');
  const indexData = JSON.parse(indexRaw);

  let matched = 0;
  let unmatched = 0;

  for (const hero of indexData) {
    const candidates = nameCandidates(hero.name);
    const found = candidates.map((k) => rarityMap.get(k)).find(Boolean);

    if (found) {
      hero.rarities = found;
      hero.rarity = rarityTextFromArray(found);
      matched += 1;
    } else {
      hero.rarities = null;
      hero.rarity = null;
      unmatched += 1;
    }
  }

  fs.writeFileSync(INDEX_FILE, JSON.stringify(indexData, null, 2));

  console.log('✅ Rarity sync complete.');
  console.log(`   Matched heroes : ${matched}`);
  console.log(`   Unmatched heroes: ${unmatched}`);
}

run().catch((error) => {
  console.error(`❌ Fandom rarity updater failed: ${error.message}`);
  process.exit(1);
});
