#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

function normalizeGuideText(raw) {
  return String(raw || "")
    .replace(/\s+/g, " ")
    .replace(/\s([,.!?;:])/g, "$1")
    .trim();
}

function cleanLegacyCandidate(value) {
  let candidate = String(value || "")
    .replace(/\s+/g, " ")
    .trim();

  const nestedIllustratorMatches = Array.from(
    candidate.matchAll(/Illustrator\s+([A-Za-z0-9'’().,&\- ]{2,80})/gi)
  );
  if (nestedIllustratorMatches.length) {
    candidate = String(
      nestedIllustratorMatches[nestedIllustratorMatches.length - 1]?.[1] || ""
    ).trim();
  }

  candidate = candidate
    .replace(/\s+(Appears In|Illustration|FEH:|Related Guides)\b[\s\S]*$/i, "")
    .replace(/\s*\([^)]*$/, "")
    .trim();

  if (!candidate) return null;
  if (candidate.length > 80) return null;
  if (/\b(voice actor|information|english)\b/i.test(candidate)) return null;
  if (/^information$/i.test(candidate)) return null;
  return candidate;
}

function extractLegacyIllustratorName(rawText) {
  const compact = normalizeGuideText(rawText);
  if (!compact) return null;

  const matches = Array.from(
    compact.matchAll(/Illustrator\s+([A-Za-z0-9'’().,&\- ]{2,140})/gi)
  );

  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const cleaned = cleanLegacyCandidate(matches[i]?.[1]);
    if (cleaned) return cleaned;
  }

  return null;
}

function cleanCandidate(value) {
  let candidate = String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^[\s:：\-–—|]+/, "")
    .trim();

  candidate = candidate
    .replace(
      /\s+(Appears In|Illustration|How to Get|Voice Actor(?:\s*\(English\))?|Quotes?|FEH:|Related Guides|Attire|Distribution Date|Starts|Ends|Obtain(?:ed)? Through)\b[\s\S]*$/i,
      ""
    )
    .replace(/\s*\([^)]*$/, "")
    .replace(/[|•]+$/g, "")
    .trim();

  if (!candidate) return null;
  if (candidate.length > 100) return null;
  if (/^(none|unknown|n\/?a|information)$/i.test(candidate)) return null;
  if (!/[\p{L}\p{N}]/u.test(candidate)) return null;
  return candidate;
}

function extractImprovedIllustratorName(rawText) {
  const compact = normalizeGuideText(rawText);
  if (!compact) return null;

  const markers =
    "Appears In|Illustration|FEH:|Related Guides|How to Get|Voice Actor(?:\\s*\\(English\\))?|Quotes?|Attire|Distribution Date|Starts|Ends|Obtain(?:ed)? Through";

  const patterns = [
    new RegExp(
      `Voice Actor(?:\\s*\\(English\\))?\\s+.{1,120}?\\s+Illustrator\\s*[:：\\-]?\\s*(.{1,140}?)(?=\\s+(?:${markers})|$)`,
      "gi"
    ),
    new RegExp(
      `Illustrator\\s*[:：\\-]?\\s*(.{1,160}?)(?=\\s+(?:${markers})|$)`,
      "gi"
    ),
  ];

  const candidates = [];
  for (const pattern of patterns) {
    for (const match of compact.matchAll(pattern)) {
      const captured = String(match?.[1] || "");
      if (captured) candidates.push(captured);
    }
  }

  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const cleaned = cleanCandidate(candidates[i]);
    if (cleaned) return cleaned;
  }

  return extractLegacyIllustratorName(rawText);
}

function parseArgs(argv) {
  const out = {
    mode: "improved",
    sample: 20,
    json: false,
    heroesOnly: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--legacy") out.mode = "legacy";
    if (token === "--improved") out.mode = "improved";
    if (token === "--json") out.json = true;
    if (token === "--heroes-only") out.heroesOnly = true;
    if (token === "--sample") {
      const raw = argv[i + 1];
      const value = Number.parseInt(raw, 10);
      if (Number.isFinite(value) && value >= 0) out.sample = value;
      i += 1;
    }
  }

  return out;
}

const HERO_WEAPON_TYPES = new Set([
  "Sword",
  "Lance",
  "Axe",
  "Bow",
  "Dagger",
  "Tome",
  "Breath",
  "Beast",
  "Red Tome",
  "Blue Tome",
  "Green Tome",
  "Colorless Tome",
  "Red Bow",
  "Blue Bow",
  "Green Bow",
  "Colorless Bow",
  "Red Dagger",
  "Blue Dagger",
  "Green Dagger",
  "Colorless Dagger",
  "Staff",
  "Red Breath",
  "Blue Breath",
  "Green Breath",
  "Colorless Breath",
  "Red Beast",
  "Blue Beast",
  "Green Beast",
  "Colorless Beast",
]);

const HERO_MOVE_TYPES = new Set(["Infantry", "Armored", "Cavalry", "Flying"]);

function isLikelyHeroRecord(row) {
  const name = String(row?.name || "").trim();
  const url = String(row?.url || "").trim();
  const tag = String(row?.tag || "").trim();
  const weapon = String(row?.weapon || "").trim();
  const move = String(row?.move || "").trim();

  if (!name) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  if (tag === "Legacy ID Snipe") return false;

  const hasValidWeaponMove = HERO_WEAPON_TYPES.has(weapon) && HERO_MOVE_TYPES.has(move);
  return hasValidWeaponMove;
}

function runAudit({ mode, sample, heroesOnly }) {
  const root = path.join(process.cwd(), "db", "units");
  const files = fs.readdirSync(root).filter((f) => f.toLowerCase().endsWith(".json"));

  const extract = mode === "legacy" ? extractLegacyIllustratorName : extractImprovedIllustratorName;

  let withArtist = 0;
  const missing = [];

  for (const file of files) {
    const filePath = path.join(root, file);
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));

      if (heroesOnly && !isLikelyHeroRecord(parsed)) {
        continue;
      }

      const artist = extract(parsed.raw_text_data);
      if (artist) {
        withArtist += 1;
      } else {
        missing.push(file.replace(/\.json$/i, ""));
      }
    } catch {
      missing.push(file.replace(/\.json$/i, ""));
    }
  }

  const total = files.length;
  const evaluatedTotal = withArtist + missing.length;
  const withoutArtist = missing.length;

  return {
    mode,
    total,
    evaluatedTotal,
    heroesOnly,
    withArtist,
    withoutArtist,
    coveragePct: evaluatedTotal ? Number(((withArtist / evaluatedTotal) * 100).toFixed(2)) : 0,
    sampleMissing: missing.slice(0, sample),
  };
}

const options = parseArgs(process.argv.slice(2));
const result = runAudit(options);

if (options.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`mode=${result.mode}`);
  console.log(`total=${result.total}`);
  console.log(`with_artist=${result.withArtist}`);
  console.log(`without_artist=${result.withoutArtist}`);
  console.log(`coverage_pct=${result.coveragePct}`);
  if (result.sampleMissing.length) {
    console.log(`sample_missing=${result.sampleMissing.join(",")}`);
  }
}
