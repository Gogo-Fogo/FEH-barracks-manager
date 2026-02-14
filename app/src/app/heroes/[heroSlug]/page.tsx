import fs from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/client";
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

const DEFAULT_POSE_ORDER = ["portrait", "attack", "special", "damage"];

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

function weaponIconName(weapon?: string | null) {
  if (!weapon) return null;
  const w = weapon.toLowerCase();
  const color = w.includes("red") ? "Red" : w.includes("blue") ? "Blue" : w.includes("green") ? "Green" : "Colorless";

  if (w.includes("sword")) return "Icon_Class_Red_Sword.png";
  if (w.includes("lance")) return "Icon_Class_Blue_Lance.png";
  if (w.includes("axe")) return "Icon_Class_Green_Axe.png";
  if (w.includes("staff")) return "Icon_Class_Colorless_Staff.png";
  if (w.includes("tome")) return `Icon_Class_${color}_Tome.png`;
  if (w.includes("bow")) return `Icon_Class_${color}_Bow.png`;
  if (w.includes("dagger")) return `Icon_Class_${color}_Dagger.png`;
  if (w.includes("breath") || w.includes("dragon")) return `Icon_Class_${color}_Breath.png`;
  if (w.includes("beast")) return `Icon_Class_${color}_Beast.png`;
  return null;
}

function moveIconName(move?: string | null) {
  if (!move) return null;
  const m = move.toLowerCase();
  if (m.includes("infantry")) return "Icon_Move_Infantry.png";
  if (m.includes("armor")) return "Icon_Move_Armored.png";
  if (m.includes("flying")) return "Icon_Move_Flying.png";
  if (m.includes("cavalry")) return "Icon_Move_Cavalry.png";
  return null;
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
        return DEFAULT_POSE_ORDER.filter((pose) => poses.has(pose));
      }
    } catch {
      // continue
    }
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

export default async function HeroDetailPage({ params }: HeroDetailPageProps) {
  if (!isSupabaseConfigured()) {
    redirect("/login");
  }

  const { heroSlug } = await params;
  const unitFile = await loadUnitFile(heroSlug);

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
    .eq("hero_slug", heroSlug)
    .maybeSingle();

  const { data: favoriteRow } = await supabase
    .from("user_favorites")
    .select("hero_slug")
    .eq("user_id", user.id)
    .eq("hero_slug", heroSlug)
    .maybeSingle();

  const hero = heroFromDb ||
    (unitFile
      ? {
          hero_slug: heroSlug,
          name: unitFile.name || heroSlug,
          tier: null,
          weapon: null,
          move: null,
          tag: null,
          source_url: null,
        }
      : null);

  if (!hero) {
    notFound();
  }

  const poses = await loadFullbodyPoses(hero.hero_slug);
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
  const buildEntries = Object.entries(recommendedBuild).filter(([, value]) => value && value.trim());
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
          <FullbodyCarousel
            heroName={hero.name}
            heroSlug={hero.hero_slug}
            poses={poses}
            initialBackgroundName={initialBackgroundName}
            backgroundOptions={backgroundOptions}
            persistBackgroundPreference={Boolean(heroFromDb)}
          />

          <div className="space-y-4">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm">
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

            {buildEntries.length ? (
              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm">
                <h2 className="mb-2 text-base font-semibold">Recommended Build</h2>
                <div className="grid gap-1 md:grid-cols-2">
                  {buildEntries.map(([key, value]) => (
                    <p key={key}>
                      <span className="text-zinc-400">{key.replaceAll("_", " ")}:</span> {value}
                    </p>
                  ))}
                </div>
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
