#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const https = require("node:https");
const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");

const OWNER = process.env.FEH_RELEASE_OWNER || "Gogo-Fogo";
const REPO = process.env.FEH_RELEASE_REPO || "FEH-barracks-manager";

const APP_ZIP_NAME = "feh-app-bundle.zip";
const ASSETS_ZIP_NAME = "feh-assets-bundle.zip";
const FULL_ASSETS_ZIP_NAME = "feh-assets-full-bundle.zip";
const NODE_RUNTIME_ZIP_NAME = "feh-node-runtime.zip";
const RUNTIME_CONFIG_NAME = "feh-runtime-config.json";

/**
 * Create a launcher core instance.
 *
 * @param {object} opts
 * @param {{ log: (msg: string) => void, progress: (pct: number, label: string) => void }} opts.logger
 * @param {boolean} [opts.isPackaged] - true when running as a packaged exe
 * @param {string} [opts.execPath]    - path to the running executable (when packaged)
 */
function createCore({ logger, isPackaged = false, execPath = "" } = {}) {
  const log = (msg) => logger.log(String(msg ?? ""));
  const progress = (pct, label) => logger.progress(pct, label || "");

  let runtimeGithubToken =
    process.env.FEH_GITHUB_TOKEN || process.env.GITHUB_TOKEN || "";

  const LAUNCHER_BASE_DIR = isPackaged
    ? path.dirname(execPath || process.execPath)
    : path.resolve(__dirname, "..");

  const INSTALL_ROOT = path.join(LAUNCHER_BASE_DIR, "FEH-Barracks-Manager");
  const META_PATH = path.join(INSTALL_ROOT, "launcher-meta.json");
  const TOKEN_PATH = path.join(INSTALL_ROOT, "launcher-token.txt");
  const APP_PATH = path.join(INSTALL_ROOT, "app");
  const ENV_LOCAL_PATH = path.join(APP_PATH, ".env.local");
  const ENV_EXAMPLE_PATH = path.join(APP_PATH, ".env.example");
  const START_SCRIPT_PATH = path.join(INSTALL_ROOT, "Start-FEH-Barracks.bat");
  const EMBEDDED_NPM_PATH = path.join(
    INSTALL_ROOT,
    "node-runtime",
    "npm.cmd"
  );

  // ─── helpers ────────────────────────────────────────────────────────────────

  function ensureDirSync(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  function githubHeaders(accept) {
    return {
      "User-Agent": "FEH-Barracks-Launcher",
      Accept: accept,
      ...(runtimeGithubToken
        ? { Authorization: `Bearer ${runtimeGithubToken}` }
        : {}),
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

  function getJson(url) {
    return new Promise((resolve, reject) => {
      const req = https.get(
        url,
        { headers: githubHeaders("application/vnd.github+json") },
        (res) => {
          if (!res.statusCode || res.statusCode >= 400) {
            let rawErr = "";
            res.on("data", (chunk) => (rawErr += chunk));
            res.on("end", () => {
              let detail = "";
              try {
                const parsed = JSON.parse(rawErr);
                detail = parsed?.message ? ` (${parsed.message})` : "";
              } catch { /* ignore */ }
              reject(new Error(`HTTP ${res.statusCode} on ${url}${detail}`));
            });
            return;
          }
          let raw = "";
          res.on("data", (chunk) => (raw += chunk));
          res.on("end", () => {
            try { resolve(JSON.parse(raw)); }
            catch (err) { reject(err); }
          });
        }
      );
      req.on("error", reject);
    });
  }

  /**
   * @param {string} url
   * @param {string} outPath
   * @param {number} [redirectCount]
   * @param {(pct: number) => void} [onProgress]
   */
  function downloadFile(url, outPath, redirectCount = 0, onProgress = null) {
    return new Promise((resolve, reject) => {
      ensureDirSync(path.dirname(outPath));

      const req = https.get(
        url,
        { headers: githubHeaders("application/octet-stream") },
        (res) => {
          const status = res.statusCode || 0;

          if (status >= 300 && status < 400 && res.headers.location) {
            if (redirectCount >= 10) {
              reject(new Error(`Too many redirects downloading ${url}`));
              return;
            }
            const redirectedUrl = new URL(
              res.headers.location,
              url
            ).toString();
            res.resume();
            downloadFile(redirectedUrl, outPath, redirectCount + 1, onProgress)
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
              } catch { /* ignore */ }
              reject(
                new Error(`HTTP ${status} downloading ${url}${detail}`)
              );
            });
            return;
          }

          // byte-count progress
          const totalBytes = parseInt(
            res.headers["content-length"] || "0",
            10
          );
          let receivedBytes = 0;
          if (totalBytes > 0 && onProgress) {
            res.on("data", (chunk) => {
              receivedBytes += chunk.length;
              onProgress(Math.round((receivedBytes / totalBytes) * 100));
            });
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
    const AdmZip = require("adm-zip");
    ensureDirSync(outDir);
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(outDir, true);
  }

  function runCommand(command, args, cwd) {
    return new Promise((resolve, reject) => {
      const isWin = process.platform === "win32";
      // On Windows with shell:true, paths containing spaces must be quoted
      // or cmd.exe splits them at the first space (e.g. "C:\Users\Juan" → error)
      const safeCmd = isWin && command.includes(" ") ? `"${command}"` : command;
      const child = spawn(safeCmd, args, {
        cwd,
        stdio: "inherit",
        shell: isWin,
      });
      child.on("close", (code) => {
        if (code === 0) resolve();
        else
          reject(
            new Error(
              `${command} ${args.join(" ")} failed with code ${code}`
            )
          );
      });
    });
  }

  function runCommandCapture(command, args, cwd) {
    return new Promise((resolve, reject) => {
      const isWin = process.platform === "win32";
      const safeCmd = isWin && command.includes(" ") ? `"${command}"` : command;
      const child = spawn(safeCmd, args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        shell: isWin,
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += String(chunk || ""); });
      child.stderr.on("data", (chunk) => { stderr += String(chunk || ""); });
      child.on("close", (code) => {
        if (code === 0) resolve({ stdout, stderr });
        else
          reject(
            new Error(
              `${command} ${args.join(" ")} failed with code ${code}${stderr ? `: ${stderr}` : ""}`
            )
          );
      });
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function stopRunningAppNodeProcesses() {
    if (process.platform !== "win32") return;
    const escapedAppPath = APP_PATH.replace(/'/g, "''");
    const script = [
      "$ErrorActionPreference = 'SilentlyContinue'",
      "$procs = Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine -like '*",
      escapedAppPath,
      "*' }",
      "if ($procs) { $procs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } }",
    ].join("");
    try {
      await runCommand(
        "powershell",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
        INSTALL_ROOT
      );
    } catch { /* best effort */ }
  }

  async function isAppDevServerAlreadyRunning() {
    if (process.platform !== "win32") return false;
    const escapedAppPath = APP_PATH.replace(/'/g, "''");
    const script = [
      "$ErrorActionPreference = 'SilentlyContinue'",
      "$procs = Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\" | Where-Object {",
      "  $_.CommandLine -and $_.CommandLine -like '*",
      escapedAppPath,
      "*' -and $_.CommandLine -like '*next*dev*'",
      "}",
      "if ($procs) { 'RUNNING' } else { 'NOT_RUNNING' }",
    ].join("");
    try {
      const { stdout } = await runCommandCapture(
        "powershell",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
        INSTALL_ROOT
      );
      return String(stdout || "").includes("RUNNING");
    } catch {
      return false;
    }
  }

  async function resolveNpmCommand() {
    try {
      await runCommand("npm", ["--version"], APP_PATH);
      return "npm";
    } catch { /* try next */ }

    if (process.platform === "win32") {
      try {
        await runCommand("npm.cmd", ["--version"], APP_PATH);
        return "npm.cmd";
      } catch { /* try next */ }

      try {
        await runCommand(EMBEDDED_NPM_PATH, ["--version"], APP_PATH);
        return EMBEDDED_NPM_PATH;
      } catch { /* fall through */ }
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
    log(`Downloading ${NODE_RUNTIME_ZIP_NAME}...`);
    await downloadFile(
      runtimeAsset.browser_download_url,
      runtimeZipPath,
      0,
      (pct) => progress(pct, `Downloading Node runtime... ${pct}%`)
    );
    log("Extracting embedded Node runtime...");
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
      `cd /d "${APP_PATH}"`,
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
    log(`Downloading ${RUNTIME_CONFIG_NAME}...`);
    await downloadFile(configAsset.browser_download_url, configPath);
    const raw = await fsp.readFile(configPath, "utf8");
    const config = parseRuntimeConfig(raw);
    if (!config) {
      log(`${RUNTIME_CONFIG_NAME} is invalid. Skipping auto-env setup.`);
      return false;
    }
    const envContent = [
      `NEXT_PUBLIC_SUPABASE_URL=${config.supabaseUrl}`,
      `NEXT_PUBLIC_SUPABASE_ANON_KEY=${config.supabaseAnonKey}`,
      "",
    ].join("\r\n");
    await fsp.writeFile(ENV_LOCAL_PATH, envContent, "utf8");
    log("Configured app/.env.local from release runtime config.");
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
    log(`Downloading ${APP_ZIP_NAME}...`);
    await downloadFile(
      appAsset.browser_download_url,
      appZipPath,
      0,
      (pct) => progress(pct, `Downloading app bundle... ${pct}%`)
    );

    log("Extracting app bundle...");
    progress(0, "Extracting app bundle...");
    await extractZip(appZipPath, INSTALL_ROOT);

    const assetsAsset =
      findAsset(release, FULL_ASSETS_ZIP_NAME) ||
      findAsset(release, ASSETS_ZIP_NAME);
    if (assetsAsset) {
      const assetsZipPath = path.join(tempDir, assetsAsset.name);
      log(`Downloading ${assetsAsset.name}...`);
      await downloadFile(
        assetsAsset.browser_download_url,
        assetsZipPath,
        0,
        (pct) => progress(pct, `Downloading assets... ${pct}%`)
      );
      log("Extracting assets bundle...");
      progress(0, "Extracting assets...");
      await extractZip(assetsZipPath, INSTALL_ROOT);
    } else {
      log(
        `No ${FULL_ASSETS_ZIP_NAME} or ${ASSETS_ZIP_NAME} in release. Keeping existing local assets.`
      );
    }

    if (!fs.existsSync(path.join(APP_PATH, "package.json"))) {
      throw new Error(
        `Expected app package at ${APP_PATH}. Check app bundle structure.`
      );
    }

    await applyRuntimeConfigFromRelease(release, tempDir);

    try {
      await resolveNpmCommand();
    } catch {
      log("npm not found on system. Falling back to bundled Node runtime...");
      await ensureEmbeddedNodeRuntime(release, tempDir);
      await resolveNpmCommand();
    }

    log("Installing app dependencies...");
    progress(0, "Installing dependencies...");
    await stopRunningAppNodeProcesses();

    try {
      await runNpm(["ci"], APP_PATH);
    } catch (ciErr) {
      log(
        `npm ci failed (${ciErr.message}). Attempting lock-safe retry...`
      );
      await stopRunningAppNodeProcesses();
      await sleep(1500);
      try {
        await runNpm(["ci"], APP_PATH);
      } catch (retryErr) {
        log(
          `npm ci retry failed (${retryErr.message}). Retrying with npm install...`
        );
        await stopRunningAppNodeProcesses();
        await sleep(1500);
        await runNpm(["install"], APP_PATH);
      }
    }

    const existing = await readMeta();
    await writeMeta({
      installedAt: new Date().toISOString(),
      lastReleaseTag: release.tag_name,
      releaseName: release.name || release.tag_name,
      previousReleaseTag: existing?.lastReleaseTag || null,
      installRoot: INSTALL_ROOT,
    });

    await fsp.rm(tempDir, { recursive: true, force: true });
    await ensureStartScript();
    log(`\nInstall/Update complete. Installed release: ${release.tag_name}`);
  }

  async function launchApp() {
    if (!fs.existsSync(path.join(APP_PATH, "package.json"))) {
      log("App is not installed yet. Run Install/Update first.");
      return "not-installed";
    }

    // Always refresh the .bat so it reflects the current install location,
    // even if the folder was moved between sessions.
    await ensureStartScript().catch(() => {});

    if (await isAppDevServerAlreadyRunning()) {
      log("\nFEH Barracks app is already running. Reusing existing dev server.");
      log("App URL: http://localhost:3000");
      runCommand(
        "cmd",
        ["/c", "start", "", "http://localhost:3000"],
        APP_PATH
      ).catch(() => {});
      return "already-running";
    }

    let envState = await readSupabaseEnvState();

    if (!envState.configured) {
      const release = await fetchLatestRelease();
      const tempDir = path.join(INSTALL_ROOT, "_tmp");
      ensureDirSync(tempDir);
      const configuredFromRelease = await applyRuntimeConfigFromRelease(
        release,
        tempDir
      ).catch(() => false);
      await fsp.rm(tempDir, { recursive: true, force: true });

      envState = await readSupabaseEnvState();
      if (!envState.configured) {
        if (!envState.exists && fs.existsSync(ENV_EXAMPLE_PATH)) {
          await fsp.copyFile(ENV_EXAMPLE_PATH, ENV_LOCAL_PATH);
          log("\nCreated app/.env.local from .env.example");
        } else if (!envState.exists) {
          await ensureEnvLocalTemplate();
          log(
            "\nCreated app/.env.local template (no .env.example found in bundle)."
          );
        }

        log("\nSupabase not configured yet.");
        log("Please fill Supabase values in:");
        log(`  ${ENV_LOCAL_PATH}`);
        await runCommand("notepad", [ENV_LOCAL_PATH], APP_PATH).catch(() => {});
        return "needs-env";
      }

      if (configuredFromRelease) {
        log(
          "Supabase configuration found and applied from release runtime config."
        );
      }
    }

    await resolveNpmCommand();

    log("\nStarting FEH Barracks app (local)...");
    log("App URL: http://localhost:3000");
    progress(100, "Launching app...");
    runCommand(
      "cmd",
      ["/c", "start", "", "http://localhost:3000"],
      APP_PATH
    ).catch(() => {});
    await runNpm(["run", "dev"], APP_PATH);
    return "started";
  }

  async function autoUpdateAndLaunch() {
    log("\nFEH Barracks Launcher");
    log("Checking install state and latest release...");
    progress(5, "Checking for updates...");

    const [meta, release] = await Promise.all([
      readMeta(),
      fetchLatestRelease(),
    ]);

    // ── Folder-move detection ─────────────────────────────────────────────────
    // If the user moved the FEH-Barracks-Manager folder after install, the
    // stored installRoot in meta will differ from the current INSTALL_ROOT.
    // Re-write the .bat and run `npm ci` so hardcoded paths are healed.
    if (meta?.installRoot && meta.installRoot !== INSTALL_ROOT) {
      log(`[Relocation] Install folder moved:`);
      log(`  was: ${meta.installRoot}`);
      log(`  now: ${INSTALL_ROOT}`);
      log("Updating launch script and package references...");
      await ensureStartScript();
      if (fs.existsSync(path.join(APP_PATH, "package.json"))) {
        try {
          await stopRunningAppNodeProcesses();
          await runNpm(["ci"], APP_PATH);
          log("Package references updated.");
        } catch (e) {
          log(`npm ci after relocation failed: ${e.message} (continuing)`);
        }
      }
      await writeMeta({ ...meta, installRoot: INSTALL_ROOT });
      log("Relocation healed.\n");
    }

    const installed = fs.existsSync(path.join(APP_PATH, "package.json"));
    const needsInstall = !installed;
    const needsUpdate =
      !needsInstall && meta?.lastReleaseTag !== release.tag_name;

    if (needsInstall) {
      log("No local install found. Installing now...");
      await installOrUpdateFromRelease(release);
    } else if (needsUpdate) {
      log(
        `Update found (${meta?.lastReleaseTag || "unknown"} -> ${release.tag_name}). Updating now...`
      );
      await installOrUpdateFromRelease(release);
    } else {
      log(`Already up to date (${meta?.lastReleaseTag || release.tag_name}).`);
      progress(100, "Up to date");
    }

    return launchApp();
  }

  // public API for token handling (called from main.js when user submits token)
  function provideToken(token) {
    const trimmed = String(token || "").trim();
    if (trimmed) {
      setRuntimeToken(trimmed);
      saveToken(trimmed).catch(() => {});
    }
  }

  return {
    autoUpdateAndLaunch,
    launchApp,
    provideToken,
    readSavedToken,
    setRuntimeToken,
  };
}

module.exports = { createCore };
