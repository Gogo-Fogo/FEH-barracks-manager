import fs from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { moveIconName, rarityIconName, rarityStarsText, weaponIconName } from "@/lib/feh-icons";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type LibraryPageProps = {
  searchParams: Promise<{
    q?: string;
    weapon?: string;
    move?: string;
    tag?: string;
    minTier?: string;
    favorite?: string;
    sort?: string;
  }>;
};

type HeroMeta = {
  hero_slug: string;
  rarity: string | null;
  weapon: string | null;
  move: string | null;
  tier: number | null;
  tag: string | null;
};

type LibraryEntry = {
  hero_slug: string;
  hero_name: string;
  merges: number;
  copies_owned: number;
  notes: string | null;
  updated_at: string | null;
  rarity: string | null;
  weapon: string | null;
  move: string | null;
  tier: number | null;
  tag: string | null;
  favorite: boolean;
};

function normalize(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function toNum(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
        const slug = String(row.name).replace(/[^a-z0-9]/gi, "_").toLowerCase();
        map.set(slug, row.rarity ?? null);
      }
      return map;
    } catch {
      // continue
    }
  }

  return new Map<string, string | null>();
}

export default async function BarracksLibraryPage({ searchParams }: LibraryPageProps) {
  if (!isSupabaseConfigured()) {
    redirect("/login");
  }

  const params = await searchParams;
  const q = (params.q || "").trim();
  const weapon = (params.weapon || "").trim();
  const move = (params.move || "").trim();
  const tag = (params.tag || "").trim();
  const minTier = toNum(params.minTier);
  const favoriteOnly = params.favorite === "1";
  const sort = (params.sort || "tier_desc").trim();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [{ data: barracks }, { data: favorites }] = await Promise.all([
    supabase
      .from("user_barracks")
      .select("hero_slug,hero_name,merges,copies_owned,notes,updated_at")
      .eq("user_id", user.id)
      .order("hero_name", { ascending: true }),
    supabase.from("user_favorites").select("hero_slug").eq("user_id", user.id),
  ]);

  const heroSlugs = (barracks || []).map((b) => b.hero_slug);
  const heroMetaBySlug = new Map<string, HeroMeta>();
  const localRarityBySlug = await loadLocalRarityBySlug();

  if (heroSlugs.length) {
    const metaResult = await supabase
      .from("heroes")
      .select("hero_slug,rarity,weapon,move,tier,tag")
      .in("hero_slug", heroSlugs);

    let metaRows: HeroMeta[] = [];

    if (metaResult.error?.message.includes("rarity")) {
      const fallback = await supabase
        .from("heroes")
        .select("hero_slug,weapon,move,tier,tag")
        .in("hero_slug", heroSlugs);

      metaRows = (fallback.data || []).map((row) => ({
        hero_slug: row.hero_slug,
        rarity: localRarityBySlug.get(row.hero_slug) ?? null,
        weapon: row.weapon,
        move: row.move,
        tier: row.tier,
        tag: row.tag,
      }));
    } else {
      metaRows = (metaResult.data || []).map((row) => ({
        hero_slug: row.hero_slug,
        rarity: row.rarity ?? localRarityBySlug.get(row.hero_slug) ?? null,
        weapon: row.weapon,
        move: row.move,
        tier: row.tier,
        tag: row.tag,
      }));
    }

    for (const row of metaRows) {
      heroMetaBySlug.set(row.hero_slug, row);
    }
  }

  const favoriteSet = new Set((favorites || []).map((f) => f.hero_slug));

  const libraryAll: LibraryEntry[] = (barracks || []).map((entry) => {
    const meta = heroMetaBySlug.get(entry.hero_slug);
    return {
      hero_slug: entry.hero_slug,
      hero_name: entry.hero_name,
      merges: entry.merges ?? 0,
      copies_owned: entry.copies_owned ?? 0,
      notes: entry.notes,
      updated_at: entry.updated_at,
      rarity: meta?.rarity ?? null,
      weapon: meta?.weapon ?? null,
      move: meta?.move ?? null,
      tier: meta?.tier ?? null,
      tag: meta?.tag ?? null,
      favorite: favoriteSet.has(entry.hero_slug),
    };
  });

  const filtered = libraryAll
    .filter((row) => {
      if (q && !normalize(row.hero_name).includes(normalize(q))) return false;
      if (weapon && row.weapon !== weapon) return false;
      if (move && row.move !== move) return false;
      if (tag && row.tag !== tag) return false;
      if (minTier != null && (row.tier == null || row.tier < minTier)) return false;
      if (favoriteOnly && !row.favorite) return false;
      return true;
    })
    .sort((a, b) => {
      if (sort === "name_asc") return a.hero_name.localeCompare(b.hero_name);
      if (sort === "updated_desc") {
        const at = a.updated_at ? new Date(a.updated_at).getTime() : 0;
        const bt = b.updated_at ? new Date(b.updated_at).getTime() : 0;
        return bt - at;
      }
      const at = a.tier ?? -999;
      const bt = b.tier ?? -999;
      if (bt !== at) return bt - at;
      return a.hero_name.localeCompare(b.hero_name);
    });

  const weaponOptions = Array.from(new Set(libraryAll.map((r) => r.weapon).filter((v): v is string => Boolean(v)))).sort((a, b) =>
    a.localeCompare(b)
  );
  const moveOptions = Array.from(new Set(libraryAll.map((r) => r.move).filter((v): v is string => Boolean(v)))).sort((a, b) =>
    a.localeCompare(b)
  );
  const tagOptions = Array.from(new Set(libraryAll.map((r) => r.tag).filter((v): v is string => Boolean(v)))).sort((a, b) =>
    a.localeCompare(b)
  );

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-100">
      <main className="mx-auto w-full max-w-7xl rounded-2xl border border-zinc-800 bg-zinc-900 p-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">My Wifus</h1>
            <p className="text-sm text-zinc-300">All owned units on one page, default sorted by tier hierarchy.</p>
          </div>
          <Link
            href="/barracks"
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
          >
            Back to barracks
          </Link>
        </header>

        <form className="mt-6 grid gap-3 rounded-xl border border-zinc-800 bg-zinc-950 p-4 md:grid-cols-4 xl:grid-cols-8">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search name"
            className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm xl:col-span-2"
          />

          <select name="weapon" defaultValue={weapon} className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm">
            <option value="">All weapons</option>
            {weaponOptions.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>

          <select name="move" defaultValue={move} className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm">
            <option value="">All moves</option>
            {moveOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>

          <select name="tag" defaultValue={tag} className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm">
            <option value="">All tags</option>
            {tagOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          <input
            name="minTier"
            type="number"
            step="0.1"
            min={0}
            max={10}
            defaultValue={minTier ?? ""}
            placeholder="Min tier"
            className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
          />

          <select name="sort" defaultValue={sort} className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm">
            <option value="tier_desc">Tier: High → Low (default)</option>
            <option value="name_asc">Name: A → Z</option>
            <option value="updated_desc">Recently updated</option>
          </select>

          <label className="flex items-center gap-2 rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm">
            <input type="checkbox" name="favorite" value="1" defaultChecked={favoriteOnly} />
            Favorites only
          </label>

          <button type="submit" className="rounded bg-indigo-500 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-400">
            Apply filters
          </button>
        </form>

        <p className="mt-4 text-xs text-zinc-400">
          Showing {filtered.length} of {libraryAll.length} entries.
        </p>

        {!filtered.length ? (
          <p className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-300">
            No entries match your filters.
          </p>
        ) : (
          <section className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((hero) => (
              <Link
                key={hero.hero_slug}
                href={`/heroes/${hero.hero_slug}`}
                className="group block rounded-xl border border-zinc-800 bg-zinc-950 p-4 transition-all hover:-translate-y-1 hover:border-zinc-700 hover:bg-zinc-900/80"
              >
                <article>
                  <img
                    src={`/api/headshots/${hero.hero_slug}`}
                    alt={`${hero.hero_name} headshot`}
                    className="h-28 w-28 rounded-xl border border-zinc-700 object-cover transition-transform group-hover:scale-105"
                    loading="lazy"
                  />
                <div className="mt-3 space-y-1">
                  <p className="line-clamp-2 font-medium group-hover:text-indigo-300">
                    {hero.favorite ? "★ " : ""}
                    {hero.hero_name}
                  </p>
                  <p className="text-xs text-zinc-400">Tier: {hero.tier ?? "-"}</p>
                  <div className="flex items-center gap-2 text-xs text-zinc-300">
                    {rarityIconName(hero.rarity) ? (
                      <img
                        src={`/api/shared-icons/rarity?name=${encodeURIComponent(rarityIconName(hero.rarity) || "")}`}
                        alt={`${hero.rarity || "Rarity"} icon`}
                        className="h-4 w-4 rounded-sm"
                      />
                    ) : null}
                    <span>{rarityStarsText(hero.rarity)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-zinc-300">
                    {weaponIconName(hero.weapon) ? (
                      <img
                        src={`/api/shared-icons/weapon_type?name=${encodeURIComponent(weaponIconName(hero.weapon) || "")}`}
                        alt={`${hero.weapon || "Weapon"} icon`}
                        className="h-4 w-4 rounded-sm"
                      />
                    ) : null}
                    <span>{hero.weapon || "-"}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-zinc-300">
                    {moveIconName(hero.move) ? (
                      <img
                        src={`/api/shared-icons/move?name=${encodeURIComponent(moveIconName(hero.move) || "")}`}
                        alt={`${hero.move || "Move"} icon`}
                        className="h-4 w-4 rounded-sm"
                      />
                    ) : null}
                    <span>{hero.move || "-"}</span>
                  </div>
                  <p className="text-xs text-zinc-400">Tag: {hero.tag || "-"}</p>
                  <p className="text-xs text-zinc-300">Merges: +{hero.merges}</p>
                  <p className="text-xs text-cyan-300">Dupes owned: {hero.copies_owned}</p>
                  {hero.notes ? <p className="line-clamp-2 text-xs text-zinc-500">{hero.notes}</p> : null}
                </div>
                </article>
              </Link>
            ))}
          </section>
        )}
      </main>
    </div>
  );
}
