#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const https = require("node:https");
const { spawn } = require("node:child_process");
const readline = require("node:readline/promises");
const AdmZip = require("adm-zip");

const OWNER = "Gogo-Fogo";
const REPO = "FEH-barracks-manager";

const APP_ZIP_NAME = "feh-app-bundle.zip";
const ASSETS_ZIP_NAME = "feh-assets-bundle.zip";

const LAUNCHER_BASE_DIR = process.pkg
  ? path.dirname(process.execPath)
  : path.resolve(__dirname, "..");

const INSTALL_ROOT = path.join(LAUNCHER_BASE_DIR, "FEH-Barracks-Manager");
const META_PATH = path.join(INSTALL_ROOT, "launcher-meta.json");
const APP_PATH = path.join(INSTALL_ROOT, "app");
const ENV_LOCAL_PATH = path.join(APP_PATH, ".env.local");
const ENV_EXAMPLE_PATH = path.join(APP_PATH, ".env.example");

function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent": "FEH-Barracks-Launcher",
          Accept: "application/vnd.github+json",
        },
      },
      (res) => {
        if (!res.statusCode || res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} on ${url}`));
          res.resume();
          return;
        }

        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(raw));
          } catch (err) {
            reject(err);
          }
        });
      }
    );

    req.on("error", reject);
  });
}

function downloadFile(url, outPath) {
  return new Promise((resolve, reject) => {
    ensureDirSync(path.dirname(outPath));

    const req = https.get(
      url,
      {
        headers: {
          "User-Agent": "FEH-Barracks-Launcher",
          Accept: "application/octet-stream",
        },
      },
      (res) => {
        if (!res.statusCode || res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
          res.resume();
          return;
        }

        const file = fs.createWriteStream(outPath);
        res.pipe(file);
        file.on("finish", () => file.close(() => resolve(outPath)));
        file.on("error", reject);
      }
    );

    req.on("error", reject);
  });
}

async function extractZip(zipPath, outDir) {
  ensureDirSync(outDir);
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(outDir, true);
}

function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed with code ${code}`));
    });
  });
}

async function readMeta() {
  try {
    const raw = await fsp.readFile(META_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeMeta(meta) {
  ensureDirSync(INSTALL_ROOT);
  await fsp.writeFile(META_PATH, JSON.stringify(meta, null, 2), "utf8");
}

async function fetchLatestRelease() {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;
  return getJson(url);
}

function findAsset(release, name) {
  return (release.assets || []).find((a) => a.name === name) || null;
}

async function installOrUpdate() {
  console.log("\nChecking latest release...");
  const release = await fetchLatestRelease();
  const appAsset = findAsset(release, APP_ZIP_NAME);

  if (!appAsset) {
    throw new Error(
      `Missing ${APP_ZIP_NAME} in latest release (${release.tag_name}). Upload app/assets bundles to GitHub Release first.`
    );
  }

  ensureDirSync(INSTALL_ROOT);
  const tempDir = path.join(INSTALL_ROOT, "_tmp");
  ensureDirSync(tempDir);

  const appZipPath = path.join(tempDir, APP_ZIP_NAME);
  console.log(`Downloading ${APP_ZIP_NAME}...`);
  await downloadFile(appAsset.browser_download_url, appZipPath);

  console.log("Extracting app bundle...");
  await extractZip(appZipPath, INSTALL_ROOT);

  const assetsAsset = findAsset(release, ASSETS_ZIP_NAME);
  if (assetsAsset) {
    const assetsZipPath = path.join(tempDir, ASSETS_ZIP_NAME);
    console.log(`Downloading ${ASSETS_ZIP_NAME}...`);
    await downloadFile(assetsAsset.browser_download_url, assetsZipPath);
    console.log("Extracting assets bundle...");
    await extractZip(assetsZipPath, INSTALL_ROOT);
  } else {
    console.log(`No ${ASSETS_ZIP_NAME} in release. Keeping existing local assets.`);
  }

  if (!fs.existsSync(path.join(APP_PATH, "package.json"))) {
    throw new Error(`Expected app package at ${APP_PATH}. Check app bundle structure.`);
  }

  console.log("Installing app dependencies...");
  await runCommand("npm", ["ci"], APP_PATH);

  const existing = await readMeta();
  await writeMeta({
    installedAt: new Date().toISOString(),
    lastReleaseTag: release.tag_name,
    releaseName: release.name || release.tag_name,
    previousReleaseTag: existing?.lastReleaseTag || null,
  });

  await fsp.rm(tempDir, { recursive: true, force: true });
  console.log(`\nInstall/Update complete. Installed release: ${release.tag_name}`);
}

async function launchApp() {
  if (!fs.existsSync(path.join(APP_PATH, "package.json"))) {
    console.log("App is not installed yet. Run Install/Update first.");
    return;
  }

  if (!fs.existsSync(ENV_LOCAL_PATH)) {
    if (fs.existsSync(ENV_EXAMPLE_PATH)) {
      await fsp.copyFile(ENV_EXAMPLE_PATH, ENV_LOCAL_PATH);
      console.log("\nCreated app/.env.local from .env.example");
      console.log("Please fill Supabase values in:");
      console.log(`  ${ENV_LOCAL_PATH}`);
      return;
    }

    console.log("Missing .env.local (and no .env.example found).");
    console.log(`Create this file before launch: ${ENV_LOCAL_PATH}`);
    return;
  }

  console.log("\nStarting FEH Barracks app (local)...");
  console.log("App URL: http://localhost:3000");
  await runCommand("npm", ["run", "dev"], APP_PATH);
}

async function showStatus() {
  const meta = await readMeta();
  console.log("\n=== Launcher Status ===");
  console.log(`Install root: ${INSTALL_ROOT}`);
  console.log(`App installed: ${fs.existsSync(path.join(APP_PATH, "package.json")) ? "yes" : "no"}`);
  if (meta) {
    console.log(`Last release: ${meta.lastReleaseTag}`);
    console.log(`Installed at: ${meta.installedAt}`);
  } else {
    console.log("No launcher metadata found yet.");
  }
}

async function main() {
  ensureDirSync(INSTALL_ROOT);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      console.log("\nFEH Barracks Launcher");
      console.log("1) Install / Update from GitHub Release");
      console.log("2) Launch app locally");
      console.log("3) Status");
      console.log("4) Exit");

      const answer = (await rl.question("Select option: ")).trim();
      if (answer === "1") {
        await installOrUpdate();
      } else if (answer === "2") {
        await launchApp();
      } else if (answer === "3") {
        await showStatus();
      } else if (answer === "4") {
        break;
      } else {
        console.log("Invalid option.");
      }
    }
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error("\nLauncher error:", err.message);
  process.exit(1);
});
