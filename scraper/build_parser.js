const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const UNITS_FOLDER = path.join(__dirname, '../db/units');
const FAILED_FILE = path.join(__dirname, '../db/failed_build_parser_units.json');

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1200;
const BETWEEN_UNITS_DELAY_MS = 900;

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
    console.log('🧹 Cleared previous build-parser failure log (no failures this run).');
  }
}

(async () => {
  let browser;
  const failures = [];
  const runStats = {
    totalFiles: 0,
    targets: 0,
    success: 0,
    failed: 0,
    invalidJsonSkipped: 0,
  };

  try {
    const files = fs.readdirSync(UNITS_FOLDER).filter((f) => f.endsWith('.json'));
    runStats.totalFiles = files.length;

    const targets = [];

    for (const file of files) {
      const filePath = path.join(UNITS_FOLDER, file);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (!data.raw_text_data || !data.recommended_build) {
          targets.push(file);
        }
      } catch (error) {
        runStats.invalidJsonSkipped += 1;
        failures.push({
          file,
          filePath,
          name: null,
          url: null,
          error: `Invalid JSON during target scan: ${error.message}`,
          timestamp: new Date().toISOString(),
        });
      }
    }

    runStats.targets = targets.length;

    if (targets.length === 0) {
      console.log('✨ All unit files are already fully enriched.');
      saveFailures(failures);
      return;
    }

    console.log(`🔬 [RESEARCHER] Found ${targets.length} units needing deep scrapes...`);
    browser = await puppeteer.launch({
      headless: false,
      protocolTimeout: 180000,
      args: ['--start-maximized'],
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    for (let i = 0; i < targets.length; i++) {
      const filePath = path.join(UNITS_FOLDER, targets[i]);
      let hero;

      try {
        hero = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (error) {
        runStats.failed += 1;
        failures.push({
          file: targets[i],
          filePath,
          name: null,
          url: null,
          error: `Invalid JSON before scrape: ${error.message}`,
          timestamp: new Date().toISOString(),
        });
        console.log(`[${i + 1}/${targets.length}] ❌ Skipping invalid JSON file: ${targets[i]}`);
        continue;
      }

      try {
        console.log(`[${i + 1}/${targets.length}] Scraping Knowledge: ${hero.name}`);

        const details = await retryWithBackoff(async () => {
          await page.goto(hero.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

          return page.evaluate(() => {
            const results = {};

            // 1. RAW TEXT (Knowledge for AI)
            const body = document.querySelector('.p-entry__body') || document.querySelector('.l-mainContents');
            if (body) {
              const clone = body.cloneNode(true);
              clone.querySelectorAll('script, style, .a-arnArea, .p-entry__footer').forEach((s) => s.remove());
              results.raw_text_data = clone.innerText.replace(/\s\s+/g, ' ').trim();
            }

            // 2. STRUCTURED BUILD (Structured Skills)
            const getSkill = (context, keywords) => {
              const img = Array.from(context.querySelectorAll('img')).find((i) => keywords.some((kw) => i.getAttribute('alt')?.includes(kw)));
              if (img) {
                const parent = img.parentElement;
                const link = parent.querySelector('a');
                return link ? link.textContent.trim() : parent.textContent.split('：')[1]?.trim() || '-';
              }
              return '-';
            };

            const buildH = Array.from(document.querySelectorAll('h2, h3')).find((h) => h.innerText.includes('Build'));
            if (buildH) {
              let table = buildH.nextElementSibling;
              while (table && table.tagName !== 'TABLE') table = table.nextElementSibling;
              if (table) {
                results.recommended_build = {
                  weapon: getSkill(table, ['Weapon Skill']),
                  assist: getSkill(table, ['Assist Skill']),
                  special: getSkill(table, ['Special Skill']),
                  passive_a: getSkill(table, ['Passive Skill A']),
                  passive_b: getSkill(table, ['Passive Skill B']),
                  passive_c: getSkill(table, ['Passive Skill C']),
                  sacred_seal: getSkill(table, ['Sacred Seal']),
                };
              }
            }

            document.querySelectorAll('table').forEach((t) => {
              if (t.innerText.includes('Asset')) results.ivs = t.innerText.trim();
            });

            return results;
          });
        }, `Build parser scrape ${hero.name}`);

        fs.writeFileSync(filePath, JSON.stringify({ ...hero, ...details }, null, 2));
        runStats.success += 1;
        process.stdout.write('   ✅ Success\n');

        await sleep(BETWEEN_UNITS_DELAY_MS);
      } catch (error) {
        runStats.failed += 1;
        failures.push({
          file: targets[i],
          filePath,
          name: hero?.name || null,
          url: hero?.url || null,
          error: error.message,
          timestamp: new Date().toISOString(),
        });
        console.log(`   ❌ Failed: ${error.message}`);
      }
    }

    saveFailures(failures);
    console.log('\n✅ RESEARCH COMPLETE.');
    console.log('📊 Run Summary:');
    console.log(`   Total unit files      : ${runStats.totalFiles}`);
    console.log(`   Targets this run      : ${runStats.targets}`);
    console.log(`   Successful enrichments: ${runStats.success}`);
    console.log(`   Failed enrichments    : ${runStats.failed}`);
    console.log(`   Invalid JSON skipped  : ${runStats.invalidJsonSkipped}`);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();