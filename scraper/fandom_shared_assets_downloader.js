const fs = require('fs');
const path = require('path');
const https = require('https');

const DB_ROOT = path.join(__dirname, '../db');
const ASSET_ROOT = path.join(DB_ROOT, 'unit_assets/fandom/shared');
const MANIFEST_DIR = path.join(__dirname, '../db/unit_assets_manifest');
const MANIFEST_PATH = path.join(MANIFEST_DIR, 'shared_icons.json');

const PREFIX_CONFIG = [
  { prefix: 'Icon_Move_', bucket: 'move' },
  { prefix: 'Icon_Rarity_', bucket: 'rarity' },
  { prefix: 'Icon_Class_', bucket: 'weapon_type' },
];

const PAGE_IMAGE_CONFIG = [
  {
    page: 'Unit_backgrounds',
    bucket: 'unit_backgrounds',
    include: /^(BG|Bg)_DetailedStatus(?:_[A-Za-z0-9]+)*(?:_Reliance)?\.(png|webp|jpg|jpeg)$/i,
  },
];

function toDbRelativePath(absPath) {
  const rel = path.relative(DB_ROOT, absPath).replace(/\\/g, '/');
  return `db/${rel}`;
}

function clearDir(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  for (const entry of fs.readdirSync(dirPath)) {
    const full = path.join(dirPath, entry);
    const stat = fs.statSync(full);
    if (stat.isFile()) fs.unlinkSync(full);
  }
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

async function listAllImagesByPrefix(prefix) {
  let aicontinue = '';
  const names = [];

  while (true) {
    const url =
      'https://feheroes.fandom.com/api.php?action=query&format=json&list=allimages&ailimit=500' +
      `&aiprefix=${encodeURIComponent(prefix)}` +
      (aicontinue ? `&aicontinue=${encodeURIComponent(aicontinue)}` : '');

    const json = await apiGetJson(url);
    const rows = (json.query && json.query.allimages) || [];
    for (const row of rows) {
      if (row.name) names.push(row.name);
    }

    aicontinue = json.continue && json.continue.aicontinue ? json.continue.aicontinue : '';
    if (!aicontinue) break;
  }

  return names;
}

async function getImageInfo(title) {
  const url =
    'https://feheroes.fandom.com/api.php?action=query&format=json&prop=imageinfo&iiprop=url|size|mime&titles=' +
    encodeURIComponent(`File:${title}`);
  const json = await apiGetJson(url);
  const page = Object.values((json.query && json.query.pages) || {})[0] || {};
  return page.imageinfo && page.imageinfo[0] ? page.imageinfo[0] : null;
}

async function listPageImages(pageTitle) {
  const url =
    'https://feheroes.fandom.com/api.php?action=parse&format=json&prop=images&page=' +
    encodeURIComponent(pageTitle);
  const json = await apiGetJson(url);
  return (json.parse && json.parse.images) || [];
}

async function main() {
  fs.mkdirSync(ASSET_ROOT, { recursive: true });
  fs.mkdirSync(MANIFEST_DIR, { recursive: true });

  const manifest = {
    updated_at: new Date().toISOString(),
    source: 'fandom_mediawiki_api',
    items: [],
  };

  for (const cfg of PREFIX_CONFIG) {
    const bucketDir = path.join(ASSET_ROOT, cfg.bucket);
    fs.mkdirSync(bucketDir, { recursive: true });
    clearDir(bucketDir);

    const imageNames = await listAllImagesByPrefix(cfg.prefix);
    console.log(`\n${cfg.prefix} -> ${imageNames.length} file(s)`);

    for (const imageName of imageNames) {
      const info = await getImageInfo(imageName);
      if (!info || !info.url) continue;

      const safeName = imageName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const outPath = path.join(bucketDir, safeName);

      await downloadFile(info.url, outPath);
      manifest.items.push({
        source: 'fandom',
        source_kind: 'prefix',
        category: cfg.bucket,
        file_name: imageName,
        mime: info.mime,
        width: info.width,
        height: info.height,
        source_url: info.url,
        local_path: toDbRelativePath(outPath),
      });

      console.log(`  saved ${cfg.bucket}/${safeName}`);
    }
  }

  for (const cfg of PAGE_IMAGE_CONFIG) {
    const bucketDir = path.join(ASSET_ROOT, cfg.bucket);
    fs.mkdirSync(bucketDir, { recursive: true });
    clearDir(bucketDir);

    const pageImages = await listPageImages(cfg.page);
    const imageNames = pageImages.filter((name) => cfg.include.test(name));
    console.log(`\n${cfg.page} -> ${imageNames.length} filtered file(s)`);

    for (const imageName of imageNames) {
      const info = await getImageInfo(imageName);
      if (!info || !info.url) continue;

      const safeName = imageName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const outPath = path.join(bucketDir, safeName);

      await downloadFile(info.url, outPath);
      manifest.items.push({
        source: 'fandom',
        source_kind: 'page',
        source_page: cfg.page,
        category: cfg.bucket,
        file_name: imageName,
        mime: info.mime,
        width: info.width,
        height: info.height,
        source_url: info.url,
        local_path: toDbRelativePath(outPath),
      });

      console.log(`  saved ${cfg.bucket}/${safeName}`);
    }
  }

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`\nDONE shared assets=${manifest.items.length}`);
  console.log(`manifest ${MANIFEST_PATH.replace(/\\/g, '/')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
