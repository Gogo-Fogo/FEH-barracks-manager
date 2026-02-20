import "server-only";

import fs from "node:fs/promises";
import path from "node:path";

type HeroAliasEntry = {
  canonical_slug?: string;
  canonical_name?: string;
  aliases?: string[];
};

type HeroAliasesFile = {
  entries?: HeroAliasEntry[];
};

export type HeroAliasOption = {
  alias: string;
  hero_slug: string;
};

const ALIAS_FILE_CANDIDATES = [
  path.join(process.cwd(), "db", "hero_aliases.json"),
  path.join(process.cwd(), "..", "db", "hero_aliases.json"),
];

let aliasFilePromise: Promise<HeroAliasesFile | null> | null = null;
let aliasLookupPromise: Promise<Map<string, string>> | null = null;

function normalizeAlias(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function slugifyAlias(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
}

function canonicalSlugFromEntry(entry: HeroAliasEntry) {
  const explicit = String(entry.canonical_slug || "").trim().toLowerCase();
  if (explicit) return explicit;
  return slugifyAlias(entry.canonical_name || "");
}

async function loadAliasFile() {
  if (aliasFilePromise) return aliasFilePromise;

  aliasFilePromise = (async () => {
    for (const filePath of ALIAS_FILE_CANDIDATES) {
      try {
        const raw = await fs.readFile(filePath, "utf8");
        return JSON.parse(raw) as HeroAliasesFile;
      } catch {
        // continue
      }
    }
    return null;
  })();

  return aliasFilePromise;
}

async function loadAliasLookup() {
  if (aliasLookupPromise) return aliasLookupPromise;

  aliasLookupPromise = (async () => {
    const aliasFile = await loadAliasFile();
    const lookup = new Map<string, string>();

    for (const entry of aliasFile?.entries || []) {
      const canonicalSlug = canonicalSlugFromEntry(entry);
      if (!canonicalSlug) continue;

      const register = (key: string) => {
        if (key && !lookup.has(key)) {
          lookup.set(key, canonicalSlug);
        }
      };

      register(normalizeAlias(canonicalSlug));
      register(slugifyAlias(canonicalSlug));

      if (entry.canonical_name) {
        register(normalizeAlias(entry.canonical_name));
        register(slugifyAlias(entry.canonical_name));
      }

      for (const alias of entry.aliases || []) {
        register(normalizeAlias(alias));
        register(slugifyAlias(alias));
      }
    }

    return lookup;
  })();

  return aliasLookupPromise;
}

export async function resolveHeroAliasToSlug(input: string) {
  const normalized = normalizeAlias(input);
  const slugified = slugifyAlias(input);
  if (!normalized && !slugified) return null;

  const lookup = await loadAliasLookup();
  return lookup.get(normalized) || lookup.get(slugified) || null;
}

export async function listHeroAliasOptionsBySlug(allowedSlugs?: Set<string>) {
  const aliasFile = await loadAliasFile();
  const options: HeroAliasOption[] = [];
  const seen = new Set<string>();

  for (const entry of aliasFile?.entries || []) {
    const canonicalSlug = canonicalSlugFromEntry(entry);
    if (!canonicalSlug) continue;
    if (allowedSlugs && !allowedSlugs.has(canonicalSlug)) continue;

    for (const alias of entry.aliases || []) {
      const cleaned = alias.trim();
      if (!cleaned) continue;

      const dedupeKey = `${normalizeAlias(cleaned)}::${canonicalSlug}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      options.push({ alias: cleaned, hero_slug: canonicalSlug });
    }
  }

  return options;
}
