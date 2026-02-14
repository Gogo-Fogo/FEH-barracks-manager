"use client";

import { useMemo, useState } from "react";

type HeroOption = {
  hero_slug: string;
  name: string;
  weapon: string | null;
  move: string | null;
  tier: number | null;
};

type AddHeroTypeaheadProps = {
  heroes: HeroOption[];
  redirectTo: string;
  addAction: (formData: FormData) => void | Promise<void>;
};

export function AddHeroTypeahead({ heroes, redirectTo, addAction }: AddHeroTypeaheadProps) {
  const [query, setQuery] = useState("");
  const [selectedSlug, setSelectedSlug] = useState("");
  const [open, setOpen] = useState(false);

  const normalizedQuery = query.trim().toLowerCase();

  const filteredHeroes = useMemo(() => {
    if (!normalizedQuery) return heroes.slice(0, 10);

    return heroes
      .filter((hero) => {
        const name = hero.name.toLowerCase();
        const slug = hero.hero_slug.toLowerCase();
        return name.includes(normalizedQuery) || slug.includes(normalizedQuery);
      })
      .slice(0, 10);
  }, [heroes, normalizedQuery]);

  const exactMatch = useMemo(
    () =>
      heroes.find(
        (hero) =>
          hero.name.toLowerCase() === normalizedQuery || hero.hero_slug.toLowerCase() === normalizedQuery
      ),
    [heroes, normalizedQuery]
  );

  const resolvedSlug = selectedSlug || exactMatch?.hero_slug || "";

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

        {open && filteredHeroes.length ? (
          <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
            {filteredHeroes.map((hero) => (
              <button
                key={hero.hero_slug}
                type="button"
                onClick={() => {
                  setQuery(hero.name);
                  setSelectedSlug(hero.hero_slug);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 border-b border-zinc-800 px-2 py-2 text-left hover:bg-zinc-800"
              >
                <img
                  src={`/api/headshots/${hero.hero_slug}`}
                  alt={`${hero.name} headshot`}
                  className="h-8 w-8 rounded-md border border-zinc-700 object-cover"
                  loading="lazy"
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm text-zinc-100">{hero.name}</span>
                  <span className="block truncate text-xs text-zinc-400">
                    {hero.weapon || "-"} • {hero.move || "-"}
                    {hero.tier != null ? ` • T${hero.tier}` : ""}
                  </span>
                </span>
              </button>
            ))}
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
