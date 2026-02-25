"use strict";

const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("node:path");
const https = require("node:https");
const http  = require("node:http");
const pkg   = require("./package.json");

const LOCAL_URL   = "http://localhost:3000";
const REMOTE_URL  = "https://feh-barracks-manager.vercel.app";
const RELEASES_API = "https://api.github.com/repos/Gogo-Fogo/FEH-barracks-manager/releases/latest";

let mainWin   = null;
let splashWin = null;

function getIconPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "assets", "gullveig.png")
    : path.join(__dirname, "assets", "gullveig.png");
}

function send(win, channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

// Check if the local dev server is up (fast, 800 ms timeout).
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

// Fetch latest GitHub release tag (shown in the splash version label).
function fetchLatestTag() {
  return new Promise((resolve) => {
    const req = https.get(RELEASES_API, {
      headers: { "User-Agent": `FEH-Barracks-Launcher/${pkg.version}` },
    }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve(JSON.parse(data).tag_name || pkg.version); }
        catch { resolve(pkg.version); }
      });
    });
    req.on("error", () => resolve(pkg.version));
    req.setTimeout(5000, () => { req.destroy(); resolve(pkg.version); });
  });
}

// ── Splash window ─────────────────────────────────────────────────────────────
function createSplash() {
  splashWin = new BrowserWindow({
    width: 480,
    height: 300,
    frame: false,
    resizable: false,
    center: true,
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

  splashWin.webContents.once("did-finish-load", () => {
    send(splashWin, "progress", { pct: 10, label: "Connecting to FEH Barracks…" });
  });
}

// ── Main window ───────────────────────────────────────────────────────────────
function createMainWindow(appUrl) {
  const isLocal = appUrl.startsWith("http://localhost");

  mainWin = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    icon: getIconPath(),
    backgroundColor: "#0a0a1a",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWin.setMenuBarVisibility(false);

  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  const label = isLocal ? "Loading local server…" : "Connecting to FEH Barracks…";
  let pct = 10;
  const tick = setInterval(() => {
    pct = Math.min(pct + (isLocal ? 4 : 1.2), 88);
    send(splashWin, "progress", { pct, label });
  }, 100);

  mainWin.webContents.once("did-finish-load", () => {
    clearInterval(tick);
    send(splashWin, "done", "ok");
    setTimeout(() => {
      if (splashWin && !splashWin.isDestroyed()) splashWin.close();
      if (mainWin  && !mainWin.isDestroyed())  { mainWin.show(); mainWin.focus(); }
    }, 500);
  });

  mainWin.webContents.on("did-fail-load", (_e, code, desc) => {
    clearInterval(tick);
    send(splashWin, "log",      `Could not connect: ${desc} (${code})`);
    send(splashWin, "progress", { pct: 0, label: "Connection failed — check your internet." });
  });

  mainWin.loadURL(appUrl);
}

// ── IPC ───────────────────────────────────────────────────────────────────────
ipcMain.on("get-asset-path", (event, name) => {
  event.returnValue = app.isPackaged
    ? path.join(process.resourcesPath, "assets", name)
    : path.join(__dirname, "assets", name);
});

// ── Boot ──────────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  createSplash();

  // Probe local dev server and fetch version in parallel
  const [isLocal, version] = await Promise.all([
    probeLocalServer(),
    fetchLatestTag(),
  ]);

  const appUrl = isLocal ? LOCAL_URL : REMOTE_URL;
  send(splashWin, "init", { version });

  if (isLocal) {
    send(splashWin, "log", "Local server detected — using localhost:3000");
  }

  createMainWindow(appUrl);
});

app.on("window-all-closed", () => {
  app.quit();
});
