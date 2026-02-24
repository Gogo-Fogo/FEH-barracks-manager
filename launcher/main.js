"use strict";

const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const { createCore } = require("./launcher-core");

let win = null;

function send(channel, ...args) {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, ...args);
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 600,
    height: 400,
    resizable: false,
    frame: true,
    backgroundColor: "#0a0a1a",
    title: "FEH Barracks Manager",
    icon: path.join(__dirname, "assets", "gullveig.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.setMenuBarVisibility(false);

  win.webContents.once("did-finish-load", () => {
    runLauncher();
  });
}

async function runLauncher() {
  const core = createCore({
    logger: {
      log: (msg) => send("log", msg),
      progress: (pct, label) => send("progress", { pct, label }),
    },
    isPackaged: app.isPackaged,
    execPath: app.getPath("exe"),
  });

  // Load saved token
  const savedToken = await core.readSavedToken();
  if (savedToken) core.setRuntimeToken(savedToken);

  try {
    const state = await core.autoUpdateAndLaunch();
    send("done", state);
  } catch (err) {
    const msg = String(err?.message || err);
    send("log", `\nError: ${msg}`);

    // Prompt for token if it looks like an auth issue
    if (/404|401|private/i.test(msg) && !/token/i.test(msg)) {
      send("need-token");
    } else {
      send("done", "error");
    }
  }
}

// Resolve asset path for renderer (works both in dev and packaged)
ipcMain.on("get-asset-path", (event, name) => {
  event.returnValue = app.isPackaged
    ? path.join(process.resourcesPath, "assets", name)
    : path.join(__dirname, "assets", name);
});

// Token submitted from renderer
ipcMain.on("submit-token", async (_, token) => {
  const { createCore: makeCore } = require("./launcher-core");
  const core = makeCore({
    logger: {
      log: (msg) => send("log", msg),
      progress: (pct, label) => send("progress", { pct, label }),
    },
    isPackaged: app.isPackaged,
    execPath: app.getPath("exe"),
  });
  core.provideToken(token);
  send("log", "Token saved. Retrying...");
  try {
    const state = await core.autoUpdateAndLaunch();
    send("done", state);
  } catch (err) {
    send("log", `Retry failed: ${err.message}`);
    send("done", "error");
  }
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  app.quit();
});
