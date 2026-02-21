"use client";

import { useMemo, useState } from "react";
import {
  buildAliasTermsBySlug,
  DEFAULT_MAX_TYPEAHEAD_RESULTS,
  normalizeHeroSearchText,
  normalizeHeroSlugSearchText,
  rankHeroSuggestions,
  type HeroTypeaheadAliasOption,
  type HeroTypeaheadOption,
} from "@/lib/hero-typeahead";

type HeroBrowserFiltersProps = {
  heroes: HeroTypeaheadOption[];
  aliasOptions?: HeroTypeaheadAliasOption[];
  weaponOptions: string[];
  moveOptions: string[];
  initialQuery: string;
  initialWeapon: string;
  initialMove: string;
  ownedHeroSlugs?: string[];
};

export function HeroBrowserFilters({
  heroes,
  aliasOptions = [],
  weaponOptions,
  moveOptions,
  initialQuery,
  initialWeapon,
  initialMove,
  ownedHeroSlugs = [],
}: HeroBrowserFiltersProps) {
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(false);

  const normalizedQuery = normalizeHeroSearchText(query);
  const normalizedSlugQuery = normalizeHeroSlugSearchText(query);
  const aliasTermsBySlug = useMemo(() => buildAliasTermsBySlug(aliasOptions), [aliasOptions]);
  const ownedHeroSlugSet = useMemo(() => new Set(ownedHeroSlugs), [ownedHeroSlugs]);

  const { filteredHeroes, totalMatches } = useMemo(
    () =>
      rankHeroSuggestions(
        heroes,
        aliasTermsBySlug,
        normalizedQuery,
        normalizedSlugQuery,
        DEFAULT_MAX_TYPEAHEAD_RESULTS
      ),
    [aliasTermsBySlug, heroes, normalizedQuery, normalizedSlugQuery]
  );

  return (
    <form method="GET" className="mt-6 grid gap-3 rounded-xl border border-zinc-800 bg-zinc-950 p-4 md:grid-cols-4">
      <div className="relative">
        <input
          name="q"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          placeholder="Search hero name"
          className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
          autoComplete="off"
        />

        {open ? (
          <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
            {filteredHeroes.length ? (
              <>
                {filteredHeroes.map((hero) => {
                  const isOwned = ownedHeroSlugSet.has(hero.hero_slug);
                  return (
                    <button
                      key={hero.hero_slug}
                      type="button"
                      onClick={() => {
                        setQuery(hero.name);
                        setOpen(false);
                      }}
                      className={`flex w-full items-center gap-2 border-b border-zinc-800 px-2 py-2 text-left hover:bg-zinc-800 ${
                        isOwned ? "bg-emerald-950/25 ring-1 ring-inset ring-emerald-700/50" : ""
                      }`}
                    >
                      <img
                        src={`/api/headshots/${hero.hero_slug}`}
                        alt={`${hero.name} headshot`}
                        className="h-8 w-8 rounded-md border border-zinc-700 object-cover"
                        loading="lazy"
                      />
                      <span className="min-w-0">
                        <span className="flex items-center gap-2 truncate text-base text-zinc-100">
                          <span className="truncate">{hero.name}</span>
                          {isOwned ? (
                            <span className="rounded border border-emerald-700 bg-emerald-950/50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-300">
                              In Barracks
                            </span>
                          ) : null}
                        </span>
                        <span className="block truncate text-sm text-zinc-400">
                          {hero.weapon || "-"} • {hero.move || "-"}
                          {hero.tier != null ? ` • T${hero.tier}` : ""}
                        </span>
                      </span>
                    </button>
                  );
                })}

                {totalMatches > filteredHeroes.length ? (
                  <p className="px-2 py-2 text-sm text-zinc-400">
                    Showing first {filteredHeroes.length} matches out of {totalMatches}. Keep typing to narrow.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="px-2 py-2 text-sm text-zinc-400">
                No heroes found for “{query.trim()}”.
              </p>
            )}
          </div>
        ) : null}
      </div>

      <select
        name="weapon"
        defaultValue={initialWeapon}
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
        defaultValue={initialMove}
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
  );
}
