const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// CONFIGURATION
const DB_FOLDER = path.join(__dirname, '../db');
const UNITS_FOLDER = path.join(DB_FOLDER, 'units');
const INDEX_FILE = path.join(DB_FOLDER, 'index.json');
const FAILED_FILE = path.join(DB_FOLDER, 'failed_maintenance_units.json');

const MAX_SCROLL_ITERATIONS = 600;
const NO_GROWTH_LIMIT = 24;
const SCROLL_DELAY_MS = 400;

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1200;
const BETWEEN_UNITS_DELAY_MS = 700;

if (!fs.existsSync(DB_FOLDER)) fs.mkdirSync(DB_FOLDER);
if (!fs.existsSync(UNITS_FOLDER)) fs.mkdirSync(UNITS_FOLDER);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function retryWithBackoff(operation, label) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === MAX_RETRIES;
      const waitMs = BASE_RETRY_DELAY_MS * (2 ** (attempt - 1));

      console.log(`   ⚠️  ${label} failed (attempt ${attempt}/${MAX_RETRIES}): ${error.message}`);
      if (!isLastAttempt) {
        console.log(`   ⏳ Retrying in ${waitMs}ms...`);
        await sleep(waitMs);
      }
    }
  }

  throw lastError;
}

function saveFailures(failures) {
  if (failures.length > 0) {
    fs.writeFileSync(FAILED_FILE, JSON.stringify(failures, null, 2));
    console.log(`🧾 Failure log saved to: ${FAILED_FILE}`);
  } else if (fs.existsSync(FAILED_FILE)) {
    fs.unlinkSync(FAILED_FILE);
    console.log('🧹 Cleared previous maintenance failure log (no failures this run).');
  }
}

(async () => {
  console.log('🔄 Launching VAULT MAINTENANCE & UPDATER...');
  let browser;
  const failures = [];

  const runStats = {
    scannedHeroes: 0,
    skipped: 0,
    updated: 0,
    failed: 0,
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

    const CONTAINER_SELECTOR = 'div[class*="style-module__cardView"]';
    await page.waitForSelector(CONTAINER_SELECTOR, { timeout: 15000 });
    await page.click(CONTAINER_SELECTOR);
    await sleep(1000);

    // --- PHASE 1: SCAN FOR CHANGES ---
    const uniqueHeroes = new Map();
    let lastCount = 0;
    let noGrowthStreak = 0;

    for (let i = 0; i < MAX_SCROLL_ITERATIONS; i++) {
      await page.evaluate((containerSelector) => {
        const container = document.querySelector(containerSelector);
        if (container) {
          container.scrollTop += Math.floor(container.clientHeight * 0.9);
          return;
        }

        // Fallback (should rarely be needed)
        window.scrollBy({ top: Math.floor(window.innerHeight * 0.9), behavior: 'instant' });
      }, CONTAINER_SELECTOR);
      await sleep(SCROLL_DELAY_MS);

      const currentBatch = await page.evaluate(() => {
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

      currentBatch.forEach((hero) => {
        if (hero.url && !uniqueHeroes.has(hero.url)) uniqueHeroes.set(hero.url, hero);
      });

      const currentCount = uniqueHeroes.size;
      if (currentCount === lastCount) {
        noGrowthStreak += 1;
      } else {
        noGrowthStreak = 0;
        lastCount = currentCount;
      }

      if (i % 25 === 0) {
        process.stdout.write(`Scanning... Found ${currentCount} heroes | no-growth streak: ${noGrowthStreak}    \r`);
      }

      if (noGrowthStreak >= NO_GROWTH_LIMIT) {
        console.log(`\n🛑 No new heroes detected after ${NO_GROWTH_LIMIT} scroll checks. Stopping adaptive scan.`);
        break;
      }
    }

    const heroList = Array.from(uniqueHeroes.values());
    runStats.scannedHeroes = heroList.length;
    fs.writeFileSync(INDEX_FILE, JSON.stringify(heroList, null, 2));
    console.log(`\n✅ Scan Complete. Found ${heroList.length} heroes total.`);

    // --- PHASE 2: FILL THE GAPS ---
    console.log('\n🔍 Checking for missing build info or new units...');

    for (const hero of heroList) {
      const safeName = hero.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const filePath = path.join(UNITS_FOLDER, `${safeName}.json`);

      let needsUpdate = false;
      try {
        if (!fs.existsSync(filePath)) {
          needsUpdate = true; // New hero
        } else {
          const existingData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          if (!existingData.raw_text_data || !existingData.recommended_build) {
            needsUpdate = true; // Missing deep scrape info
          }
        }
      } catch (error) {
        needsUpdate = true; // Corrupted JSON etc.
        console.log(`\n⚠️ Could not read existing file for ${hero.name}, forcing refresh: ${error.message}`);
      }

      if (!needsUpdate) {
        runStats.skipped += 1;
        process.stdout.write('.');
        continue;
      }

      try {
        console.log(`\n📥 Updating Info: ${hero.name}`);
        const details = await retryWithBackoff(async () => {
          await page.goto(hero.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

          return page.evaluate(() => {
            const data = {};

            // 1. Get IVs
            document.querySelectorAll('table').forEach((t) => {
              if (t.innerText.includes('Asset')) data.ivs = t.innerText.trim();
            });

            // 2. Extract Raw Text Content for AI
            const entryBody = document.querySelector('.p-entry__body') || document.querySelector('.l-mainContents');
            if (entryBody) {
              const clone = entryBody.cloneNode(true);
              clone.querySelectorAll('script, style, .a-arnArea').forEach((s) => s.remove());
              data.raw_text_data = clone.innerText.replace(/\s\s+/g, ' ').trim();
            }

            // 3. Capture Build Table (messy version to be parsed later or kept)
            const buildH = Array.from(document.querySelectorAll('h2, h3')).find((h) => h.innerText.includes('Build'));
            if (buildH) {
              let n = buildH.nextElementSibling;
              while (n && n.tagName !== 'TABLE') n = n.nextElementSibling;
              if (n) data.build_html = n.outerHTML;
            }

            return data;
          });
        }, `Scrape ${hero.name}`);

        fs.writeFileSync(filePath, JSON.stringify({ ...hero, ...details }, null, 2));
        runStats.updated += 1;
        process.stdout.write(' ✅ Done');
        await sleep(BETWEEN_UNITS_DELAY_MS);
      } catch (error) {
        runStats.failed += 1;
        failures.push({
          name: hero.name,
          url: hero.url,
          filePath,
          error: error.message,
          timestamp: new Date().toISOString(),
        });
        process.stdout.write(' ❌ Failed');
      }
    }

    saveFailures(failures);
    console.log('\n\n✅ ALL DONE. Your Vault is up to date.');
    console.log('📊 Run Summary:');
    console.log(`   Scanned heroes : ${runStats.scannedHeroes}`);
    console.log(`   Updated files  : ${runStats.updated}`);
    console.log(`   Skipped files  : ${runStats.skipped}`);
    console.log(`   Failed updates : ${runStats.failed}`);
  } catch (error) {
    console.error(`❌ Maintenance updater crashed: ${error.message}`);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();