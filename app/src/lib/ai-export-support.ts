import fs from "node:fs/promises";
import path from "node:path";
import bundledBannerPullGuidesJson from "@/lib/bundled-banner-guides.json";
import bundledUnitDataJson from "@/lib/bundled-unit-data.json";
import {
  type BarracksEntryInventory,
  type BarracksTrackedSkill,
  EQUIPPED_SKILL_SLOTS,
} from "@/lib/barracks-entry-metadata";
import { dbRoot } from "@/lib/db-root";
import game8IndexJson from "@/lib/game8-index.json";
import { loadSkillCatalog, normalizeSkillSearchText, type SkillCatalogEntry } from "@/lib/skill-catalog";

export type BuildKey =
  | "weapon"
  | "assist"
  | "special"
  | "emblem"
  | "passive_a"
  | "passive_b"
  | "passive_c"
  | "sacred_seal"
  | "attuned";

export type UnitFile = {
  artist?: string | null;
  name?: string;
  url?: string | null;
  ivs?: string | null;
  raw_text_data?: string | null;
  recommended_build?: Partial<Record<BuildKey, string>>;
};

export type BannerPullGuideRecommendation = {
  hero_name?: string;
  hero_slug_guess?: string;
  tier?: string;
  pull_recommendation?: string;
  notes?: string;
};

export type BannerPullGuide = {
  id?: string;
  url?: string;
  title?: string;
  scraped_at?: string;
  guide_sections?: Array<{ heading?: string; content?: string }>;
  recommendations?: BannerPullGuideRecommendation[];
};

type BannerPullGuidesFile = {
  items?: BannerPullGuide[];
};

type IndexEntry = {
  name?: string;
  url?: string;
};

export type SkillOwnership = {
  equipped: Set<string>;
  fodder: Set<string>;
  legacy: Set<string>;
};

export type SummonTarget = {
  heroSlug: string | null;
  heroName: string;
  bannerTitle: string;
  bannerUrl: string | null;
  scrapedAt: string | null;
  tier: string;
  pullRecommendation: string;
  notes: string;
};

export const DEFAULT_RAW_TEXT_LIMIT = 2600;
export const DEFAULT_SUMMON_TARGET_LIMIT = 12;
export const REQUIRED_BUILD_KEYS: BuildKey[] = [
  "weapon",
  "assist",
  "special",
  "emblem",
  "passive_a",
  "passive_b",
  "passive_c",
  "sacred_seal",
  "attuned",
];
export const BUILD_SLOT_LABELS = new Map<BuildKey, string>(
  EQUIPPED_SKILL_SLOTS.map((slot) => [slot.key as BuildKey, slot.label])
);

const BUNDLED_UNIT_DATA: Record<string, UnitFile> = bundledUnitDataJson as Record<string, UnitFile>;
const BUNDLED_GAME8_INDEX: Array<IndexEntry> = game8IndexJson as Array<IndexEntry>;
const BUNDLED_BANNER_PULL_GUIDES: BannerPullGuide[] = Array.isArray(
  (bundledBannerPullGuidesJson as BannerPullGuidesFile | null | undefined)?.items
)
  ? ((bundledBannerPullGuidesJson as BannerPullGuidesFile).items as BannerPullGuide[])
  : [];

let indexBySlugPromise: Promise<Map<string, IndexEntry>> | null = null;
let skillCatalogByNamePromise: Promise<Map<string, SkillCatalogEntry>> | null = null;
const localUnitCache = new Map<string, Promise<UnitFile | null>>();
const remoteFallbackUnitCache = new Map<string, Promise<UnitFile | null>>();

export function sanitizeText(value: string | null | undefined) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function trimForExport(text: string, limit: number) {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)} …[truncated]`;
}

export function normalizeSlug(value: string) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .toLowerCase()
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

export function toSlug(value: string) {
  return String(value || "").replace(/[^a-z0-9]/gi, "_").toLowerCase();
}

function decodeHtmlEntities(value: string) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => {
      const codePoint = Number.parseInt(hex, 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : "";
    })
    .replace(/&#(\d+);/g, (_match, dec) => {
      const codePoint = Number.parseInt(dec, 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : "";
    });
}

function stripHtmlToText(html: string) {
  return decodeHtmlEntities(
    String(html || "")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\r/g, "")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function stripMarkdownToText(markdown: string) {
  return decodeHtmlEntities(String(markdown || ""))
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, " $1 ")
    .replace(/`{1,3}[^`]*`{1,3}/g, " ")
    .replace(/^\s*>+\s?/gm, "")
    .replace(/[|]/g, " ")
    .replace(/\*\*|__/g, " ")
    .replace(/^[#-]+\s*/gm, "")
    .replace(/\r/g, "")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function normalizeRawText(value: string) {
  if (!value) return "";
  const cutMarkers = [
    "Please participate in our site improvement survey",
    "Popular Games",
    "Recommended Games",
    "Terms of Use",
    "Game8 - Your Go-To Platform For All Game Walkthroughs and Strategy Guides",
  ];

  let cleaned = value;
  for (const marker of cutMarkers) {
    const index = cleaned.indexOf(marker);
    if (index > 0) {
      cleaned = cleaned.slice(0, index);
      break;
    }
  }

  return cleaned.replace(/\s\s+/g, " ").trim();
}

function escapeRegex(value: string) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSkillName(value: string | null) {
  const cleaned = decodeHtmlEntities(String(value || ""))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s:：\-–—|]+/, "")
    .trim();

  if (!cleaned || cleaned.length > 120) return "-";
  if (/^(weapon skill|assist skill|special skill|passive skill [abc]|sacred seal)$/i.test(cleaned)) {
    return "-";
  }
  return cleaned;
}

function extractSkillFromHtml(html: string, label: string) {
  const escapedLabel = escapeRegex(label);
  const patterns = [
    new RegExp(
      `<img[^>]*alt=["'][^"']*${escapedLabel}[^"']*["'][^>]*>[\\s\\S]{0,700}?<a[^>]*>([^<]{1,140})<\\/a>`,
      "i"
    ),
    new RegExp(`${escapedLabel}[\\s\\S]{0,420}?<a[^>]*>([^<]{1,140})<\\/a>`, "i"),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    const normalized = normalizeSkillName(match?.[1] || null);
    if (normalized !== "-") return normalized;
  }

  return "-";
}

function extractSkillFromMirrorText(text: string, label: string) {
  const escapedLabel = escapeRegex(label);
  const patterns = [
    new RegExp(
      `${escapedLabel}[\\s\\S]{0,320}?\\[([^\\]\\n]{1,140})\\]\\(https?:\\/\\/game8\\.co\\/games\\/fire-emblem-heroes\\/archives\\/\\d+\\)`,
      "i"
    ),
    new RegExp(`${escapedLabel}[\\s\\S]{0,180}?:\\s*([^|\\n]{2,120})`, "i"),
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const normalized = normalizeSkillName(match?.[1] || null);
    if (normalized !== "-") return normalized;
  }

  return "-";
}

function deriveIvsFromRawText(rawText = "") {
  if (!rawText) return null;

  const sentenceMatch = rawText.match(/best IVs[^.]*?are\s*([+\-][A-Za-z]+)\s*(?:and|\/)\s*([+\-][A-Za-z]+)/i);
  if (sentenceMatch) {
    return `${sentenceMatch[1]} / ${sentenceMatch[2]}`;
  }

  const compactMatch = rawText.match(/([+\-][A-Za-z]{3,6})\s*\/\s*([+\-][A-Za-z]{3,6})/);
  if (compactMatch) {
    return `${compactMatch[1]} / ${compactMatch[2]}`;
  }

  return null;
}

function normalizeRecommendedBuild(build: Partial<Record<BuildKey, string>>) {
  const normalized = {} as Record<BuildKey, string>;

  for (const key of REQUIRED_BUILD_KEYS) {
    const value = sanitizeText(build[key] || "-");
    normalized[key] = value || "-";
  }

  return normalized;
}

async function readJsonSafe<T>(filePath: string) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function loadIndexBySlug() {
  if (indexBySlugPromise) return indexBySlugPromise;

  indexBySlugPromise = (async () => {
    let rows = await readJsonSafe<IndexEntry[]>(path.join(dbRoot(), "index.json"));
    if (!Array.isArray(rows) || !rows.length) {
      rows = BUNDLED_GAME8_INDEX;
    }

    const map = new Map<string, IndexEntry>();
    for (const row of rows) {
      const slug = toSlug(String(row?.name || ""));
      if (!slug || map.has(slug)) continue;
      map.set(slug, row);
    }

    return map;
  })();

  return indexBySlugPromise;
}

function loadBundledUnitFile(heroSlug: string) {
  const direct = BUNDLED_UNIT_DATA[heroSlug];
  if (direct) return direct;

  const normalized = toSlug(heroSlug);
  return normalized ? BUNDLED_UNIT_DATA[normalized] ?? null : null;
}

function buildMirrorUrl(sourceUrl: string) {
  return `https://r.jina.ai/http://${String(sourceUrl || "").replace(/^https?:\/\//i, "")}`;
}

async function loadRemoteFallbackUnit(heroSlug: string): Promise<UnitFile | null> {
  const key = toSlug(heroSlug);
  if (!key) return null;

  if (remoteFallbackUnitCache.has(key)) {
    return remoteFallbackUnitCache.get(key)!;
  }

  const promise = (async () => {
    const index = await loadIndexBySlug();
    const entry = index.get(key);
    const sourceUrl = sanitizeText(entry?.url);
    if (!/^https?:\/\//i.test(sourceUrl)) return null;

    const fetchOpts: RequestInit = {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      cache: "force-cache",
    };

    try {
      const response = await fetch(sourceUrl, fetchOpts);
      if (response.ok) {
        const html = await response.text();
        const rawText = normalizeRawText(stripHtmlToText(html));
        if (rawText && rawText.length >= 200) {
          return {
            name: entry?.name,
            url: sourceUrl,
            raw_text_data: rawText,
            recommended_build: normalizeRecommendedBuild({
              weapon: extractSkillFromHtml(html, "Weapon Skill"),
              assist: extractSkillFromHtml(html, "Assist Skill"),
              special: extractSkillFromHtml(html, "Special Skill"),
              passive_a: extractSkillFromHtml(html, "Passive Skill A"),
              passive_b: extractSkillFromHtml(html, "Passive Skill B"),
              passive_c: extractSkillFromHtml(html, "Passive Skill C"),
              sacred_seal: extractSkillFromHtml(html, "Sacred Seal"),
              emblem: extractSkillFromHtml(html, "Emblem"),
            }),
            ivs: deriveIvsFromRawText(rawText) || "-",
          } satisfies UnitFile;
        }
      }
    } catch {
      // Continue to mirror fallback.
    }

    try {
      const mirrorResponse = await fetch(buildMirrorUrl(sourceUrl), fetchOpts);
      if (!mirrorResponse.ok) return null;

      const mirrorText = await mirrorResponse.text();
      const rawText = normalizeRawText(stripMarkdownToText(mirrorText));
      if (!rawText || rawText.length < 200) return null;

      return {
        name: entry?.name,
        url: sourceUrl,
        raw_text_data: rawText,
        recommended_build: normalizeRecommendedBuild({
          weapon: extractSkillFromMirrorText(mirrorText, "Weapon Skill"),
          assist: extractSkillFromMirrorText(mirrorText, "Assist Skill"),
          special: extractSkillFromMirrorText(mirrorText, "Special Skill"),
          passive_a: extractSkillFromMirrorText(mirrorText, "Passive Skill A"),
          passive_b: extractSkillFromMirrorText(mirrorText, "Passive Skill B"),
          passive_c: extractSkillFromMirrorText(mirrorText, "Passive Skill C"),
          sacred_seal: extractSkillFromMirrorText(mirrorText, "Sacred Seal"),
          emblem: extractSkillFromMirrorText(mirrorText, "Emblem"),
          attuned: extractSkillFromMirrorText(mirrorText, "Attuned Skill"),
        }),
        ivs: deriveIvsFromRawText(rawText) || "-",
      } satisfies UnitFile;
    } catch {
      return null;
    }
  })();

  remoteFallbackUnitCache.set(key, promise);
  return promise;
}

export async function loadExportUnitFile(
  heroSlug: string,
  allowRemoteFallback: boolean
): Promise<UnitFile | null> {
  const cacheKey = `${normalizeSlug(heroSlug)}:${allowRemoteFallback ? "remote" : "local"}`;
  if (localUnitCache.has(cacheKey)) {
    return localUnitCache.get(cacheKey)!;
  }

  const promise = (async () => {
    const local = await readJsonSafe<UnitFile>(path.join(dbRoot(), "units", `${heroSlug}.json`));
    if (local) return local;

    const bundled = loadBundledUnitFile(heroSlug);
    if (bundled) return bundled;

    if (!allowRemoteFallback) return null;
    return loadRemoteFallbackUnit(heroSlug);
  })();

  localUnitCache.set(cacheKey, promise);
  return promise;
}

export async function loadBannerPullGuides() {
  const parsed = await readJsonSafe<BannerPullGuidesFile>(path.join(dbRoot(), "banner_pull_guides.json"));
  const localItems = Array.isArray(parsed?.items) ? parsed.items : [];
  if (localItems.length) {
    return normalizeBannerGuides(localItems);
  }

  return normalizeBannerGuides(BUNDLED_BANNER_PULL_GUIDES);
}

export async function loadSkillCatalogByName() {
  if (skillCatalogByNamePromise) return skillCatalogByNamePromise;

  skillCatalogByNamePromise = (async () => {
    const catalog = await loadSkillCatalog();
    const map = new Map<string, SkillCatalogEntry>();

    for (const entry of catalog) {
      const key = normalizeSkillSearchText(entry.name);
      if (!key || map.has(key)) continue;
      map.set(key, entry);
    }

    return map;
  })();

  return skillCatalogByNamePromise;
}

export async function loadGame8IndexBySlug() {
  return loadIndexBySlug();
}

export function describeTrackedSkill(skill: BarracksTrackedSkill | null | undefined) {
  if (!skill) return null;
  const suffix = skill.subcategory || skill.category_label || skill.category || "Skill";
  return `${skill.name} [${suffix}]`;
}

function addSkillOwnership(
  index: Map<string, SkillOwnership>,
  skill: BarracksTrackedSkill | null | undefined,
  bucket: keyof SkillOwnership,
  heroLabel: string
) {
  if (!skill?.name) return;
  const key = normalizeSkillSearchText(skill.name);
  if (!key) return;

  let existing = index.get(key);
  if (!existing) {
    existing = {
      equipped: new Set<string>(),
      fodder: new Set<string>(),
      legacy: new Set<string>(),
    };
    index.set(key, existing);
  }

  existing[bucket].add(heroLabel);
}

export function buildSkillOwnershipIndex(
  items: Array<{ heroName: string; inventory: BarracksEntryInventory }>
) {
  const index = new Map<string, SkillOwnership>();

  for (const item of items) {
    for (const slot of EQUIPPED_SKILL_SLOTS) {
      addSkillOwnership(index, item.inventory.equipped[slot.key], "equipped", item.heroName);
    }
    for (const skill of item.inventory.fodder) {
      addSkillOwnership(index, skill, "fodder", item.heroName);
    }
    for (const skill of item.inventory.legacy_skills) {
      addSkillOwnership(index, skill, "legacy", item.heroName);
    }
  }

  return index;
}

function formatOwnerNames(values: Set<string>) {
  const names = Array.from(values).slice(0, 3);
  const suffix = values.size > names.length ? ` +${values.size - names.length} more` : "";
  return names.length ? `${names.join(", ")}${suffix}` : "";
}

function lookupSkillEffect(skillName: string, skillCatalogByName: Map<string, SkillCatalogEntry>) {
  const key = normalizeSkillSearchText(skillName);
  if (!key) return null;
  const entry = skillCatalogByName.get(key);
  const effect = sanitizeText(entry?.effect);
  if (!effect) return null;
  return trimForExport(effect, 140);
}

function formatSkillCoverage(
  skillName: string,
  currentEquipped: string | null,
  ownershipIndex: Map<string, SkillOwnership>
) {
  const normalized = normalizeSkillSearchText(skillName);
  if (!normalized) return null;

  if (currentEquipped && normalizeSkillSearchText(currentEquipped) === normalized) {
    return "already equipped";
  }

  const ownership = ownershipIndex.get(normalized);
  if (!ownership) {
    return "not tracked on-account";
  }

  const parts: string[] = [];
  if (ownership.fodder.size) parts.push(`fodder: ${formatOwnerNames(ownership.fodder)}`);
  if (ownership.equipped.size) parts.push(`equipped: ${formatOwnerNames(ownership.equipped)}`);
  if (ownership.legacy.size) parts.push(`legacy: ${formatOwnerNames(ownership.legacy)}`);
  return parts.length ? parts.join("; ") : "not tracked on-account";
}

export function appendTrackedInventoryLines(
  lines: string[],
  inventory: BarracksEntryInventory,
  indent = ""
) {
  if (inventory.blessings.length) {
    lines.push(`${indent}- Blessings: ${inventory.blessings.join(", ")}`);
  }

  const hasEquipped = EQUIPPED_SKILL_SLOTS.some((slot) => inventory.equipped[slot.key]);
  if (hasEquipped) {
    lines.push(`${indent}- Build Slots:`);
    for (const slot of EQUIPPED_SKILL_SLOTS) {
      const value = describeTrackedSkill(inventory.equipped[slot.key]);
      if (!value) continue;
      lines.push(`${indent}  - ${slot.label}: ${value}`);
    }
  }

  if (inventory.fodder.length) {
    lines.push(
      `${indent}- Fodder / Manuals: ${inventory.fodder
        .map((skill) => describeTrackedSkill(skill))
        .filter(Boolean)
        .join(", ")}`
    );
  }

  if (inventory.legacy_skills.length) {
    lines.push(
      `${indent}- Legacy Tracked Skills: ${inventory.legacy_skills
        .map((skill) => skill.name)
        .join(", ")}`
    );
  }
}

export function appendRecommendedBuildLines(
  lines: string[],
  unit: UnitFile,
  skillCatalogByName: Map<string, SkillCatalogEntry>,
  ownershipIndex: Map<string, SkillOwnership>,
  currentInventory: BarracksEntryInventory | null,
  indent = ""
) {
  const normalizedBuild = normalizeRecommendedBuild(unit.recommended_build || {});
  const buildLines = REQUIRED_BUILD_KEYS
    .map((key) => {
      const recommended = sanitizeText(normalizedBuild[key]);
      if (!recommended || recommended === "-") return null;

      const current = sanitizeText(currentInventory?.equipped[key]?.name || "");
      const coverage = formatSkillCoverage(recommended, current || null, ownershipIndex);
      const effect = lookupSkillEffect(recommended, skillCatalogByName);
      const parts = [`${BUILD_SLOT_LABELS.get(key) || key}: ${recommended}`];

      if (current && normalizeSkillSearchText(current) !== normalizeSkillSearchText(recommended)) {
        parts.push(`current: ${current}`);
      }
      if (coverage) parts.push(`account: ${coverage}`);
      if (effect) parts.push(`effect: ${effect}`);

      return `${indent}  - ${parts.join(" | ")}`;
    })
    .filter((line): line is string => Boolean(line));

  if (!buildLines.length) return;

  lines.push(`${indent}- Recommended Build Planning:`);
  lines.push(...buildLines);
}

function parseTierScore(value: string) {
  const text = sanitizeText(value).toLowerCase();
  if (!text || text === "-") return Number.NEGATIVE_INFINITY;

  const numeric = Number.parseFloat(text);
  if (Number.isFinite(numeric)) return numeric;
  if (text === "s") return 10;
  if (text === "a") return 9;
  if (text === "b") return 8;
  if (text === "c") return 7;
  return 0;
}

function parsePullPriority(value: string) {
  const text = sanitizeText(value).toLowerCase();
  if (!text || text === "-") return 0;
  if (text.includes("must")) return 4;
  if (text.includes("high") || text.includes("strong")) return 3;
  if (text.includes("medium") || text.includes("consider")) return 2;
  if (text.includes("low") || text.includes("skip")) return 1;
  return 2;
}

function hasMeaningfulSummonSignal(recommendation: BannerPullGuideRecommendation) {
  const tier = sanitizeText(recommendation.tier);
  const numericTier = Number.parseFloat(tier);
  if (Number.isFinite(numericTier) && numericTier >= 7) {
    return true;
  }

  if (/^[sab]$/i.test(tier)) {
    return true;
  }

  const pull = sanitizeText(recommendation.pull_recommendation).toLowerCase();
  return /must|high|strong|consider|medium/.test(pull);
}

function isLikelySummonGuide(guide: BannerPullGuide) {
  const title = sanitizeText(guide.title || guide.id || "").toLowerCase();
  if (!title) return false;

  if (/who should you pull|should you summon|best banners?\s+to summon|banner rankings?/.test(title)) {
    return true;
  }

  if (
    /summoner support|summoner duels|summon simulators?|summon results board|active summon simulators/.test(title)
  ) {
    return false;
  }

  return title.includes(" banner");
}

function normalizeBannerGuides(guides: BannerPullGuide[]) {
  return guides
    .filter((guide) => isLikelySummonGuide(guide))
    .sort((a, b) => {
      const at = a.scraped_at ? Date.parse(a.scraped_at) : 0;
      const bt = b.scraped_at ? Date.parse(b.scraped_at) : 0;
      return bt - at;
    });
}

export function isLikelyHeroRecommendation(recommendation: BannerPullGuideRecommendation) {
  const heroName = sanitizeText(recommendation.hero_name || recommendation.hero_slug_guess || "");
  if (!heroName) return false;

  const text = heroName.toLowerCase();
  const notes = sanitizeText(recommendation.notes || "");
  const notesLower = notes.toLowerCase();
  if (
    /^(hero|heroes|summon categories|legendary heroes|mythic heroes|special heroes|new heroes|hero alts|dates of availability|best summons to pull from and release dates|base stats?)$/i.test(
      heroName
    )
  ) {
    return false;
  }

  if (
    /(categories|release dates|availability|simulator|results board|useful skills|summon categories|best summons|summoning event|arena reward|free summon|revival summoning event)/.test(
      text
    )
  ) {
    return false;
  }

  if (/^lv\.?\s*\d+$/i.test(heroName) || /^(hp|atk|spd|def|res)\d*$/i.test(heroName)) {
    return false;
  }

  if (/[+]\s*$/.test(heroName)) {
    return false;
  }

  if (
    notes.startsWith("：") ||
    (notes.match(/：/g) || []).length >= 3 ||
    /\b(base stats?|lv\.?\s*1|lv\.?\s*40|summon simulator|summoning event|arena reward|free summon)\b/.test(
      notesLower
    )
  ) {
    return false;
  }

  if (!/[a-z]/i.test(heroName) || heroName.length > 80) {
    return false;
  }

  return true;
}

export function normalizeTeamSlots(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((slot) => sanitizeText(String(slot || "")));
}

export function normalizeTeamLabels(value: unknown) {
  if (!Array.isArray(value)) return [];
  const seen = new Map<string, number>();
  return value.map((label) => {
    const cleaned = sanitizeText(String(label || ""));
    if (!cleaned) return "";

    const key = cleaned.toLowerCase();
    const count = (seen.get(key) || 0) + 1;
    seen.set(key, count);
    return count === 1 ? cleaned : `${cleaned} ${count}`;
  });
}

export function resolveOwnedHero(
  recommendation: BannerPullGuideRecommendation,
  barracksBySlug: Map<string, { hero_slug: string; hero_name: string }>,
  barracksByName: Map<string, { hero_slug: string; hero_name: string }>
) {
  const slugGuess = normalizeSlug(recommendation.hero_slug_guess || "");
  if (slugGuess) {
    const direct = barracksBySlug.get(slugGuess);
    if (direct) return direct;
  }

  const byName = barracksByName.get(normalizeSkillSearchText(recommendation.hero_name || ""));
  if (byName) return byName;

  if (slugGuess.includes("_")) {
    const base = slugGuess.split("_")[0];
    const fallback = Array.from(barracksBySlug.entries()).find(([slug]) => slug.startsWith(`${base}_`))?.[1];
    if (fallback) return fallback;
  }

  const recName = sanitizeText(recommendation.hero_name).toLowerCase();
  if (recName) {
    return (
      Array.from(barracksBySlug.values()).find((hero) => {
        const heroName = sanitizeText(hero.hero_name).toLowerCase();
        return heroName.includes(recName) || recName.includes(heroName);
      }) || null
    );
  }

  return null;
}

function resolveCanonicalHeroSlug(
  recommendation: BannerPullGuideRecommendation,
  indexBySlug: Map<string, IndexEntry>
) {
  const candidates = [
    normalizeSlug(recommendation.hero_slug_guess || ""),
    toSlug(recommendation.hero_name || ""),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (indexBySlug.has(candidate)) return candidate;
  }

  return candidates[0] || null;
}

export function collectSummonTargets(
  bannerGuides: BannerPullGuide[],
  barracksBySlug: Map<string, { hero_slug: string; hero_name: string }>,
  barracksByName: Map<string, { hero_slug: string; hero_name: string }>,
  indexBySlug: Map<string, IndexEntry>
) {
  const sortedGuides = [...bannerGuides].sort((a, b) => {
    const at = a.scraped_at ? Date.parse(a.scraped_at) : 0;
    const bt = b.scraped_at ? Date.parse(b.scraped_at) : 0;
    return bt - at;
  });

  const targets: SummonTarget[] = [];
  const seen = new Set<string>();

  for (const guide of sortedGuides) {
    for (const recommendation of guide.recommendations || []) {
      const heroName = sanitizeText(recommendation.hero_name || recommendation.hero_slug_guess || "");
      if (!heroName) continue;
      if (!isLikelyHeroRecommendation(recommendation)) continue;
      if (!hasMeaningfulSummonSignal(recommendation)) continue;

      if (resolveOwnedHero(recommendation, barracksBySlug, barracksByName)) continue;

      const heroSlug = resolveCanonicalHeroSlug(recommendation, indexBySlug);
      const dedupeKey = heroSlug || normalizeSkillSearchText(heroName);
      if (!dedupeKey || seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      targets.push({
        heroSlug,
        heroName,
        bannerTitle: sanitizeText(guide.title || guide.id || "Banner Guide"),
        bannerUrl: sanitizeText(guide.url) || null,
        scrapedAt: sanitizeText(guide.scraped_at) || null,
        tier: sanitizeText(recommendation.tier) || "-",
        pullRecommendation: sanitizeText(recommendation.pull_recommendation) || "-",
        notes: sanitizeText(recommendation.notes),
      });
    }
  }

  return targets.sort((a, b) => {
    const pullDelta = parsePullPriority(b.pullRecommendation) - parsePullPriority(a.pullRecommendation);
    if (pullDelta) return pullDelta;

    const dateDelta = (b.scrapedAt ? Date.parse(b.scrapedAt) : 0) - (a.scrapedAt ? Date.parse(a.scrapedAt) : 0);
    if (dateDelta) return dateDelta;

    const tierDelta = parseTierScore(b.tier) - parseTierScore(a.tier);
    if (tierDelta) return tierDelta;

    return a.heroName.localeCompare(b.heroName);
  });
}
