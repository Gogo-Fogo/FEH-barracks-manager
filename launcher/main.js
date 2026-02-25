"use strict";

const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("node:path");
const https = require("node:https");
const pkg   = require("./package.json");

const APP_URL      = "https://feh-barracks-manager.vercel.app";
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

// Fetch latest GitHub release tag (shown in the splash version label).
// Falls back to package.json version on any error or timeout.
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

// ── Splash window (frameless, shows while the app URL loads) ──────────────────
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

// ── Main window (hidden until the app finishes loading) ───────────────────────
function createMainWindow() {
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

  // Open links that target _blank (OAuth, external pages) in the system browser
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Animate the progress bar while the URL is loading
  let pct = 10;
  const tick = setInterval(() => {
    pct = Math.min(pct + 1.2, 88);
    send(splashWin, "progress", { pct, label: "Connecting to FEH Barracks…" });
  }, 100);

  mainWin.webContents.once("did-finish-load", () => {
    clearInterval(tick);
    send(splashWin, "done", "ok"); // splash shows "Launching app…" for 500 ms
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

  mainWin.loadURL(APP_URL);
}

// ── IPC ───────────────────────────────────────────────────────────────────────
ipcMain.on("get-asset-path", (event, name) => {
  event.returnValue = app.isPackaged
    ? path.join(process.resourcesPath, "assets", name)
    : path.join(__dirname, "assets", name);
});

// ── Boot ──────────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // Show splash immediately; fetch release version in background
  createSplash();
  createMainWindow();

  fetchLatestTag().then((version) => {
    send(splashWin, "init", { version });
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
