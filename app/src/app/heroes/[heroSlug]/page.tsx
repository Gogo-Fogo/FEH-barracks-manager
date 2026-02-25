import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { resolveHeroAliasToSlug } from "@/lib/hero-aliases";
import { moveIconName, rarityIconName, weaponIconName } from "@/lib/feh-icons";
import { loadUnitRarityBySlugs } from "@/lib/local-unit-data";
import { HeroUnitDataClient } from "@/components/hero-unit-data-client";
import { toggleFavorite } from "@/app/barracks/actions";

type HeroDetailPageProps = {
  params: Promise<{ heroSlug: string }>;
};

function unitBackgroundName(tag?: string | null) {
  const t = (tag || "").toLowerCase();
  if (t.includes("halloween")) return "Bg_DetailedStatus_Halloween.webp";
  if (t.includes("new year"))  return "Bg_DetailedStatus_NewYear.webp";
  if (t.includes("summer") || t.includes("beach")) return "Bg_DetailedStatus_Beach.webp";
  if (t.includes("tea"))   return "Bg_DetailedStatus_TeaParty.webp";
  if (t.includes("ninja")) return "Bg_DetailedStatus_Ask.webp";
  return "BG_DetailedStatus.png";
}

export default async function HeroDetailPage({ params }: HeroDetailPageProps) {
  if (!isSupabaseConfigured()) redirect("/login");

  const { heroSlug }      = await params;
  const aliasResolvedSlug = await resolveHeroAliasToSlug(heroSlug);
  const canonicalHeroSlug = aliasResolvedSlug || heroSlug;

  if (aliasResolvedSlug && aliasResolvedSlug !== heroSlug) {
    redirect(`/heroes/${aliasResolvedSlug}`);
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: heroFromDb } = await supabase
    .from("heroes")
    .select("*")
    .eq("hero_slug", canonicalHeroSlug)
    .maybeSingle();

  type Hero = {
    hero_slug: string; name: string; tier?: number | null;
    weapon?: string | null; move?: string | null; tag?: string | null;
    rarity?: string | null; source_url?: string | null;
  };

  let hero: Hero | null = heroFromDb as Hero | null;

  if (!hero) {
    // Hero not imported to Supabase yet — build minimal stub from index.json
    const rarityMap = await loadUnitRarityBySlugs([canonicalHeroSlug]);
    const rarity    = rarityMap.get(canonicalHeroSlug) ?? null;
    if (!rarity) notFound();
    hero = {
      hero_slug: canonicalHeroSlug,
      name:      canonicalHeroSlug.replace(/_+/g, " "),
      rarity, tier: null, weapon: null, move: null, tag: null, source_url: null,
    };
  }

  const { data: favoriteRow } = await supabase
    .from("user_favorites")
    .select("hero_slug")
    .eq("user_id", user.id)
    .eq("hero_slug", canonicalHeroSlug)
    .maybeSingle();

  // Background preference saved in DB or cookie
  const { data: savedPreference } = await supabase
    .from("user_hero_preferences")
    .select("background_name")
    .eq("user_id", user.id)
    .eq("hero_slug", hero.hero_slug)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const cookieStore        = await cookies();
  const cookieBg           = decodeURIComponent(cookieStore.get(`hero_bg_${hero.hero_slug}`)?.value || "");
  const savedBackgroundName = savedPreference?.background_name || cookieBg || "";

  const weaponIcon = weaponIconName(hero.weapon);
  const moveIcon   = moveIconName(hero.move);

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-100">
      <main className="mx-auto w-full max-w-6xl rounded-2xl border border-zinc-800 bg-zinc-900 p-8">
        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">{hero.name}</h1>
          <div className="flex gap-2">
            <form action={toggleFavorite}>
              <input type="hidden" name="hero_slug"   value={hero.hero_slug} readOnly />
              <input type="hidden" name="redirect_to" value={`/heroes/${hero.hero_slug}`} readOnly />
              <button
                type="submit"
                className="rounded-md border border-amber-700 px-3 py-1.5 text-sm text-amber-300 hover:bg-amber-950"
              >
                {favoriteRow?.hero_slug ? "★ Unfavorite" : "☆ Favorite"}
              </button>
            </form>
            <Link href="/heroes"   className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800">Back to heroes</Link>
            <Link href="/barracks" className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800">Back to barracks</Link>
          </div>
        </div>

        {/* ── Static metadata from Supabase ──────────────────────────────────── */}
        <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm">
          <p className="mb-2 flex items-center gap-2">
            {rarityIconName(hero.rarity) && (
              <img
                src={`/api/shared-icons/rarity?name=${encodeURIComponent(rarityIconName(hero.rarity) || "")}`}
                alt={`${hero.rarity || "Rarity"} icon`}
                className="h-5 w-5 rounded-sm"
              />
            )}
            <span className="text-zinc-400">Rarity:</span> {hero.rarity || "-"}
          </p>
          <p className="mb-2 flex items-center gap-2">
            {weaponIcon && (
              <img
                src={`/api/shared-icons/weapon_type?name=${encodeURIComponent(weaponIcon)}`}
                alt={`${hero.weapon || "Weapon"} icon`}
                className="h-5 w-5 rounded-sm"
              />
            )}
            <span className="text-zinc-400">Weapon:</span> {hero.weapon || "-"}
          </p>
          <p className="mb-2 flex items-center gap-2">
            {moveIcon && (
              <img
                src={`/api/shared-icons/move?name=${encodeURIComponent(moveIcon)}`}
                alt={`${hero.move || "Move"} icon`}
                className="h-5 w-5 rounded-sm"
              />
            )}
            <span className="text-zinc-400">Move:</span> {hero.move || "-"}
          </p>
          <p><span className="text-zinc-400">Tier:</span> {hero.tier ?? "-"}</p>
          <p><span className="text-zinc-400">Tag:</span>  {hero.tag  || "-"}</p>
          {hero.source_url && (
            <p className="mt-2">
              <a href={hero.source_url} target="_blank" rel="noreferrer" className="text-indigo-300 hover:underline">
                Open source page
              </a>
            </p>
          )}
        </div>

        {/*
          Everything that depends on local files (fullbody art, quotes, artist name,
          IVs, recommended build, guide highlights) is fetched client-side via
          /api/unit-data/{slug}.  The Electron launcher intercepts that request and
          serves it from the locally-extracted data bundle — instant, no CDN wait.
        */}
        <HeroUnitDataClient
          heroSlug={hero.hero_slug}
          heroName={hero.name}
          sourceUrl={hero.source_url ?? null}
          savedBackgroundName={savedBackgroundName}
          defaultBackgroundName={unitBackgroundName(hero.tag)}
          persistBackgroundPreference={Boolean(heroFromDb)}
        />
      </main>
    </div>
  );
}
