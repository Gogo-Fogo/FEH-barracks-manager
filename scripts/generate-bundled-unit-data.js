#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const UNITS_DIR = path.join(ROOT, "db", "units");
const INDEX_FILE = path.join(ROOT, "db", "index.json");
const OUT_FILE = path.join(ROOT, "app", "src", "lib", "bundled-unit-data.json");
const DEFAULT_MAX_INDEX_ROWS = 160;
const BUILD_KEYS = [
  "weapon",
  "assist",
  "special",
  "emblem",
  "passive_a",
  "passive_b",
  "passive_c",
  "sacred_seal",
  "attuned",
];

function normalizeBuild(build) {
  const out = {};
  for (const key of BUILD_KEYS) {
    const value = String(build?.[key] || "").trim();
    out[key] = value || "-";
  }
  return out;
}

function toSlug(name) {
  return String(name || "").replace(/[^a-z0-9]/gi, "_").toLowerCase();
}

function normalizeArtistText(raw) {
  return String(raw || "")
    .replace(/\s+/g, " ")
    .replace(/\s([,.!?;:])/g, "$1")
    .trim();
}

function cleanArtistCandidate(value) {
  let candidate = String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^[\s:：\-–—|]+/, "")
    .trim();

  candidate = candidate
    .replace(
      /\s+(Appears In|Illustration|How to Get|Voice Actor(?:\s*\(English\))?|Quotes?|FEH:|Related Guides|Attire|Distribution Date|Starts|Ends|Obtain(?:ed)? Through)\b[\s\S]*$/i,
      ""
    )
    .replace(/[,;!?…]+$/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!candidate) return null;
  if (candidate.length > 100) return null;
  if (/^(none|unknown|n\/?a|information)$/i.test(candidate)) return null;
  return candidate;
}

function extractArtist(rawText) {
  const compact = normalizeArtistText(rawText);
  if (!compact) return null;

  const markers =
    "Appears In|Illustration|FEH:|Related Guides|How to Get|Voice Actor(?:\\s*\\(English\\))?|Quotes?|Attire|Distribution Date|Starts|Ends|Obtain(?:ed)? Through";

  const patterns = [
    new RegExp(
      `Voice Actor(?:\\s*\\(English\\))?\\s+.{1,120}?\\s+Illustrator\\s*[:：\\-]?\\s*(.{1,140}?)(?=\\s+(?:${markers})|$)`,
      "gi"
    ),
    new RegExp(
      `Illustrator\\s*[:：\\-]?\\s*(.{1,160}?)(?=\\s+(?:${markers})|$)`,
      "gi"
    ),
  ];

  const candidates = [];
  for (const pattern of patterns) {
    for (const match of compact.matchAll(pattern)) {
      const captured = String(match?.[1] || "");
      if (captured) candidates.push(captured);
    }
  }

  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const cleaned = cleanArtistCandidate(candidates[i]);
    if (cleaned) return cleaned;
  }

  return null;
}

function parseArgs(argv) {
  const args = Array.from(argv || []);
  const includeAll = args.includes("--all");
  const maxArg = args.find((value) => /^--max=\d+$/i.test(value));
  const maxRows = includeAll
    ? Number.POSITIVE_INFINITY
    : maxArg
    ? Number.parseInt(maxArg.split("=")[1], 10)
    : DEFAULT_MAX_INDEX_ROWS;

  return {
    includeAll,
    maxRows: Number.isFinite(maxRows) && maxRows > 0 ? maxRows : DEFAULT_MAX_INDEX_ROWS,
  };
}

async function loadPrioritySlugs(maxRows) {
  if (!fs.existsSync(INDEX_FILE)) {
    return null;
  }

  try {
    const raw = await fsp.readFile(INDEX_FILE, "utf8");
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows) || !rows.length) {
      return null;
    }

    const selectedRows = rows.slice(0, maxRows);
    const slugs = new Set();

    for (const row of selectedRows) {
      const slug = String(row?.hero_slug || "").trim() || toSlug(row?.name);
      if (slug) slugs.add(slug);
    }

    return slugs.size ? slugs : null;
  } catch {
    return null;
  }
}

async function main() {
  if (!fs.existsSync(UNITS_DIR)) {
    console.error(`db/units/ not found at: ${UNITS_DIR}`);
    process.exit(1);
  }

  const { includeAll, maxRows } = parseArgs(process.argv.slice(2));
  const prioritySlugs = includeAll ? null : await loadPrioritySlugs(maxRows);

  const entries = await fsp.readdir(UNITS_DIR, { withFileTypes: true });
  const unitFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const bundled = {};
  let written = 0;
  let skipped = 0;

  for (const fileName of unitFiles) {
    const slug = fileName.replace(/\.json$/i, "");
    if (prioritySlugs && !prioritySlugs.has(slug)) {
      skipped += 1;
      continue;
    }

    try {
      const raw = await fsp.readFile(path.join(UNITS_DIR, fileName), "utf8");
      const unit = JSON.parse(raw);
      const name = String(unit?.name || "").trim();
      const url = String(unit?.url || "").trim();
      const ivs = String(unit?.ivs || "").trim();
      const rawText = String(unit?.raw_text_data || "").trim();
      const artist = extractArtist(rawText);
      const recommendedBuild = normalizeBuild(unit?.recommended_build || {});

      const hasBuildValue = Object.values(recommendedBuild).some((value) => value && value !== "-");
      if (!name && !url && !ivs && !rawText && !hasBuildValue) {
        skipped += 1;
        continue;
      }

      bundled[slug] = {
        name: name || undefined,
        url: url || undefined,
        ivs: ivs || undefined,
        artist: artist || undefined,
        raw_text_data: rawText || undefined,
        recommended_build: recommendedBuild,
      };
      written += 1;
    } catch {
      skipped += 1;
    }
  }

  await fsp.writeFile(OUT_FILE, `${JSON.stringify(bundled, null, 2)}\n`, "utf8");
  console.log(`Done. ${written} entries written to app/src/lib/bundled-unit-data.json`);
  console.log(`      ${skipped} units skipped.`);
  if (prioritySlugs) {
    console.log(`      Bundled the latest ${Math.min(prioritySlugs.size, maxRows)} indexed heroes.`);
  } else {
    console.log("      Bundled all available unit files.");
  }
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
