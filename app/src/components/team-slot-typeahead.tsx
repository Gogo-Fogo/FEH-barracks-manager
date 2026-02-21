"use client";

import { useMemo, useState } from "react";

type TeamSlotHeroOption = {
  hero_slug: string;
  hero_name: string;
  weapon?: string | null;
  move?: string | null;
  tier?: number | null;
};

type TeamSlotTypeaheadProps = {
  inputName: string;
  heroes: TeamSlotHeroOption[];
  initialSlug?: string;
  label?: string;
  placeholder?: string;
};

function normalizeText(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function TeamSlotTypeahead({
  inputName,
  heroes,
  initialSlug = "",
  label,
  placeholder = "Type to search owned heroes",
}: TeamSlotTypeaheadProps) {
  const initialHero = useMemo(
    () => heroes.find((hero) => hero.hero_slug === initialSlug),
    [heroes, initialSlug]
  );

  const [query, setQuery] = useState(initialHero?.hero_name || "");
  const [selectedSlug, setSelectedSlug] = useState(initialSlug);
  const [open, setOpen] = useState(false);

  const normalizedQuery = normalizeText(query);
  const slugQuery = String(query || "").trim().toLowerCase();

  const filteredHeroes = useMemo(() => {
    const ranked = heroes
      .map((hero) => {
        const nameNorm = normalizeText(hero.hero_name);
        const slugNorm = hero.hero_slug.toLowerCase();

        if (!normalizedQuery && !slugQuery) {
          return { hero, rank: 1 };
        }

        if (nameNorm === normalizedQuery || slugNorm === slugQuery) {
          return { hero, rank: 100 };
        }

        if (nameNorm.startsWith(normalizedQuery) || slugNorm.startsWith(slugQuery)) {
          return { hero, rank: 70 };
        }

        if (nameNorm.includes(normalizedQuery) || slugNorm.includes(slugQuery)) {
          return { hero, rank: 40 };
        }

        return null;
      })
      .filter((entry): entry is { hero: TeamSlotHeroOption; rank: number } => Boolean(entry))
      .sort((a, b) => {
        if (b.rank !== a.rank) return b.rank - a.rank;
        return a.hero.hero_name.localeCompare(b.hero.hero_name);
      })
      .map((entry) => entry.hero);

    return ranked.slice(0, 12);
  }, [heroes, normalizedQuery, slugQuery]);

  const exactMatchSlug = useMemo(() => {
    if (!query.trim()) return "";
    const match = heroes.find((hero) => {
      const nameNorm = normalizeText(hero.hero_name);
      const slugNorm = hero.hero_slug.toLowerCase();
      return nameNorm === normalizedQuery || slugNorm === slugQuery;
    });
    return match?.hero_slug || "";
  }, [heroes, normalizedQuery, query, slugQuery]);

  const singleMatchSlug = filteredHeroes.length === 1 ? filteredHeroes[0]?.hero_slug || "" : "";
  const resolvedSlug = selectedSlug || exactMatchSlug || singleMatchSlug || "";

  return (
    <div className="relative">
      <input type="hidden" name={inputName} value={resolvedSlug} readOnly />

      {label ? <label className="mb-1 block text-[11px] text-zinc-400">{label}</label> : null}

      <div className="flex gap-2">
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelectedSlug("");
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          placeholder={placeholder}
          autoComplete="off"
          className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
        />

        <button
          type="button"
          onClick={() => {
            setQuery("");
            setSelectedSlug("");
            setOpen(false);
          }}
          className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
        >
          Clear
        </button>
      </div>

      {open ? (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded border border-zinc-700 bg-zinc-900 shadow-xl">
          {filteredHeroes.length ? (
            filteredHeroes.map((hero) => (
              <button
                key={`${inputName}_${hero.hero_slug}`}
                type="button"
                onClick={() => {
                  setQuery(hero.hero_name);
                  setSelectedSlug(hero.hero_slug);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 border-b border-zinc-800 px-2 py-1.5 text-left hover:bg-zinc-800"
              >
                <img
                  src={`/api/headshots/${hero.hero_slug}`}
                  alt={`${hero.hero_name} headshot`}
                  className="h-6 w-6 rounded border border-zinc-700 object-cover"
                  loading="lazy"
                />
                <span className="min-w-0 text-xs">
                  <span className="block truncate text-zinc-100">{hero.hero_name}</span>
                  <span className="block truncate text-zinc-400">
                    {hero.weapon || "-"} • {hero.move || "-"}
                    {hero.tier != null ? ` • T${hero.tier}` : ""}
                  </span>
                </span>
              </button>
            ))
          ) : (
            <p className="px-2 py-2 text-xs text-zinc-400">No owned hero matches “{query.trim()}”.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
