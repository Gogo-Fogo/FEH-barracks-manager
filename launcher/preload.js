"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("launcher", {
  getAssetPath: (name) => ipcRenderer.sendSync("get-asset-path", name),
  onLog:        (cb) => ipcRenderer.on("log",        (_, msg)  => cb(msg)),
  onProgress:   (cb) => ipcRenderer.on("progress",   (_, data) => cb(data)),
  onDone:       (cb) => ipcRenderer.on("done",        (_, s)   => cb(s)),
  onNeedToken:  (cb) => ipcRenderer.on("need-token",  ()       => cb()),
  submitToken:  (t)  => ipcRenderer.send("submit-token", t),
});
