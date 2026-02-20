import "server-only";

import fs from "node:fs/promises";
import path from "node:path";

type UnitRecord = {
  name?: string;
  img_url?: string | null;
  raw_text_data?: string | null;
  rarity?: string | null;
};

const unitRecordCache = new Map<string, Promise<UnitRecord | null>>();
const normalizedFileIndexCache = new Map<string, Promise<Map<string, string>>>();

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
