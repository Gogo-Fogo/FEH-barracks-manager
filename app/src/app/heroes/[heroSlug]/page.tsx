import fs from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { resolveHeroAliasToSlug } from "@/lib/hero-aliases";
import { moveIconName, rarityIconName, weaponIconName } from "@/lib/feh-icons";
import {
  loadFandomFullbodyPosesBySlug,
  loadFandomQuoteTextBySlug,
  loadUnitRarityBySlugs,
} from "@/lib/local-unit-data";
import { FullbodyCarousel } from "@/components/fullbody-carousel";
import { toggleFavorite } from "@/app/barracks/actions";

type HeroDetailPageProps = {
  params: Promise<{
    heroSlug: string;
  }>;
};

type UnitFile = {
  name?: string;
  ivs?: string;
  raw_text_data?: string;
  recommended_build?: Record<string, string>;
};

type GuideHighlights = {
  role: string[];
  strengths: string[];
  weaknesses: string[];
  tips: string[];
  counters: string[];
};

type BuildEntryDetail = {
  key: string;
  value: string;
  description: string | null;
  inheritSources: string[];
  isDerivedSpecial: boolean;
};

type SkillHint = "weapon" | "special";

type UnitSnapshot = {
  name: string;
  rawText: string;
};

type QuotesFile = {
  quote_text?: string;
};

const DEFAULT_POSE_ORDER = ["portrait", "attack", "special", "damage"];
const ARTIST_REFERENCE_URL = "https://feheroes.fandom.com/wiki/List_of_artists";
const BUILD_KEY_ORDER = [
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

let unitSnapshotsPromise: Promise<UnitSnapshot[]> | null = null;
let inheritableSkillSourcesPromise: Promise<Map<string, string[]>> | null = null;
const skillDescriptionCache = new Map<string, string | null>();

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSkillKey(value?: string | null) {
  return (value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[’]/g, "'")
    .replace(/[^A-Za-z0-9+/'().\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function cleanDescription(value?: string | null) {
  const cleaned = (value || "")
    .replace(/\s+/g, " ")
    .replace(/\s([,.;!?])/g, "$1")
    .trim();

  if (!cleaned) return null;
  if (cleaned.length <= 520) return cleaned;
  return `${cleaned.slice(0, 517)}...`;
}

function extractSkillDescriptionFromRaw(rawText: string | undefined, skillName: string, hint: SkillHint) {
  if (!rawText || !skillName || skillName.trim() === "-") return null;

  const compact = rawText.replace(/\s+/g, " ").trim();
  if (!compact) return null;

  const escaped = escapeRegExp(skillName.trim());

  const patterns =
    hint === "weapon"
      ? [
          new RegExp(
            `${escaped}\\s+Might:\\s*\\d+\\s+Range:\\s*\\d+\\s*([\\s\\S]{12,1200}?)(?=\\s+[A-Za-z0-9'+./\\- ]+\\s+Cooldown Count\\s*=|\\s+[A-Za-z0-9'+./\\- ]+\\s+Best IVs|\\s+[A-Za-z0-9'+./\\- ]+\\s+Best Builds|\\s+[A-Za-z0-9'+./\\- ]+\\s+Best Weapon Refine|$)`,
            "i"
          ),
          new RegExp(
            `${escaped}\\s+\\d+\\s+\\d+\\s*([\\s\\S]{12,1200}?)(?=\\s+[345]\\u2605|\\s+Assists\\s+This Hero|\\s+Specials\\s+Skill Name|\\s+Passives\\s+Skill Name|$)`,
            "i"
          ),
        ]
      : [
          new RegExp(
            `${escaped}\\s*\\(Cooldown Count\\s*=\\s*\\d+\\)\\s*([\\s\\S]{10,900}?)(?=\\s+[345]\\u2605|\\s+[A-Za-z0-9'+./\\- ]+\\s*\\(Cooldown Count\\s*=|\\s+Passives\\s+Skill Name|\\s+[A-Za-z0-9'+./\\- ]+\\s+as a Source Hero|\\s+How to Get|$)`,
            "i"
          ),
          new RegExp(
            `${escaped}\\s+Cooldown Count\\s*=\\s*\\d+\\s*([\\s\\S]{10,900}?)(?=\\s+[A-Za-z0-9'+./\\- ]+\\s+(?:At start of combat|Inflicts|After combat|Boosts|Treats)|\\s+[A-Za-z0-9'+./\\- ]+\\s+Best IVs|\\s+[A-Za-z0-9'+./\\- ]+\\s+Best Builds|$)`,
            "i"
          ),
        ];

  for (const pattern of patterns) {
    const match = compact.match(pattern);
    const cleaned = cleanDescription(match?.[1]);
    if (cleaned) return cleaned;
  }

  return null;
}

async function loadUnitSnapshots(): Promise<UnitSnapshot[]> {
  if (unitSnapshotsPromise) return unitSnapshotsPromise;

  unitSnapshotsPromise = (async () => {
    const roots = [
      path.join(process.cwd(), "db", "units"),
      path.join(process.cwd(), "..", "db", "units"),
    ];

    for (const root of roots) {
      try {
        const files = (await fs.readdir(root)).filter((file) => file.endsWith(".json"));
        const snapshots: UnitSnapshot[] = [];

        for (const file of files) {
          try {
            const raw = await fs.readFile(path.join(root, file), "utf8");
            const parsed = JSON.parse(raw) as UnitFile;
            snapshots.push({
              name: parsed.name || file.replace(/\.json$/i, ""),
              rawText: parsed.raw_text_data || "",
            });
          } catch {
            // skip malformed files
          }
        }

        return snapshots;
      } catch {
        // continue to next root candidate
      }
    }

    return [] as UnitSnapshot[];
  })();

  return unitSnapshotsPromise;
}

async function findSkillDescription(skillName: string, hint: SkillHint, preferredRawText?: string) {
  if (!skillName || skillName.trim() === "-") return null;

  const cacheKey = `${hint}:${normalizeSkillKey(skillName)}`;
  if (skillDescriptionCache.has(cacheKey)) {
    return skillDescriptionCache.get(cacheKey) ?? null;
  }

  const preferred = extractSkillDescriptionFromRaw(preferredRawText, skillName, hint);
  if (preferred) {
    skillDescriptionCache.set(cacheKey, preferred);
    return preferred;
  }

  const snapshots = await loadUnitSnapshots();
  for (const snapshot of snapshots) {
    const fromSnapshot = extractSkillDescriptionFromRaw(snapshot.rawText, skillName, hint);
    if (fromSnapshot) {
      skillDescriptionCache.set(cacheKey, fromSnapshot);
      return fromSnapshot;
    }
  }

  skillDescriptionCache.set(cacheKey, null);
  return null;
}

function extractInheritableSkills(rawText?: string) {
  if (!rawText) return [] as string[];

  const compact = rawText.replace(/\s+/g, " ").trim();
  if (!compact) return [] as string[];

  const skills = new Set<string>();
  const inheritanceRegex =
    /\bhas\s+(.{3,320}?)\s+as\s+(?:[a-z-]+\s+){0,4}(?:inheritable|inheritance)\s+(?:options|skills)\b/gi;

  for (const match of compact.matchAll(inheritanceRegex)) {
    const fragment = (match[1] || "")
      .replace(/\([^)]*\)/g, " ")
      .replace(/\b(?:both|either)\b/gi, " ")
      .replace(/\bplus another skill\b/gi, " ");

    const candidates = fragment
      .replace(/\band\/or\b/gi, ",")
      .replace(/\band\b/gi, ",")
      .replace(/\bplus\b/gi, ",")
      .split(",")
      .map((piece) =>
        piece
          .replace(/\b(?:skills?|options?)\b/gi, " ")
          .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9+/'().\-\s]+$/g, "")
          .replace(/\s+/g, " ")
          .trim()
      )
      .filter((piece) => piece.length >= 2 && piece.length <= 80 && /[A-Za-z]/.test(piece));

    for (const candidate of candidates) {
      skills.add(candidate);
    }
  }

  return Array.from(skills);
}

async function loadInheritableSkillSources() {
  if (inheritableSkillSourcesPromise) return inheritableSkillSourcesPromise;

  inheritableSkillSourcesPromise = (async () => {
    const snapshots = await loadUnitSnapshots();
    const map = new Map<string, Set<string>>();

    for (const snapshot of snapshots) {
      const inheritSkills = extractInheritableSkills(snapshot.rawText);
      for (const skill of inheritSkills) {
        const key = normalizeSkillKey(skill);
        if (!key) continue;

        if (!map.has(key)) map.set(key, new Set<string>());
        map.get(key)?.add(snapshot.name);
      }
    }

    return new Map(
      Array.from(map.entries()).map(([key, names]) => [
        key,
        Array.from(names).sort((a, b) => a.localeCompare(b)),
      ])
    );
  })();

  return inheritableSkillSourcesPromise;
}

function extractIllustratorName(rawText?: string) {
  const compact = normalizeGuideText(rawText);
  if (!compact) return null;

  const patterns = [
    /Illustrator\s+([A-Za-z0-9'’().,&\- ]{2,80}?)\s+(?:Appears In|Illustration|FEH:|Related Guides)/i,
    /Voice Actor and Illustrator Information[\s\S]{0,220}?Illustrator\s+([A-Za-z0-9'’().,&\- ]{2,80})/i,
  ];

  for (const pattern of patterns) {
    const match = compact.match(pattern);
    const candidate = match?.[1]?.replace(/\s+/g, " ").trim();
    if (candidate && !/^information$/i.test(candidate)) {
      return candidate;
    }
  }

  return null;
}

function deriveSpecialFromRawText(rawText?: string) {
  const compact = normalizeGuideText(rawText);
  if (!compact) return null;

  const patterns = [
    /Skills at 5★[\s\S]{0,750}?\b([A-Z][A-Za-z0-9'’+./\- ]{1,60})\s+Cooldown Count\s*=\s*\d+/i,
    /Specials\s+Skill Name\s+Effect\s+Learned At\s+([A-Z][A-Za-z0-9'’+./\- ]{1,60})\s*\(Cooldown Count\s*=\s*\d+\)/i,
  ];

  for (const pattern of patterns) {
    const match = compact.match(pattern);
    const candidate = match?.[1]?.replace(/\s+/g, " ").trim();
    if (!candidate) continue;
    if (/^(skills?|specials?|cooldown|count|effect|learned|at)$/i.test(candidate)) continue;
    return candidate;
  }

  return null;
}

function SkillValueWithTooltip({
  skillName,
  description,
}: {
  skillName: string;
  description: string | null;
}) {
  if (!skillName || skillName.trim() === "-") {
    return <span>{skillName || "-"}</span>;
  }

  return (
    <span className="group skill-tooltip relative inline-flex max-w-full items-center gap-1 align-middle">
      <span
        tabIndex={0}
        className="inline-flex max-w-full items-center gap-1 rounded-md border border-indigo-700/60 bg-indigo-950/35 px-1.5 py-0.5 text-zinc-100 outline-none transition focus-visible:ring-2 focus-visible:ring-indigo-400"
      >
        <span className="truncate">{skillName}</span>
        {description ? <span className="text-[10px] text-indigo-300">ⓘ</span> : null}
      </span>

      {description ? (
        <span className="pointer-events-none absolute bottom-[calc(100%+0.55rem)] left-0 z-40 hidden w-[min(34rem,82vw)] rounded-lg border border-indigo-500/70 bg-zinc-950/97 p-3 text-xs leading-relaxed text-zinc-100 shadow-[0_0_16px_rgba(99,102,241,0.45),0_0_34px_rgba(59,130,246,0.3)] backdrop-blur-sm group-hover:block group-focus-within:block">
          {description}
        </span>
      ) : null}
    </span>
  );
}

function buildKeyLabel(key: string) {
  const labels: Record<string, string> = {
    weapon: "Weapon",
    assist: "Assist",
    special: "Special",
    emblem: "Emblem",
    passive_a: "Passive A",
    passive_b: "Passive B",
    passive_c: "Passive C",
    sacred_seal: "Sacred Seal",
    attuned: "Attuned",
  };

  return labels[key] || key.replaceAll("_", " ");
}

function normalizeGuideText(raw?: string | null) {
  return (raw || "")
    .replace(/\s+/g, " ")
    .replace(/\s([,.!?;:])/g, "$1")
    .trim();
}

function pickMatches(sentences: string[], patterns: RegExp[], limit = 3) {
  const selected: string[] = [];
  for (const sentence of sentences) {
    if (!sentence || sentence.length < 20) continue;
    if (patterns.some((pattern) => pattern.test(sentence))) {
      if (!selected.includes(sentence)) selected.push(sentence);
      if (selected.length >= limit) break;
    }
  }
  return selected;
}

function buildGuideHighlights(rawText?: string): GuideHighlights {
  const normalized = normalizeGuideText(rawText);
  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    role: pickMatches(sentences, [/\brole\b/i, /\bplaystyle\b/i, /\bexcels\b/i, /\bworks best\b/i]),
    strengths: pickMatches(sentences, [/\bstrength\b/i, /\bstrong\b/i, /\bexcellent\b/i, /\bhigh\b/i, /\badvantage\b/i]),
    weaknesses: pickMatches(sentences, [/\bweak\b/i, /\bweakness\b/i, /\bstruggle\b/i, /\bvulnerable\b/i, /\bcaution\b/i]),
    tips: pickMatches(sentences, [/\btip\b/i, /\brecommend\b/i, /\bposition\b/i, /\buse\b/i, /\bprioritize\b/i]),
    counters: pickMatches(sentences, [/\bcounter\b/i, /\bagainst\b/i, /\bthreat\b/i, /\bmatchup\b/i]),
  };
}

function unitBackgroundName(tag?: string | null) {
  const t = (tag || "").toLowerCase();
  if (t.includes("halloween")) return "Bg_DetailedStatus_Halloween.webp";
  if (t.includes("new year")) return "Bg_DetailedStatus_NewYear.webp";
  if (t.includes("summer") || t.includes("beach")) return "Bg_DetailedStatus_Beach.webp";
  if (t.includes("tea")) return "Bg_DetailedStatus_TeaParty.webp";
  if (t.includes("ninja")) return "Bg_DetailedStatus_Ask.webp";
  return "BG_DetailedStatus.png";
}

async function loadFullbodyPoses(heroSlug: string) {
  let localPoses: string[] = [];

  const roots = [
    path.join(process.cwd(), "db", "unit_assets", "fandom", "fullbody", heroSlug),
    path.join(process.cwd(), "..", "db", "unit_assets", "fandom", "fullbody", heroSlug),
  ];

  for (const root of roots) {
    try {
      const files = await fs.readdir(root);
      const poses = new Set<string>();
      for (const file of files) {
        const match = file.match(/_(portrait|attack|special|damage)\.(webp|png|jpe?g)$/i);
        if (match?.[1]) poses.add(match[1].toLowerCase());
      }

      if (poses.size) {
        localPoses = DEFAULT_POSE_ORDER.filter((pose) => poses.has(pose));
        break;
      }
    } catch {
      // continue
    }
  }

  const fandomPoses = await loadFandomFullbodyPosesBySlug(heroSlug);
  if (fandomPoses.length > localPoses.length) {
    return fandomPoses;
  }

  if (localPoses.length) {
    return localPoses;
  }

  if (fandomPoses.length) {
    return fandomPoses;
  }

  return ["portrait"];
}

async function loadUnitFile(heroSlug: string): Promise<UnitFile | null> {
  const candidates = [
    path.join(process.cwd(), "db", "units", `${heroSlug}.json`),
    path.join(process.cwd(), "..", "db", "units", `${heroSlug}.json`),
  ];

  for (const filePath of candidates) {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      return JSON.parse(raw) as UnitFile;
    } catch {
      // continue
    }
  }

  return null;
}

function extractQuoteCandidates(rawText?: string) {
  if (!rawText) return [] as string[];

  const allowedSections = new Set([
    "summoning",
    "castle",
    "friend greeting",
    "leveling up",
    "ally growth",
    "5★ lv. 40 conversation",
    "special trigger",
    "defeat",
    "status page",
    "turn action",
  ]);

  const sectionHeading = /^(.+?)\s*\[[^\]]*\]\s*$/;
  const noiseHeading = /^(general|quotes|misc|audio|transcription|rarity|story appearances|random quote)$/i;
  const markerNoise = /^(\+\[[0-9,]+\]\s*points|\*spit\*|upload file|-|\[[^\]]*\])$/i;

  const lines = rawText
    .split(/\r?\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const unique: string[] = [];
  let inAllowedSection = false;

  for (const line of lines) {
    if (/^story appearances\b/i.test(line)) {
      inAllowedSection = false;
      continue;
    }

    if (/^random quote\b/i.test(line)) {
      inAllowedSection = false;
      continue;
    }

    const sectionMatch = line.match(sectionHeading);
    if (sectionMatch?.[1]) {
      const sectionName = sectionMatch[1].toLowerCase();
      inAllowedSection = allowedSections.has(sectionName);
      continue;
    }

    if (!inAllowedSection) continue;
    if (line.length < 10 || line.length > 220) continue;
    if (/^https?:\/\//i.test(line)) continue;
    if (noiseHeading.test(line)) continue;
    if (markerNoise.test(line)) continue;
    if (/\(map\)/i.test(line)) continue;
    if (/&#\d+;|&nbsp;/i.test(line)) continue;
    if (/^\([^)]*\)$/.test(line)) continue;
    if (/upload file/i.test(line)) continue;
    if (/\/Story\b/i.test(line)) continue;
    if (/^in\s.+\/story$/i.test(line)) continue;
    if (/^(name|source|fandom|extracted_at)\b/i.test(line)) continue;
    if (!/[A-Za-z]/.test(line)) continue;
    if (/[ぁ-んァ-ン一-龯]/.test(line)) continue;
    if (/^[\d\[\]().,:;!/?%+\-\s]+$/.test(line)) continue;

    if (!unique.includes(line)) unique.push(line);
    if (unique.length >= 80) break;
  }

  return unique;
}

async function loadHeroQuotes(heroSlug: string) {
  const candidates = [
    path.join(process.cwd(), "db", "quotes", "fandom", `${heroSlug}.json`),
    path.join(process.cwd(), "..", "db", "quotes", "fandom", `${heroSlug}.json`),
  ];

  for (const filePath of candidates) {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as QuotesFile;
      return extractQuoteCandidates(parsed.quote_text);
    } catch {
      // continue
    }
  }

  return [] as string[];
}

function parseQuoteTextToCandidates(rawText?: string | null) {
  return extractQuoteCandidates(rawText ?? undefined);
}

async function loadUnitBackgroundOptions() {
  const roots = [
    path.join(process.cwd(), "db", "unit_assets", "fandom", "shared", "unit_backgrounds"),
    path.join(process.cwd(), "..", "db", "unit_assets", "fandom", "shared", "unit_backgrounds"),
  ];

  for (const root of roots) {
    try {
      const files = await fs.readdir(root);
      return files
        .filter((f) => /\.(png|webp|jpe?g)$/i.test(f))
        .sort((a, b) => a.localeCompare(b));
    } catch {
      // continue
    }
  }

  return [] as string[];
}

async function loadLocalRarityBySlug(heroSlug: string) {
  const candidates = [
    path.join(process.cwd(), "db", "index.json"),
    path.join(process.cwd(), "..", "db", "index.json"),
  ];

  for (const filePath of candidates) {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const rows = JSON.parse(raw) as Array<{ name?: string; rarity?: string | null }>;
      const bySlug = new Map<string, string | null>();
      for (const row of rows) {
        if (!row?.name) continue;
        const slug = String(row.name).replace(/[^a-z0-9]/gi, "_").toLowerCase();
        bySlug.set(slug, row.rarity ?? null);
      }
      return bySlug.get(heroSlug) ?? null;
    } catch {
      // continue
    }
  }

  const fallback = await loadUnitRarityBySlugs([heroSlug]);
  return fallback.get(heroSlug) ?? null;

  return null;
}

export default async function HeroDetailPage({ params }: HeroDetailPageProps) {
  if (!isSupabaseConfigured()) {
    redirect("/login");
  }

  const { heroSlug } = await params;
  const aliasResolvedSlug = await resolveHeroAliasToSlug(heroSlug);
  const canonicalHeroSlug = aliasResolvedSlug || heroSlug;

  if (aliasResolvedSlug && aliasResolvedSlug !== heroSlug) {
    redirect(`/heroes/${aliasResolvedSlug}`);
  }

  const unitFile = await loadUnitFile(canonicalHeroSlug);
  const localRarity = await loadLocalRarityBySlug(canonicalHeroSlug);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: heroFromDb } = await supabase
    .from("heroes")
    .select("*")
    .eq("hero_slug", canonicalHeroSlug)
    .maybeSingle();

  const { data: favoriteRow } = await supabase
    .from("user_favorites")
    .select("hero_slug")
    .eq("user_id", user.id)
    .eq("hero_slug", canonicalHeroSlug)
    .maybeSingle();

  const hero = heroFromDb ||
    (unitFile
      ? {
          hero_slug: canonicalHeroSlug,
          name: unitFile.name || canonicalHeroSlug,
          tier: null,
          weapon: null,
          move: null,
          tag: null,
          source_url: null,
        }
      : null);

  if (hero && !hero.rarity) {
    hero.rarity = localRarity;
  }

  if (!hero) {
    notFound();
  }

  const poses = await loadFullbodyPoses(hero.hero_slug);
  let heroQuotes = await loadHeroQuotes(hero.hero_slug);
  if (!heroQuotes.length) {
    const fandomQuoteText = await loadFandomQuoteTextBySlug(hero.hero_slug);
    heroQuotes = parseQuoteTextToCandidates(fandomQuoteText);
  }
  const weaponIcon = weaponIconName(hero.weapon);
  const moveIcon = moveIconName(hero.move);
  const defaultBackgroundName = unitBackgroundName(hero.tag);
  const backgroundOptions = await loadUnitBackgroundOptions();

  const { data: savedPreference } = await supabase
    .from("user_hero_preferences")
    .select("background_name")
    .eq("user_id", user.id)
    .eq("hero_slug", hero.hero_slug)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const savedBackgroundName = savedPreference?.background_name || "";
  const cookieStore = await cookies();
  const cookieBackgroundName = decodeURIComponent(
    cookieStore.get(`hero_bg_${hero.hero_slug}`)?.value || ""
  );
  const initialBackgroundName = backgroundOptions.includes(savedBackgroundName)
    ? savedBackgroundName
    : backgroundOptions.includes(cookieBackgroundName)
      ? cookieBackgroundName
    : backgroundOptions.includes(defaultBackgroundName)
      ? defaultBackgroundName
      : backgroundOptions[0] || defaultBackgroundName;

  const recommendedBuild = unitFile?.recommended_build || {};
  const baseSpecial = (recommendedBuild.special || "").trim();
  const derivedSpecial = !baseSpecial || baseSpecial === "-" ? deriveSpecialFromRawText(unitFile?.raw_text_data) : null;
  const effectiveBuild: Record<string, string> = {
    ...recommendedBuild,
    ...(derivedSpecial ? { special: derivedSpecial } : {}),
  };

  const inheritSourceMap = await loadInheritableSkillSources();
  const buildEntriesDetailed: BuildEntryDetail[] = await Promise.all(
    BUILD_KEY_ORDER.map(async (key) => {
      const value = (effectiveBuild[key] || "").trim();
      if (!value || value === "-") return null;

      const description =
        key === "weapon" || key === "special"
          ? await findSkillDescription(value, key as SkillHint, unitFile?.raw_text_data)
          : null;

      const inheritSources = (inheritSourceMap.get(normalizeSkillKey(value)) || [])
        .filter((sourceName) => sourceName !== hero.name)
        .slice(0, 8);

      return {
        key,
        value,
        description,
        inheritSources,
        isDerivedSpecial: key === "special" && Boolean(derivedSpecial),
      } as BuildEntryDetail;
    })
  ).then((entries) => entries.filter((entry): entry is BuildEntryDetail => Boolean(entry)));

  const isSpecialMissing = !buildEntriesDetailed.some((entry) => entry.key === "special");
  const artistName = extractIllustratorName(unitFile?.raw_text_data);
  const highlights = buildGuideHighlights(unitFile?.raw_text_data);
  const hasAnyHighlight =
    highlights.role.length ||
    highlights.strengths.length ||
    highlights.weaknesses.length ||
    highlights.tips.length ||
    highlights.counters.length;

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-100">
      <main className="mx-auto w-full max-w-6xl rounded-2xl border border-zinc-800 bg-zinc-900 p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">{hero.name}</h1>
          <div className="flex gap-2">
            <form action={toggleFavorite}>
              <input type="hidden" name="hero_slug" value={hero.hero_slug} readOnly />
              <input type="hidden" name="redirect_to" value={`/heroes/${hero.hero_slug}`} readOnly />
              <button
                type="submit"
                className="rounded-md border border-amber-700 px-3 py-1.5 text-sm text-amber-300 hover:bg-amber-950"
              >
                {favoriteRow?.hero_slug ? "★ Unfavorite" : "☆ Favorite"}
              </button>
            </form>
            <Link
              href="/heroes"
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800"
            >
              Back to heroes
            </Link>
            <Link
              href="/barracks"
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800"
            >
              Back to barracks
            </Link>
          </div>
        </div>

        <section className="mt-6 grid gap-6 md:grid-cols-[minmax(360px,420px)_1fr]">
          <div className="space-y-3">
            <FullbodyCarousel
              heroName={hero.name}
              heroSlug={hero.hero_slug}
              poses={poses}
              quotes={heroQuotes}
              initialBackgroundName={initialBackgroundName}
              backgroundOptions={backgroundOptions}
              persistBackgroundPreference={Boolean(heroFromDb)}
            />

            <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-300">
              <span className="text-zinc-400">Banner art illustrator:</span>{" "}
              {artistName ? (
                <>
                  {artistName}{" "}
                  <a
                    href={ARTIST_REFERENCE_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="text-indigo-300 hover:underline"
                  >
                    (artist list)
                  </a>
                </>
              ) : (
                <>
                  Unknown{" "}
                  <a
                    href={ARTIST_REFERENCE_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="text-indigo-300 hover:underline"
                  >
                    (check artist list)
                  </a>
                </>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm">
              <p className="mb-2 flex items-center gap-2">
                {rarityIconName(hero.rarity) ? (
                  <img
                    src={`/api/shared-icons/rarity?name=${encodeURIComponent(rarityIconName(hero.rarity) || "")}`}
                    alt={`${hero.rarity || "Rarity"} icon`}
                    className="h-5 w-5 rounded-sm"
                  />
                ) : null}
                <span className="text-zinc-400">Rarity:</span> {hero.rarity || "-"}
              </p>
              <p className="mb-2 flex items-center gap-2">
                {weaponIcon ? (
                  <img
                    src={`/api/shared-icons/weapon_type?name=${encodeURIComponent(weaponIcon)}`}
                    alt={`${hero.weapon || "Weapon"} icon`}
                    className="h-5 w-5 rounded-sm"
                  />
                ) : null}
                <span className="text-zinc-400">Weapon:</span> {hero.weapon || "-"}
              </p>
              <p className="mb-2 flex items-center gap-2">
                {moveIcon ? (
                  <img
                    src={`/api/shared-icons/move?name=${encodeURIComponent(moveIcon)}`}
                    alt={`${hero.move || "Move"} icon`}
                    className="h-5 w-5 rounded-sm"
                  />
                ) : null}
                <span className="text-zinc-400">Move:</span> {hero.move || "-"}
              </p>
              <p>
                <span className="text-zinc-400">Tier:</span> {hero.tier ?? "-"}
              </p>
              <p>
                <span className="text-zinc-400">Tag:</span> {hero.tag || "-"}
              </p>
              {hero.source_url ? (
                <p className="mt-2">
                  <a
                    href={hero.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-indigo-300 hover:underline"
                  >
                    Open source page
                  </a>
                </p>
              ) : null}
            </div>

            {unitFile?.ivs ? (
              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm">
                <h2 className="mb-2 text-base font-semibold">IV Recommendation</h2>
                <p className="text-zinc-300">{unitFile.ivs}</p>
              </div>
            ) : null}

            {buildEntriesDetailed.length ? (
              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm">
                <h2 className="mb-2 text-base font-semibold">Recommended Build</h2>
                <p className="mb-2 text-xs text-zinc-400">Hover Weapon / Special for effect descriptions.</p>

                <div className="grid gap-2 md:grid-cols-2">
                  {buildEntriesDetailed.map((entry) => (
                    <div key={entry.key} className="rounded-md border border-zinc-800 bg-zinc-900/45 p-2">
                      <p>
                        <span className="text-zinc-400">{buildKeyLabel(entry.key)}:</span>{" "}
                        {entry.key === "weapon" || entry.key === "special" ? (
                          <SkillValueWithTooltip skillName={entry.value} description={entry.description} />
                        ) : (
                          <span>{entry.value}</span>
                        )}
                      </p>

                      {entry.isDerivedSpecial ? (
                        <p className="mt-1 text-[11px] text-amber-300">
                          Filled from profile text because special was missing in structured build data.
                        </p>
                      ) : null}

                      {entry.inheritSources.length ? (
                        <p className="mt-1 text-[11px] text-cyan-200">
                          Inherit from: {entry.inheritSources.join(", ")}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>

                {isSpecialMissing ? (
                  <p className="mt-3 rounded-md border border-amber-800/80 bg-amber-950/25 px-2 py-1.5 text-xs text-amber-200">
                    This hero is currently missing a detected Special/Ult in available data.
                  </p>
                ) : null}
              </div>
            ) : null}

            {hasAnyHighlight ? (
              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm">
                <h2 className="mb-3 text-base font-semibold">Guide Highlights</h2>

                <div className="grid gap-3 md:grid-cols-2">
                  {highlights.role.length ? (
                    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                      <h3 className="mb-2 text-sm font-semibold text-indigo-300">Role / Playstyle</h3>
                      <ul className="list-disc space-y-1 pl-5 text-zinc-300">
                        {highlights.role.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {highlights.strengths.length ? (
                    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                      <h3 className="mb-2 text-sm font-semibold text-emerald-300">Strengths</h3>
                      <ul className="list-disc space-y-1 pl-5 text-zinc-300">
                        {highlights.strengths.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {highlights.weaknesses.length ? (
                    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                      <h3 className="mb-2 text-sm font-semibold text-amber-300">Weaknesses</h3>
                      <ul className="list-disc space-y-1 pl-5 text-zinc-300">
                        {highlights.weaknesses.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {highlights.tips.length ? (
                    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                      <h3 className="mb-2 text-sm font-semibold text-cyan-300">Quick Tips</h3>
                      <ul className="list-disc space-y-1 pl-5 text-zinc-300">
                        {highlights.tips.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {highlights.counters.length ? (
                    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 md:col-span-2">
                      <h3 className="mb-2 text-sm font-semibold text-rose-300">Counters / Threat Notes</h3>
                      <ul className="list-disc space-y-1 pl-5 text-zinc-300">
                        {highlights.counters.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}
