"use client";

import { useMemo, useState } from "react";
import {
  buildAliasLookup,
  buildAliasTermsBySlug,
  DEFAULT_MAX_TYPEAHEAD_RESULTS,
  normalizeHeroSearchText,
  normalizeHeroSlugSearchText,
  rankHeroSuggestions,
  type HeroTypeaheadAliasOption,
  type HeroTypeaheadOption,
} from "@/lib/hero-typeahead";

type HeroOption = HeroTypeaheadOption;
type HeroAliasOption = HeroTypeaheadAliasOption;

type AddHeroTypeaheadProps = {
  heroes: HeroOption[];
  aliasOptions?: HeroAliasOption[];
  ownedHeroSlugs?: string[];
  redirectTo: string;
  addAction: (formData: FormData) => void | Promise<void>;
};

export function AddHeroTypeahead({
  heroes,
  aliasOptions = [],
  ownedHeroSlugs = [],
  redirectTo,
  addAction,
}: AddHeroTypeaheadProps) {
  const [query, setQuery] = useState("");
  const [selectedSlug, setSelectedSlug] = useState("");
  const [open, setOpen] = useState(false);

  const normalizedQuery = normalizeHeroSearchText(query);
  const normalizedSlugQuery = normalizeHeroSlugSearchText(query);

  const aliasLookup = useMemo(() => buildAliasLookup(aliasOptions), [aliasOptions]);

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

  const exactMatch = useMemo(
    () =>
      heroes.find(
        (hero) =>
          normalizeHeroSearchText(hero.name) === normalizedQuery ||
          hero.hero_slug.toLowerCase() === normalizedSlugQuery
      ),
    [heroes, normalizedQuery, normalizedSlugQuery]
  );

  const aliasMatchSlug = useMemo(() => {
    if (!query.trim()) return "";
    return aliasLookup.get(normalizeHeroSearchText(query)) || "";
  }, [aliasLookup, query]);

  const singleMatchSlug = filteredHeroes.length === 1 ? filteredHeroes[0]?.hero_slug || "" : "";
  const resolvedSlug = selectedSlug || exactMatch?.hero_slug || aliasMatchSlug || singleMatchSlug || "";

  return (
    <form action={addAction} className="mt-4 flex flex-wrap items-end gap-3">
      <input type="hidden" name="redirect_to" value={redirectTo} readOnly />
      <input type="hidden" name="hero_slug" value={resolvedSlug} readOnly />

      <div className="relative min-w-72 flex-1">
        <label htmlFor="hero_query" className="mb-1 block text-sm text-zinc-300">
          Hero
        </label>

        <input
          id="hero_query"
          name="hero_query"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelectedSlug("");
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          placeholder="Type hero name"
          autoComplete="off"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100"
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
                      setSelectedSlug(hero.hero_slug);
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

      <button
        type="submit"
        disabled={!resolvedSlug}
        className="rounded-lg bg-indigo-500 px-4 py-2 font-medium text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Add
      </button>
    </form>
  );
}
