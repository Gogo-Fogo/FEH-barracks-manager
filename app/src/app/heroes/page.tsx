import fs from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { dbRoot } from "@/lib/db-root";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { HeroesListClient } from "@/components/heroes-list-client";
import { HeroBrowserFilters } from "@/components/hero-browser-filters";
import { listHeroAliasOptionsBySlug, resolveHeroAliasToSlug } from "@/lib/hero-aliases";
import { loadUnitRarityBySlugs } from "@/lib/local-unit-data";
import { normalizeHeroSearchText } from "@/lib/hero-typeahead";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const HERO_QUERY_MAX_ROWS = 5000;

type HeroesPageProps = {
  searchParams: Promise<{
    q?: string;
    weapon?: string;
    move?: string;
    tag?: string;
    minTier?: string;
    favorite?: string;
    sort?: string;
    notice?: string;
    tone?: string;
  }>;
};

function safeSlug(name: string) {
  return String(name || "")
    .replace(/[^a-z0-9]/gi, "_")
    .toLowerCase();
}

async function loadLocalRarityBySlug() {
  const candidates = [
    path.join(dbRoot(), "index.json"),
  ];

  for (const filePath of candidates) {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const rows = JSON.parse(raw) as Array<{ name?: string; rarity?: string | null }>;
      const map = new Map<string, string | null>();
      for (const row of rows) {
        if (!row?.name) continue;
        map.set(safeSlug(row.name), row.rarity ?? null);
      }
      return map;
    } catch {
      // continue
    }
  }

  return new Map<string, string | null>();
}

function looksLikeGuideTitle(name: string) {
  return /\b(builds?|best\s+refine|best\s+build|tier\s+list|ratings?)\b/i.test(name);
}

export default async function HeroesPage({ searchParams }: HeroesPageProps) {
  if (!isSupabaseConfigured()) {
    redirect("/login");
  }

  const params = await searchParams;
  const q = (params.q || "").trim();
  const weapon = (params.weapon || "").trim();
  const move = (params.move || "").trim();
  const tag = (params.tag || "").trim();
  const minTierRaw = (params.minTier || "").trim();
  const minTierParsed = Number(minTierRaw);
  const minTier = Number.isFinite(minTierParsed) ? minTierParsed : null;
  const favoriteOnly = params.favorite === "1";
  const sort = (params.sort || "tier_desc").trim();
  const notice = (params.notice || "").trim();
  const tone = (params.tone || "success").trim();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const currentQuery = new URLSearchParams();
  if (q) currentQuery.set("q", q);
  if (weapon) currentQuery.set("weapon", weapon);
  if (move) currentQuery.set("move", move);
  if (tag) currentQuery.set("tag", tag);
  if (minTierRaw) currentQuery.set("minTier", minTierRaw);
  if (favoriteOnly) currentQuery.set("favorite", "1");
  if (sort && sort !== "tier_desc") currentQuery.set("sort", sort);
  const currentPath = `/heroes${currentQuery.toString() ? `?${currentQuery.toString()}` : ""}`;
  const localRarityBySlug = await loadLocalRarityBySlug();

  const buildHeroesQueryWithRarity = () => {
    let query = supabase
      .from("heroes")
      .select("hero_slug,name,rarity,weapon,move,tier,tag,updated_at")
      .order("hero_slug", { ascending: true })
      .range(0, HERO_QUERY_MAX_ROWS - 1);

    // q is intentionally NOT passed to Supabase — ILIKE is not accent-aware so
    // "Celine" would miss "Céline". We apply normalizeHeroSearchText in JS below.
    if (weapon) query = query.eq("weapon", weapon);
    if (move) query = query.eq("move", move);
    if (tag) query = query.eq("tag", tag);
    if (minTier != null) query = query.gte("tier", minTier);
    return query;
  };

  const buildHeroesQueryWithoutRarity = () => {
    let query = supabase
      .from("heroes")
      .select("hero_slug,name,weapon,move,tier,tag,updated_at")
      .order("hero_slug", { ascending: true })
      .range(0, HERO_QUERY_MAX_ROWS - 1);

    if (weapon) query = query.eq("weapon", weapon);
    if (move) query = query.eq("move", move);
    if (tag) query = query.eq("tag", tag);
    if (minTier != null) query = query.gte("tier", minTier);
    return query;
  };

  const heroesResult = await buildHeroesQueryWithRarity();
  let heroRows: Array<{
    hero_slug: string;
    name: string;
    rarity: string | null;
    weapon: string | null;
    move: string | null;
    tier: number | null;
    tag: string | null;
    updated_at: string | null;
  }> = [];

  if (heroesResult.error?.message.includes("rarity")) {
    const fallback = await buildHeroesQueryWithoutRarity();
    heroRows = (fallback.data || []).map((h) => ({
      hero_slug: h.hero_slug,
      name: h.name,
      rarity: localRarityBySlug.get(h.hero_slug) ?? null,
      weapon: h.weapon,
      move: h.move,
      tier: h.tier,
      tag: h.tag,
      updated_at: h.updated_at,
    }));
  } else {
    heroRows = (heroesResult.data || []).map((h) => ({
      hero_slug: h.hero_slug,
      name: h.name,
      rarity: h.rarity ?? localRarityBySlug.get(h.hero_slug) ?? null,
      weapon: h.weapon,
      move: h.move,
      tier: h.tier,
      tag: h.tag,
      updated_at: h.updated_at,
    }));
  }

  const localUnitRarityBySlug = await loadUnitRarityBySlugs(heroRows.map((hero) => hero.hero_slug));

  heroRows = heroRows.map((hero) => {
    const patchedRarity = hero.rarity ?? localUnitRarityBySlug.get(hero.hero_slug) ?? null;
    const patchedName = looksLikeGuideTitle(hero.name)
      ? hero.name
          .replace(/\bBuilds?\s+and\s+Best\s+Refine\b/gi, "")
          .replace(/\s+/g, " ")
          .trim()
      : hero.name;

    return {
      ...hero,
      name: patchedName || hero.name,
      rarity: patchedRarity,
    };
  });

  // Accent-safe name filter: applied in JS so "celine" matches "Céline - Love's Aroma"
  if (q) {
    const qNorm = normalizeHeroSearchText(q);
    heroRows = heroRows.filter((h) =>
      normalizeHeroSearchText(h.name).includes(qNorm)
    );
  }

  const aliasSlug = q ? await resolveHeroAliasToSlug(q) : null;
  if (q && aliasSlug) {
    const aliasResultWithRarity = await supabase
      .from("heroes")
      .select("hero_slug,name,rarity,weapon,move,tier,tag,updated_at")
      .eq("hero_slug", aliasSlug)
      .maybeSingle();

    let aliasHeroRow: {
      hero_slug: string;
      name: string;
      rarity: string | null;
      weapon: string | null;
      move: string | null;
      tier: number | null;
      tag: string | null;
      updated_at: string | null;
    } | null = null;

    if (aliasResultWithRarity.error?.message.includes("rarity")) {
      const aliasFallback = await supabase
        .from("heroes")
        .select("hero_slug,name,weapon,move,tier,tag,updated_at")
        .eq("hero_slug", aliasSlug)
        .maybeSingle();

      if (aliasFallback.data) {
        aliasHeroRow = {
          hero_slug: aliasFallback.data.hero_slug,
          name: aliasFallback.data.name,
          rarity: localRarityBySlug.get(aliasFallback.data.hero_slug) ?? null,
          weapon: aliasFallback.data.weapon,
          move: aliasFallback.data.move,
          tier: aliasFallback.data.tier,
          tag: aliasFallback.data.tag,
          updated_at: aliasFallback.data.updated_at,
        };
      }
    } else if (aliasResultWithRarity.data) {
      aliasHeroRow = {
        hero_slug: aliasResultWithRarity.data.hero_slug,
        name: aliasResultWithRarity.data.name,
        rarity: aliasResultWithRarity.data.rarity ?? localRarityBySlug.get(aliasResultWithRarity.data.hero_slug) ?? null,
        weapon: aliasResultWithRarity.data.weapon,
        move: aliasResultWithRarity.data.move,
        tier: aliasResultWithRarity.data.tier,
        tag: aliasResultWithRarity.data.tag,
        updated_at: aliasResultWithRarity.data.updated_at,
      };
    }

    if (aliasHeroRow) {
      heroRows = [aliasHeroRow, ...heroRows];
    }
  }

  const [{ data: weapons }, { data: moves }, { data: tags }, { data: favorites }, { data: barracks }] = await Promise.all([
    supabase.from("heroes").select("weapon").not("weapon", "is", null),
    supabase.from("heroes").select("move").not("move", "is", null),
    supabase.from("heroes").select("tag").not("tag", "is", null),
    supabase.from("user_favorites").select("hero_slug").eq("user_id", user.id),
    supabase.from("user_barracks").select("hero_slug").eq("user_id", user.id),
  ]);

  const weaponOptions = Array.from(
    new Set((weapons || []).map((r) => r.weapon).filter((value): value is string => Boolean(value?.trim())))
  ).sort((a, b) => a.localeCompare(b));
  const moveOptions = Array.from(
    new Set((moves || []).map((r) => r.move).filter((value): value is string => Boolean(value?.trim())))
  ).sort((a, b) => a.localeCompare(b));
  const tagOptions = Array.from(
    new Set((tags || []).map((r) => r.tag).filter((value): value is string => Boolean(value?.trim())))
  ).sort((a, b) => a.localeCompare(b));
  const dedupedHeroes = Array.from(
    new Map(heroRows.map((hero) => [hero.hero_slug, hero])).values()
  );
  const favoriteSlugs = (favorites || []).map((f) => f.hero_slug);
  const favoriteSet = new Set(favoriteSlugs);
  const heroesList = dedupedHeroes
    .filter((hero) => (favoriteOnly ? favoriteSet.has(hero.hero_slug) : true))
    .sort((a, b) => {
      if (sort === "name_asc") return a.name.localeCompare(b.name);
      if (sort === "updated_desc") {
        const at = a.updated_at ? new Date(a.updated_at).getTime() : 0;
        const bt = b.updated_at ? new Date(b.updated_at).getTime() : 0;
        return bt - at;
      }

      const at = a.tier ?? -999;
      const bt = b.tier ?? -999;
      if (bt !== at) return bt - at;
      return a.name.localeCompare(b.name);
    });
  const heroAliasOptions = await listHeroAliasOptionsBySlug(
    new Set(heroesList.map((hero) => hero.hero_slug))
  );
  const ownedHeroSlugs = Array.from(new Set((barracks || []).map((b) => b.hero_slug).filter(Boolean)));

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-100">
      <main className="mx-auto w-full max-w-5xl rounded-2xl border border-zinc-800 bg-zinc-900 p-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Hero Browser</h1>
            <p className="text-sm text-zinc-300">Find heroes and add them to your barracks.</p>
          </div>
          <Link
            href="/barracks"
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
          >
            Back to barracks
          </Link>
        </header>

        {notice ? (
          <p
            className={`mt-4 rounded-lg border p-3 text-sm ${
              tone === "warn"
                ? "border-amber-800 bg-amber-950/40 text-amber-200"
                : "border-emerald-800 bg-emerald-950/40 text-emerald-200"
            }`}
          >
            {notice}
          </p>
        ) : null}

        <HeroBrowserFilters
          heroes={heroesList}
          aliasOptions={heroAliasOptions}
          weaponOptions={weaponOptions}
          moveOptions={moveOptions}
          tagOptions={tagOptions}
          initialQuery={q}
          initialWeapon={weapon}
          initialMove={move}
          initialTag={tag}
          initialMinTier={minTierRaw}
          initialFavoriteOnly={favoriteOnly}
          initialSort={sort}
          ownedHeroSlugs={ownedHeroSlugs}
        />

        <div className="mt-6 space-y-2">
          <HeroesListClient heroesList={heroesList} favoriteSlugs={favoriteSlugs} currentPath={currentPath} />
        </div>
      </main>
    </div>
  );
}
