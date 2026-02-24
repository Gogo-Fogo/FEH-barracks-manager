export type HeroTypeaheadOption = {
  hero_slug: string;
  name: string;
  weapon: string | null;
  move: string | null;
  tier: number | null;
};

export type HeroTypeaheadAliasOption = {
  alias: string;
  hero_slug: string;
};

export const DEFAULT_MAX_TYPEAHEAD_RESULTS = 50;

// Characters that don't decompose via NFD but have common ASCII approximations.
const SPECIAL_CHAR_MAP: Record<string, string> = {
  // Norse/Old English
  ð: "d", Ð: "d",
  þ: "th", Þ: "th",
  æ: "ae", Æ: "ae",
  ø: "o", Ø: "o",
  // Other common cases
  ß: "ss",
  ł: "l", Ł: "l",
  đ: "d", Đ: "d",
};

const SPECIAL_CHAR_REGEX = new RegExp(
  Object.keys(SPECIAL_CHAR_MAP).map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
  "g"
);

export function normalizeHeroSearchText(value: string) {
  return String(value || "")
    .replace(SPECIAL_CHAR_REGEX, (c) => SPECIAL_CHAR_MAP[c] ?? c)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining diacritics (é→e, í→i, ö→o, etc.)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeHeroSlugSearchText(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function buildAliasLookup(aliasOptions: HeroTypeaheadAliasOption[]) {
  const map = new Map<string, string>();

  for (const option of aliasOptions) {
    const key = normalizeHeroSearchText(option.alias);
    if (key && !map.has(key)) {
      map.set(key, option.hero_slug);
    }
  }

  return map;
}

export function buildAliasTermsBySlug(aliasOptions: HeroTypeaheadAliasOption[]) {
  const map = new Map<string, string[]>();

  for (const option of aliasOptions) {
    const key = normalizeHeroSearchText(option.alias);
    if (!key) continue;

    if (!map.has(option.hero_slug)) {
      map.set(option.hero_slug, []);
    }

    const existing = map.get(option.hero_slug)!;
    if (!existing.includes(key)) {
      existing.push(key);
    }
  }

  return map;
}

export function rankHeroSuggestions(
  heroes: HeroTypeaheadOption[],
  aliasTermsBySlug: Map<string, string[]>,
  normalizedQuery: string,
  normalizedSlugQuery: string,
  maxResults = DEFAULT_MAX_TYPEAHEAD_RESULTS
) {
  if (!normalizedQuery && !normalizedSlugQuery) {
    return {
      filteredHeroes: heroes.slice(0, maxResults),
      totalMatches: heroes.length,
    };
  }

  const scored = heroes
    .map((hero) => {
      const name = normalizeHeroSearchText(hero.name);
      const slug = hero.hero_slug.toLowerCase();
      const aliases = aliasTermsBySlug.get(hero.hero_slug) || [];

      const isExact =
        (normalizedQuery && name === normalizedQuery) ||
        (normalizedSlugQuery && slug === normalizedSlugQuery) ||
        (normalizedQuery && aliases.some((alias) => alias === normalizedQuery));
      if (isExact) return { hero, score: 0 };

      const startsWith =
        (normalizedQuery && name.startsWith(normalizedQuery)) ||
        (normalizedSlugQuery && slug.startsWith(normalizedSlugQuery)) ||
        (normalizedQuery && aliases.some((alias) => alias.startsWith(normalizedQuery)));
      if (startsWith) return { hero, score: 1 };

      const includes =
        (normalizedQuery && name.includes(normalizedQuery)) ||
        (normalizedSlugQuery && slug.includes(normalizedSlugQuery)) ||
        (normalizedQuery && aliases.some((alias) => alias.includes(normalizedQuery)));
      if (includes) return { hero, score: 2 };

      return null;
    })
    .filter((entry): entry is { hero: HeroTypeaheadOption; score: number } => Boolean(entry))
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return a.hero.name.localeCompare(b.hero.name);
    });

  return {
    filteredHeroes: scored.slice(0, maxResults).map((entry) => entry.hero),
    totalMatches: scored.length,
  };
}
