#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const DB_ROOT = path.join(ROOT, "db");
const STAGE_ROOT = path.join(ROOT, "release_local", "assets");
const STAGE_DB = path.join(STAGE_ROOT, "db");
const OUTPUT_ZIP = path.join(ROOT, "feh-assets-full-bundle.zip");

const REQUIRED_ENTRIES = [
  "index.json",
  "units",
  "unit_assets",
  "unit_assets_manifest",
  "quotes",
];

const OPTIONAL_ENTRIES = ["banner_pull_seed_urls.json", "banner_pull_guides.json"];

function exists(p) {
  return fs.existsSync(p);
}

async function cleanDir(dir) {
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(dir, { recursive: true });
}

async function copyEntry(name, required) {
  const src = path.join(DB_ROOT, name);
  const dst = path.join(STAGE_DB, name);

  if (!exists(src)) {
    if (required) {
      throw new Error(`Missing required db entry: ${name}`);
    }
    console.log(`Skipping optional missing entry: db/${name}`);
    return;
  }

  await fsp.cp(src, dst, { recursive: true, force: true });
  console.log(`Included: db/${name}`);
}

function zipWithPowerShell(inputDir, outputZip) {
  const command = `Compress-Archive -Path '${inputDir.replace(/'/g, "''")}' -DestinationPath '${outputZip.replace(/'/g, "''")}' -Force`;

  const result = spawnSync(
    "C:/Program Files/PowerShell/7/pwsh.exe",
    ["-NoProfile", "-Command", command],
    { stdio: "inherit" }
  );

  if (result.status !== 0) {
    throw new Error("Failed to create zip via PowerShell Compress-Archive");
  }
}

async function main() {
  if (!exists(DB_ROOT)) {
    throw new Error("db folder not found");
  }

  await cleanDir(STAGE_DB);

  for (const name of REQUIRED_ENTRIES) {
    await copyEntry(name, true);
  }

  for (const name of OPTIONAL_ENTRIES) {
    await copyEntry(name, false);
  }

  if (exists(OUTPUT_ZIP)) {
    await fsp.rm(OUTPUT_ZIP, { force: true });
  }

  zipWithPowerShell(path.join(STAGE_ROOT, "db"), OUTPUT_ZIP);
  console.log(`\nCreated: ${OUTPUT_ZIP}`);
  console.log("Run `npm run release:assets` to upload to the latest GitHub release.");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
