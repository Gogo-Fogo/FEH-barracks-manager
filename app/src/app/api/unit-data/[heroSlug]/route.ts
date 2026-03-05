import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { dbRoot } from "@/lib/db-root";
import game8IndexJson from "@/lib/game8-index.json";
import {
  loadFandomFullbodyPosesBySlug,
  loadFandomQuoteTextBySlug,
} from "@/lib/local-unit-data";

const DEFAULT_POSE_ORDER = ["portrait", "attack", "special", "damage"];
const REQUIRED_BUILD_KEYS = [
  "weapon",
  "assist",
  "special",
  "emblem",
  "passive_a",
  "passive_b",
  "passive_c",
  "sacred_seal",
  "attuned",
] as const;

type BuildKey = (typeof REQUIRED_BUILD_KEYS)[number];

type UnitFileShape = {
  name?: string;
  url?: string | null;
  ivs?: string | null;
  raw_text_data?: string | null;
  recommended_build?: Partial<Record<BuildKey, string>>;
};

type IndexEntry = {
  name?: string;
  url?: string;
};

const BUNDLED_GAME8_INDEX: Array<IndexEntry> = game8IndexJson as Array<IndexEntry>;

let indexBySlugPromise: Promise<Map<string, IndexEntry>> | null = null;
const unitFallbackCache = new Map<string, Promise<UnitFileShape | null>>();

function toSlug(name: string) {
  return String(name || "").replace(/[^a-z0-9]/gi, "_").toLowerCase();
}

function decodeHtmlEntities(value: string) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => {
      const n = Number.parseInt(hex, 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : "";
    })
    .replace(/&#(\d+);/g, (_m, dec) => {
      const n = Number.parseInt(dec, 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : "";
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

function normalizeRawText(text: string) {
  if (!text || typeof text !== "string") return "";

  const cutMarkers = [
    "Please participate in our site improvement survey",
    "Popular Games",
    "Recommended Games",
    "Terms of Use",
    "Game8 - Your Go-To Platform For All Game Walkthroughs and Strategy Guides",
  ];

  let cleaned = text;
  for (const marker of cutMarkers) {
    const idx = cleaned.indexOf(marker);
    if (idx > 0) {
      cleaned = cleaned.slice(0, idx);
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

  if (!cleaned) return "-";
  if (cleaned.length > 120) return "-";

  const forbidden = /^(weapon skill|assist skill|special skill|passive skill [abc]|sacred seal)$/i;
  if (forbidden.test(cleaned)) return "-";

  return cleaned;
}

function extractSkillFromHtml(html: string, label: string) {
  const escapedLabel = escapeRegex(label);
  const patterns = [
    new RegExp(
      `<img[^>]*alt=["'][^"']*${escapedLabel}[^"']*["'][^>]*>[\\s\\S]{0,700}?<a[^>]*>([^<]{1,140})<\\/a>`,
      "i"
    ),
    new RegExp(
      `${escapedLabel}[\\s\\S]{0,420}?<a[^>]*>([^<]{1,140})<\\/a>`,
      "i"
    ),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
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
  const out: Record<BuildKey, string> = {
    weapon: "-",
    assist: "-",
    special: "-",
    emblem: "-",
    passive_a: "-",
    passive_b: "-",
    passive_c: "-",
    sacred_seal: "-",
    attuned: "-",
  };

  for (const key of REQUIRED_BUILD_KEYS) {
    const value = String(build[key] || "").trim();
    out[key] = value || "-";
  }

  return out;
}

async function loadIndexBySlug() {
  if (indexBySlugPromise) return indexBySlugPromise;

  indexBySlugPromise = (async () => {
    let rows: Array<IndexEntry> = [];

    try {
      const raw = await fs.readFile(path.join(dbRoot(), "index.json"), "utf8");
      rows = JSON.parse(raw) as Array<IndexEntry>;
    } catch {
      rows = BUNDLED_GAME8_INDEX;
    }

    if (!Array.isArray(rows) || !rows.length) {
      rows = BUNDLED_GAME8_INDEX;
    }

    const map = new Map<string, IndexEntry>();

    for (const row of rows) {
      const name = String(row?.name || "").trim();
      const slug = toSlug(name);
      if (!slug || map.has(slug)) continue;
      map.set(slug, row);
    }

    return map;
  })();

  return indexBySlugPromise;
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

function buildMirrorUrl(sourceUrl: string) {
  return `https://r.jina.ai/http://${String(sourceUrl || "").replace(/^https?:\/\//i, "")}`;
}

async function loadGame8FallbackUnit(heroSlug: string) {
  const key = toSlug(heroSlug);
  if (!key) return null;

  if (unitFallbackCache.has(key)) {
    return unitFallbackCache.get(key)!;
  }

  const promise = (async () => {
    const index = await loadIndexBySlug();
    const entry = index.get(key);
    const sourceUrl = String(entry?.url || "").trim();

    if (!/^https?:\/\//i.test(sourceUrl)) return null;

    const fetchOpts: RequestInit = {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      cache: "force-cache",
    };

    // Primary source: direct Game8 HTML.
    try {
      const response = await fetch(sourceUrl, fetchOpts);
      if (response.ok) {
        const html = await response.text();
        if (html) {
          const rawText = normalizeRawText(stripHtmlToText(html));
          if (rawText && rawText.length >= 200) {
            const recommendedBuild = normalizeRecommendedBuild({
              weapon: extractSkillFromHtml(html, "Weapon Skill"),
              assist: extractSkillFromHtml(html, "Assist Skill"),
              special: extractSkillFromHtml(html, "Special Skill"),
              passive_a: extractSkillFromHtml(html, "Passive Skill A"),
              passive_b: extractSkillFromHtml(html, "Passive Skill B"),
              passive_c: extractSkillFromHtml(html, "Passive Skill C"),
              sacred_seal: extractSkillFromHtml(html, "Sacred Seal"),
              emblem: extractSkillFromHtml(html, "Emblem"),
            });

            return {
              name: entry?.name,
              url: sourceUrl,
              raw_text_data: rawText,
              recommended_build: recommendedBuild,
              ivs: deriveIvsFromRawText(rawText) || "-",
            } satisfies UnitFileShape;
          }
        }
      }
    } catch {
      // Continue to mirror fallback.
    }

    // Secondary source: r.jina.ai mirror (works when Game8 blocks cloud runtimes).
    try {
      const mirrorUrl = buildMirrorUrl(sourceUrl);
      const mirrorResponse = await fetch(mirrorUrl, fetchOpts);
      if (!mirrorResponse.ok) return null;

      const mirrorText = await mirrorResponse.text();
      if (!mirrorText) return null;

      const rawText = normalizeRawText(stripMarkdownToText(mirrorText));
      if (!rawText || rawText.length < 200) return null;

      const recommendedBuild = normalizeRecommendedBuild({
        weapon: extractSkillFromMirrorText(mirrorText, "Weapon Skill"),
        assist: extractSkillFromMirrorText(mirrorText, "Assist Skill"),
        special: extractSkillFromMirrorText(mirrorText, "Special Skill"),
        passive_a: extractSkillFromMirrorText(mirrorText, "Passive Skill A"),
        passive_b: extractSkillFromMirrorText(mirrorText, "Passive Skill B"),
        passive_c: extractSkillFromMirrorText(mirrorText, "Passive Skill C"),
        sacred_seal: extractSkillFromMirrorText(mirrorText, "Sacred Seal"),
        emblem: extractSkillFromMirrorText(mirrorText, "Emblem"),
        attuned: extractSkillFromMirrorText(mirrorText, "Attuned Skill"),
      });

      return {
        name: entry?.name,
        url: sourceUrl,
        raw_text_data: rawText,
        recommended_build: recommendedBuild,
        ivs: deriveIvsFromRawText(rawText) || "-",
      } satisfies UnitFileShape;
    } catch {
      return null;
    }
  })();

  unitFallbackCache.set(key, promise);
  return promise;
}

async function readJsonSafe(filePath: string) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ heroSlug: string }> }
) {
  const { heroSlug } = await params;

  // Unit build / IVs / raw guide text
  let unitFile = await readJsonSafe(
    path.join(dbRoot(), "units", `${heroSlug}.json`)
  );
  if (!unitFile) {
    unitFile = await loadGame8FallbackUnit(heroSlug);
  }

  // Quotes
  const quotesFile = await readJsonSafe(
    path.join(dbRoot(), "quotes", "fandom", `${heroSlug}.json`)
  );
  let quoteText: string | null = quotesFile?.quote_text ?? null;
  if (!quoteText) {
    quoteText = await loadFandomQuoteTextBySlug(heroSlug);
  }

  // Fullbody poses
  let poses: string[] = [];
  try {
    const fbDir = path.join(dbRoot(), "unit_assets", "fandom", "fullbody", heroSlug);
    const files = await fs.readdir(fbDir);
    const poseSet = new Set<string>();
    for (const f of files) {
      const m = f.match(/_(portrait|attack|special|damage)\.(webp|png|jpe?g)$/i);
      if (m?.[1]) poseSet.add(m[1].toLowerCase());
    }
    poses = DEFAULT_POSE_ORDER.filter((p) => poseSet.has(p));
  } catch {
    /* no local fullbody */
  }
  if (!poses.length) poses = await loadFandomFullbodyPosesBySlug(heroSlug);
  if (!poses.length) poses = ["portrait"];

  // Background options
  let backgroundOptions: string[] = [];
  try {
    const bgDir = path.join(
      dbRoot(), "unit_assets", "fandom", "shared", "unit_backgrounds"
    );
    backgroundOptions = (await fs.readdir(bgDir))
      .filter((f) => /\.(png|webp|jpe?g)$/i.test(f))
      .sort();
  } catch {
    /* not available */
  }

  return NextResponse.json(
    { unitFile: unitFile ?? null, quoteText, poses, backgroundOptions },
    { headers: { "Cache-Control": "no-store" } }
  );
}
