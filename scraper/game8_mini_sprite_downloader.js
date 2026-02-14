const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const DB_ROOT = path.join(__dirname, "../db");
const INDEX_PATH = path.join(DB_ROOT, "index.json");
const OUTPUT_ROOT = path.join(DB_ROOT, "unit_assets", "game8", "mini_sprites");
const MANIFEST_DIR = path.join(DB_ROOT, "unit_assets_manifest", "game8");
const MANIFEST_PATH = path.join(MANIFEST_DIR, "mini_sprites_manifest.json");

const COUNT_ARG = process.argv.find((arg) => arg.startsWith("--count="));
const ONLY_ARG = process.argv.find((arg) => arg.startsWith("--only="));
const FORCE = process.argv.includes("--force");

const TARGET_COUNT = COUNT_ARG ? Number(COUNT_ARG.replace("--count=", "")) : Infinity;
const ONLY_LIST = ONLY_ARG
  ? ONLY_ARG
      .replace("--only=", "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  : null;

function safeSlug(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .toLowerCase()
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function extFromContentType(contentType) {
  const lower = String(contentType || "").toLowerCase();
  if (lower.includes("image/png")) return ".png";
  if (lower.includes("image/webp")) return ".webp";
  if (lower.includes("image/jpeg")) return ".jpg";
  if (lower.includes("image/gif")) return ".gif";
  return ".bin";
}

function extFromUrl(url) {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (pathname.endsWith(".png") || pathname.includes(".png/")) return ".png";
    if (pathname.endsWith(".webp") || pathname.includes(".webp/")) return ".webp";
    if (pathname.endsWith(".jpg") || pathname.includes(".jpg/")) return ".jpg";
    if (pathname.endsWith(".jpeg") || pathname.includes(".jpeg/")) return ".jpeg";
    if (pathname.endsWith(".gif") || pathname.includes(".gif/")) return ".gif";
  } catch {
    // ignore
  }
  return "";
}

function parseGame8AssetParts(url) {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\/(\d+)\/([a-f0-9]{16,64})\.(png|webp|jpe?g|gif)\//i);
    if (!match) return { numericId: "unknown", token: "asset" };
    return {
      numericId: match[1],
      token: match[2].slice(0, 12),
    };
  } catch {
    return { numericId: "unknown", token: "asset" };
  }
}

function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https://") ? https : http;

    const req = lib.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Referer: "https://game8.co/",
          Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirected = new URL(res.headers.location, url).toString();
          res.resume();
          return resolve(downloadBuffer(redirected));
        }

        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }

        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            buffer: Buffer.concat(chunks),
            contentType: res.headers["content-type"] || "application/octet-stream",
          });
        });
      }
    );

    req.on("error", reject);
  });
}

function toFilterKey(value) {
  return safeSlug(value).replace(/___/g, "_");
}

async function main() {
  if (!fs.existsSync(INDEX_PATH)) {
    throw new Error(`Missing index file: ${INDEX_PATH}`);
  }

  ensureDir(OUTPUT_ROOT);
  ensureDir(MANIFEST_DIR);

  const indexRows = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
  const filterSet = ONLY_LIST ? new Set(ONLY_LIST.map(toFilterKey)) : null;

  let selected = indexRows.filter((row) => typeof row?.img_url === "string" && row.img_url.includes("img.game8.co"));

  if (filterSet) {
    selected = selected.filter((row) => {
      const nameKey = toFilterKey(row.name || "");
      const slugKey = toFilterKey(row.slug || row.game8_slug || "");
      return filterSet.has(nameKey) || (slugKey && filterSet.has(slugKey));
    });
  }

  if (Number.isFinite(TARGET_COUNT)) {
    selected = selected.slice(0, Math.max(0, TARGET_COUNT));
  }

  if (!selected.length) {
    console.log("No matching Game8 img_url entries found.");
    return;
  }

  const manifest = {
    source: "game8",
    type: "mini_sprites",
    generated_at: new Date().toISOString(),
    total: selected.length,
    items: [],
    failed: [],
  };

  console.log(`Downloading ${selected.length} Game8 mini sprite(s)...`);

  for (const [index, row] of selected.entries()) {
    const heroName = row.name || `hero_${index + 1}`;
    const slug = safeSlug(row.slug || row.game8_slug || heroName);
    const { numericId, token } = parseGame8AssetParts(row.img_url);

    let ext = extFromUrl(row.img_url);
    const filenameBase = `game8_${slug}_mini_${numericId}_${token}`;

    const existing = fs
      .readdirSync(OUTPUT_ROOT)
      .find((file) => file.startsWith(filenameBase + ".") || file === filenameBase);

    if (existing && !FORCE) {
      const localPath = path.join(OUTPUT_ROOT, existing);
      manifest.items.push({
        name: heroName,
        slug,
        img_url: row.img_url,
        local_path: path.relative(DB_ROOT, localPath).replace(/\\/g, "/"),
        skipped_existing: true,
      });
      console.log(`[${index + 1}/${selected.length}] ↷ ${heroName} (exists)`);
      continue;
    }

    try {
      const { buffer, contentType } = await downloadBuffer(row.img_url);
      if (!ext) ext = extFromContentType(contentType);
      const finalName = `${filenameBase}${ext || ".bin"}`;
      const finalPath = path.join(OUTPUT_ROOT, finalName);

      fs.writeFileSync(finalPath, buffer);

      manifest.items.push({
        name: heroName,
        slug,
        img_url: row.img_url,
        content_type: contentType,
        local_path: path.relative(DB_ROOT, finalPath).replace(/\\/g, "/"),
      });

      console.log(`[${index + 1}/${selected.length}] ✓ ${heroName}`);
    } catch (error) {
      manifest.failed.push({
        name: heroName,
        slug,
        img_url: row.img_url,
        error: error.message,
      });
      console.log(`[${index + 1}/${selected.length}] ✗ ${heroName}: ${error.message}`);
    }
  }

  manifest.generated_at = new Date().toISOString();
  manifest.downloaded = manifest.items.filter((item) => !item.skipped_existing).length;
  manifest.skipped_existing = manifest.items.filter((item) => item.skipped_existing).length;
  manifest.failed_total = manifest.failed.length;

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

  console.log("\nDone.");
  console.log(`Downloaded: ${manifest.downloaded}`);
  console.log(`Skipped existing: ${manifest.skipped_existing}`);
  console.log(`Failed: ${manifest.failed_total}`);
  console.log(`Manifest: ${path.relative(process.cwd(), MANIFEST_PATH)}`);
}

main().catch((error) => {
  console.error("Fatal error:", error.message);
  process.exit(1);
});
