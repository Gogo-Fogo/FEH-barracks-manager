#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const INDEX_PATH = path.join(ROOT, "db", "index.json");
const ALIAS_PATH = path.join(ROOT, "db", "hero_aliases.json");
const FANDOM_NAME_MAP_PATH = path.join(
  ROOT,
  "app",
  "src",
  "lib",
  "fandom-name-map.json",
);
const REPORT_DIR = path.join(ROOT, "release_local", "fandom-backfill");

const LIMIT_ARG = process.argv.find((arg) => arg.startsWith("--limit="));
const ONLY_ARG = process.argv.find((arg) => arg.startsWith("--only="));
const BATCH_ARG = process.argv.find((arg) => arg.startsWith("--batch-size="));
const REPORT_ONLY = process.argv.includes("--report-only");

const LIMIT = LIMIT_ARG
  ? Number(LIMIT_ARG.replace("--limit=", "").trim())
  : null;
const BATCH_SIZE = BATCH_ARG
  ? Number(BATCH_ARG.replace("--batch-size=", "").trim())
  : 25;
const ONLY = ONLY_ARG
  ? new Set(
      ONLY_ARG.replace("--only=", "")
        .split(",")
        .map((value) => normalizeKey(value))
        .filter(Boolean),
    )
  : null;

const MANUAL_QUERY_OVERRIDES = {
  "caeda talyss heart": ["Caeda Talys"],
  "conrad unmasked knight": ["Conrad Knight"],
  "fiora defrosted ilian": ["Fiora Defrosted"],
  "gustav exsanguinator": ["Valentine Gustav"],
  "larachel harvest princess": ["L'Arachel Harvest Princess"],
  "larachel princess of light": ["L'Arachel Princess of Light"],
  "leo seashores prince": ["Leo Seashore Prince"],
  "linhardt hevrings heir": ["Linhardt Hevring"],
  "lonqu solitary blade": ["Lon'qu Solitary Blade"],
  "tanya dagdars kid": ["Tanya Dagdar"],
};

const TITLE_MATCH_SYNONYM_GROUPS = [
  ["adrift", "dream"],
  [
    "summer",
    "tropical",
    "seashore",
    "seashores",
    "seaside",
    "vacationer",
    "heat",
    "paradise",
  ],
  ["bridal", "bride", "brides", "money", "maiden"],
  ["spring", "springtime", "earsome"],
  ["new", "year", "newyear", "holiday"],
  ["halloween", "harvest"],
  ["valentine", "valentines", "exsanguinator"],
  ["young", "child"],
  ["m", "male", "prince"],
  ["f", "female", "princess"],
];

const ARTICLE_PREFIX_TOKENS = new Set([
  "summer",
  "bridal",
  "spring",
  "new",
  "year",
  "newyear",
  "halloween",
  "valentine",
  "young",
  "fallen",
  "legendary",
  "mythic",
  "ascended",
  "attuned",
  "rearmed",
  "harmonized",
  "duo",
  "winter",
  "ninja",
  "pirate",
  "child",
  "desert",
  "tea",
  "tribal",
  "khadein",
  "flame",
]);

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function normalizeKey(text) {
  const transliterated = String(text || "")
    .replace(/[ðÐ]/g, "d")
    .replace(/[þÞ]/g, "th")
    .replace(/[æÆ]/g, "ae")
    .replace(/[œŒ]/g, "oe")
    .replace(/[øØ]/g, "o")
    .replace(/[łŁ]/g, "l")
    .replace(/[’'`]/g, "");

  return transliterated
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function toFandomBase(name) {
  return String(name || "")
    .replace(/\s+-\s+/g, " ")
    .trim();
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function commandForCurrentPlatform(name) {
  if (process.platform !== "win32") return name;
  return name === "npm" ? "npm.cmd" : name;
}

function quoteWindowsArg(value) {
  const text = String(value ?? "");
  if (text.length === 0) return '""';
  if (!/[\s"&()^<>|]/.test(text)) return text;

  return `"${text.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, "$1$1")}"`;
}

function runCommand(command, args, options = {}) {
  const spawnOptions = {
    cwd: ROOT,
    stdio: "inherit",
    ...options,
  };

  let executable = command;
  let executableArgs = args;

  if (process.platform === "win32") {
    executable = process.env.ComSpec || "cmd.exe";
    executableArgs = [
      "/d",
      "/s",
      "/c",
      [command, ...args].map((arg) => quoteWindowsArg(arg)).join(" "),
    ];
  }

  const result = spawnSync(executable, executableArgs, spawnOptions);

  return result.status === 0;
}

function apiGetJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            Accept: "application/json",
            ...headers,
          },
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 400) {
            res.resume();
            reject(new Error(`HTTP ${res.statusCode} for ${url}`));
            return;
          }

          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            try {
              resolve(JSON.parse(data));
            } catch (error) {
              reject(error);
            }
          });
        },
      )
      .on("error", reject);
  });
}

async function getFandomHeadshotBases() {
  let imcontinue = "";
  const seen = new Set();

  while (true) {
    const url =
      "https://feheroes.fandom.com/api.php?action=query&format=json&titles=List_of_Heroes&prop=images&imlimit=500" +
      (imcontinue ? `&imcontinue=${encodeURIComponent(imcontinue)}` : "");

    const json = await apiGetJson(url);
    const page = Object.values((json.query && json.query.pages) || {})[0] || {};

    for (const image of page.images || []) {
      const title = image.title || "";
      const match = title.match(/^File:(.+) Face FC\.(webp|png|jpg|jpeg)$/i);
      if (!match) continue;
      seen.add(match[1]);
    }

    imcontinue =
      json.continue && json.continue.imcontinue ? json.continue.imcontinue : "";
    if (!imcontinue) break;
  }

  return [...seen].sort((a, b) => a.localeCompare(b));
}

function buildCoverage(indexRows, aliasData, fandomNameMap) {
  const coverage = new Set();
  const indexUrls = new Set();

  for (const value of Object.values(fandomNameMap)) {
    const key = normalizeKey(value);
    if (key) coverage.add(key);
  }

  for (const row of indexRows) {
    const key = normalizeKey(toFandomBase(row?.name));
    if (key) coverage.add(key);
    const url = String(row?.url || "").trim();
    if (url) indexUrls.add(url);
  }

  for (const entry of aliasData.entries || []) {
    const canonicalKey = normalizeKey(toFandomBase(entry.canonical_name));
    if (canonicalKey) coverage.add(canonicalKey);

    for (const alias of entry.aliases || []) {
      const aliasKey = normalizeKey(toFandomBase(alias));
      if (aliasKey) coverage.add(aliasKey);
    }
  }

  return { coverage, indexUrls };
}

function isLikelyHeroArticleTitle(title) {
  return /\b(Builds and Best (IVs|Refine)|Best Builds and Best IVs)\b/i.test(
    String(title || ""),
  );
}

function articleBaseName(title) {
  return String(title || "")
    .replace(/\s+\|\s*Fire Emblem Heroes.*$/i, "")
    .replace(/\s+Builds and Best (IVs|Refine).*$/i, "")
    .replace(/\s+Best Builds and Best IVs.*$/i, "")
    .trim();
}

function expandMatchTokens(tokens) {
  const expanded = new Set(tokens);

  for (const group of TITLE_MATCH_SYNONYM_GROUPS) {
    if (group.some((token) => expanded.has(token))) {
      for (const token of group) {
        expanded.add(token);
      }
    }
  }

  if (expanded.has("new") && expanded.has("year")) {
    expanded.add("newyear");
  }

  if (expanded.has("l") && expanded.has("arachel")) {
    expanded.add("larachel");
  }

  return expanded;
}

function scoreArchiveCandidate(fandomBase, articleName) {
  const queryTokens = expandMatchTokens(
    normalizeKey(fandomBase).split(" ").filter(Boolean),
  );
  const articleTokens = expandMatchTokens(
    normalizeKey(articleName).split(" ").filter(Boolean),
  );
  let score = 0;

  for (const token of articleTokens) {
    if (queryTokens.has(token)) {
      score += 12;
    } else {
      score -= ARTICLE_PREFIX_TOKENS.has(token) ? 4 : 2;
    }
  }

  for (const token of queryTokens) {
    if (articleTokens.has(token)) {
      score += 6;
    }
  }

  if (queryTokens.has("prince") || queryTokens.has("m")) {
    if (articleTokens.has("m")) score += 20;
    if (articleTokens.has("f")) score -= 25;
  }

  if (queryTokens.has("princess") || queryTokens.has("f")) {
    if (articleTokens.has("f")) score += 20;
    if (articleTokens.has("m")) score -= 25;
  }

  if (queryTokens.has("dream") && articleTokens.has("adrift")) {
    score += 12;
  }

  const queryHasPrefixHints = [...queryTokens].some((token) =>
    ARTICLE_PREFIX_TOKENS.has(token),
  );
  const articleHasPrefixHints = [...articleTokens].some((token) =>
    ARTICLE_PREFIX_TOKENS.has(token),
  );

  if (!queryHasPrefixHints && articleHasPrefixHints) {
    score -= 5;
  }

  const firstQueryToken = normalizeKey(fandomBase).split(" ")[0];
  const firstArticleToken = normalizeKey(articleName).split(" ")[0];

  if (firstQueryToken && firstQueryToken === firstArticleToken) {
    score += 8;
  }

  return score;
}

async function resolveGame8Archive(fandomBase) {
  const normalizedBase = normalizeKey(fandomBase);
  const queries = [
    ...(MANUAL_QUERY_OVERRIDES[normalizedBase] || []),
    fandomBase,
  ].filter(Boolean);
  const seenQueries = new Set();
  const candidatesById = new Map();

  for (const query of queries) {
    const normalizedQuery = normalizeKey(query);
    if (!normalizedQuery || seenQueries.has(normalizedQuery)) continue;
    seenQueries.add(normalizedQuery);

    const url = `https://game8.co/api/suggestions?game_id=964&search=${encodeURIComponent(query)}`;
    const json = await apiGetJson(url, {
      "X-Requested-With": "XMLHttpRequest",
    });
    const archives = Array.isArray(json.archives) ? json.archives : [];
    const heroArchives = archives.filter((row) =>
      isLikelyHeroArticleTitle(row.title),
    );
    for (const row of heroArchives) {
      const articleName = articleBaseName(row.title);
      const score = scoreArchiveCandidate(fandomBase, articleName);
      const existing = candidatesById.get(row.id);

      if (!existing || score > existing.score) {
        candidatesById.set(row.id, {
          query,
          id: row.id,
          title: row.title,
          article_name: articleName,
          archive_url: `https://game8.co/games/fire-emblem-heroes/archives/${row.id}`,
          updated_at: row.updated_at || null,
          score,
        });
      }
    }
  }

  const candidates = [...candidatesById.values()].sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return String(left.article_name || "").localeCompare(
      String(right.article_name || ""),
    );
  });

  if (candidates.length === 0) {
    return null;
  }

  const [best, runnerUp] = candidates;
  return {
    ...best,
    confidence_gap: runnerUp ? best.score - runnerUp.score : null,
    candidates: candidates.slice(0, 5),
  };
}

async function buildBackfillReport() {
  const indexRows = readJson(INDEX_PATH, []);
  const aliasData = readJson(ALIAS_PATH, { entries: [] });
  const fandomNameMap = readJson(FANDOM_NAME_MAP_PATH, {});
  const fandomBases = await getFandomHeadshotBases();
  const { coverage, indexUrls } = buildCoverage(
    indexRows,
    aliasData,
    fandomNameMap,
  );

  let missingBases = fandomBases.filter(
    (base) => !coverage.has(normalizeKey(base)),
  );

  if (ONLY) {
    missingBases = missingBases.filter((base) => ONLY.has(normalizeKey(base)));
  }

  if (Number.isFinite(LIMIT) && LIMIT > 0) {
    missingBases = missingBases.slice(0, LIMIT);
  }

  const report = {
    created_at: new Date().toISOString(),
    fandom_total: fandomBases.length,
    index_rows_before: indexRows.length,
    candidate_missing_bases: missingBases.length,
    resolved: [],
    already_present_by_url: [],
    unresolved: [],
    command_failures: [],
  };

  for (const base of missingBases) {
    try {
      const resolved = await resolveGame8Archive(base);
      if (!resolved) {
        report.unresolved.push({
          fandom_base: base,
          reason: "game8_suggestions_no_hero_match",
        });
        continue;
      }

      if (indexUrls.has(resolved.archive_url)) {
        report.already_present_by_url.push({ fandom_base: base, ...resolved });
        continue;
      }

      report.resolved.push({ fandom_base: base, ...resolved });
      indexUrls.add(resolved.archive_url);
    } catch (error) {
      report.unresolved.push({
        fandom_base: base,
        reason: error.message,
      });
    }
  }

  return report;
}

function readIndexRowsByUrl() {
  const rows = readJson(INDEX_PATH, []);
  return new Map(
    rows
      .map((row) => [String(row?.url || "").trim(), row])
      .filter(([url]) => Boolean(url)),
  );
}

async function main() {
  const report = await buildBackfillReport();
  const timestamp = report.created_at.replace(/[:.]/g, "-");
  const reportPath = path.join(REPORT_DIR, `backfill-report-${timestamp}.json`);
  writeJson(reportPath, report);

  console.log(`FANDOM_TOTAL=${report.fandom_total}`);
  console.log(`INDEX_ROWS_BEFORE=${report.index_rows_before}`);
  console.log(`CANDIDATE_MISSING_BASES=${report.candidate_missing_bases}`);
  console.log(`RESOLVED=${report.resolved.length}`);
  console.log(`ALREADY_PRESENT_BY_URL=${report.already_present_by_url.length}`);
  console.log(`UNRESOLVED=${report.unresolved.length}`);
  console.log(`REPORT_PATH=${reportPath}`);

  if (REPORT_ONLY || report.resolved.length === 0) {
    return;
  }

  const archiveUrls = report.resolved.map((row) => row.archive_url);
  const reconcileBatches = chunk(archiveUrls, BATCH_SIZE);
  const npmCommand = commandForCurrentPlatform("npm");
  const nodeCommand = commandForCurrentPlatform("node");

  for (const batch of reconcileBatches) {
    const args = [
      "run",
      "reconcile:index",
      "--",
      ...batch.map((url) => `--archive-url=${url}`),
    ];
    const ok = runCommand(npmCommand, args);
    if (ok) continue;

    for (const url of batch) {
      const singleArgs = [
        "run",
        "reconcile:index",
        "--",
        `--archive-url=${url}`,
      ];
      const singleOk = runCommand(npmCommand, singleArgs);
      if (!singleOk) {
        report.command_failures.push({
          stage: "reconcile:index",
          archive_url: url,
        });
      }
    }
  }

  const rowsByUrl = readIndexRowsByUrl();
  const resolvedRows = report.resolved
    .map((row) => {
      const indexRow = rowsByUrl.get(row.archive_url);
      if (!indexRow) return null;
      return {
        fandom_base: row.fandom_base,
        archive_url: row.archive_url,
        hero_slug: String(indexRow.hero_slug || "")
          .trim()
          .toLowerCase(),
        name: indexRow.name,
      };
    })
    .filter((row) => row && row.hero_slug);

  writeJson(reportPath, {
    ...report,
    resolved_rows: resolvedRows,
  });

  const slugBatches = chunk(
    resolvedRows.map((row) => row.hero_slug),
    BATCH_SIZE,
  );

  for (const batch of slugBatches) {
    const onlyFiles = batch.map((slug) => `${slug}.json`).join(",");
    const ok = runCommand(nodeCommand, [
      "scraper/build_parser.js",
      "--headless",
      `--only=${onlyFiles}`,
    ]);
    if (ok) continue;

    for (const slug of batch) {
      const singleOk = runCommand(nodeCommand, [
        "scraper/build_parser.js",
        "--headless",
        `--only=${slug}.json`,
      ]);
      if (!singleOk) {
        report.command_failures.push({
          stage: "build_parser",
          hero_slug: slug,
        });
      }
    }
  }

  for (const batch of reconcileBatches) {
    const args = [
      "run",
      "reconcile:index",
      "--",
      ...batch.map((url) => `--archive-url=${url}`),
    ];
    const ok = runCommand(npmCommand, args);
    if (ok) continue;

    for (const url of batch) {
      const singleArgs = [
        "run",
        "reconcile:index",
        "--",
        `--archive-url=${url}`,
      ];
      const singleOk = runCommand(npmCommand, singleArgs);
      if (!singleOk) {
        report.command_failures.push({
          stage: "reconcile:index:post-build-parser",
          archive_url: url,
        });
      }
    }
  }

  if (!runCommand(nodeCommand, ["scripts/generate-fandom-name-map.js"])) {
    report.command_failures.push({
      stage: "generate-fandom-name-map",
    });
  }

  for (const batch of slugBatches) {
    const onlySlugs = batch.join(",");
    const downloaderCommands = [
      [
        "fandom_fullbody_downloader",
        ["scraper/fandom_fullbody_downloader.js", `--only=${onlySlugs}`],
      ],
      [
        "fandom_headshot_downloader",
        ["scraper/fandom_headshot_downloader.js", `--only=${onlySlugs}`],
      ],
      [
        "fandom_quotes_downloader",
        ["scraper/fandom_quotes_downloader.js", `--only=${onlySlugs}`],
      ],
    ];

    for (const [stage, args] of downloaderCommands) {
      const ok = runCommand(nodeCommand, args);
      if (ok) continue;

      for (const slug of batch) {
        const singleArgs = [args[0], `--only=${slug}`];
        const singleOk = runCommand(nodeCommand, singleArgs);
        if (!singleOk) {
          report.command_failures.push({
            stage,
            hero_slug: slug,
          });
        }
      }
    }
  }

  if (!runCommand(npmCommand, ["--prefix", "app", "run", "import:heroes"])) {
    report.command_failures.push({
      stage: "import:heroes",
    });
  }

  writeJson(reportPath, {
    ...report,
    resolved_rows: resolvedRows,
  });
}

main().catch((error) => {
  console.error(`BACKFILL_ERROR=${error.message}`);
  process.exit(1);
});
