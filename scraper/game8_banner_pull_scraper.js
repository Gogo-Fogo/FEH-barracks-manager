const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const DB_FOLDER = path.join(__dirname, '../db');
const OUTPUT_FILE = path.join(DB_FOLDER, 'banner_pull_guides.json');
const SEED_FILE = path.join(DB_FOLDER, 'banner_pull_seed_urls.json');
const DISCOVERED_FILE = path.join(DB_FOLDER, 'banner_pull_discovered_urls.json');

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1200;

const URL_ARGS = process.argv
  .filter((arg) => arg.startsWith('--url='))
  .map((arg) => arg.replace('--url=', '').trim())
  .filter(Boolean);

const DISCOVER_FROM_ARG = process.argv.find((arg) => arg.startsWith('--discover-from='));
const DISCOVER_FROM_URL = DISCOVER_FROM_ARG ? DISCOVER_FROM_ARG.replace('--discover-from=', '').trim() : '';
const MAX_URLS_ARG = process.argv.find((arg) => arg.startsWith('--max='));
const MAX_URLS = MAX_URLS_ARG ? Number.parseInt(MAX_URLS_ARG.replace('--max=', '').trim(), 10) : null;
const DISCOVER_ONLY = process.argv.includes('--discover-only');

if (!fs.existsSync(DB_FOLDER)) fs.mkdirSync(DB_FOLDER, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function toSlug(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toLowerCase()
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

async function retryWithBackoff(operation, label) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      const waitMs = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);
      const isLastAttempt = attempt === MAX_RETRIES;

      console.log(`   ⚠️ ${label} failed (attempt ${attempt}/${MAX_RETRIES}): ${error.message}`);
      if (!isLastAttempt) {
        console.log(`   ⏳ Retrying in ${waitMs}ms...`);
        await sleep(waitMs);
      }
    }
  }

  throw lastError;
}

function loadSeedUrls() {
  const set = new Set();

  if (fs.existsSync(SEED_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
      for (const value of Array.isArray(parsed) ? parsed : []) {
        if (typeof value === 'string' && value.includes('/archives/')) {
          set.add(value.trim());
        }
      }
    } catch (error) {
      console.log(`⚠️ Could not parse ${SEED_FILE}: ${error.message}`);
    }
  }

  for (const url of URL_ARGS) set.add(url);
  return Array.from(set);
}

async function discoverBannerUrls(page, sourceUrl) {
  await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

  return page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href*="/games/fire-emblem-heroes/archives/"]'));
    const clean = (v) => (v || '').replace(/\s+/g, ' ').trim();

    const contentRoot =
      document.querySelector('.archive-style-wrapper') ||
      document.querySelector('.p-entry__body') ||
      document.querySelector('.l-mainContents') ||
      document.body;

    const archiveSectionLinks = [];
    const headings = Array.from(contentRoot.querySelectorAll('h2, h3'));
    const archiveHeading = headings.find((h) => /summoning\s*event\s*archive/i.test(clean(h.textContent || '')));
    if (archiveHeading) {
      let n = archiveHeading.nextElementSibling;
      while (n && !/^H[23]$/.test(n.tagName)) {
        const localLinks = Array.from(n.querySelectorAll('a[href*="/games/fire-emblem-heroes/archives/"]'));
        for (const a of localLinks) {
          archiveSectionLinks.push({ href: a.href, text: clean(a.textContent || '') });
        }
        n = n.nextElementSibling;
      }
    }

    const candidates = [...links.map((a) => ({ href: a.href, text: clean(a.textContent || '') })), ...archiveSectionLinks]
      .map((a) => ({
        href: a.href,
        text: clean(a.text || ''),
      }))
      .filter((row) => row.href && /\/archives\/\d+/.test(row.href))
      .filter((row) => {
        const t = row.text.toLowerCase();
        return (
          /pull|summon|banner|who should you/i.test(t) ||
          /revival|focus|new heroes|special heroes|mythic heroes|legendary heroes|emblem heroes|hero fest|free summon/i.test(t)
        );
      });

    const unique = [];
    const seen = new Set();
    for (const row of candidates) {
      if (seen.has(row.href)) continue;
      seen.add(row.href);
      unique.push(row.href);
    }

    return unique;
  });
}

async function scrapeBannerPage(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  return page.evaluate(() => {
    const clean = (v) => (v || '').replace(/\s+/g, ' ').trim();
    const title = clean(document.querySelector('h1')?.textContent || document.title || 'Unknown Banner Guide');

    const articleRoot =
      document.querySelector('.archive-style-wrapper') ||
      document.querySelector('.p-entry__body') ||
      document.querySelector('.l-mainContents') ||
      document.body;

    const sectionTexts = [];
    const sectionHeadings = Array.from(articleRoot.querySelectorAll('h2, h3'));
    for (const heading of sectionHeadings) {
      const hText = clean(heading.textContent || '');
      if (!/pull|summon|should you/i.test(hText)) continue;

      let content = '';
      let n = heading.nextElementSibling;
      while (n && !/^H[23]$/.test(n.tagName)) {
        content += ` ${clean(n.textContent || '')}`;
        n = n.nextElementSibling;
      }

      const clipped = clean(content).slice(0, 1400);
      if (clipped) {
        sectionTexts.push({ heading: hText, content: clipped });
      }
    }

    const recommendationMap = new Map();
    const tables = Array.from(articleRoot.querySelectorAll('table'));

    for (const table of tables) {
      const rows = Array.from(table.querySelectorAll('tr'));
      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll('th,td'));
        if (!cells.length) continue;

        const link = row.querySelector('a[href*="/games/fire-emblem-heroes/archives/"]');
        const name = clean(link?.textContent || cells[0]?.textContent || '');
        if (!name || name.length < 2 || /^rank|name$/i.test(name)) continue;

        const rowText = clean(cells.map((c) => c.textContent || '').join(' | '));
        const tier =
          rowText.match(/\b([SsAaBb][+\-]?)\b/)?.[1] ||
          rowText.match(/\b(\d{1,2}(?:\.\d)?)\b/)?.[1] ||
          '-';

        const pullRecommendation =
          rowText.match(/must pull|highly recommend|recommend|skip|good|decent|priority/i)?.[0] ||
          '-';

        const current = recommendationMap.get(name);
        if (!current || (current.tier === '-' && tier !== '-')) {
          recommendationMap.set(name, {
            hero_name: name,
            hero_slug_guess: name
              .normalize('NFKD')
              .replace(/[\u0300-\u036f]/g, '')
              .replace(/[^a-zA-Z0-9]+/g, '_')
              .toLowerCase()
              .replace(/^_+|_+$/g, '')
              .replace(/_+/g, '_'),
            tier,
            pull_recommendation: pullRecommendation,
            notes: rowText.slice(0, 500),
          });
        }
      }
    }

    const topRaw = clean(articleRoot.textContent || '').slice(0, 2500);

    return {
      title,
      sections: sectionTexts,
      recommendations: Array.from(recommendationMap.values()),
      raw_excerpt: topRaw,
    };
  });
}

async function main() {
  const staticUrls = loadSeedUrls();
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    protocolTimeout: 180000,
    args: ['--start-maximized'],
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  const discoveredUrls = [];
  if (DISCOVER_FROM_URL) {
    try {
      console.log(`🔎 Discovering banner links from: ${DISCOVER_FROM_URL}`);
      const found = await retryWithBackoff(
        async () => discoverBannerUrls(page, DISCOVER_FROM_URL),
        'Banner URL discovery'
      );
      discoveredUrls.push(...found);
      console.log(`   Found ${found.length} candidate banner links.`);

      if (DISCOVER_ONLY) {
        fs.writeFileSync(
          DISCOVERED_FILE,
          JSON.stringify(
            {
              source_url: DISCOVER_FROM_URL,
              discovered_at: new Date().toISOString(),
              count: found.length,
              urls: found,
            },
            null,
            2
          )
        );
        console.log(`   Saved discovered URLs: ${DISCOVERED_FILE}`);
      }
    } catch (error) {
      console.log(`   ❌ Discovery failed: ${error.message}`);
    }
  }

  if (DISCOVER_ONLY) {
    await browser.close();
    return;
  }

  const urls = Array.from(new Set([...staticUrls, ...discoveredUrls]));
  const finalUrls = Number.isFinite(MAX_URLS) && MAX_URLS > 0 ? urls.slice(0, MAX_URLS) : urls;

  if (!finalUrls.length) {
    console.log('⚠️ No banner URLs provided.');
    console.log(`Add URLs to ${SEED_FILE}, pass --url=<game8-banner-url>, or use --discover-from=<hub-url>.`);
    await browser.close();
    return;
  }

  console.log(`🎯 [BANNER SCOUT] Scraping ${finalUrls.length} pull-guide pages...`);

  const items = [];
  const failed = [];

  try {
    for (let i = 0; i < finalUrls.length; i++) {
      const url = finalUrls[i];
      console.log(`[${i + 1}/${finalUrls.length}] ${url}`);

      try {
        const parsed = await retryWithBackoff(
          async () => scrapeBannerPage(page, url),
          `Banner page scrape ${url}`
        );

        items.push({
          id: toSlug(parsed.title || url),
          url,
          title: parsed.title,
          scraped_at: new Date().toISOString(),
          guide_sections: parsed.sections || [],
          recommendations: parsed.recommendations || [],
          raw_excerpt: parsed.raw_excerpt || '',
        });
      } catch (error) {
        failed.push({ url, error: error.message, timestamp: new Date().toISOString() });
        console.log(`   ❌ Failed: ${error.message}`);
      }
    }
  } finally {
    await browser.close();
  }

  const output = {
    source: 'game8',
    generated_at: new Date().toISOString(),
    item_count: items.length,
    failed_count: failed.length,
    items,
    failed,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`\n✅ Saved banner pull guides: ${OUTPUT_FILE}`);
  console.log(`   Items: ${items.length}`);
  console.log(`   Failed: ${failed.length}`);
}

main().catch((error) => {
  console.error(`❌ Banner pull scraper crashed: ${error.message}`);
  process.exit(1);
});
