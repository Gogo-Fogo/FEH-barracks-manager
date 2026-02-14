import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { addToBarracks, toggleFavorite } from "@/app/barracks/actions";

type HeroesPageProps = {
  searchParams: Promise<{
    q?: string;
    weapon?: string;
    move?: string;
    notice?: string;
    tone?: string;
  }>;
};

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

  let query = supabase
    .from("heroes")
    .select("hero_slug,name,weapon,move,tier")
    .order("name", { ascending: true })
    .limit(200);

  if (q) query = query.ilike("name", `%${q}%`);
  if (weapon) query = query.eq("weapon", weapon);
  if (move) query = query.eq("move", move);

  const [{ data: heroes }, { data: weapons }, { data: moves }, { data: favorites }] = await Promise.all([
    query,
    supabase.from("heroes").select("weapon").not("weapon", "is", null),
    supabase.from("heroes").select("move").not("move", "is", null),
    supabase.from("user_favorites").select("hero_slug").eq("user_id", user.id),
  ]);

  const weaponOptions = Array.from(new Set((weapons || []).map((r) => r.weapon))).sort();
  const moveOptions = Array.from(new Set((moves || []).map((r) => r.move))).sort();
  const favoriteSet = new Set((favorites || []).map((f) => f.hero_slug));

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

        <section className="mt-6 space-y-2">
          {!heroes?.length ? (
            <p className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-300">
              No heroes found for current filters.
            </p>
          ) : (
            heroes.map((hero) => (
              <div
                key={hero.hero_slug}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3"
              >
                <div className="flex items-center gap-2">
                  <img
                    src={`/api/headshots/${hero.hero_slug}`}
                    alt={`${hero.name} headshot`}
                    className="h-12 w-12 rounded-lg border border-zinc-700 object-cover"
                    loading="lazy"
                  />
                  <div>
                  <Link href={`/heroes/${hero.hero_slug}`} className="font-medium hover:text-indigo-300">
                    {hero.name}
                  </Link>
                  <p className="text-xs text-zinc-400">
                    {hero.weapon || "-"} • {hero.move || "-"}
                    {hero.tier != null ? ` • T${hero.tier}` : ""}
                  </p>
                  </div>
                </div>

                <form action={addToBarracks}>
                  <input type="hidden" name="hero_slug" value={hero.hero_slug} readOnly />
                  <input type="hidden" name="redirect_to" value={currentPath} readOnly />
                  <button
                    type="submit"
                    className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800"
                  >
                    Add to barracks
                  </button>
                </form>

                <form action={toggleFavorite}>
                  <input type="hidden" name="hero_slug" value={hero.hero_slug} readOnly />
                  <input type="hidden" name="redirect_to" value={currentPath} readOnly />
                  <button
                    type="submit"
                    className="rounded-md border border-amber-700 px-3 py-1.5 text-sm text-amber-300 hover:bg-amber-950"
                  >
                    {favoriteSet.has(hero.hero_slug) ? "★ Favorited" : "☆ Favorite"}
                  </button>
                </form>
              </div>
            ))
          )}
        </section>
      </main>
    </div>
  );
}
