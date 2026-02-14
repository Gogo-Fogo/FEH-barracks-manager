import fs from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { HeroesListClient } from "@/components/heroes-list-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type HeroesPageProps = {
  searchParams: Promise<{
    q?: string;
    weapon?: string;
    move?: string;
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
    path.join(process.cwd(), "db", "index.json"),
    path.join(process.cwd(), "..", "db", "index.json"),
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

export default async function HeroesPage({ searchParams }: HeroesPageProps) {
  if (!isSupabaseConfigured()) {
    redirect("/login");
  }

  const params = await searchParams;
  const q = (params.q || "").trim();
  const weapon = (params.weapon || "").trim();
  const move = (params.move || "").trim();
  const notice = (params.notice || "").trim();
  const tone = (params.tone || "success").trim();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const currentPath = `/heroes?q=${encodeURIComponent(q)}&weapon=${encodeURIComponent(weapon)}&move=${encodeURIComponent(move)}`;
  const localRarityBySlug = await loadLocalRarityBySlug();

  const buildHeroesQueryWithRarity = () => {
    let query = supabase
      .from("heroes")
      .select("hero_slug,name,rarity,weapon,move,tier")
      .order("hero_slug", { ascending: true })
      .limit(200);

    if (q) query = query.ilike("name", `%${q}%`);
    if (weapon) query = query.eq("weapon", weapon);
    if (move) query = query.eq("move", move);
    return query;
  };

  const buildHeroesQueryWithoutRarity = () => {
    let query = supabase
      .from("heroes")
      .select("hero_slug,name,weapon,move,tier")
      .order("hero_slug", { ascending: true })
      .limit(200);

    if (q) query = query.ilike("name", `%${q}%`);
    if (weapon) query = query.eq("weapon", weapon);
    if (move) query = query.eq("move", move);
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
    }));
  } else {
    heroRows = (heroesResult.data || []).map((h) => ({
      hero_slug: h.hero_slug,
      name: h.name,
      rarity: h.rarity ?? localRarityBySlug.get(h.hero_slug) ?? null,
      weapon: h.weapon,
      move: h.move,
      tier: h.tier,
    }));
  }

  const [{ data: weapons }, { data: moves }, { data: favorites }] = await Promise.all([
    supabase.from("heroes").select("weapon").not("weapon", "is", null),
    supabase.from("heroes").select("move").not("move", "is", null),
    supabase.from("user_favorites").select("hero_slug").eq("user_id", user.id),
  ]);

  const weaponOptions = Array.from(
    new Set((weapons || []).map((r) => r.weapon).filter((value): value is string => Boolean(value?.trim())))
  ).sort((a, b) => a.localeCompare(b));
  const moveOptions = Array.from(
    new Set((moves || []).map((r) => r.move).filter((value): value is string => Boolean(value?.trim())))
  ).sort((a, b) => a.localeCompare(b));
  const dedupedHeroes = Array.from(
    new Map(heroRows.map((hero) => [hero.hero_slug, hero])).values()
  );
  const heroesList = dedupedHeroes.sort((a, b) => {
    if (a.hero_slug < b.hero_slug) return -1;
    if (a.hero_slug > b.hero_slug) return 1;
    return 0;
  });
  const favoriteSlugs = (favorites || []).map((f) => f.hero_slug);

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

        <form className="mt-6 grid gap-3 rounded-xl border border-zinc-800 bg-zinc-950 p-4 md:grid-cols-4">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search hero name"
            className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
          />

          <select
            name="weapon"
            defaultValue={weapon}
            className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
          >
            <option value="">All weapons</option>
            {weaponOptions.map((w) => (
              <option key={w} value={w || ""}>
                {w}
              </option>
            ))}
          </select>

          <select
            name="move"
            defaultValue={move}
            className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
          >
            <option value="">All move types</option>
            {moveOptions.map((m) => (
              <option key={m} value={m || ""}>
                {m}
              </option>
            ))}
          </select>

          <button
            type="submit"
            className="rounded bg-indigo-500 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-400"
          >
            Apply filters
          </button>
        </form>

        <div className="mt-6 space-y-2">
          <HeroesListClient heroesList={heroesList} favoriteSlugs={favoriteSlugs} currentPath={currentPath} />
        </div>
      </main>
    </div>
  );
}
