"use strict";

// ── Background image ──────────────────────────────────────────
const imgPath = window.launcher.getAssetPath("edelgard_husk.webp");
document.getElementById("bg").style.backgroundImage =
  `url('${imgPath.replace(/\\/g, "/")}')`;

function stripMarkdownLine(value) {
  return String(value || "")
    .replace(/<img[^>]*>/gi, "")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_>#]/g, "")
    .replace(/^\s*[-*]\s+/, "")
    .replace(/^\s*\d+\.\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractReleaseNotes(body) {
  const lines = String(body || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const bulletLines = lines
    .filter((line) => /^[-*]\s+/.test(line))
    .map(stripMarkdownLine)
    .filter(Boolean);

  if (bulletLines.length) {
    return bulletLines.slice(0, 6);
  }

  return lines
    .map(stripMarkdownLine)
    .filter(Boolean)
    .slice(0, 4);
}

// ── Version label ─────────────────────────────────────────────
window.launcher.onInit(({ launcherVersion, latestVersion, installedVersion }) => {
  const versionEl = document.getElementById("version");
  const launcherEl = document.getElementById("launcher-version");
  const latestEl = document.getElementById("latest-version");
  const installedEl = document.getElementById("installed-version");

  if (versionEl) versionEl.textContent = `Latest ${latestVersion || "-"}`;
  if (launcherEl) launcherEl.textContent = launcherVersion || "-";
  if (latestEl) latestEl.textContent = latestVersion || "-";
  if (installedEl) installedEl.textContent = installedVersion || "Not installed";
});

// ── Update notes ──────────────────────────────────────────────
const notesCard = document.getElementById("notes-card");
const notesTitle = document.getElementById("notes-title");
const notesVersion = document.getElementById("notes-version");
const notesList = document.getElementById("notes-list");
const notesEmpty = document.getElementById("notes-empty");

window.launcher.onUpdateInfo(({ hasUpdate, installedVersion, latestVersion, releaseName, notes, firstInstall, refreshOnly }) => {
  if (!notesCard || !notesTitle || !notesVersion || !notesList || !notesEmpty) return;

  notesList.replaceChildren();

  if (!hasUpdate) {
    notesCard.classList.add("hidden");
    notesEmpty.classList.add("hidden");
    return;
  }

  notesCard.classList.remove("hidden");
  notesTitle.textContent = firstInstall
    ? `Installing ${releaseName || latestVersion || "latest release"}`
    : refreshOnly
    ? `Refreshing local bundle for ${latestVersion || "-"}`
    : `Updating ${installedVersion || "-"} -> ${latestVersion || "-"}`;
  notesVersion.textContent = latestVersion || "-";

  const items = extractReleaseNotes(notes);
  if (!items.length) {
    notesEmpty.classList.remove("hidden");
    return;
  }

  notesEmpty.classList.add("hidden");
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item;
    notesList.appendChild(li);
  }
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
const bar = document.getElementById("progress-bar");
const label = document.getElementById("progress-label");
const note = document.getElementById("status-note");
const heading = document.getElementById("status-heading");

window.launcher.onProgress(({ pct, label: text, detail }) => {
  bar.style.width = Math.min(100, Math.max(0, pct)) + "%";
  if (text) label.textContent = text;
  if (text && heading) heading.textContent = text;
  if (detail && note) note.textContent = detail;
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
