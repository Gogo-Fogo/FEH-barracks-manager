#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Builds feh-data-bundle.zip and uploads it to the latest GitHub release.
 */

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const fs = require("node:fs");

const ROOT       = path.resolve(__dirname, "..");
const OUTPUT_ZIP = path.join(ROOT, "feh-data-bundle.zip");

// Resolve gh CLI — try well-known Windows install paths before falling back to PATH.
function findGh() {
  if (process.platform !== "win32") return "gh";
  const candidates = [
    "C:\\Program Files\\GitHub CLI\\gh.exe",
    path.join(process.env.LOCALAPPDATA || "", "Programs", "GitHub CLI", "gh.exe"),
    path.join(process.env.USERPROFILE  || "", "scoop", "shims", "gh.exe"),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return "gh.exe"; // last resort — must be on PATH
}
const GH_CMD = findGh();

function run(cmd, args) {
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${cmd} exited with code ${result.status}`);
}

function capture(cmd, args) {
  const result = spawnSync(cmd, args, {
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || "").trim());
  return (result.stdout || "").trim();
}

async function main() {
  console.log("=== Step 1: Build data bundle ===");
  run("node", [path.join(__dirname, "build-data-bundle.js")]);

  console.log("\n=== Step 2: Upload to latest GitHub release ===");
  const tag = capture(GH_CMD, [
    "release", "list",
    "--repo", "Gogo-Fogo/FEH-barracks-manager",
    "--limit", "1", "--json", "tagName", "--jq", ".[0].tagName",
  ]);

  if (!tag) throw new Error("Could not determine latest release tag.");

  console.log(`Uploading to release: ${tag}`);
  run(GH_CMD, [
    "release", "upload", tag, OUTPUT_ZIP,
    "--clobber", "--repo", "Gogo-Fogo/FEH-barracks-manager",
  ]);

  console.log(`\nDone. feh-data-bundle.zip uploaded to ${tag}.`);
}

main().catch((err) => {
  console.error("\nFailed:", err.message);
  process.exit(1);
});
