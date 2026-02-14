"use client";

import Link from "next/link";
import { addToBarracks, toggleFavorite } from "@/app/barracks/actions";
import { moveIconName, rarityIconNames, rarityStarsText, weaponIconName } from "@/lib/feh-icons";

type HeroRow = {
  hero_slug: string;
  name: string;
  rarity: string | null;
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
          <Link
            href={`/heroes/${hero.hero_slug}`}
            className="group flex items-center gap-2 rounded-lg px-1 py-1 transition-all hover:-translate-y-0.5 hover:bg-zinc-800/40"
          >
            <img
              src={`/api/headshots/${hero.hero_slug}`}
              alt={`${hero.name} headshot`}
              className="h-12 w-12 rounded-lg border border-zinc-700 object-cover transition-transform group-hover:scale-105"
              loading="lazy"
            />
            <div>
              <p className="font-medium group-hover:text-indigo-300">
                {hero.name}
              </p>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                {rarityIconNames(hero.rarity).map((iconName) => (
                  <img
                    key={`${hero.hero_slug}-${iconName}`}
                    src={`/api/shared-icons/rarity?name=${encodeURIComponent(iconName)}`}
                    alt={`${hero.rarity || "Rarity"} icon`}
                    className="h-4 w-4 rounded-sm"
                  />
                ))}
                <span>{rarityStarsText(hero.rarity)}</span>
                {weaponIconName(hero.weapon) ? (
                  <img
                    src={`/api/shared-icons/weapon_type?name=${encodeURIComponent(weaponIconName(hero.weapon) || "")}`}
                    alt={`${hero.weapon || "Weapon"} icon`}
                    className="h-4 w-4 rounded-sm"
                  />
                ) : null}
                <span>{hero.weapon || "-"}</span>
                {moveIconName(hero.move) ? (
                  <img
                    src={`/api/shared-icons/move?name=${encodeURIComponent(moveIconName(hero.move) || "")}`}
                    alt={`${hero.move || "Move"} icon`}
                    className="h-4 w-4 rounded-sm"
                  />
                ) : null}
                <span>{hero.move || "-"}</span>
                {hero.tier != null ? <span>• T{hero.tier}</span> : null}
              </div>
            </div>
          </Link>

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
