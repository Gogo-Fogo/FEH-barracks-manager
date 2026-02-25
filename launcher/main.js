"use strict";

const { app, BrowserWindow, dialog, ipcMain, shell, session } = require("electron");
const path = require("node:path");
const https = require("node:https");
const http  = require("node:http");
const fs    = require("node:fs");
const fsp   = require("node:fs/promises");
const { spawnSync } = require("node:child_process");

const pkg = require("./package.json");

// ── Constants ──────────────────────────────────────────────────────────────────
const LOCAL_URL    = "http://localhost:3000";
const REMOTE_URL   = "https://feh-barracks-manager.vercel.app";
const VERCEL_HOST  = "feh-barracks-manager.vercel.app";
const RELEASES_API = "https://api.github.com/repos/Gogo-Fogo/FEH-barracks-manager/releases/latest";
const BUNDLE_NAME  = "feh-data-bundle.zip";
const ASSET_PORT   = 45678;

let mainWin   = null;
let splashWin = null;

// In-memory asset index built from the local data bundle.
// headshotIndex:  Map< slug-variant → relative-path-from-dbRoot >
// sharedIconIndex: Map< "category/filename" → relative-path-from-dbRoot >
let headshotIndex   = null;
let sharedIconIndex = null;

// ── Path helpers ───────────────────────────────────────────────────────────────
const getDataRoot    = () => path.join(app.getPath("userData"), "feh-data");
const getDbRoot      = () => path.join(getDataRoot(), "db");
const getVersionFile = () => path.join(getDataRoot(), "version.txt");
const getIconPath    = () =>
  app.isPackaged
    ? path.join(process.resourcesPath, "assets", "edelgard_husk.png")
    : path.join(__dirname, "assets", "edelgard_husk.png");

// ── Utilities ──────────────────────────────────────────────────────────────────
const send = (win, ch, ...a) => {
  if (win && !win.isDestroyed()) win.webContents.send(ch, ...a);
};

function inferMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".webp") return "image/webp";
  if (ext === ".png")  return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif")  return "image/gif";
  return "application/octet-stream";
}

// Same normalisation algorithm used in the Next.js API routes.
function normSlug(s) {
  return String(s || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .toLowerCase()
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

// ── Asset index builders ───────────────────────────────────────────────────────
async function buildIndices() {
  const dbRoot = getDbRoot();
  headshotIndex   = new Map();
  sharedIconIndex = new Map();

  // headshots: db/unit_assets/fandom/headshots/{heroDir}/{image}
  const headsRoot = path.join(dbRoot, "unit_assets", "fandom", "headshots");
  try {
    const entries = await fsp.readdir(headsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const heroDir = path.join(headsRoot, entry.name);
      try {
        const files = await fsp.readdir(heroDir);
        const image = files.find((f) => /\.(webp|png|jpe?g|gif)$/i.test(f));
        if (!image) continue;
        const rel = path.relative(dbRoot, path.join(heroDir, image)).replace(/\\/g, "/");
        // Index by exact lower-case dir name AND normalised slug
        const lower = entry.name.toLowerCase();
        const normd = normSlug(entry.name);
        if (!headshotIndex.has(lower)) headshotIndex.set(lower, rel);
        if (!headshotIndex.has(normd)) headshotIndex.set(normd, rel);
      } catch { /* skip */ }
    }
  } catch { /* headshots dir absent */ }

  // shared icons: db/unit_assets/fandom/shared/{category}/{file}
  const sharedRoot = path.join(dbRoot, "unit_assets", "fandom", "shared");
  try {
    const categories = await fsp.readdir(sharedRoot, { withFileTypes: true });
    for (const cat of categories) {
      if (!cat.isDirectory()) continue;
      const catDir = path.join(sharedRoot, cat.name);
      try {
        const files = await fsp.readdir(catDir);
        for (const file of files) {
          const key = `${cat.name}/${file}`;
          const rel = path.relative(dbRoot, path.join(catDir, file)).replace(/\\/g, "/");
          sharedIconIndex.set(key, rel);
        }
      } catch { /* skip */ }
    }
  } catch { /* shared dir absent */ }
}

// ── Local HTTP asset server ────────────────────────────────────────────────────
// Endpoints:
//   GET /serve?f={relative-path-from-dbRoot}          → serve a static file
//   GET /unit-data/{heroSlug}                          → serve unit JSON + quotes + poses
function startAssetServer() {
  return new Promise((resolve) => {
    const safeRoot = path.resolve(getDbRoot());

    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, `http://127.0.0.1:${ASSET_PORT}`);

        // ── Static file endpoint ─────────────────────────────────────────────
        if (url.pathname === "/serve") {
          const rel = url.searchParams.get("f");
          if (!rel) { res.writeHead(400); res.end(); return; }

          const full = path.resolve(safeRoot, rel);
          if (!full.startsWith(safeRoot + path.sep) && full !== safeRoot) {
            res.writeHead(403); res.end(); return;
          }

          const data = await fsp.readFile(full);
          res.writeHead(200, {
            "Content-Type": inferMime(full),
            "Cache-Control": "public, max-age=604800",
            "Access-Control-Allow-Origin": "*",
          });
          res.end(data);
          return;
        }

        // ── Unit-data JSON endpoint ──────────────────────────────────────────
        if (url.pathname.startsWith("/unit-data/")) {
          const heroSlug = decodeURIComponent(url.pathname.slice("/unit-data/".length));
          const payload  = await buildLocalUnitData(heroSlug);
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
          });
          res.end(JSON.stringify(payload));
          return;
        }

        res.writeHead(404); res.end();
      } catch {
        res.writeHead(500); res.end();
      }
    });

    server.listen(ASSET_PORT, "127.0.0.1", () => resolve(server));
    server.on("error", (e) => {
      console.error("Asset server error:", e.message);
      resolve(null);
    });
  });
}

// Build the same JSON shape as /api/unit-data/[heroSlug] on Vercel.
async function buildLocalUnitData(heroSlug) {
  const dbRoot = getDbRoot();

  const unitFile = await readLocalJson(path.join(dbRoot, "units", `${heroSlug}.json`));
  const quotesFile = await readLocalJson(path.join(dbRoot, "quotes", "fandom", `${heroSlug}.json`));
  const quoteText = quotesFile?.quote_text ?? null;

  // Fullbody poses
  const DEFAULT_POSE_ORDER = ["portrait", "attack", "special", "damage"];
  let poses = [];
  try {
    const fbDir = path.join(dbRoot, "unit_assets", "fandom", "fullbody", heroSlug);
    const files  = await fsp.readdir(fbDir);
    const poseSet = new Set();
    for (const f of files) {
      const m = f.match(/_(portrait|attack|special|damage)\.(webp|png|jpe?g)$/i);
      if (m?.[1]) poseSet.add(m[1].toLowerCase());
    }
    poses = DEFAULT_POSE_ORDER.filter((p) => poseSet.has(p));
  } catch { /* no local fullbody */ }
  if (!poses.length) poses = ["portrait"];

  // Background options
  let backgroundOptions = [];
  try {
    const bgDir = path.join(dbRoot, "unit_assets", "fandom", "shared", "unit_backgrounds");
    backgroundOptions = (await fsp.readdir(bgDir))
      .filter((f) => /\.(png|webp|jpe?g)$/i.test(f))
      .sort();
  } catch { /* not in bundle */ }

  return { unitFile: unitFile ?? null, quoteText, poses, backgroundOptions };
}

async function readLocalJson(filePath) {
  try { return JSON.parse(await fsp.readFile(filePath, "utf8")); }
  catch { return null; }
}

// ── webRequest interception ────────────────────────────────────────────────────
// Intercepts /api/headshots/* and /api/shared-icons/* on the Vercel domain.
// If the asset is in the local index, redirects to the local HTTP server.
// If not found locally, passes through to Vercel (which falls back to Fandom CDN).
function setupInterception() {
  session.defaultSession.webRequest.onBeforeRequest(
    {
      urls: [
        `https://${VERCEL_HOST}/api/headshots/*`,
        `https://${VERCEL_HOST}/api/shared-icons/*`,
        `https://${VERCEL_HOST}/api/unit-data/*`,
      ],
    },
    (details, callback) => {
      try {
        const url = new URL(details.url);
        const { pathname, searchParams } = url;

        // ── Headshots ──────────────────────────────────────────────────────────
        if (pathname.startsWith("/api/headshots/")) {
          if (!headshotIndex) { callback({}); return; }
          const rawSlug = decodeURIComponent(
            pathname.slice("/api/headshots/".length).split("?")[0]
          );
          const rel =
            headshotIndex.get(rawSlug.toLowerCase()) ??
            headshotIndex.get(normSlug(rawSlug));
          if (rel) {
            callback({
              redirectURL: `http://127.0.0.1:${ASSET_PORT}/serve?f=${encodeURIComponent(rel)}`,
            });
          } else {
            callback({}); // pass through to Vercel
          }
          return;
        }

        // ── Shared icons ───────────────────────────────────────────────────────
        if (pathname.startsWith("/api/shared-icons/")) {
          if (!sharedIconIndex) { callback({}); return; }
          const category = pathname.slice("/api/shared-icons/".length).split("/")[0];
          const name = searchParams.get("name");
          const key  = name ? `${category}/${name}` : null;
          const rel  = key ? sharedIconIndex.get(key) : undefined;
          if (rel) {
            callback({
              redirectURL: `http://127.0.0.1:${ASSET_PORT}/serve?f=${encodeURIComponent(rel)}`,
            });
          } else {
            callback({}); // pass through to Vercel
          }
          return;
        }

        // ── Unit data JSON (quotes, artist, build, IVs, guide) ─────────────────
        // Always serve from local bundle if db/units/ is present — this is the
        // key fix for missing artist/quotes/skills on Vercel.
        if (pathname.startsWith("/api/unit-data/")) {
          const heroSlug = decodeURIComponent(
            pathname.slice("/api/unit-data/".length).split("?")[0]
          );
          const dbRoot = getDbRoot();
          if (fs.existsSync(dbRoot)) {
            callback({
              redirectURL: `http://127.0.0.1:${ASSET_PORT}/unit-data/${encodeURIComponent(heroSlug)}`,
            });
          } else {
            callback({}); // no local data — pass through
          }
          return;
        }
      } catch { /* fall through */ }
      callback({});
    }
  );
}

// ── Probe local dev server (fast, 800 ms timeout) ─────────────────────────────
function probeLocalServer() {
  return new Promise((resolve) => {
    const req = http.get(LOCAL_URL, { timeout: 800 }, (res) => {
      res.destroy();
      resolve(res.statusCode < 500);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

// ── GitHub release helpers ─────────────────────────────────────────────────────
function fetchLatestRelease() {
  return new Promise((resolve) => {
    const req = https.get(
      RELEASES_API,
      { headers: { "User-Agent": `FEH-Barracks-Launcher/${pkg.version}` } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const json  = JSON.parse(data);
            const asset = (json.assets || []).find((a) => a.name === BUNDLE_NAME);
            resolve({
              tag:         json.tag_name || pkg.version,
              downloadUrl: asset?.browser_download_url ?? null,
              assetSize:   asset?.size ?? 0,
            });
          } catch {
            resolve({ tag: pkg.version, downloadUrl: null, assetSize: 0 });
          }
        });
      }
    );
    req.on("error", () => resolve({ tag: pkg.version, downloadUrl: null, assetSize: 0 }));
    req.setTimeout(8000, () => {
      req.destroy();
      resolve({ tag: pkg.version, downloadUrl: null, assetSize: 0 });
    });
  });
}

function readInstalledVersion() {
  try { return fs.readFileSync(getVersionFile(), "utf8").trim(); } catch { return null; }
}

// ── Streaming download with redirect handling and progress ─────────────────────
function downloadFile(url, destPath, totalSize, onProgress, _redirectsLeft = 8) {
  return new Promise((resolve, reject) => {
    const doRequest = (targetUrl, left) => {
      if (left <= 0) { reject(new Error("Too many redirects")); return; }
      const proto = targetUrl.startsWith("https://") ? https : http;
      proto
        .get(targetUrl, { headers: { "User-Agent": `FEH-Barracks-Launcher/${pkg.version}` } }, (res) => {
          if ([301, 302, 307, 308].includes(res.statusCode)) {
            res.destroy();
            doRequest(res.headers.location, left - 1);
            return;
          }
          if (res.statusCode !== 200) {
            res.destroy();
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          const realTotal = parseInt(res.headers["content-length"] || "0", 10) || totalSize;
          let received = 0;
          const out = fs.createWriteStream(destPath);
          res.on("data", (chunk) => {
            received += chunk.length;
            out.write(chunk);
            if (onProgress && realTotal > 0) onProgress(received, realTotal);
          });
          res.on("end",   () => { out.end(); resolve(); });
          res.on("error", (e) => { out.destroy(); reject(e); });
          out.on("error", reject);
        })
        .on("error", reject);
    };
    doRequest(url, _redirectsLeft);
  });
}

// ── Extract via PowerShell ─────────────────────────────────────────────────────
function extractZip(zipPath, destDir) {
  const pwsh = fs.existsSync("C:/Program Files/PowerShell/7/pwsh.exe")
    ? "C:/Program Files/PowerShell/7/pwsh.exe"
    : "powershell.exe";
  // Use -LiteralPath to avoid glob expansion issues, and pipe output so the
  // child process doesn't inherit a null handle (which caused silent failures
  // in packaged Electron apps where there is no console stdio).
  const cmd = [
    "Expand-Archive",
    `-LiteralPath '${zipPath.replace(/'/g, "''")}'`,
    `-DestinationPath '${destDir.replace(/'/g, "''")}'`,
    "-Force",
    "-ErrorAction Stop",
  ].join(" ");
  const result = spawnSync(pwsh, ["-NoProfile", "-NonInteractive", "-Command", cmd], {
    stdio:   "pipe",   // capture output — never inherit in a packaged app
    timeout: 180000,
    encoding: "utf8",
  });
  const stderr = (result.stderr || "").trim();
  const stdout = (result.stdout || "").trim();
  if (result.status !== 0 || result.error) {
    const detail = stderr || stdout || (result.error?.message ?? "unknown error");
    throw new Error(`Expand-Archive failed (exit ${result.status}): ${detail}`);
  }
}

// ── Window factories ───────────────────────────────────────────────────────────
function createSplash() {
  splashWin = new BrowserWindow({
    width: 480, height: 300,
    frame: false, resizable: false, center: true,
    icon: getIconPath(),
    backgroundColor: "#0a0a1a",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  splashWin.loadFile(path.join(__dirname, "renderer", "index.html"));
  splashWin.setMenuBarVisibility(false);
}

function createMainWindow(appUrl) {
  const isLocal = appUrl.startsWith("http://localhost");
  mainWin = new BrowserWindow({
    width: 1280, height: 800,
    show: false,
    icon: getIconPath(),
    backgroundColor: "#0a0a1a",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // Allow HTTP responses from local asset server while the page is served
      // over HTTPS. This is intentional for the desktop app context.
      webSecurity: false,
    },
  });
  mainWin.setMenuBarVisibility(false);

  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  let pct = isLocal ? 60 : 92;
  const label = isLocal ? "Loading local server…" : "Opening FEH Barracks…";
  const tick = setInterval(() => {
    pct = Math.min(pct + (isLocal ? 3 : 0.6), 98);
    send(splashWin, "progress", { pct, label });
  }, 150);

  mainWin.webContents.once("did-finish-load", () => {
    clearInterval(tick);
    send(splashWin, "done", "ok");
    setTimeout(() => {
      if (splashWin && !splashWin.isDestroyed()) splashWin.close();
      if (mainWin  && !mainWin.isDestroyed())   { mainWin.show(); mainWin.focus(); }
    }, 500);
  });

  mainWin.webContents.on("did-fail-load", (_e, code, desc) => {
    clearInterval(tick);
    send(splashWin, "log",      `Load failed: ${desc} (${code})`);
    send(splashWin, "progress", { pct: 0, label: "Connection failed — check your internet." });
  });

  mainWin.loadURL(appUrl);
}

// ── IPC ────────────────────────────────────────────────────────────────────────
ipcMain.on("get-asset-path", (event, name) => {
  event.returnValue = app.isPackaged
    ? path.join(process.resourcesPath, "assets", name)
    : path.join(__dirname, "assets", name);
});

// ── Boot ───────────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  createSplash();
  send(splashWin, "progress", { pct: 5, label: "Connecting…" });

  // Probe local dev server and fetch release metadata in parallel.
  const [isLocal, release] = await Promise.all([probeLocalServer(), fetchLatestRelease()]);
  send(splashWin, "init", { version: release.tag });

  // ── Local dev mode ─────────────────────────────────────────────────────────
  if (isLocal) {
    send(splashWin, "log",      "Local dev server detected — loading localhost:3000");
    send(splashWin, "progress", { pct: 55, label: "Local server detected…" });
    createMainWindow(LOCAL_URL);
    return;
  }

  // ── Check / download data bundle ───────────────────────────────────────────
  const dataRoot     = getDataRoot();
  const unitsDir     = path.join(getDbRoot(), "units");
  const installedVer = readInstalledVersion();

  // Force re-download if version matches but units/ is actually missing —
  // prevents a stale version.txt from permanently blocking the download.
  const unitsExist   = fs.existsSync(unitsDir) &&
    (() => { try { return fs.readdirSync(unitsDir).length > 0; } catch { return false; } })();
  const needsDownload = !installedVer || installedVer !== release.tag || !unitsExist;

  send(splashWin, "log",
    `Version check — installed: ${installedVer ?? "none"}, latest: ${release.tag}, units on disk: ${unitsExist}`
  );

  if (!release.downloadUrl) {
    // GitHub API returned but had no matching asset (unusual).
    const msg = `Could not find ${BUNDLE_NAME} in release ${release.tag}.\nImages will load from CDN.`;
    send(splashWin, "log", msg);
    dialog.showErrorBox("FEH Barracks — Data Bundle Missing", msg);
  } else if (needsDownload) {
    await fsp.mkdir(dataRoot, { recursive: true });
    const zipDest = path.join(dataRoot, BUNDLE_NAME);

    const reason = !installedVer
      ? `First install — downloading data bundle (${release.tag})…`
      : !unitsExist
      ? `Local data missing despite version match — re-downloading (${release.tag})…`
      : `Update available: ${installedVer} → ${release.tag}`;

    send(splashWin, "log", reason);
    send(splashWin, "progress", { pct: 5, label: "Downloading data bundle…" });

    let downloadOk = false;
    try {
      await downloadFile(
        release.downloadUrl,
        zipDest,
        release.assetSize,
        (rx, tot) => {
          const pct = Math.round(5 + (rx / tot) * 52); // 5% → 57%
          const mb  = (rx  / 1024 / 1024).toFixed(1);
          const tmb = (tot / 1024 / 1024).toFixed(1);
          send(splashWin, "progress", { pct, label: `Downloading… ${mb} / ${tmb} MB` });
        }
      );
      downloadOk = true;
    } catch (err) {
      const msg = `Download failed: ${err.message}`;
      send(splashWin, "log", msg);
      dialog.showErrorBox("FEH Barracks — Download Failed", `${msg}\n\nImages will load from CDN.`);
    }

    if (downloadOk) {
      send(splashWin, "progress", { pct: 60, label: "Extracting data…" });
      send(splashWin, "log", "Extracting bundle…");
      try {
        extractZip(zipDest, dataRoot);
        await fsp.rm(zipDest, { force: true }).catch(() => {});

        // Verify extraction succeeded before writing version stamp.
        const afterUnits = fs.existsSync(unitsDir) &&
          (() => { try { return fs.readdirSync(unitsDir).length > 0; } catch { return false; } })();

        if (afterUnits) {
          await fsp.writeFile(getVersionFile(), release.tag, "utf8");
          send(splashWin, "log", `Data bundle installed (${release.tag})`);
        } else {
          const msg = "Extraction completed but db/units/ appears empty — check disk space.";
          send(splashWin, "log", msg);
          dialog.showErrorBox("FEH Barracks — Extraction Issue", msg);
        }
      } catch (err) {
        const msg = `Extraction failed: ${err.message}`;
        send(splashWin, "log", msg);
        dialog.showErrorBox("FEH Barracks — Extraction Failed", `${msg}\n\nImages will load from CDN.`);
      }
    }

    send(splashWin, "progress", { pct: 72, label: "Building asset index…" });
  } else {
    send(splashWin, "log", `Data up to date (${installedVer})`);
    send(splashWin, "progress", { pct: 72, label: "Building asset index…" });
  }

  // ── Start local asset server if data is present ────────────────────────────
  const dbRoot = getDbRoot();
  if (fs.existsSync(dbRoot)) {
    await buildIndices();
    send(splashWin, "log",
      `Asset index ready: ${headshotIndex.size} heroes, ${sharedIconIndex.size} icons`
    );

    const assetServer = await startAssetServer();
    if (assetServer) {
      setupInterception();
      send(splashWin, "log", `Local asset server on port ${ASSET_PORT}`);
    }
  } else {
    send(splashWin, "log", "No local data bundle found — all assets will load from CDN");
  }

  send(splashWin, "progress", { pct: 90, label: "Opening FEH Barracks…" });
  createMainWindow(REMOTE_URL);
});

app.on("window-all-closed", () => app.quit());
