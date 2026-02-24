#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Builds feh-assets-full-bundle.zip from local db/ folder and uploads it
 * to the latest GitHub release, replacing any previous copy (--clobber).
 *
 * Requires gh CLI: https://cli.github.com/
 *   winget install GitHub.cli   (first-time setup)
 *   gh auth login               (first-time auth)
 */
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT_ZIP = path.join(ROOT, "feh-assets-full-bundle.zip");
const GH_CMD = process.platform === "win32" ? "gh.exe" : "gh";

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...opts,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited with code ${result.status}`);
  }
  return result;
}

function capture(cmd, args) {
  const result = spawnSync(cmd, args, {
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} failed: ${(result.stderr || "").trim()}`
    );
  }
  return (result.stdout || "").trim();
}

async function main() {
  // 1. Build the bundle
  console.log("=== Step 1: Build full assets bundle ===");
  run("node", [path.join(__dirname, "build-local-assets-bundle.js")]);

  // 2. Check gh is available
  console.log("\n=== Step 2: Upload to latest GitHub release ===");
  try {
    capture(GH_CMD, ["--version"]);
  } catch {
    console.error(
      "\nERROR: gh CLI not found. Install it with:\n  winget install GitHub.cli\nThen authenticate with:\n  gh auth login"
    );
    process.exit(1);
  }

  // 3. Get the latest release tag
  const tag = capture(GH_CMD, [
    "release",
    "list",
    "--limit",
    "1",
    "--json",
    "tagName",
    "-q",
    ".[0].tagName",
  ]);

  if (!tag) {
    console.error("ERROR: Could not determine latest release tag. Is there a published release?");
    process.exit(1);
  }

  console.log(`Uploading to release: ${tag}`);
  console.log(`File: ${OUTPUT_ZIP}`);

  // 4. Upload (--clobber replaces existing asset with the same name)
  run(GH_CMD, ["release", "upload", tag, OUTPUT_ZIP, "--clobber"]);

  console.log(`\nDone. feh-assets-full-bundle.zip uploaded to ${tag}.`);
}

main().catch((err) => {
  console.error("\nFailed:", err.message);
  process.exit(1);
});
