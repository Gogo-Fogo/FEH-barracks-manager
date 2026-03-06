import fs from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { dbRoot } from "@/lib/db-root";
import { redirect } from "next/navigation";
import { HeroBrowserFilters } from "@/components/hero-browser-filters";
import { SkillTagSelector } from "@/components/skill-tag-selector";
import { listHeroAliasOptionsBySlug } from "@/lib/hero-aliases";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { moveIconName, rarityIconName, rarityStarsText, weaponIconName } from "@/lib/feh-icons";
import { buildAliasTermsBySlug, normalizeHeroSearchText, normalizeHeroSlugSearchText } from "@/lib/hero-typeahead";
import {
  countEquippedSkills,
  EQUIPPED_SKILL_SLOTS,
  HERO_BLESSING_META,
  HERO_BLESSING_OPTIONS,
  type BarracksEntryInventory,
  parseBarracksEntryNotes,
} from "@/lib/barracks-entry-metadata";
import { removeBarracksEntry, toggleFavorite, updateBarracksEntry } from "../actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type LibraryPageProps = {
  searchParams: Promise<{
    q?: string;
    weapon?: string;
    move?: string;
    tag?: string;
    minTier?: string;
    favorite?: string;
    sort?: string;
    notice?: string;
    tone?: string;
  }>;
};

type HeroMeta = {
  hero_slug: string;
  rarity: string | null;
  weapon: string | null;
  move: string | null;
  tier: number | null;
  tag: string | null;
};

type LibraryEntry = {
  id: string;
  hero_slug: string;
  hero_name: string;
  merges: number;
  copies_owned: number;
  notes: string | null;
  inventory: BarracksEntryInventory;
  updated_at: string | null;
  rarity: string | null;
  weapon: string | null;
  move: string | null;
  tier: number | null;
  tag: string | null;
  favorite: boolean;
};

const MERGE_OPTIONS = Array.from({ length: 21 }, (_, index) => index);
const DUPE_OPTIONS_BASE = [...Array.from({ length: 21 }, (_, index) => index), 25, 30, 40, 50, 75, 99];

const ACCENT_STYLES = {
  amber: {
    badge: "border-amber-700/70 bg-amber-950/70 text-amber-200",
    panel: "border-amber-900/50 bg-amber-950/20",
  },
  sky: {
    badge: "border-sky-700/70 bg-sky-950/70 text-sky-200",
    panel: "border-sky-900/50 bg-sky-950/20",
  },
  violet: {
    badge: "border-violet-700/70 bg-violet-950/70 text-violet-200",
    panel: "border-violet-900/50 bg-violet-950/20",
  },
  rose: {
    badge: "border-rose-700/70 bg-rose-950/70 text-rose-200",
    panel: "border-rose-900/50 bg-rose-950/20",
  },
  emerald: {
    badge: "border-emerald-700/70 bg-emerald-950/70 text-emerald-200",
    panel: "border-emerald-900/50 bg-emerald-950/20",
  },
  cyan: {
    badge: "border-cyan-700/70 bg-cyan-950/70 text-cyan-200",
    panel: "border-cyan-900/50 bg-cyan-950/20",
  },
  red: {
    badge: "border-red-700/70 bg-red-950/70 text-red-200",
    panel: "border-red-900/50 bg-red-950/20",
  },
  stone: {
    badge: "border-zinc-700/70 bg-zinc-900/85 text-zinc-200",
    panel: "border-zinc-800 bg-zinc-900/55",
  },
} as const;

function toNum(value: string | undefined) {
  if (!value || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildLibraryRedirectPath(params: {
  q: string;
  weapon: string;
  move: string;
  tag: string;
  minTier: string;
  favoriteOnly: boolean;
  sort: string;
}) {
  const nextParams = new URLSearchParams();

  if (params.q) nextParams.set("q", params.q);
  if (params.weapon) nextParams.set("weapon", params.weapon);
  if (params.move) nextParams.set("move", params.move);
  if (params.tag) nextParams.set("tag", params.tag);
  if (params.minTier) nextParams.set("minTier", params.minTier);
  if (params.favoriteOnly) nextParams.set("favorite", "1");
  if (params.sort && params.sort !== "tier_desc") nextParams.set("sort", params.sort);

  const query = nextParams.toString();
  return query ? `/barracks/library?${query}` : "/barracks/library";
}

function buildInventorySummary(hero: LibraryEntry) {
  const parts: string[] = [];
  if (hero.inventory.blessings.length) {
    parts.push(...hero.inventory.blessings);
  }
  const equippedCount = countEquippedSkills(hero.inventory);
  if (equippedCount) {
    parts.push(`Build ${equippedCount}/${EQUIPPED_SKILL_SLOTS.length}`);
  }
  if (hero.inventory.fodder.length) {
    parts.push(`Fodder ${hero.inventory.fodder.length}`);
  }
  if (hero.inventory.legacy_skills.length) {
    parts.push(`Legacy ${hero.inventory.legacy_skills.length}`);
  }
  return parts;
}

function buildSelectOptions(baseOptions: number[], currentValue: number) {
  const values = new Set(baseOptions);
  values.add(Math.max(0, currentValue));
  return Array.from(values).sort((a, b) => a - b);
}

async function loadLocalRarityBySlug() {
  const candidates = [
    path.join(dbRoot(), "index.json"),
  ];

  for (const filePath of candidates) {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const rows = JSON.parse(raw) as Array<{ name?: string; rarity?: string | null }>;
      const map = new Map<string, string | null>();
      for (const row of rows) {
        if (!row?.name) continue;
        const slug = String(row.name).replace(/[^a-z0-9]/gi, "_").toLowerCase();
        map.set(slug, row.rarity ?? null);
      }
      return map;
    } catch {
      // continue
    }
  }

  return new Map<string, string | null>();
}

export default async function BarracksLibraryPage({ searchParams }: LibraryPageProps) {
  if (!isSupabaseConfigured()) {
    redirect("/login");
  }

  const params = await searchParams;
  const q = (params.q || "").trim();
  const weapon = (params.weapon || "").trim();
  const move = (params.move || "").trim();
  const tag = (params.tag || "").trim();
  const minTierRaw = (params.minTier || "").trim();
  const minTier = toNum(minTierRaw);
  const favoriteOnly = params.favorite === "1";
  const sort = (params.sort || "tier_desc").trim();
  const notice = (params.notice || "").trim();
  const tone = (params.tone || "success").trim();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [{ data: barracks }, { data: favorites }] = await Promise.all([
    supabase
      .from("user_barracks")
      .select("id,hero_slug,hero_name,merges,copies_owned,notes,updated_at")
      .eq("user_id", user.id)
      .order("hero_name", { ascending: true }),
    supabase.from("user_favorites").select("hero_slug").eq("user_id", user.id),
  ]);

  const heroSlugs = (barracks || []).map((b) => b.hero_slug);
  const heroMetaBySlug = new Map<string, HeroMeta>();
  const localRarityBySlug = await loadLocalRarityBySlug();

  if (heroSlugs.length) {
    const metaResult = await supabase
      .from("heroes")
      .select("hero_slug,rarity,weapon,move,tier,tag")
      .in("hero_slug", heroSlugs);

    let metaRows: HeroMeta[] = [];

    if (metaResult.error?.message.includes("rarity")) {
      const fallback = await supabase
        .from("heroes")
        .select("hero_slug,weapon,move,tier,tag")
        .in("hero_slug", heroSlugs);

      metaRows = (fallback.data || []).map((row) => ({
        hero_slug: row.hero_slug,
        rarity: localRarityBySlug.get(row.hero_slug) ?? null,
        weapon: row.weapon,
        move: row.move,
        tier: row.tier,
        tag: row.tag,
      }));
    } else {
      metaRows = (metaResult.data || []).map((row) => ({
        hero_slug: row.hero_slug,
        rarity: row.rarity ?? localRarityBySlug.get(row.hero_slug) ?? null,
        weapon: row.weapon,
        move: row.move,
        tier: row.tier,
        tag: row.tag,
      }));
    }

    for (const row of metaRows) {
      heroMetaBySlug.set(row.hero_slug, row);
    }
  }

  const favoriteSet = new Set((favorites || []).map((f) => f.hero_slug));

  const libraryAll: LibraryEntry[] = (barracks || []).map((entry) => {
    const meta = heroMetaBySlug.get(entry.hero_slug);
    const parsedEntry = parseBarracksEntryNotes(entry.notes);
    return {
      id: entry.id,
      hero_slug: entry.hero_slug,
      hero_name: entry.hero_name,
      merges: entry.merges ?? 0,
      copies_owned: entry.copies_owned ?? 0,
      notes: parsedEntry.notes || null,
      inventory: parsedEntry.inventory,
      updated_at: entry.updated_at,
      rarity: meta?.rarity ?? null,
      weapon: meta?.weapon ?? null,
      move: meta?.move ?? null,
      tier: meta?.tier ?? null,
      tag: meta?.tag ?? null,
      favorite: favoriteSet.has(entry.hero_slug),
    };
  });

  const typeaheadHeroes = libraryAll.map((hero) => ({
    hero_slug: hero.hero_slug,
    name: hero.hero_name,
    weapon: hero.weapon,
    move: hero.move,
    tier: hero.tier,
  }));
  const heroAliasOptions = await listHeroAliasOptionsBySlug(
    new Set(typeaheadHeroes.map((hero) => hero.hero_slug))
  );
  const aliasTermsBySlug = buildAliasTermsBySlug(heroAliasOptions);
  const normalizedQuery = normalizeHeroSearchText(q);
  const normalizedSlugQuery = normalizeHeroSlugSearchText(q);

  const filtered = libraryAll
    .filter((row) => {
      if (q) {
        const normalizedName = normalizeHeroSearchText(row.hero_name);
        const normalizedSlug = row.hero_slug.toLowerCase();
        const aliasTerms = aliasTermsBySlug.get(row.hero_slug) || [];
        const matchesName = normalizedQuery ? normalizedName.includes(normalizedQuery) : false;
        const matchesSlug = normalizedSlugQuery ? normalizedSlug.includes(normalizedSlugQuery) : false;
        const matchesAlias = normalizedQuery ? aliasTerms.some((alias) => alias.includes(normalizedQuery)) : false;
        if (!matchesName && !matchesSlug && !matchesAlias) return false;
      }
      if (weapon && row.weapon !== weapon) return false;
      if (move && row.move !== move) return false;
      if (tag && row.tag !== tag) return false;
      if (minTier != null && (row.tier == null || row.tier < minTier)) return false;
      if (favoriteOnly && !row.favorite) return false;
      return true;
    })
    .sort((a, b) => {
      if (sort === "name_asc") return a.hero_name.localeCompare(b.hero_name);
      if (sort === "updated_desc") {
        const at = a.updated_at ? new Date(a.updated_at).getTime() : 0;
        const bt = b.updated_at ? new Date(b.updated_at).getTime() : 0;
        return bt - at;
      }
      const at = a.tier ?? -999;
      const bt = b.tier ?? -999;
      if (bt !== at) return bt - at;
      return a.hero_name.localeCompare(b.hero_name);
    });

  const weaponOptions = Array.from(new Set(libraryAll.map((r) => r.weapon).filter((v): v is string => Boolean(v)))).sort((a, b) =>
    a.localeCompare(b)
  );
  const moveOptions = Array.from(new Set(libraryAll.map((r) => r.move).filter((v): v is string => Boolean(v)))).sort((a, b) =>
    a.localeCompare(b)
  );
  const tagOptions = Array.from(new Set(libraryAll.map((r) => r.tag).filter((v): v is string => Boolean(v)))).sort((a, b) =>
    a.localeCompare(b)
  );
  const redirectTo = buildLibraryRedirectPath({
    q,
    weapon,
    move,
    tag,
    minTier: minTierRaw,
    favoriteOnly,
    sort,
  });

  return (
    <div className="min-h-screen bg-zinc-950 px-3 py-6 text-zinc-100 sm:px-4 sm:py-10">
      <main className="mx-auto w-full max-w-7xl rounded-2xl border border-zinc-800 bg-zinc-900 p-4 sm:p-6 lg:p-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">My Heroes</h1>
            <p className="text-sm text-zinc-300">All owned units on one page, default sorted by tier hierarchy.</p>
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
            className={`mt-6 rounded-lg border p-3 text-sm ${
              tone === "warn"
                ? "border-amber-800 bg-amber-950/40 text-amber-200"
                : "border-emerald-800 bg-emerald-950/40 text-emerald-200"
            }`}
          >
            {notice}
          </p>
        ) : null}

        <HeroBrowserFilters
          heroes={typeaheadHeroes}
          aliasOptions={heroAliasOptions}
          weaponOptions={weaponOptions}
          moveOptions={moveOptions}
          tagOptions={tagOptions}
          initialQuery={q}
          initialWeapon={weapon}
          initialMove={move}
          initialTag={tag}
          initialMinTier={minTierRaw}
          initialFavoriteOnly={favoriteOnly}
          initialSort={sort}
        />

        <p className="mt-4 text-xs text-zinc-400">
          Showing {filtered.length} of {libraryAll.length} entries.
        </p>

        {!filtered.length ? (
          <p className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-300">
            No entries match your filters.
          </p>
        ) : (
          <section className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((hero) => (
              <article
                key={hero.hero_slug}
                className="library-card-shell relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 p-4 transition-all hover:border-zinc-700 hover:bg-zinc-900/80"
              >
                <Link
                  href={`/heroes/${hero.hero_slug}`}
                  aria-label={`Open ${hero.hero_name}`}
                  className="absolute inset-0 z-10 rounded-xl cursor-pointer"
                />

                <div className="pointer-events-none relative z-20 flex items-start justify-between gap-3">
                  <div className="pointer-events-none min-w-0 flex-1">
                    <div className="flex gap-3">
                      <img
                        src={`/api/headshots/${hero.hero_slug}`}
                        alt={`${hero.hero_name} headshot`}
                        className="library-card-media h-20 w-20 rounded-xl border border-zinc-700 object-cover sm:h-24 sm:w-24"
                        loading="lazy"
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="line-clamp-2 font-medium text-zinc-100">
                          {hero.favorite ? "★ " : ""}
                          {hero.hero_name}
                        </p>
                        <p className="text-xs text-zinc-400">Tier: {hero.tier ?? "-"}</p>
                        <div className="flex items-center gap-2 text-xs text-zinc-300">
                          {rarityIconName(hero.rarity) ? (
                            <img
                              src={`/api/shared-icons/rarity?name=${encodeURIComponent(rarityIconName(hero.rarity) || "")}`}
                              alt={`${hero.rarity || "Rarity"} icon`}
                              className="h-4 w-4 rounded-sm"
                            />
                          ) : null}
                          <span>{rarityStarsText(hero.rarity)}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-zinc-300">
                          {weaponIconName(hero.weapon) ? (
                            <img
                              src={`/api/shared-icons/weapon_type?name=${encodeURIComponent(weaponIconName(hero.weapon) || "")}`}
                              alt={`${hero.weapon || "Weapon"} icon`}
                              className="h-4 w-4 rounded-sm"
                            />
                          ) : null}
                          <span>{hero.weapon || "-"}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-zinc-300">
                          {moveIconName(hero.move) ? (
                            <img
                              src={`/api/shared-icons/move?name=${encodeURIComponent(moveIconName(hero.move) || "")}`}
                              alt={`${hero.move || "Move"} icon`}
                              className="h-4 w-4 rounded-sm"
                            />
                          ) : null}
                          <span>{hero.move || "-"}</span>
                        </div>
                        <p className="text-xs text-zinc-400">Tag: {hero.tag || "-"}</p>
                      </div>
                    </div>
                  </div>
                  <div className="relative z-30 flex shrink-0 flex-col items-end gap-2 pointer-events-auto">
                    <form action={toggleFavorite}>
                      <input type="hidden" name="hero_slug" value={hero.hero_slug} readOnly />
                      <input type="hidden" name="redirect_to" value={redirectTo} readOnly />
                      <button
                        type="submit"
                        className="rounded-md border border-amber-700 px-2 py-1 text-xs text-amber-300 hover:bg-amber-950"
                      >
                        {hero.favorite ? "★" : "☆"}
                      </button>
                    </form>
                  </div>
                </div>

                <div className="pointer-events-none relative z-20 mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-zinc-300">
                    Merges: +{hero.merges}
                  </span>
                  <span className="rounded border border-cyan-800 px-1.5 py-0.5 text-cyan-300">
                    Dupes: {hero.copies_owned}
                  </span>
                </div>

                {buildInventorySummary(hero).length ? (
                  <div className="pointer-events-none relative z-20 mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-300">
                    {buildInventorySummary(hero).map((item) => (
                      <span
                        key={`${hero.hero_slug}-${item}`}
                        className="rounded-full border border-zinc-700 bg-zinc-900/70 px-2 py-0.5"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                ) : null}

                {hero.notes ? <p className="pointer-events-none relative z-20 mt-2 line-clamp-2 text-xs text-zinc-500">{hero.notes}</p> : null}

                <details className="library-card-details relative z-30 mt-3 rounded-xl border border-zinc-800/80 bg-zinc-900/55 p-2 pointer-events-auto open:border-cyan-800/70 open:bg-zinc-900/80">
                  <summary className="flex list-none items-center gap-2 rounded-lg border border-zinc-800/70 bg-zinc-950/75 px-2.5 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800/60">
                    <span className="library-card-chevron flex h-7 w-7 items-center justify-center rounded-full border border-cyan-700/90 bg-cyan-950/70 text-base font-semibold text-cyan-200">
                      ▸
                    </span>
                    <span>Manage merges, dupes, blessings, notes</span>
                  </summary>
                  <form action={updateBarracksEntry} className="mt-3 space-y-3">
                    <input type="hidden" name="id" value={hero.id} readOnly />
                    <input type="hidden" name="redirect_to" value={redirectTo} readOnly />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-xs text-zinc-400">Merges</label>
                        <select
                          name="merges"
                          defaultValue={String(hero.merges)}
                          className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
                        >
                          {buildSelectOptions(MERGE_OPTIONS, hero.merges).map((value) => (
                            <option key={`${hero.hero_slug}-merge-${value}`} value={value}>
                              +{value}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-zinc-400">Dupes owned</label>
                        <select
                          name="copies_owned"
                          defaultValue={String(hero.copies_owned)}
                          className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
                        >
                          {buildSelectOptions(DUPE_OPTIONS_BASE, hero.copies_owned).map((value) => (
                            <option key={`${hero.hero_slug}-dupe-${value}`} value={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Tracked Blessings</p>
                        <p className="mt-1 text-xs text-zinc-500">
                          Blessings stay synced with the hero entry and are included in AI exports.
                        </p>
                      </div>
                      <div>
                        <label className="mb-2 block text-xs text-zinc-400">Blessings</label>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {HERO_BLESSING_OPTIONS.map((blessing) => {
                            const meta = HERO_BLESSING_META[blessing];
                            const accentStyle = ACCENT_STYLES[meta.accent];

                            return (
                              <label
                                key={`${hero.hero_slug}-${blessing}`}
                                className={`flex items-start gap-3 rounded-xl border px-3 py-2 text-xs text-zinc-300 ${accentStyle.panel}`}
                              >
                              <input
                                type="checkbox"
                                name="inventory_blessings"
                                value={blessing}
                                defaultChecked={hero.inventory.blessings.includes(blessing)}
                                className="mt-1 h-4 w-4 rounded border-zinc-700 bg-zinc-950 text-cyan-400"
                              />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span
                                      className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${accentStyle.badge}`}
                                    >
                                      {meta.badge}
                                    </span>
                                    <span className="font-medium text-zinc-100">{blessing}</span>
                                  </div>
                                  <p className="mt-1 text-[11px] text-zinc-500">{meta.description}</p>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Current Build</p>
                        <p className="mt-1 text-xs text-zinc-500">
                          Track the actual FEH build slots using the shared Game8-based skill catalog.
                        </p>
                      </div>
                      <div className="grid gap-3 xl:grid-cols-2">
                        {EQUIPPED_SKILL_SLOTS.map((slot) => {
                          const accentStyle = ACCENT_STYLES[slot.accent];

                          return (
                            <div
                              key={`${hero.hero_slug}-${slot.key}`}
                              className={`rounded-xl border p-3 ${accentStyle.panel}`}
                            >
                              <div className="mb-3 flex items-start gap-3">
                                <span
                                  className={`inline-flex min-w-[3.25rem] items-center justify-center rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${accentStyle.badge}`}
                                >
                                  {slot.shortLabel}
                                </span>
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-zinc-100">{slot.label}</p>
                                  <p className="mt-1 text-xs text-zinc-500">{slot.helperText}</p>
                                </div>
                              </div>
                              <SkillTagSelector
                                inputName={`equipped_${slot.key}`}
                                selectedValue={hero.inventory.equipped[slot.key]}
                                multiple={false}
                                allowedCategories={[...slot.allowedCategories]}
                                placeholder={slot.placeholder}
                                emptyStateText={slot.emptyStateText}
                              />
                            </div>
                          );
                        })}
                      </div>
                      <div className="rounded-xl border border-zinc-800 bg-zinc-900/55 p-3">
                        <SkillTagSelector
                          inputName="inventory_fodder"
                          label="Fodder / manuals on hand"
                          helperText="Track inheritance pieces, duplicate manuals, and spare seals you own for this hero or project."
                          selectedValues={hero.inventory.fodder}
                          placeholder="Search fodder, manuals, seals..."
                          emptyStateText="No matching fodder skills found."
                        />
                      </div>
                      {hero.inventory.legacy_skills.length ? (
                        <div className="rounded-lg border border-amber-800/60 bg-amber-950/25 p-3 text-xs text-amber-100">
                          <p className="font-semibold uppercase tracking-[0.16em] text-amber-200">Legacy tracked skills</p>
                          <p className="mt-1 text-amber-100/80">
                            These came from the older generic skill tracker. Re-save this hero after filling the slot-specific fields if you want to fully migrate them.
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {hero.inventory.legacy_skills.map((skill) => (
                              <span
                                key={`${hero.hero_slug}-legacy-${skill.id}`}
                                className="rounded-full border border-amber-700/60 bg-amber-950/40 px-2 py-0.5 text-[11px]"
                              >
                                {skill.name}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-zinc-400">Notes</label>
                      <textarea
                        name="notes"
                        defaultValue={hero.notes ?? ""}
                        placeholder="Build / IV / project notes"
                        rows={3}
                        className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="submit"
                        className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800"
                      >
                        Save
                      </button>
                    </div>
                  </form>
                </details>

                <form action={removeBarracksEntry} className="relative z-30 mt-3 pointer-events-auto">
                  <input type="hidden" name="id" value={hero.id} readOnly />
                  <input type="hidden" name="redirect_to" value={redirectTo} readOnly />
                  <button
                    type="submit"
                    className="rounded-md border border-rose-800 px-2 py-1 text-xs text-rose-300 hover:bg-rose-950"
                  >
                    Remove from barracks
                  </button>
                </form>

                <p className="pointer-events-none relative z-20 mt-3 text-xs text-zinc-500">
                  Last updated: {hero.updated_at ? new Date(hero.updated_at).toLocaleString() : "-"}
                </p>
              </article>
            ))}
          </section>
        )}
      </main>
    </div>
  );
}
