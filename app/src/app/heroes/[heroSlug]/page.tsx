import fs from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { FullbodyCarousel } from "@/components/fullbody-carousel";

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

const DEFAULT_POSE_ORDER = ["portrait", "attack", "special", "damage"];

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

  const recommendedBuild = unitFile?.recommended_build || {};
  const buildEntries = Object.entries(recommendedBuild).filter(([, value]) => value && value.trim());
  const snapshotSummary = unitFile?.raw_text_data
    ? unitFile.raw_text_data.replace(/\s+/g, " ").slice(0, 240)
    : null;

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-100">
      <main className="mx-auto w-full max-w-5xl rounded-2xl border border-zinc-800 bg-zinc-900 p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">{hero.name}</h1>
          <div className="flex gap-2">
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

        <section className="mt-6 grid gap-6 md:grid-cols-[280px_1fr]">
          <FullbodyCarousel heroName={hero.name} heroSlug={hero.hero_slug} poses={poses} />

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

            {snapshotSummary ? (
              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm">
                <h2 className="mb-2 text-base font-semibold">Overview</h2>
                <p className="text-zinc-300">{snapshotSummary}...</p>
              </div>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}
