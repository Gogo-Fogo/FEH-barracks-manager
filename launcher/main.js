"use strict";

const { app, BrowserWindow, shell } = require("electron");
const path = require("node:path");

const APP_URL = "https://feh-barracks-manager.vercel.app";

let win = null;

function createWindow() {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, "assets", "gullveig.png")
    : path.join(__dirname, "assets", "gullveig.png");

  win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "FEH Barracks Manager",
    icon: iconPath,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL(APP_URL);
  win.setMenuBarVisibility(false);

  // Open _blank links (OAuth redirects, external links) in the system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  app.quit();
});
