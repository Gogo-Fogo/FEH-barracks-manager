const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const DB_FOLDER = path.join(__dirname, '../db');
const INDEX_FILE = path.join(DB_FOLDER, 'index.json');
const UNITS_FOLDER = path.join(DB_FOLDER, 'units');
const ASSETS_ROOT = path.join(DB_FOLDER, 'unit_assets');

const DEFAULT_COUNT = 10;
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1200;

const COUNT_ARG = process.argv.find((arg) => arg.startsWith('--count='));
const ONLY_ARG = process.argv.find((arg) => arg.startsWith('--only='));

const TARGET_COUNT = COUNT_ARG ? Number(COUNT_ARG.replace('--count=', '')) : DEFAULT_COUNT;
const ONLY_SLUGS = ONLY_ARG
  ? ONLY_ARG
      .replace('--only=', '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  : null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (!fs.existsSync(ASSETS_ROOT)) fs.mkdirSync(ASSETS_ROOT, { recursive: true });

function safeSlug(name) {
  return name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

async function retryWithBackoff(operation, label) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const waitMs = BASE_RETRY_DELAY_MS * (2 ** (attempt - 1));
      const isLastAttempt = attempt === MAX_RETRIES;

      console.log(`   ⚠️ ${label} failed (attempt ${attempt}/${MAX_RETRIES}): ${error.message}`);
      if (!isLastAttempt) {
        await sleep(waitMs);
      }
    }
  }

  throw lastError;
}

async function dismissMembershipModal(page) {
  await page.evaluate(() => {
    const guestButton = document.querySelector('.js-continue-as-guest');
    if (guestButton) guestButton.click();
  });
  await sleep(900);
}

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https://') ? https : http;

    const req = lib.get(
      url,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Referer: 'https://game8.co/',
        },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const next = new URL(res.headers.location, url).toString();
          res.resume();
          return resolve(fetchBuffer(next));
        }

        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }

        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            buffer: Buffer.concat(chunks),
            contentType: res.headers['content-type'] || 'application/octet-stream',
          });
        });
      }
    );

    req.on('error', reject);
  });
}

function extFromContentType(contentType) {
  if (contentType.includes('image/png')) return '.png';
  if (contentType.includes('image/webp')) return '.webp';
  if (contentType.includes('image/jpeg')) return '.jpg';
  return '.bin';
}

function cleanAssetFolder(folderPath) {
  if (!fs.existsSync(folderPath)) return;
  for (const file of fs.readdirSync(folderPath)) {
    const fp = path.join(folderPath, file);
    if (fs.statSync(fp).isFile()) fs.unlinkSync(fp);
  }
}

(async () => {
  const indexData = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));

  let targets = indexData;
  if (ONLY_SLUGS && ONLY_SLUGS.length > 0) {
    targets = indexData.filter((hero) => ONLY_SLUGS.includes(safeSlug(hero.name)));
  } else {
    targets = indexData.slice(0, TARGET_COUNT);
  }

  if (targets.length === 0) {
    console.log('No targets found for art scraping.');
    return;
  }

  console.log(`🖼️ Art asset pilot run for ${targets.length} unit(s)...`);

  const browser = await puppeteer.launch({
    headless: false,
    protocolTimeout: 180000,
    args: ['--start-maximized'],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    for (const [i, hero] of targets.entries()) {
      const slug = safeSlug(hero.name);
      const unitJsonPath = path.join(UNITS_FOLDER, `${slug}.json`);
      const unitAssetFolder = path.join(ASSETS_ROOT, slug);
      fs.mkdirSync(unitAssetFolder, { recursive: true });
      cleanAssetFolder(unitAssetFolder);

      console.log(`\n[${i + 1}/${targets.length}] ${hero.name}`);

      const artData = await retryWithBackoff(async () => {
        await page.goto(hero.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await dismissMembershipModal(page);

        return page.evaluate(() => {
          const toAbsolute = (src) => {
            try {
              return new URL(src, window.location.href).toString();
            } catch {
              return null;
            }
          };

          const normalize = (u) => (u || '').replace(/\?.*$/, '');

          const urls = [];
          const push = (type, src) => {
            const abs = toAbsolute(src);
            if (!abs) return;
            if (!abs.includes('img.game8.co')) return;
            if (!/\.(png|jpg|jpeg|webp)\/show$/i.test(normalize(abs))) return;
            urls.push({ type, url: abs });
          };

          const srcOf = (img) => img.getAttribute('data-src') || img.getAttribute('src') || '';

          // Top banner art (canonical)
          const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content');
          const ogImageAbs = ogImage ? toAbsolute(ogImage) : null;
          push('banner', ogImage);

          // Additional banner-like images near the top of article
          document.querySelectorAll('.archive-style-wrapper img').forEach((img) => {
            const src = srcOf(img);
            if (!src) return;

            const alt = (img.getAttribute('alt') || '').toLowerCase();
            const w = Number(img.naturalWidth || img.width || 0);
            if (alt.includes('icon')) return;
            if (!alt.includes('banner')) return;

            const abs = toAbsolute(src);
            const isPrimaryBanner = !!ogImageAbs && !!abs && normalize(abs) === normalize(ogImageAbs);

            if (isPrimaryBanner || w >= 500) {
              push('banner', src);
            } else {
              push('mini_banner', src);
            }
          });

          // Character illustration gallery (typically 4 arts)
          document.querySelectorAll('.imageLink.js-archive-open-image-modal img').forEach((img) => {
            const src = srcOf(img);
            const alt = img.getAttribute('alt') || '';
            const w = Number(img.naturalWidth || img.width || 0);
            if (/\.png$/i.test(alt) || w >= 120) {
              push('illustration', src);
            }
          });

          const dedup = [];
          const seen = new Set();
          for (const item of urls) {
            const key = item.url.replace(/\?.*$/, '');
            if (seen.has(key)) continue;
            seen.add(key);
            dedup.push(item);
          }

          return dedup;
        });
      }, `Open/scrape art URLs for ${hero.name}`);

      const downloaded = [];
      const typeCounters = {};
      for (let idx = 0; idx < artData.length; idx++) {
        const item = artData[idx];

        try {
          const { buffer, contentType } = await retryWithBackoff(
            () => fetchBuffer(item.url),
            `Download art ${idx + 1} for ${hero.name}`
          );

          const ext = extFromContentType(contentType);
          typeCounters[item.type] = (typeCounters[item.type] || 0) + 1;
          const typeIndex = String(typeCounters[item.type]).padStart(2, '0');
          const filename = `${slug}_${item.type}_${typeIndex}${ext}`;
          const filePath = path.join(unitAssetFolder, filename);
          fs.writeFileSync(filePath, buffer);

          downloaded.push({
            type: item.type,
            url: item.url,
            local_path: path.relative(DB_FOLDER, filePath).replace(/\\/g, '/'),
          });
        } catch (error) {
          console.log(`   ❌ Failed asset ${idx + 1}: ${error.message}`);
        }
      }

      let unitJson = {};
      if (fs.existsSync(unitJsonPath)) {
        try {
          unitJson = JSON.parse(fs.readFileSync(unitJsonPath, 'utf8'));
        } catch {
          unitJson = {};
        }
      }

      unitJson.art_assets = {
        updated_at: new Date().toISOString(),
        total: downloaded.length,
        items: downloaded,
      };

      fs.writeFileSync(unitJsonPath, JSON.stringify(unitJson, null, 2));
      console.log(`   ✅ Saved ${downloaded.length} asset(s) -> db/unit_assets/${slug}`);
      await sleep(600);
    }

    console.log('\n✅ Art asset pilot run complete.');
  } finally {
    await browser.close();
  }
})();
