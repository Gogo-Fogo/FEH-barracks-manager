const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// CONFIGURATION
const DB_FOLDER = path.join(__dirname, '../db');
const UNITS_FOLDER = path.join(DB_FOLDER, 'units');
const INDEX_FILE = path.join(DB_FOLDER, 'index.json');

const CONTAINER_SELECTOR = 'div[class*="style-module__cardView"]';
const TOTAL_PRESSES = 350;
const SCROLL_DELAY_MS = 400;

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1200;

if (!fs.existsSync(DB_FOLDER)) fs.mkdirSync(DB_FOLDER, { recursive: true });
if (!fs.existsSync(UNITS_FOLDER)) fs.mkdirSync(UNITS_FOLDER, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function retryWithBackoff(operation, label) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      const waitMs = BASE_RETRY_DELAY_MS * (2 ** (attempt - 1));
      const isLastAttempt = attempt === MAX_RETRIES;

      console.log(`   ⚠️  ${label} failed (attempt ${attempt}/${MAX_RETRIES}): ${error.message}`);
      if (!isLastAttempt) {
        console.log(`   ⏳ Retrying in ${waitMs}ms...`);
        await sleep(waitMs);
      }
    }
  }

  throw lastError;
}

async function extractTierCards(page) {
  return page.evaluate(() => {
    const cards = document.querySelectorAll('div[class*="style-module__cardItem"]');
    return Array.from(cards).map((card) => {
      const nameLink = card.querySelector('a[class*="style-module__cardNameLink"]');
      const tierDiv = card.querySelector('div[class*="style-module__cardText"]');
      const img = card.querySelector('img[class*="style-module__cardImage"]');
      const tags = Array.from(card.querySelectorAll('span[class*="style-module__iconWithTextText"]')).map((s) => s.innerText.trim());

      return {
        name: nameLink ? nameLink.innerText.trim() : null,
        url: nameLink ? nameLink.href : null,
        tier: tierDiv ? tierDiv.innerText.replace('Tier:', '').trim() : null,
        img_url: img ? img.src : '',
        weapon: tags[0] || 'Unknown',
        move: tags[1] || 'Unknown',
        tag: tags[2] || '',
      };
    });
  });
}

async function safeExtractTierCards(page) {
  try {
    return await extractTierCards(page);
  } catch (error) {
    const isContextError = error.message.includes('Execution context was destroyed');
    if (!isContextError) throw error;

    console.log('   ⚠️ Scan context reset detected. Re-syncing page context...');
    await sleep(800);

    const expectedUrlPart = '/games/fire-emblem-heroes/archives/242267';
    if (!page.url().includes(expectedUrlPart)) {
      console.log(`   ↩️ Unexpected URL during scan: ${page.url()} | returning to tier list...`);
      await retryWithBackoff(
        async () => page.goto(`https://game8.co${expectedUrlPart}`, { waitUntil: 'networkidle2', timeout: 60000 }),
        'Return to tier list after context reset'
      );
    }

    await page.waitForSelector(CONTAINER_SELECTOR, { timeout: 20000 });
    await page.click(CONTAINER_SELECTOR);
    await sleep(500);
    return extractTierCards(page);
  }
}

(async () => {
  console.log('🔄 Launching VAULT MAINTENANCE UPDATER (SCOUT ONLY)...');
  let browser;

  const runStats = {
    scannedHeroes: 0,
    created: 0,
    refreshedMetadata: 0,
    unchanged: 0,
  };

  try {
    browser = await puppeteer.launch({
      headless: false,
      defaultViewport: null,
      protocolTimeout: 180000,
      args: ['--start-maximized'],
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    const url = 'https://game8.co/games/fire-emblem-heroes/archives/242267';
    console.log(`📡 Checking for new additions at: ${url}`);
    await retryWithBackoff(
      async () => page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }),
      'Initial tier-list load'
    );

    await page.waitForSelector(CONTAINER_SELECTOR, { timeout: 20000 });
    await page.click(CONTAINER_SELECTOR);
    await sleep(1000);

    // --- PHASE 1: SCAN FOR CHANGES ---
    const uniqueHeroes = new Map();

    // Keep proven behavior: keyboard PageDown while container is focused.
    for (let i = 0; i < TOTAL_PRESSES; i++) {
      await page.keyboard.press('PageDown');
      await sleep(SCROLL_DELAY_MS);

      const currentBatch = await safeExtractTierCards(page);
      currentBatch.forEach((hero) => {
        if (hero.url && !uniqueHeroes.has(hero.url)) uniqueHeroes.set(hero.url, hero);
      });

      if (i % 50 === 0) {
        process.stdout.write(`Scanning... Found ${uniqueHeroes.size} heroes    \r`);
      }
    }

    const heroList = Array.from(uniqueHeroes.values());
    runStats.scannedHeroes = heroList.length;
    fs.writeFileSync(INDEX_FILE, JSON.stringify(heroList, null, 2));
    console.log(`\n✅ Scan Complete. Found ${heroList.length} heroes total.`);

    // --- PHASE 2: MAINTAIN UNIT FILE METADATA ONLY ---
    // IMPORTANT: No deep scrape here. build_parser.js owns enrichment.

    console.log('\n🗂️ Syncing unit file skeletons/metadata only...');
    for (const hero of heroList) {
      const safeName = hero.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const filePath = path.join(UNITS_FOLDER, `${safeName}.json`);

      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify(hero, null, 2));
        runStats.created += 1;
        process.stdout.write(' +');
        continue;
      }

      try {
        const existingData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const merged = { ...existingData, ...hero };

        const before = JSON.stringify(existingData);
        const after = JSON.stringify(merged);

        if (before === after) {
          runStats.unchanged += 1;
          process.stdout.write('.');
        } else {
          fs.writeFileSync(filePath, JSON.stringify(merged, null, 2));
          runStats.refreshedMetadata += 1;
          process.stdout.write(' ~');
        }
      } catch {
        fs.writeFileSync(filePath, JSON.stringify(hero, null, 2));
        runStats.refreshedMetadata += 1;
        process.stdout.write(' !');
      }
    }

    console.log('\n\n✅ SCOUT COMPLETE. Index and skeleton metadata are up to date.');
    console.log('📊 Run Summary:');
    console.log(`   Scanned heroes : ${runStats.scannedHeroes}`);
    console.log(`   Created files  : ${runStats.created}`);
    console.log(`   Refreshed meta : ${runStats.refreshedMetadata}`);
    console.log(`   Unchanged files: ${runStats.unchanged}`);
    console.log('➡️ Next step: run build_parser.js for deep enrichment.');
  } catch (error) {
    console.error(`❌ Maintenance updater crashed: ${error.message}`);
    throw error;
  } finally {
    if (browser) await browser.close();
  }
})();
