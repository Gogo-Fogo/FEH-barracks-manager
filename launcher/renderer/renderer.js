"use strict";

// ── Background image ──────────────────────────────────────────
const imgPath = window.launcher.getAssetPath("edelgard_husk.png");
document.getElementById("bg").style.backgroundImage =
  `url('${imgPath.replace(/\\/g, "/")}')`;

// ── Version label ─────────────────────────────────────────────
window.launcher.onInit(({ version }) => {
  const el = document.getElementById("version");
  if (el) el.textContent = version;
});

// ── Log ───────────────────────────────────────────────────────
const logArea = document.getElementById("log-area");
const MAX_LOG_LINES = 60;

window.launcher.onLog((msg) => {
  const lines = String(msg).split(/\r?\n/);
  for (const line of lines) {
    if (line.trim() === "") continue;
    const el = document.createElement("div");
    el.textContent = line;
    logArea.appendChild(el);
  }
  while (logArea.children.length > MAX_LOG_LINES) {
    logArea.removeChild(logArea.firstChild);
  }
  logArea.scrollTop = logArea.scrollHeight;
});

// ── Progress ──────────────────────────────────────────────────
const bar   = document.getElementById("progress-bar");
const label = document.getElementById("progress-label");

window.launcher.onProgress(({ pct, label: text }) => {
  bar.style.width = Math.min(100, Math.max(0, pct)) + "%";
  if (text) label.textContent = text;
});

// ── Done ──────────────────────────────────────────────────────
window.launcher.onDone((state) => {
  bar.style.width = "100%";
  if (state === "error") {
    label.textContent = "Something went wrong — see log above.";
    bar.style.background = "#8b2020";
  } else {
    label.textContent = "Launching app…";
    // Main process closes this window at 500 ms; this is a fallback.
    setTimeout(() => window.close(), 2000);
  }
});
