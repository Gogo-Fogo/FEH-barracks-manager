#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Builds FEH-Barracks-Launcher.exe (portable, x64) and uploads it
 * to the latest GitHub release, replacing any previous copy (--clobber).
 *
 * Requires gh CLI: https://cli.github.com/
 *   winget install GitHub.cli   (first-time setup)
 *   gh auth login               (first-time auth)
 */
const path = require("node:path");
const fs   = require("node:fs");
const { spawnSync } = require("node:child_process");
const os   = require("node:os");

const ROOT     = path.resolve(__dirname, "..");
const LAUNCHER = path.join(ROOT, "launcher");
const EXE_PATH = path.join(ROOT, "dist", "FEH-Barracks-Launcher.exe");
const GH_CMD   = process.platform === "win32" ? "gh.exe" : "gh";
const NPM_CMD  = process.platform === "win32" ? "npm.cmd" : "npm";

function run(cmd, args, opts = {}) {
  // .cmd/.bat files on Windows require shell:true to be spawned
  const shell = process.platform === "win32";
  const result = spawnSync(cmd, args, { stdio: "inherit", shell, ...opts });
  if (result.status !== 0) {
    console.error(`\nFailed: ${cmd} ${args.join(" ")}`);
    process.exit(result.status ?? 1);
  }
}

// ── Pre-populate the electron-builder winCodeSign cache ──────────────────────
// electron-builder bundles macOS code-signing tools (libssl/libcrypto symlinks)
// in its winCodeSign archive. On Windows without Developer Mode, 7-zip cannot
// create those symlinks and aborts with exit code 2. We pre-create the cache
// directory from the most-recently-partially-extracted temp dir (which has all
// Windows tools intact) so app-builder skips the download entirely.
function ensureWinCodeSignCache() {
  const cacheRoot = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "electron-builder", "Cache", "winCodeSign")
    : path.join(os.homedir(), "AppData", "Local", "electron-builder", "Cache", "winCodeSign");

  const finalDir = path.join(cacheRoot, "winCodeSign-2.6.0");
  if (fs.existsSync(finalDir)) {
    console.log("winCodeSign cache: already populated, skipping.");
    return;
  }

  // Find any partially-extracted temp dir that has the Windows tools
  let src = null;
  if (fs.existsSync(cacheRoot)) {
    for (const entry of fs.readdirSync(cacheRoot)) {
      if (!/^\d+$/.test(entry)) continue;
      const candidate = path.join(cacheRoot, entry);
      if (fs.existsSync(path.join(candidate, "windows-10"))) { src = candidate; break; }
    }
  }

  if (!src) {
    console.log("winCodeSign cache: no partial extraction found — will attempt live download.");
    console.log("  If build fails on symlink errors, enable Windows Developer Mode:");
    console.log("  Settings → System → For developers → Developer Mode → ON");
    return;
  }

  console.log(`winCodeSign cache: seeding from ${src}`);
  fs.cpSync(src, finalDir, { recursive: true });
  // Create dummy placeholder files for the two macOS symlinks that 7za couldn't create
  for (const rel of ["darwin/10.12/lib/libcrypto.dylib", "darwin/10.12/lib/libssl.dylib"]) {
    const fp = path.join(finalDir, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    if (!fs.existsSync(fp)) fs.writeFileSync(fp, "");
  }
  console.log(`winCodeSign cache: seeded → ${finalDir}`);
}

ensureWinCodeSignCache();

console.log("=== Step 1: Build launcher exe ===");
run(NPM_CMD, ["run", "build"], {
  cwd: LAUNCHER,
  env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
});
console.log(`\nBuilt: ${EXE_PATH}`);

console.log("\n=== Step 2: Upload to latest GitHub release ===");
// Get the latest release tag
const tagResult = spawnSync(GH_CMD, [
  "release", "list", "--limit", "1", "--json", "tagName", "--jq", ".[0].tagName",
], { encoding: "utf8", shell: process.platform === "win32" });
const tag = tagResult.stdout.trim();
if (!tag) { console.error("Could not determine latest release tag."); process.exit(1); }
console.log(`Uploading to release: ${tag}`);
console.log(`File: ${EXE_PATH}`);

run(GH_CMD, ["release", "upload", tag, EXE_PATH, "--clobber"]);
console.log(`\nDone. FEH-Barracks-Launcher.exe uploaded to ${tag}.`);
