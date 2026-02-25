#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Builds FEH-Barracks-Launcher.exe (portable, x64) and uploads it
 * to the latest GitHub release, replacing any previous copy (--clobber).
 *
 * MUST be run from an elevated (admin) terminal — electron-builder needs
 * symlink privileges to extract its winCodeSign toolchain on Windows.
 *
 * Requires gh CLI: https://cli.github.com/
 *   winget install GitHub.cli   (first-time setup)
 *   gh auth login               (first-time auth)
 */
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT      = path.resolve(__dirname, "..");
const LAUNCHER  = path.join(ROOT, "launcher");
const EXE_PATH  = path.join(ROOT, "dist", "FEH-Barracks-Launcher.exe");
const GH_CMD    = process.platform === "win32" ? "gh.exe" : "gh";
const NPM_CMD   = process.platform === "win32" ? "npm.cmd" : "npm";

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (result.status !== 0) {
    console.error(`\nFailed: ${cmd} ${args.join(" ")}`);
    process.exit(result.status ?? 1);
  }
}

console.log("=== Step 1: Build launcher exe ===");
run(NPM_CMD, ["run", "build"], { cwd: LAUNCHER });
console.log(`\nBuilt: ${EXE_PATH}`);

console.log("\n=== Step 2: Upload to latest GitHub release ===");
// Get the latest release tag
const tagResult = spawnSync(GH_CMD, [
  "release", "list", "--limit", "1", "--json", "tagName", "--jq", ".[0].tagName",
], { encoding: "utf8" });
const tag = tagResult.stdout.trim();
if (!tag) { console.error("Could not determine latest release tag."); process.exit(1); }
console.log(`Uploading to release: ${tag}`);
console.log(`File: ${EXE_PATH}`);

run(GH_CMD, ["release", "upload", tag, EXE_PATH, "--clobber"]);
console.log(`\nDone. FEH-Barracks-Launcher.exe uploaded to ${tag}.`);
