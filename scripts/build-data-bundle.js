#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Builds feh-data-bundle.zip — a lightweight data bundle for the Electron launcher.
 *
 * Includes:  index.json, units/, unit_assets/fandom/headshots/,
 *            unit_assets/fandom/shared/, unit_assets_manifest/, quotes/
 * Excludes:  unit_assets/fandom/fullbody/  (1.7 GB — served via Fandom CDN instead)
 *            unit_assets/fandom/unit_backgrounds/
 *            unit_assets/fandom/Aether_Resort/
 *
 * Output: feh-data-bundle.zip at project root (~15 MB compressed)
 */

const fs  = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT       = path.resolve(__dirname, "..");
const DB_ROOT    = path.join(ROOT, "db");
const STAGE_ROOT = path.join(ROOT, "release_local", "data_bundle");
const STAGE_DB   = path.join(STAGE_ROOT, "db");
const OUTPUT_ZIP = path.join(ROOT, "feh-data-bundle.zip");

// Flat entries copied from db/ directly
const FLAT_ENTRIES = [
  { name: "index.json",              required: true  },
  { name: "hero_aliases.json",       required: false },
  { name: "banner_pull_seed_urls.json", required: false },
];

// Directory entries copied in full
const DIR_ENTRIES = [
  { name: "units",                   required: true  },
  { name: "quotes",                  required: false },
  { name: "unit_assets_manifest",    required: false },
];

// Specific subdirectories under unit_assets/fandom/ to include
const FANDOM_SUBDIRS = [
  "headshots",
  "shared",
];

function exists(p) { return fs.existsSync(p); }

async function cleanDir(dir) {
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(dir, { recursive: true });
}

async function copyEntry(src, dst, required) {
  if (!exists(src)) {
    if (required) throw new Error(`Missing required entry: ${src}`);
    console.log(`Skipping (not found): ${path.relative(ROOT, src)}`);
    return;
  }
  await fsp.cp(src, dst, { recursive: true, force: true });
  console.log(`Included: ${path.relative(ROOT, src)}`);
}

function zipWithPowerShell(inputDir, outputZip) {
  // Compress-Archive with the directory itself so ZIP root contains db/
  const cmd = [
    "Compress-Archive",
    `-Path '${inputDir.replace(/'/g, "''")}'`,
    `-DestinationPath '${outputZip.replace(/'/g, "''")}'`,
    "-Force",
  ].join(" ");

  const pwsh = fs.existsSync("C:/Program Files/PowerShell/7/pwsh.exe")
    ? "C:/Program Files/PowerShell/7/pwsh.exe"
    : "powershell.exe";

  const result = spawnSync(pwsh, ["-NoProfile", "-Command", cmd], { stdio: "inherit" });
  if (result.status !== 0) throw new Error("Compress-Archive failed");
}

async function main() {
  if (!exists(DB_ROOT)) throw new Error("db/ folder not found at project root");

  console.log("=== Building feh-data-bundle.zip ===\n");
  await cleanDir(STAGE_DB);

  // Flat files
  for (const { name, required } of FLAT_ENTRIES) {
    await copyEntry(path.join(DB_ROOT, name), path.join(STAGE_DB, name), required);
  }

  // Full directories
  for (const { name, required } of DIR_ENTRIES) {
    await copyEntry(path.join(DB_ROOT, name), path.join(STAGE_DB, name), required);
  }

  // Selected fandom subdirs only (no fullbody)
  const fandomDst = path.join(STAGE_DB, "unit_assets", "fandom");
  await fsp.mkdir(fandomDst, { recursive: true });
  for (const sub of FANDOM_SUBDIRS) {
    const src = path.join(DB_ROOT, "unit_assets", "fandom", sub);
    await copyEntry(src, path.join(fandomDst, sub), false);
  }

  if (exists(OUTPUT_ZIP)) await fsp.rm(OUTPUT_ZIP, { force: true });

  console.log("\nZipping…");
  zipWithPowerShell(STAGE_DB, OUTPUT_ZIP);

  const size = fs.statSync(OUTPUT_ZIP).size;
  console.log(`\nCreated: feh-data-bundle.zip  (${(size / 1024 / 1024).toFixed(1)} MB)`);
  console.log("Run `npm run release:data-bundle` to upload to the latest GitHub release.");
}

main().catch((err) => {
  console.error("\nError:", err.message);
  process.exit(1);
});
