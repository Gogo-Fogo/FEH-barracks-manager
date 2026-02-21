#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const https = require("node:https");
const { spawn } = require("node:child_process");
const readline = require("node:readline/promises");
const AdmZip = require("adm-zip");

const OWNER = process.env.FEH_RELEASE_OWNER || "Gogo-Fogo";
const REPO = process.env.FEH_RELEASE_REPO || "FEH-barracks-manager";
let runtimeGithubToken = process.env.FEH_GITHUB_TOKEN || process.env.GITHUB_TOKEN || "";

const APP_ZIP_NAME = "feh-app-bundle.zip";
const ASSETS_ZIP_NAME = "feh-assets-bundle.zip";
const FULL_ASSETS_ZIP_NAME = "feh-assets-full-bundle.zip";
const NODE_RUNTIME_ZIP_NAME = "feh-node-runtime.zip";
const RUNTIME_CONFIG_NAME = "feh-runtime-config.json";

const LAUNCHER_BASE_DIR = process.pkg
  ? path.dirname(process.execPath)
  : path.resolve(__dirname, "..");

const INSTALL_ROOT = path.join(LAUNCHER_BASE_DIR, "FEH-Barracks-Manager");
const META_PATH = path.join(INSTALL_ROOT, "launcher-meta.json");
const TOKEN_PATH = path.join(INSTALL_ROOT, "launcher-token.txt");
const APP_PATH = path.join(INSTALL_ROOT, "app");
const ENV_LOCAL_PATH = path.join(APP_PATH, ".env.local");
const ENV_EXAMPLE_PATH = path.join(APP_PATH, ".env.example");
const START_SCRIPT_PATH = path.join(INSTALL_ROOT, "Start-FEH-Barracks.bat");
const EMBEDDED_NPM_PATH = path.join(INSTALL_ROOT, "node-runtime", "npm.cmd");

function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function githubHeaders(accept) {
  return {
    "User-Agent": "FEH-Barracks-Launcher",
    Accept: accept,
    ...(runtimeGithubToken ? { Authorization: `Bearer ${runtimeGithubToken}` } : {}),
  };
}

function setRuntimeToken(token) {
  runtimeGithubToken = String(token || "").trim();
}

async function readSavedToken() {
  try {
    const raw = await fsp.readFile(TOKEN_PATH, "utf8");
    return String(raw || "").trim();
  } catch {
    return "";
  }
}

async function saveToken(token) {
  const value = String(token || "").trim();
  if (!value) return;
  ensureDirSync(INSTALL_ROOT);
  await fsp.writeFile(TOKEN_PATH, value, "utf8");
}

async function promptForToken() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log("\nThis repository appears private to GitHub API.");
    const answer = await rl.question("Paste FEH_GITHUB_TOKEN (or press Enter to skip): ");
    return String(answer || "").trim();
  } finally {
    rl.close();
  }
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: githubHeaders("application/vnd.github+json"),
      },
      (res) => {
        if (!res.statusCode || res.statusCode >= 400) {
          let rawErr = "";
          res.on("data", (chunk) => (rawErr += chunk));
          res.on("end", () => {
            let detail = "";
            try {
              const parsed = JSON.parse(rawErr);
              detail = parsed?.message ? ` (${parsed.message})` : "";
            } catch {
              // ignore parse errors
            }
            reject(new Error(`HTTP ${res.statusCode} on ${url}${detail}`));
          });
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

function downloadFile(url, outPath, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    ensureDirSync(path.dirname(outPath));

    const req = https.get(
      url,
      {
        headers: githubHeaders("application/octet-stream"),
      },
      (res) => {
        const status = res.statusCode || 0;

        if (status >= 300 && status < 400 && res.headers.location) {
          if (redirectCount >= 10) {
            reject(new Error(`Too many redirects downloading ${url}`));
            return;
          }

          const redirectedUrl = new URL(res.headers.location, url).toString();
          res.resume();
          downloadFile(redirectedUrl, outPath, redirectCount + 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (!status || status >= 400) {
          let rawErr = "";
          res.on("data", (chunk) => (rawErr += chunk));
          res.on("end", () => {
            let detail = "";
            try {
              const parsed = JSON.parse(rawErr);
              detail = parsed?.message ? ` (${parsed.message})` : "";
            } catch {
              // ignore parse errors
            }
            reject(new Error(`HTTP ${status} downloading ${url}${detail}`));
          });
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

async function resolveNpmCommand() {
  try {
    await runCommand("npm", ["--version"], APP_PATH);
    return "npm";
  } catch {
    // continue to fallback check below
  }

  if (process.platform === "win32") {
    try {
      await runCommand("npm.cmd", ["--version"], APP_PATH);
      return "npm.cmd";
    } catch {
      // continue to embedded check
    }

    try {
      await runCommand(EMBEDDED_NPM_PATH, ["--version"], APP_PATH);
      return EMBEDDED_NPM_PATH;
    } catch {
      // continue to throw
    }
  }

  throw new Error(
    "npm is not installed or not in PATH. Please install Node.js LTS from https://nodejs.org and re-run launcher."
  );
}

async function runNpm(args, cwd = APP_PATH) {
  const npmCommand = await resolveNpmCommand();
  return runCommand(npmCommand, args, cwd);
}

async function ensureEmbeddedNodeRuntime(release, tempDir) {
  const runtimeAsset = findAsset(release, NODE_RUNTIME_ZIP_NAME);
  if (!runtimeAsset) {
    throw new Error(
      `npm is not available and ${NODE_RUNTIME_ZIP_NAME} is missing from release ${release.tag_name}.`
    );
  }

  const runtimeZipPath = path.join(tempDir, NODE_RUNTIME_ZIP_NAME);
  console.log(`Downloading ${NODE_RUNTIME_ZIP_NAME}...`);
  await downloadFile(runtimeAsset.browser_download_url, runtimeZipPath);
  console.log("Extracting embedded Node runtime...");
  await extractZip(runtimeZipPath, INSTALL_ROOT);
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

async function ensureStartScript() {
  const script = [
    "@echo off",
    `cd /d \"${APP_PATH}\"`,
    "npm run dev",
    "",
  ].join("\r\n");

  await fsp.writeFile(START_SCRIPT_PATH, script, "utf8");
}

async function ensureEnvLocalTemplate() {
  const template = [
    "NEXT_PUBLIC_SUPABASE_URL=",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY=",
    "",
  ].join("\r\n");

  await fsp.writeFile(ENV_LOCAL_PATH, template, "utf8");
}

function parseRuntimeConfig(raw) {
  try {
    const parsed = JSON.parse(String(raw || ""));
    const supabaseUrl = String(
      parsed?.supabaseUrl || parsed?.NEXT_PUBLIC_SUPABASE_URL || ""
    ).trim();
    const supabaseAnonKey = String(
      parsed?.supabaseAnonKey || parsed?.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
    ).trim();
    if (!supabaseUrl || !supabaseAnonKey) return null;
    return { supabaseUrl, supabaseAnonKey };
  } catch {
    return null;
  }
}

function parseEnvValue(envContent, key) {
  const pattern = new RegExp(`^\\s*${key}\\s*=\\s*(.*)\\s*$`, "m");
  const match = String(envContent || "").match(pattern);
  if (!match) return "";
  const value = String(match[1] || "").trim();
  return value.replace(/^"|"$/g, "").replace(/^'|'$/g, "").trim();
}

async function readSupabaseEnvState() {
  if (!fs.existsSync(ENV_LOCAL_PATH)) {
    return { exists: false, configured: false, url: "", anonKey: "" };
  }

  const raw = await fsp.readFile(ENV_LOCAL_PATH, "utf8");
  const url = parseEnvValue(raw, "NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = parseEnvValue(raw, "NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const configured = Boolean(url && anonKey);
  return { exists: true, configured, url, anonKey };
}

async function applyRuntimeConfigFromRelease(release, tempDir) {
  const configAsset = findAsset(release, RUNTIME_CONFIG_NAME);
  if (!configAsset) return false;

  const configPath = path.join(tempDir, RUNTIME_CONFIG_NAME);
  console.log(`Downloading ${RUNTIME_CONFIG_NAME}...`);
  await downloadFile(configAsset.browser_download_url, configPath);
  const raw = await fsp.readFile(configPath, "utf8");
  const config = parseRuntimeConfig(raw);
  if (!config) {
    console.log(`${RUNTIME_CONFIG_NAME} is invalid. Skipping auto-env setup.`);
    return false;
  }

  const envContent = [
    `NEXT_PUBLIC_SUPABASE_URL=${config.supabaseUrl}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${config.supabaseAnonKey}`,
    "",
  ].join("\r\n");

  await fsp.writeFile(ENV_LOCAL_PATH, envContent, "utf8");
  console.log("Configured app/.env.local from release runtime config.");
  return true;
}

async function fetchLatestRelease() {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;
  return getJson(url);
}

function findAsset(release, name) {
  return (release.assets || []).find((a) => a.name === name) || null;
}

async function installOrUpdateFromRelease(release) {
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

  const assetsAsset = findAsset(release, FULL_ASSETS_ZIP_NAME) || findAsset(release, ASSETS_ZIP_NAME);
  if (assetsAsset) {
    const assetsZipPath = path.join(tempDir, ASSETS_ZIP_NAME);
    console.log(`Downloading ${assetsAsset.name}...`);
    await downloadFile(assetsAsset.browser_download_url, assetsZipPath);
    console.log("Extracting assets bundle...");
    await extractZip(assetsZipPath, INSTALL_ROOT);
  } else {
    console.log(`No ${FULL_ASSETS_ZIP_NAME} or ${ASSETS_ZIP_NAME} in release. Keeping existing local assets.`);
  }

  if (!fs.existsSync(path.join(APP_PATH, "package.json"))) {
    throw new Error(`Expected app package at ${APP_PATH}. Check app bundle structure.`);
  }

  await applyRuntimeConfigFromRelease(release, tempDir);

  try {
    await resolveNpmCommand();
  } catch {
    console.log("npm not found on system. Falling back to bundled Node runtime...");
    await ensureEmbeddedNodeRuntime(release, tempDir);
    await resolveNpmCommand();
  }

  console.log("Installing app dependencies...");
  try {
    await runNpm(["ci"], APP_PATH);
  } catch (ciErr) {
    console.log(`npm ci failed (${ciErr.message}). Retrying with npm install...`);
    await runNpm(["install"], APP_PATH);
  }

  const existing = await readMeta();
  await writeMeta({
    installedAt: new Date().toISOString(),
    lastReleaseTag: release.tag_name,
    releaseName: release.name || release.tag_name,
    previousReleaseTag: existing?.lastReleaseTag || null,
  });

  await fsp.rm(tempDir, { recursive: true, force: true });
  await ensureStartScript();
  console.log(`\nInstall/Update complete. Installed release: ${release.tag_name}`);
}

async function installOrUpdate() {
  console.log("\nChecking latest release...");
  const release = await fetchLatestRelease();
  await installOrUpdateFromRelease(release);
}

async function launchApp() {
  if (!fs.existsSync(path.join(APP_PATH, "package.json"))) {
    console.log("App is not installed yet. Run Install/Update first.");
    return "not-installed";
  }

  let envState = await readSupabaseEnvState();

  if (!envState.configured) {
    const release = await fetchLatestRelease();
    const tempDir = path.join(INSTALL_ROOT, "_tmp");
    ensureDirSync(tempDir);
    const configuredFromRelease = await applyRuntimeConfigFromRelease(release, tempDir).catch(() => false);
    await fsp.rm(tempDir, { recursive: true, force: true });

    envState = await readSupabaseEnvState();
    if (!envState.configured) {
      if (!envState.exists && fs.existsSync(ENV_EXAMPLE_PATH)) {
        await fsp.copyFile(ENV_EXAMPLE_PATH, ENV_LOCAL_PATH);
        console.log("\nCreated app/.env.local from .env.example");
      } else if (!envState.exists) {
        await ensureEnvLocalTemplate();
        console.log("\nCreated app/.env.local template (no .env.example found in bundle).");
      }

      console.log("\nSupabase not configured yet.");
      console.log("Please fill Supabase values in:");
      console.log(`  ${ENV_LOCAL_PATH}`);
      await runCommand("notepad", [ENV_LOCAL_PATH], APP_PATH).catch(() => {});
      return "needs-env";
    }

    if (configuredFromRelease) {
      console.log("Supabase configuration found and applied from release runtime config.");
    }
  }

  await resolveNpmCommand();

  console.log("\nStarting FEH Barracks app (local)...");
  console.log("App URL: http://localhost:3000");
  runCommand("cmd", ["/c", "start", "", "http://localhost:3000"], APP_PATH).catch(() => {});
  await runNpm(["run", "dev"], APP_PATH);
  return "started";
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

async function autoUpdateAndLaunch() {
  console.log("\nFEH Barracks Launcher (auto mode)");
  console.log("Checking install state and latest release...");

  const [meta, release] = await Promise.all([readMeta(), fetchLatestRelease()]);
  const installed = fs.existsSync(path.join(APP_PATH, "package.json"));
  const needsInstall = !installed;
  const needsUpdate = !needsInstall && meta?.lastReleaseTag !== release.tag_name;

  if (needsInstall) {
    console.log("No local install found. Installing now...");
    await installOrUpdateFromRelease(release);
  } else if (needsUpdate) {
    console.log(`Update found (${meta?.lastReleaseTag || "unknown"} -> ${release.tag_name}). Updating now...`);
    await installOrUpdateFromRelease(release);
  } else {
    console.log(`Already up to date (${meta?.lastReleaseTag || release.tag_name}).`);
  }

  return launchApp();
}

async function pauseBeforeExitIfPackaged(message) {
  if (!process.pkg) return;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    await rl.question(`\n${message}\nPress Enter to close launcher...`);
  } finally {
    rl.close();
  }
}

async function runInteractiveMenu() {
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

async function main() {
  ensureDirSync(INSTALL_ROOT);

  if (!runtimeGithubToken) {
    const savedToken = await readSavedToken();
    if (savedToken) setRuntimeToken(savedToken);
  }

  const args = new Set(process.argv.slice(2));
  const forceMenu = args.has("--advanced") || args.has("--menu");

  if (forceMenu) {
    await runInteractiveMenu();
    return;
  }

  try {
    const launchState = await autoUpdateAndLaunch();
    if (launchState !== "started") {
      await pauseBeforeExitIfPackaged("Setup step completed, but app was not started yet.");
    }
  } catch (err) {
    console.error(`\nAuto mode failed: ${err.message}`);
    if (/releases\/latest/i.test(String(err.message)) && /404/i.test(String(err.message))) {
      console.log("Hint: either no GitHub Release is published yet, or the repo is private.");
      if (!runtimeGithubToken) {
        const provided = await promptForToken();
        if (provided) {
          setRuntimeToken(provided);
          await saveToken(provided);
          console.log("Token saved. Retrying auto mode...");
          try {
            await autoUpdateAndLaunch();
            return;
          } catch (retryErr) {
            console.error(`Retry failed: ${retryErr.message}`);
          }
        }
      }
      console.log("If private, run launcher with FEH_GITHUB_TOKEN set to a PAT that has repo read access.");
    }
    console.log("Switching to interactive menu...");
    await runInteractiveMenu();
    await pauseBeforeExitIfPackaged("Launcher menu exited.");
  }
}

main().catch((err) => {
  console.error("\nLauncher error:", err.message);
  process.exit(1);
});
