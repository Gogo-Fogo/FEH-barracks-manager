import fs from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/client";

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
  const recommendedBuild = unitFile?.recommended_build || {};
  const buildEntries = Object.entries(recommendedBuild).filter(([, value]) => value && value.trim());

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

        <section className="mt-6 grid gap-6 md:grid-cols-[220px_1fr]">
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
            <img
              src={`/api/headshots/${hero.hero_slug}`}
              alt={`${hero.name} headshot`}
              className="mx-auto h-40 w-40 rounded-xl border border-zinc-700 object-cover"
            />
            <p className="mt-3 text-center text-xs text-zinc-400">Local Fandom headshot</p>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm">
              <p>
                <span className="text-zinc-400">Weapon:</span> {hero.weapon || "-"}
              </p>
              <p>
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

            {unitFile?.raw_text_data ? (
              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm">
                <h2 className="mb-2 text-base font-semibold">Raw Text Snapshot</h2>
                <p className="line-clamp-6 text-zinc-300">{unitFile.raw_text_data}</p>
              </div>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}
