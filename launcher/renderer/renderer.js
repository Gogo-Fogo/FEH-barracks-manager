"use strict";

// ── Background image ──────────────────────────────────────────
const imgPath = window.launcher.getAssetPath("gullveig.png");
document.getElementById("bg").style.backgroundImage =
  `url('${imgPath.replace(/\\/g, "/")}')`;

// ── Version label (from title bar title injected at build) ────
// Electron sets the window title; we just show the app version
// string if it was embedded via the productVersion field.
// For now, leave blank — could be populated via IPC if needed.

// ── Log ───────────────────────────────────────────────────────
const logArea = document.getElementById("log-area");
const MAX_LOG_LINES = 60;

window.launcher.onLog((msg) => {
  // split multi-line messages
  const lines = String(msg).split(/\r?\n/);
  for (const line of lines) {
    if (line.trim() === "") continue;
    const el = document.createElement("div");
    el.textContent = line;
    logArea.appendChild(el);
  }
  // prune old lines
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
    label.textContent = "Launching app...";
    // Window will be closed by main process after browser opens,
    // or we close it here after a short delay.
    setTimeout(() => window.close(), 2000);
  }
});

// ── Token input ───────────────────────────────────────────────
const tokenSection = document.getElementById("token-section");
const tokenInput   = document.getElementById("token-input");
const tokenSubmit  = document.getElementById("token-submit");

window.launcher.onNeedToken(() => {
  tokenSection.classList.remove("hidden");
  tokenInput.focus();
});

tokenSubmit.addEventListener("click", () => {
  const t = tokenInput.value.trim();
  if (!t) return;
  tokenSection.classList.add("hidden");
  window.launcher.submitToken(t);
});

tokenInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") tokenSubmit.click();
});
