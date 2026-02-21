import "server-only";

import fs from "node:fs/promises";
import path from "node:path";

type UnitRecord = {
  name?: string;
  url?: string | null;
  img_url?: string | null;
  raw_text_data?: string | null;
  rarity?: string | null;
};

const unitRecordCache = new Map<string, Promise<UnitRecord | null>>();
const normalizedFileIndexCache = new Map<string, Promise<Map<string, string>>>();
const fandomAssetUrlCache = new Map<string, Promise<string | null>>();

let fandomBaseIndexPromise: Promise<
  Array<{ baseName: string; normalizedKey: string; tokens: string[] }>
> | null = null;

const fandomQuoteTextCache = new Map<string, Promise<string | null>>();
const fandomImageUrlByTitleCache = new Map<string, Promise<string | null>>();
let fandomQuotePageLookupPromise: Promise<Map<string, string>> | null = null;

type FandomImageKind = "headshot" | "fullbody";
const FULLBODY_POSE_ORDER = ["portrait", "attack", "special", "damage"] as const;

function normalizeLookupText(value: string) {
  const text = String(value || "")
    .replace(/[ðÐ]/g, "d")
    .replace(/[þÞ]/g, "th")
    .replace(/[æÆ]/g, "ae")
    .replace(/[œŒ]/g, "oe")
    .replace(/[øØ]/g, "o")
    .replace(/[łŁ]/g, "l")
    .replace(/[’'`]/g, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

  return text;
}

function cleanLegacyGuideName(name: string) {
  return String(name || "")
    .replace(/\s+Builds?\s+and\s+Best\s+Refine\b/gi, "")
    .replace(/\s+Best\s+Builds?\b/gi, "")
    .replace(/\s+Builds?\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractLegacyHeroNameFromRaw(rawText?: string | null) {
  const text = String(rawText || "");
  const match = text.match(
    /This is a ranking page for the hero\s+([^\.]+?)\s+from the game Fire Emblem Heroes/i
  );

  if (!match?.[1]) return null;
  return cleanLegacyGuideName(match[1]);
}

function extractGenderToken(name: string) {
  const value = String(name || "");
  if (/\(\s*f\s*\)/i.test(value) || /\bfemale\b/i.test(value)) return "F";
  if (/\(\s*m\s*\)/i.test(value) || /\bmale\b/i.test(value)) return "M";
  return null;
}

function buildFandomBaseCandidates(unit: UnitRecord | null, heroSlug: string) {
  const rawName = String(unit?.name || "").trim();
  const cleanedUnitName = cleanLegacyGuideName(rawName);
  const legacyHeroName = extractLegacyHeroNameFromRaw(unit?.raw_text_data);

  const candidates = new Set<string>();
  const push = (value?: string | null) => {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text) return;
    candidates.add(text);
  };

  push(cleanedUnitName);
  push(legacyHeroName);

  for (const base of Array.from(candidates)) {
    push(base.replace(/\s+-\s+/g, ": "));
    push(base.replace(/\s+:\s+/g, " - "));

    const split = base.split(/\s+-\s+|\s+:\s+/);
    if (split.length >= 2) {
      push(split[0]);
    }
  }

  const gender = extractGenderToken(cleanedUnitName);
  const legacySplit = String(legacyHeroName || "").split(/\s+-\s+|\s+:\s+/);
  if (gender && legacySplit.length >= 2) {
    const left = legacySplit[0].trim();
    const right = legacySplit.slice(1).join(" ").trim();
    if (left && right) {
      push(`${left} (${gender}) - ${right}`);
      push(`${left} (${gender}): ${right}`);
    }
  }

  const slugNameBits = String(heroSlug || "")
    .split("___")
    .map((part) => part.replace(/_/g, " ").trim())
    .filter(Boolean);
  if (slugNameBits.length) {
    push(slugNameBits.join(" - "));
    push(slugNameBits.join(": "));
    push(slugNameBits[0]);
  }

  return Array.from(candidates);
}

function normalizeSlug(value: string) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .toLowerCase()
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function unitRootCandidates() {
  return [
    path.join(process.cwd(), "db", "units"),
    path.join(process.cwd(), "..", "db", "units"),
  ];
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadNormalizedFileIndex(root: string) {
  if (normalizedFileIndexCache.has(root)) {
    return normalizedFileIndexCache.get(root)!;
  }

  const promise = (async () => {
    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      const map = new Map<string, string>();

      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".json")) continue;
        const fileName = entry.name.replace(/\.json$/i, "");
        const normalized = normalizeSlug(fileName);
        if (!normalized || map.has(normalized)) continue;
        map.set(normalized, fileName);
      }

      return map;
    } catch {
      return new Map<string, string>();
    }
  })();

  normalizedFileIndexCache.set(root, promise);
  return promise;
}

async function resolveUnitFilePath(heroSlug: string) {
  const normalizedTarget = normalizeSlug(heroSlug);
  if (!normalizedTarget) return null;

  for (const root of unitRootCandidates()) {
    const directPath = path.join(root, `${heroSlug}.json`);
    if (await fileExists(directPath)) return directPath;

    const normalizedPath = path.join(root, `${normalizedTarget}.json`);
    if (await fileExists(normalizedPath)) return normalizedPath;

    const index = await loadNormalizedFileIndex(root);
    const matchedFile = index.get(normalizedTarget);
    if (matchedFile) {
      const candidate = path.join(root, `${matchedFile}.json`);
      if (await fileExists(candidate)) return candidate;
    }
  }

  return null;
}

function tokenizeLookupKey(value: string) {
  return normalizeLookupText(value)
    .split(" ")
    .filter(Boolean);
}

async function fetchFandomJson(url: string) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
    cache: "force-cache",
  });

  if (!response.ok) {
    throw new Error(`Fandom API HTTP ${response.status}`);
  }

  return (await response.json()) as Record<string, unknown>;
}

async function loadFandomBaseIndex() {
  if (fandomBaseIndexPromise) return fandomBaseIndexPromise;

  fandomBaseIndexPromise = (async () => {
    let imcontinue = "";
    const byKey = new Map<string, { baseName: string; normalizedKey: string; tokens: string[] }>();

    while (true) {
      const url =
        "https://feheroes.fandom.com/api.php?action=query&format=json&titles=List_of_Heroes&prop=images&imlimit=500" +
        (imcontinue ? `&imcontinue=${encodeURIComponent(imcontinue)}` : "");

      const json = await fetchFandomJson(url);
      const query = (json.query || {}) as Record<string, unknown>;
      const pages = (query.pages || {}) as Record<string, unknown>;
      const firstPage = Object.values(pages)[0] as Record<string, unknown> | undefined;
      const images = Array.isArray(firstPage?.images)
        ? (firstPage?.images as Array<Record<string, unknown>>)
        : [];

      for (const image of images) {
        const title = String(image?.title || "");
        const match = title.match(/^File:(.+) Face FC\.(webp|png|jpg|jpeg)$/i);
        if (!match?.[1]) continue;

        const baseName = match[1].trim();
        const normalizedKey = normalizeLookupText(baseName);
        if (!normalizedKey || byKey.has(normalizedKey)) continue;

        byKey.set(normalizedKey, {
          baseName,
          normalizedKey,
          tokens: tokenizeLookupKey(baseName),
        });
      }

      const continuation = (json.continue || {}) as Record<string, unknown>;
      imcontinue = String(continuation.imcontinue || "");
      if (!imcontinue) break;
    }

    return Array.from(byKey.values());
  })();

  return fandomBaseIndexPromise;
}

function candidateScore(candidateTokens: string[], entryTokens: string[]) {
  if (!candidateTokens.length || !entryTokens.length) return Number.NEGATIVE_INFINITY;
  const entrySet = new Set(entryTokens);

  let overlap = 0;
  for (const token of candidateTokens) {
    if (entrySet.has(token)) overlap += 1;
  }

  if (!overlap) return Number.NEGATIVE_INFINITY;

  const allTokensMatch = candidateTokens.every((token) => entrySet.has(token));
  const baseScore = overlap * 4 - Math.abs(entryTokens.length - candidateTokens.length);

  let bonus = 0;
  if (allTokensMatch) bonus += 40;

  const hasFemaleHint = candidateTokens.includes("female") || candidateTokens.includes("f");
  const hasMaleHint = candidateTokens.includes("male") || candidateTokens.includes("m");
  const entryHasFemale = entrySet.has("female") || entrySet.has("f");
  const entryHasMale = entrySet.has("male") || entrySet.has("m");

  if (hasFemaleHint && entryHasFemale) bonus += 4;
  if (hasMaleHint && entryHasMale) bonus += 4;

  return baseScore + bonus;
}

async function resolveFandomBaseBySlug(heroSlug: string) {
  const unit = await loadUnitRecordBySlug(heroSlug);
  const candidates = buildFandomBaseCandidates(unit, heroSlug);
  if (!candidates.length) return null;

  const index = await loadFandomBaseIndex();
  if (!index.length) return null;

  const byNormalized = new Map(index.map((entry) => [entry.normalizedKey, entry.baseName]));

  for (const candidate of candidates) {
    const normalized = normalizeLookupText(candidate);
    const exact = byNormalized.get(normalized);
    if (exact) return exact;
  }

  let bestMatch: { baseName: string; score: number } | null = null;
  for (const candidate of candidates) {
    const candidateTokens = tokenizeLookupKey(candidate);
    if (!candidateTokens.length) continue;

    for (const entry of index) {
      const score = candidateScore(candidateTokens, entry.tokens);
      if (!Number.isFinite(score)) continue;

      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { baseName: entry.baseName, score };
      }
    }
  }

  return bestMatch && bestMatch.score >= 8 ? bestMatch.baseName : null;
}

async function loadFandomImageUrlByTitle(fileTitle: string) {
  const title = String(fileTitle || "").trim();
  if (!title) return null;
  if (fandomImageUrlByTitleCache.has(title)) {
    return fandomImageUrlByTitleCache.get(title)!;
  }

  const promise = (async () => {
    const url =
      "https://feheroes.fandom.com/api.php?action=query&format=json&prop=imageinfo&iiprop=url|mime&titles=" +
      encodeURIComponent(title);

    try {
      const json = await fetchFandomJson(url);
      const query = (json.query || {}) as Record<string, unknown>;
      const pages = (query.pages || {}) as Record<string, unknown>;
      const firstPage = Object.values(pages)[0] as Record<string, unknown> | undefined;
      const imageInfo = Array.isArray(firstPage?.imageinfo)
        ? (firstPage?.imageinfo as Array<Record<string, unknown>>)
        : [];
      const sourceUrl = String(imageInfo[0]?.url || "").trim();

      return /^https?:\/\//i.test(sourceUrl) ? sourceUrl : null;
    } catch {
      return null;
    }
  })();

  fandomImageUrlByTitleCache.set(title, promise);
  return promise;
}

function fullbodyStateCandidatesByPose(pose: string) {
  const normalizedPose = String(pose || "portrait").toLowerCase();
  if (normalizedPose === "attack") return ["BtlFace"];
  if (normalizedPose === "special") return ["BtlFace C", "BtlFace B"];
  if (normalizedPose === "damage") return ["BtlFace D"];
  return ["Face"];
}

async function resolveFandomImageUrl(
  heroSlug: string,
  kind: FandomImageKind,
  pose: string = "portrait"
) {
  const key = `${normalizeSlug(heroSlug)}:${kind}:${String(pose || "portrait").toLowerCase()}`;
  if (fandomAssetUrlCache.has(key)) {
    return fandomAssetUrlCache.get(key)!;
  }

  const promise = (async () => {
    const baseName = await resolveFandomBaseBySlug(heroSlug);
    if (!baseName) return null;

    const extensions = ["webp", "png", "jpg", "jpeg"];

    if (kind === "headshot") {
      for (const ext of extensions) {
        const title = `File:${baseName} Face FC.${ext}`;
        const sourceUrl = await loadFandomImageUrlByTitle(title);
        if (sourceUrl) return sourceUrl;
      }
      return null;
    }

    const stateCandidates = fullbodyStateCandidatesByPose(pose);
    for (const stateName of stateCandidates) {
      for (const ext of extensions) {
        const title = `File:${baseName} ${stateName}.${ext}`;
        const sourceUrl = await loadFandomImageUrlByTitle(title);
        if (sourceUrl) return sourceUrl;
      }
    }

    return null;
  })();

  fandomAssetUrlCache.set(key, promise);
  return promise;
}

function normalizeQuotePageBase(title: string) {
  return normalizeLookupText(String(title || "").replace(/\/Quotes$/i, "").trim());
}

function stripHtmlToText(html: string) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r/g, "")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

async function loadFandomQuotePageLookup() {
  if (fandomQuotePageLookupPromise) {
    return fandomQuotePageLookupPromise;
  }

  fandomQuotePageLookupPromise = (async () => {
    let cmcontinue = "";
    const lookup = new Map<string, string>();

    while (true) {
      const url =
        "https://feheroes.fandom.com/api.php?action=query&format=json&list=categorymembers&cmtitle=" +
        encodeURIComponent("Category:Quote_pages") +
        "&cmlimit=500" +
        (cmcontinue ? `&cmcontinue=${encodeURIComponent(cmcontinue)}` : "");

      const json = await fetchFandomJson(url);
      const query = (json.query || {}) as Record<string, unknown>;
      const members = Array.isArray(query.categorymembers)
        ? (query.categorymembers as Array<Record<string, unknown>>)
        : [];

      for (const member of members) {
        const title = String(member?.title || "").trim();
        if (!title) continue;

        const key = normalizeQuotePageBase(title);
        if (!key || lookup.has(key)) continue;
        lookup.set(key, title);
      }

      const continuation = (json.continue || {}) as Record<string, unknown>;
      cmcontinue = String(continuation.cmcontinue || "");
      if (!cmcontinue) break;
    }

    return lookup;
  })();

  return fandomQuotePageLookupPromise;
}

function buildQuoteTitleCandidates(heroSlug: string, unit: UnitRecord | null) {
  const candidates = buildFandomBaseCandidates(unit, heroSlug);
  const out = new Set<string>();
  for (const name of candidates) {
    const normalized = normalizeLookupText(name);
    if (normalized) out.add(normalized);
  }
  return Array.from(out);
}

async function resolveFandomQuotePageTitle(heroSlug: string) {
  const unit = await loadUnitRecordBySlug(heroSlug);
  const lookup = await loadFandomQuotePageLookup();

  for (const candidateKey of buildQuoteTitleCandidates(heroSlug, unit)) {
    const page = lookup.get(candidateKey);
    if (page) return page;
  }

  return null;
}

async function fetchFandomParsedPageText(pageTitle: string) {
  const url =
    "https://feheroes.fandom.com/api.php?action=parse&format=json&prop=text&page=" +
    encodeURIComponent(pageTitle);

  const json = await fetchFandomJson(url);
  const parse = (json.parse || {}) as Record<string, unknown>;
  const text = (parse.text || {}) as Record<string, unknown>;
  const html = String(text["*"] || "");
  return stripHtmlToText(html);
}

export async function loadFandomHeadshotUrlBySlug(heroSlug: string) {
  return resolveFandomImageUrl(heroSlug, "headshot", "portrait");
}

export async function loadFandomFullbodyUrlBySlug(heroSlug: string, pose: string = "portrait") {
  return resolveFandomImageUrl(heroSlug, "fullbody", pose);
}

export async function loadFandomFullbodyPosesBySlug(heroSlug: string) {
  const poses: string[] = [];

  for (const pose of FULLBODY_POSE_ORDER) {
    const sourceUrl = await loadFandomFullbodyUrlBySlug(heroSlug, pose);
    if (sourceUrl) poses.push(pose);
  }

  return poses;
}

export async function loadFandomQuoteTextBySlug(heroSlug: string) {
  const key = normalizeSlug(heroSlug);
  if (!key) return null;

  if (fandomQuoteTextCache.has(key)) {
    return fandomQuoteTextCache.get(key)!;
  }

  const promise = (async () => {
    const pageTitle = await resolveFandomQuotePageTitle(heroSlug);
    if (!pageTitle) return null;

    try {
      const text = await fetchFandomParsedPageText(pageTitle);
      return text || null;
    } catch {
      return null;
    }
  })();

  fandomQuoteTextCache.set(key, promise);
  return promise;
}

function normalizeRarityTokens(tokens: string[]) {
  const stars = new Set<number>();

  for (const token of tokens) {
    const value = token.trim();
    if (!value) continue;

    if (value === "4.5") {
      stars.add(4);
      stars.add(5);
      continue;
    }

    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 5) {
      stars.add(parsed);
    }
  }

  const sorted = Array.from(stars).sort((a, b) => a - b);
  return sorted.length ? sorted.join("/") : null;
}

function collectRarityTokens(text: string) {
  const tokens: string[] = [];
  let match: RegExpExecArray | null;

  const starPattern = /([1-5](?:\.5)?)\s*(?:★|star)/gi;
  while ((match = starPattern.exec(text))) {
    tokens.push(match[1]);
  }

  const slashPattern = /([1-5])\s*\/\s*([1-5])/g;
  while ((match = slashPattern.exec(text))) {
    tokens.push(match[1], match[2]);
  }

  return tokens;
}

export function parseRarityFromRawText(rawText?: string | null) {
  if (!rawText) return null;

  const compact = String(rawText).replace(/\s+/g, " ").trim();
  if (!compact) return null;

  const lower = compact.toLowerCase();
  const rarityIndex = lower.indexOf(" rarity ");

  if (rarityIndex >= 0) {
    const rarityWindow = compact.slice(rarityIndex, rarityIndex + 260);
    const fromRaritySection = normalizeRarityTokens(collectRarityTokens(rarityWindow));
    if (fromRaritySection) return fromRaritySection;
  }

  return normalizeRarityTokens(collectRarityTokens(compact.slice(0, 260)));
}

function normalizeArtistText(raw?: string | null) {
  return String(raw || "")
    .replace(/\s+/g, " ")
    .replace(/\s([,.!?;:])/g, "$1")
    .trim();
}

function cleanArtistCandidate(value?: string | null) {
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

function extractLegacyIllustratorFromRawText(rawText?: string | null) {
  const compact = normalizeArtistText(rawText);
  if (!compact) return null;

  const matches = Array.from(
    compact.matchAll(/Illustrator\s+([A-Za-z0-9'’().,&\- ]{2,140})/gi)
  );

  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const cleaned = cleanArtistCandidate(matches[i]?.[1]);
    if (cleaned) return cleaned;
  }

  return null;
}

export function extractIllustratorFromRawText(rawText?: string | null) {
  const compact = normalizeArtistText(rawText);
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

  const candidates: string[] = [];
  for (const pattern of patterns) {
    for (const match of compact.matchAll(pattern)) {
      const captured = String(match?.[1] || "");
      if (captured) candidates.push(captured);
    }
  }

  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const cleaned = cleanArtistCandidate(candidates[i]);
    if (cleaned) return cleaned;
  }

  return extractLegacyIllustratorFromRawText(rawText);
}

export async function loadUnitRecordBySlug(heroSlug: string) {
  const normalized = normalizeSlug(heroSlug);
  if (!normalized) return null;

  if (unitRecordCache.has(normalized)) {
    return unitRecordCache.get(normalized)!;
  }

  const promise = (async () => {
    const filePath = await resolveUnitFilePath(heroSlug);
    if (!filePath) return null;

    try {
      const raw = await fs.readFile(filePath, "utf8");
      return JSON.parse(raw) as UnitRecord;
    } catch {
      return null;
    }
  })();

  unitRecordCache.set(normalized, promise);
  return promise;
}

export async function loadUnitImageUrlBySlug(heroSlug: string) {
  const unit = await loadUnitRecordBySlug(heroSlug);
  const imageUrl = String(unit?.img_url || "").trim();
  return /^https?:\/\//i.test(imageUrl) ? imageUrl : null;
}

export async function loadUnitRarityBySlugs(slugs: string[]) {
  const out = new Map<string, string | null>();

  const uniqueSlugs = Array.from(new Set(slugs.map((slug) => String(slug || "").trim()).filter(Boolean)));
  for (const slug of uniqueSlugs) {
    const unit = await loadUnitRecordBySlug(slug);
    const rarity = unit?.rarity || parseRarityFromRawText(unit?.raw_text_data) || null;
    out.set(slug, rarity);
  }

  return out;
}
