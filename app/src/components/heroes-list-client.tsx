"use client";

import Link from "next/link";
import { addToBarracks, toggleFavorite } from "@/app/barracks/actions";

type HeroRow = {
  hero_slug: string;
  name: string;
  weapon: string | null;
  move: string | null;
  tier: number | null;
};

type HeroesListClientProps = {
  heroesList: HeroRow[];
  favoriteSlugs: string[];
  currentPath: string;
};

export function HeroesListClient({ heroesList, favoriteSlugs, currentPath }: HeroesListClientProps) {
  const favoriteSet = new Set(favoriteSlugs);

  if (!heroesList.length) {
    return (
      <p className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-300">
        No heroes found for current filters.
      </p>
    );
  }

  return (
    <>
      {heroesList.map((hero) => (
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
      ))}
    </>
  );
}
