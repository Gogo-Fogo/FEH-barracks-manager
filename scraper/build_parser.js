const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const UNITS_FOLDER = path.join(__dirname, '../db/units');
const FAILED_FILE = path.join(__dirname, '../db/failed_build_parser_units.json');

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1200;
const BETWEEN_UNITS_DELAY_MS = 900;

const ONLY_FILE_ARG = process.argv.find((arg) => arg.startsWith('--only='));
const ONLY_FILE = ONLY_FILE_ARG ? ONLY_FILE_ARG.replace('--only=', '').trim() : null;
const REQUIRED_BUILD_KEYS = ['weapon', 'assist', 'special', 'emblem', 'passive_a', 'passive_b', 'passive_c', 'sacred_seal', 'attuned'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function dismissMembershipModal(page) {
  await page.evaluate(() => {
    const guestButton = document.querySelector('.js-continue-as-guest');
    if (guestButton) {
      guestButton.click();
    }
  });

  await sleep(900);
}

function normalizeRawText(text) {
  if (!text || typeof text !== 'string') return '';

  const cutMarkers = [
    'Please participate in our site improvement survey',
    'Popular Games',
    'Recommended Games',
    'Terms of Use',
    'Game8 - Your Go-To Platform For All Game Walkthroughs and Strategy Guides',
  ];

  let cleaned = text;
  for (const marker of cutMarkers) {
    const idx = cleaned.indexOf(marker);
    if (idx > 0) {
      cleaned = cleaned.slice(0, idx);
      break;
    }
  }

  return cleaned.replace(/\s\s+/g, ' ').trim();
}

function normalizeRecommendedBuild(build = {}) {
  const normalized = {};
  for (const key of REQUIRED_BUILD_KEYS) {
    const value = build[key];
    normalized[key] = (typeof value === 'string' && value.trim()) ? value.trim() : '-';
  }
  return normalized;
}

function deriveIvsFromRawText(rawText = '') {
  if (!rawText) return null;

  const sentenceMatch = rawText.match(/best IVs[^.]*?are\s*([+\-][A-Za-z]+)\s*(?:and|\/)\s*([+\-][A-Za-z]+)/i);
  if (sentenceMatch) {
    return `${sentenceMatch[1]} / ${sentenceMatch[2]}`;
  }

  const compactMatch = rawText.match(/([+\-][A-Za-z]{3,5})\s*\/\s*([+\-][A-Za-z]{3,5})/);
  if (compactMatch) {
    return `${compactMatch[1]} / ${compactMatch[2]}`;
  }

  return null;
}

function needsEnrichment(data) {
  if (!data || typeof data !== 'object') return true;

  const hasRaw = typeof data.raw_text_data === 'string' && data.raw_text_data.trim().length > 500;
  const hasIvs = typeof data.ivs === 'string' && data.ivs.trim().length > 10;
  const build = data.recommended_build && typeof data.recommended_build === 'object' ? data.recommended_build : null;
  const hasBuild = !!build && REQUIRED_BUILD_KEYS.every((key) => typeof build[key] === 'string' && build[key].trim().length > 0);

  return !(hasRaw && hasBuild && hasIvs);
}

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
    let files = fs.readdirSync(UNITS_FOLDER).filter((f) => f.endsWith('.json'));

    if (ONLY_FILE) {
      files = files.filter((f) => f.toLowerCase() === ONLY_FILE.toLowerCase());
      if (files.length === 0) {
        console.log(`⚠️ No unit file matched --only=${ONLY_FILE}`);
        return;
      }
      console.log(`🎯 [RESEARCHER] Focus mode enabled for: ${files[0]}`);
    }

    runStats.totalFiles = files.length;

    const targets = [];

    for (const file of files) {
      const filePath = path.join(UNITS_FOLDER, file);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (needsEnrichment(data)) {
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
          await dismissMembershipModal(page);

          return page.evaluate(() => {
            const results = {};

            // 1. RAW TEXT (Knowledge for AI)
            const body =
              document.querySelector('.archive-style-wrapper') ||
              document.querySelector('.p-entry__body') ||
              document.querySelector('.l-mainContents') ||
              document.querySelector('.p-archiveContent__main') ||
              document.querySelector('.p-archiveBody__main');

            if (body) {
              const clone = body.cloneNode(true);
              clone.querySelectorAll([
                'script',
                'style',
                'noscript',
                '.a-arnArea',
                '.p-entry__footer',
                '.p-archiveContent__side',
                '.l-footerGame',
                '.survey_modal',
                '.p-membershipModal__container',
                '.p-membershipModal__backdrop',
                '.p-membershipModal__content',
                '.p-membershipModal__scrollContainer',
                '.p-rootHeaderContainer',
                '.l-footer',
                '.l-footerGame',
                '.p-breadcrumb',
                '.a-simpleHeader',
                '.p-recommendedWiki',
                '.p-popularRanking',
                '.p-gamingNews',
                '.p-archiveHeader__share',
              ].join(',')).forEach((s) => s.remove());

              results.raw_text_data = clone.innerText;
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
                  emblem: '-',
                  passive_a: getSkill(table, ['Passive Skill A']),
                  passive_b: getSkill(table, ['Passive Skill B']),
                  passive_c: getSkill(table, ['Passive Skill C']),
                  sacred_seal: getSkill(table, ['Sacred Seal']),
                  attuned: '-',
                };
              }
            }

            document.querySelectorAll('table').forEach((t) => {
              if (t.innerText.includes('Asset')) results.ivs = t.innerText.trim();
            });

            if (!results.ivs) {
              const ivHeading = Array.from(document.querySelectorAll('h2, h3')).find((h) => /Best\s*IVs/i.test(h.innerText));
              if (ivHeading) {
                let sectionText = '';
                let n = ivHeading.nextElementSibling;
                while (n && !/^H[23]$/.test(n.tagName)) {
                  sectionText += ` ${n.innerText || ''}`;
                  n = n.nextElementSibling;
                }

                sectionText = sectionText.replace(/\s\s+/g, ' ').trim();
                if (sectionText.length > 0) {
                  results.ivs = sectionText.slice(0, 2000);
                }
              }
            }

            return results;
          });
        }, `Build parser scrape ${hero.name}`);

        details.raw_text_data = normalizeRawText(details.raw_text_data);
        details.recommended_build = normalizeRecommendedBuild(details.recommended_build);

        const hasRawText = typeof details.raw_text_data === 'string' && details.raw_text_data.length > 500;
        const hasBuild = REQUIRED_BUILD_KEYS.every((key) => typeof details.recommended_build[key] === 'string' && details.recommended_build[key].trim().length > 0);
        const hasIvs = typeof details.ivs === 'string' && details.ivs.trim().length > 3;

        if (!hasRawText) {
          throw new Error('Missing or too-short raw_text_data after scrape');
        }

        if (!hasBuild) {
          throw new Error('Missing recommended_build after scrape');
        }

        if (!hasIvs) {
          const derivedIvs = deriveIvsFromRawText(details.raw_text_data);
          details.ivs = derivedIvs || '-';
          console.log(`   ⚠️ IVs not found in table for ${hero.name}; using ${details.ivs === '-' ? 'placeholder' : 'derived value'} (${details.ivs}).`);
        }

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