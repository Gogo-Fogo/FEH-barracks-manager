import fs from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AddHeroTypeahead } from "@/components/add-hero-typeahead";
import { AuthSignOutButton } from "@/components/auth-signout-button";
import { TeamSlotTypeahead } from "@/components/team-slot-typeahead";
import { listHeroAliasOptionsBySlug } from "@/lib/hero-aliases";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { moveIconName, rarityIconName, rarityStarsText, weaponIconName } from "@/lib/feh-icons";
import { loadUnitRarityBySlugs } from "@/lib/local-unit-data";
import {
  addToBarracks,
  createUserNote,
  createUserTeam,
  removeBarracksEntry,
  removeUserNote,
  removeUserTeam,
  toggleFavorite,
  updateUserNote,
  updateBarracksEntry,
  updateUserTeam,
} from "./actions";

const HERO_QUERY_MAX_ROWS = 5000;

function looksLikeGuideTitle(name: string) {
  return /\b(builds?|best\s+refine|best\s+build|tier\s+list|ratings?)\b/i.test(name);
}

async function loadLocalRarityBySlug() {
  const candidates = [
    path.join(process.cwd(), "db", "index.json"),
    path.join(process.cwd(), "..", "db", "index.json"),
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

function normalizeTeamSlotsForDisplay(rawSlots: unknown) {
  const slots = Array.isArray(rawSlots)
    ? rawSlots.map((slot) => String(slot || "").trim()).slice(0, 4)
    : [];

  while (slots.length < 4) {
    slots.push("");
  }

  return slots;
}

type BarracksPageProps = {
  searchParams: Promise<{
    notice?: string;
    tone?: string;
  }>;
};

export default async function BarracksPage({ searchParams }: BarracksPageProps) {
  if (!isSupabaseConfigured()) {
    redirect("/login");
  }

  const params = await searchParams;
  const notice = (params.notice || "").trim();
  const tone = (params.tone || "success").trim();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const fetchHeroesWithRarity = async () =>
    supabase
      .from("heroes")
      .select("hero_slug,name,rarity,weapon,move,tier")
      .order("hero_slug", { ascending: true })
      .range(0, HERO_QUERY_MAX_ROWS - 1);

  const fetchHeroesWithoutRarity = async () =>
    supabase
      .from("heroes")
      .select("hero_slug,name,weapon,move,tier")
      .order("hero_slug", { ascending: true })
      .range(0, HERO_QUERY_MAX_ROWS - 1);

  const heroesResult = await fetchHeroesWithRarity();
  const localRarityBySlug = await loadLocalRarityBySlug();
  let heroRows: Array<{
    hero_slug: string;
    name: string;
    rarity: string | null;
    weapon: string | null;
    move: string | null;
    tier: number | null;
  }> = [];

  if (heroesResult.error?.message.includes("rarity")) {
    const fallback = await fetchHeroesWithoutRarity();
    heroRows = (fallback.data || []).map((h) => ({
      hero_slug: h.hero_slug,
      name: h.name,
      rarity: localRarityBySlug.get(h.hero_slug) ?? null,
      weapon: h.weapon,
      move: h.move,
      tier: h.tier,
    }));
  } else {
    heroRows = (heroesResult.data || []).map((h) => ({
      hero_slug: h.hero_slug,
      name: h.name,
      rarity: h.rarity ?? localRarityBySlug.get(h.hero_slug) ?? null,
      weapon: h.weapon,
      move: h.move,
      tier: h.tier,
    }));
  }

  heroRows = Array.from(
    new Map(
      heroRows.map((hero) => {
        const patchedName = looksLikeGuideTitle(hero.name)
          ? hero.name
              .replace(/\bBuilds?\s+and\s+Best\s+Refine\b/gi, "")
              .replace(/\s+/g, " ")
              .trim()
          : hero.name;

        return [
          hero.hero_slug,
          {
            ...hero,
            name: patchedName || hero.name,
          },
        ] as const;
      })
    ).values()
  ).sort((a, b) => a.hero_slug.localeCompare(b.hero_slug));

  const missingRaritySlugs = heroRows
    .filter((hero) => !hero.rarity)
    .map((hero) => hero.hero_slug);

  if (missingRaritySlugs.length) {
    const unitRarityBySlug = await loadUnitRarityBySlugs(missingRaritySlugs);
    heroRows = heroRows.map((hero) => ({
      ...hero,
      rarity: hero.rarity ?? unitRarityBySlug.get(hero.hero_slug) ?? null,
    }));
  }

  const [{ data: barracks }, { data: favorites }, { data: notes }, { data: teams }] = await Promise.all([
    supabase
      .from("user_barracks")
      .select("id,hero_slug,hero_name,merges,copies_owned,notes,updated_at")
      .eq("user_id", user.id)
      .order("hero_name", { ascending: true }),
    supabase
      .from("user_favorites")
      .select("hero_slug, heroes(name)")
      .eq("user_id", user.id),
    supabase
      .from("user_notes")
      .select("id,title,content,hero_slug,updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(20),
    supabase
      .from("user_teams")
      .select("id,name,description,slots,updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(20),
  ]);

  const heroes = heroRows;
  const heroSlugSet = new Set(heroes.map((h) => h.hero_slug));
  const heroAliasOptions = await listHeroAliasOptionsBySlug(heroSlugSet);
  const ownedHeroSlugs = Array.from(
    new Set((barracks || []).map((entry) => entry.hero_slug).filter(Boolean))
  );

  const favoriteSet = new Set((favorites || []).map((f) => f.hero_slug));
  const barracksSlugOptions = (barracks || []).map((b) => ({ hero_slug: b.hero_slug, hero_name: b.hero_name }));
  const heroMetaBySlug = new Map(heroes.map((h) => [h.hero_slug, h]));
  const teamSlotHeroOptions = (barracks || []).map((entry) => {
    const meta = heroMetaBySlug.get(entry.hero_slug);
    return {
      hero_slug: entry.hero_slug,
      hero_name: entry.hero_name,
      weapon: meta?.weapon ?? null,
      move: meta?.move ?? null,
      tier: meta?.tier ?? null,
    };
  });
  const barracksNameBySlug = new Map((barracks || []).map((entry) => [entry.hero_slug, entry.hero_name]));
  const resolveTeamHeroName = (heroSlug: string) =>
    barracksNameBySlug.get(heroSlug) || heroMetaBySlug.get(heroSlug)?.name || heroSlug;

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-100">
      <main className="mx-auto w-full max-w-4xl rounded-2xl border border-zinc-800 bg-zinc-900 p-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">My Barracks</h1>
            <p className="text-sm text-zinc-300">Signed in as {user.email}</p>
          </div>
          <AuthSignOutButton />
        </header>

        <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-950 p-5">
          {notice ? (
            <p
              className={`mb-4 rounded-lg border p-3 text-sm ${
                tone === "warn"
                  ? "border-amber-800 bg-amber-950/40 text-amber-200"
                  : "border-emerald-800 bg-emerald-950/40 text-emerald-200"
              }`}
            >
              {notice}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Add hero to barracks</h2>
            <div className="flex flex-wrap gap-2">
              <a
                href="/api/ai-export"
                className="rounded-md border border-emerald-700 px-3 py-1.5 text-sm text-emerald-300 hover:bg-emerald-950"
              >
                Export AI Context (.md)
              </a>
              <Link
                href="/aether-resort"
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800"
              >
                Open Aether Resort
              </Link>
              <Link
                href="/heroes"
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800"
              >
                Open hero browser
              </Link>
              <Link
                href="/barracks/library"
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800"
              >
                Open My Wifus
              </Link>
            </div>
          </div>

          {!heroes?.length ? (
            <p className="mt-3 text-sm text-zinc-300">
              No heroes found in database yet. Run the import script first.
            </p>
          ) : (
            <AddHeroTypeahead
              heroes={heroes}
              aliasOptions={heroAliasOptions}
              ownedHeroSlugs={ownedHeroSlugs}
              redirectTo="/barracks"
              addAction={addToBarracks}
            />
          )}

          <div className="mt-6 border-t border-zinc-800 pt-5">
            <h3 className="text-lg font-semibold">My Wifus</h3>

            {!barracks?.length ? (
              <p className="mt-3 text-sm text-zinc-300">No heroes in your barracks yet.</p>
            ) : (
              <div className="mt-4 max-h-[430px] space-y-2 overflow-y-auto pr-1">
                {barracks.map((entry) => (
                  <form
                    key={entry.id}
                    action={updateBarracksEntry}
                    className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3"
                  >
                    <input type="hidden" name="id" value={entry.id} readOnly />
                    <input type="hidden" name="redirect_to" value="/barracks" readOnly />
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <Link
                        href={`/heroes/${entry.hero_slug}`}
                        className="group flex min-w-0 items-center gap-2 rounded-lg px-1 py-1 transition-all hover:-translate-y-0.5 hover:bg-zinc-800/40"
                      >
                        <img
                          src={`/api/headshots/${entry.hero_slug}`}
                          alt={`${entry.hero_name} headshot`}
                          className="h-10 w-10 rounded-lg border border-zinc-700 object-cover transition-transform group-hover:scale-105"
                          loading="lazy"
                        />
                        <span className="truncate font-medium group-hover:text-indigo-300">
                          {entry.hero_name}
                        </span>
                        {(() => {
                          const meta = heroMetaBySlug.get(entry.hero_slug);
                          const rarityIcon = rarityIconName(meta?.rarity || null);
                          const weaponIcon = weaponIconName(meta?.weapon || null);
                          const moveIcon = moveIconName(meta?.move || null);
                          return (
                            <span className="flex items-center gap-1 text-[11px] text-zinc-400">
                              {rarityIcon ? (
                                <img
                                  src={`/api/shared-icons/rarity?name=${encodeURIComponent(rarityIcon)}`}
                                  alt={`${meta?.rarity || "Rarity"} icon`}
                                  className="h-3.5 w-3.5 rounded-sm"
                                />
                              ) : null}
                              <span>{rarityStarsText(meta?.rarity || null)}</span>
                              {weaponIcon ? (
                                <img
                                  src={`/api/shared-icons/weapon_type?name=${encodeURIComponent(weaponIcon)}`}
                                  alt={`${meta?.weapon || "Weapon"} icon`}
                                  className="h-3.5 w-3.5 rounded-sm"
                                />
                              ) : null}
                              {moveIcon ? (
                                <img
                                  src={`/api/shared-icons/move?name=${encodeURIComponent(moveIcon)}`}
                                  alt={`${meta?.move || "Move"} icon`}
                                  className="h-3.5 w-3.5 rounded-sm"
                                />
                              ) : null}
                              <span>{meta?.tier != null ? `T${meta.tier}` : "T-"}</span>
                            </span>
                          );
                        })()}
                        <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[11px] text-zinc-300">
                          +{entry.merges ?? 0}
                        </span>
                        <span className="rounded border border-cyan-800 px-1.5 py-0.5 text-[11px] text-cyan-300">
                          Dupes: {entry.copies_owned ?? 0}
                        </span>
                      </Link>

                      <div className="flex items-center gap-2">
                        <input type="hidden" name="hero_slug" value={entry.hero_slug} readOnly />
                        <button
                          type="submit"
                          formAction={toggleFavorite}
                          className="rounded-md border border-amber-700 px-2 py-1 text-xs text-amber-300 hover:bg-amber-950"
                        >
                          {favoriteSet.has(entry.hero_slug) ? "★ Unfavorite" : "☆ Favorite"}
                        </button>
                        <button
                          type="submit"
                          formAction={removeBarracksEntry}
                          className="rounded-md border border-rose-800 px-2 py-1 text-xs text-rose-300 hover:bg-rose-950"
                        >
                          Remove
                        </button>
                      </div>
                    </div>

                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-zinc-400 hover:text-zinc-200">
                        Edit merges / dupes / notes
                      </summary>

                      <div className="mt-2 grid gap-3 md:grid-cols-[120px_120px_1fr_auto]">
                        <div>
                          <label className="mb-1 block text-xs text-zinc-400">Merges</label>
                          <input
                            name="merges"
                            type="number"
                            min={0}
                            max={20}
                            defaultValue={entry.merges ?? 0}
                            className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-xs text-zinc-400">Dupes owned</label>
                          <input
                            name="copies_owned"
                            type="number"
                            min={0}
                            max={999}
                            defaultValue={entry.copies_owned ?? 0}
                            className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-xs text-zinc-400">Notes</label>
                          <input
                            name="notes"
                            defaultValue={entry.notes ?? ""}
                            placeholder="Build/IV notes"
                            className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
                          />
                        </div>

                        <div className="self-end">
                          <button
                            type="submit"
                            className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    </details>

                    <p className="mt-2 text-xs text-zinc-500">
                      Last updated: {entry.updated_at ? new Date(entry.updated_at).toLocaleString() : "-"}
                    </p>
                  </form>
                ))}
              </div>
            )}
          </div>

          <div className="mt-6">
            <Link
              href="/"
              className="inline-block rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
            >
              Back to home
            </Link>
          </div>

          <div className="mt-8 border-t border-zinc-800 pt-5">
            <h3 className="text-lg font-semibold">Favorites</h3>
            {!favorites?.length ? (
              <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-sm text-zinc-300">
                <p>No favorites yet. Use ☆ Favorite in Hero Browser.</p>
                <Link
                  href="/heroes"
                  className="mt-2 inline-block rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
                >
                  Browse heroes
                </Link>
              </div>
            ) : (
              <>
                <p className="mt-2 text-xs text-zinc-400">{favorites.length} favorite(s) synced to your account.</p>
                <div className="mt-3 max-h-[320px] overflow-y-auto pr-1">
                <div className="flex flex-wrap gap-2">
                {heroes
                  .filter((h) => favoriteSet.has(h.hero_slug))
                  .map((h) => (
                    <div
                      key={h.hero_slug}
                      className="inline-flex items-center gap-2 rounded-full border border-amber-700 px-2 py-1 text-xs text-amber-300"
                    >
                      <Link href={`/heroes/${h.hero_slug}`} className="inline-flex items-center rounded-full pr-1 hover:text-amber-200">
                        <img
                          src={`/api/headshots/${h.hero_slug}`}
                          alt={`${h.name} headshot`}
                          className="mr-2 inline h-6 w-6 rounded-md border border-zinc-700 object-cover align-middle"
                          loading="lazy"
                        />
                        ★ {h.name}
                      </Link>

                      <form action={toggleFavorite}>
                        <input type="hidden" name="hero_slug" value={h.hero_slug} readOnly />
                        <input type="hidden" name="redirect_to" value="/barracks" readOnly />
                        <button
                          type="submit"
                          className="rounded-full border border-rose-700 px-2 py-0.5 text-[11px] text-rose-300 hover:bg-rose-950"
                          aria-label={`Remove ${h.name} from favorites`}
                        >
                          Remove
                        </button>
                      </form>
                    </div>
                  ))}

                {(favorites || [])
                  .filter((f) => !heroes.some((h) => h.hero_slug === f.hero_slug))
                  .map((f) => (
                    <div
                      key={f.hero_slug}
                      className="inline-flex items-center gap-2 rounded-full border border-amber-700 px-2 py-1 text-xs text-amber-300"
                    >
                      <Link href={`/heroes/${f.hero_slug}`} className="inline-flex items-center rounded-full pr-1 hover:text-amber-200">
                        <img
                          src={`/api/headshots/${f.hero_slug}`}
                          alt={`${(f as { heroes?: { name?: string } | null }).heroes?.name || f.hero_slug} headshot`}
                          className="mr-2 inline h-6 w-6 rounded-md border border-zinc-700 object-cover align-middle"
                          loading="lazy"
                        />
                        ★ {(f as { heroes?: { name?: string } | null }).heroes?.name || f.hero_slug}
                      </Link>

                      <form action={toggleFavorite}>
                        <input type="hidden" name="hero_slug" value={f.hero_slug} readOnly />
                        <input type="hidden" name="redirect_to" value="/barracks" readOnly />
                        <button
                          type="submit"
                          className="rounded-full border border-rose-700 px-2 py-0.5 text-[11px] text-rose-300 hover:bg-rose-950"
                          aria-label={`Remove ${(f as { heroes?: { name?: string } | null }).heroes?.name || f.hero_slug} from favorites`}
                        >
                          Remove
                        </button>
                      </form>
                    </div>
                  ))}
                </div>
                </div>
              </>
            )}
          </div>

          <div className="mt-8 border-t border-zinc-800 pt-5">
            <h3 className="text-lg font-semibold">Team Builder</h3>
            <p className="mt-1 text-xs text-zinc-400">
              Teams are account-bound and synced online for this login.
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              Choose heroes from your barracks for each slot. You can replace or remove a character at any time.
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Duplicate slots are automatically de-duplicated and at least one hero is required.
            </p>

            <datalist id="barracks-slug-suggestions">
              {barracksSlugOptions.map((b) => (
                <option key={b.hero_slug} value={b.hero_slug}>
                  {b.hero_name}
                </option>
              ))}
            </datalist>

            <form action={createUserTeam} className="mt-3 grid gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
              <input type="hidden" name="redirect_to" value="/barracks" readOnly />
              <input
                name="name"
                placeholder="Team name (e.g. Arena Core)"
                required
                className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
              />
              <div className="grid gap-2 md:grid-cols-2">
                {[1, 2, 3, 4].map((slot) => (
                  <TeamSlotTypeahead
                    key={`new_team_slot_${slot}`}
                    inputName={`slot_${slot}`}
                    label={`Slot ${slot}`}
                    heroes={teamSlotHeroOptions}
                    placeholder="Search your owned heroes"
                  />
                ))}
              </div>
              <input
                name="description"
                placeholder="Optional description"
                className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
              />
              <button
                type="submit"
                className="w-fit rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800"
              >
                Save team
              </button>
            </form>

            <div className="mt-3 space-y-3">
              {(teams || []).map((team) => {
                const slots = normalizeTeamSlotsForDisplay(team.slots);

                return (
                  <form key={team.id} action={updateUserTeam} className="rounded-xl border border-zinc-700 bg-zinc-900/70 p-3">
                    <input type="hidden" name="id" value={team.id} readOnly />
                    <input type="hidden" name="redirect_to" value="/barracks" readOnly />

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <input
                        name="name"
                        defaultValue={team.name}
                        required
                        className="min-w-[220px] flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
                      />
                      <span className="text-[11px] text-zinc-500">
                        {team.updated_at ? new Date(team.updated_at).toLocaleString() : "-"}
                      </span>
                    </div>

                    <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-800">
                      <table className="w-full min-w-[560px] text-sm">
                        <thead className="bg-zinc-950/80 text-zinc-400">
                          <tr>
                            <th className="px-3 py-2 text-left text-[11px] uppercase">Slot</th>
                            <th className="px-3 py-2 text-left text-[11px] uppercase">Hero</th>
                          </tr>
                        </thead>
                        <tbody>
                          {slots.map((slot, index) => (
                            <tr key={`${team.id}_slot_${index + 1}`} className="border-t border-zinc-800">
                              <td className="px-3 py-2 text-zinc-300">{index + 1}</td>
                              <td className="px-3 py-2">
                                {slot ? (
                                  (() => {
                                    const meta = heroMetaBySlug.get(slot);
                                    const rarityIcon = rarityIconName(meta?.rarity || null);
                                    const weaponIcon = weaponIconName(meta?.weapon || null);
                                    const moveIcon = moveIconName(meta?.move || null);

                                    return (
                                      <div>
                                        <Link href={`/heroes/${slot}`} className="group inline-flex min-w-0 items-center gap-2 hover:text-indigo-300">
                                          <img
                                            src={`/api/headshots/${slot}`}
                                            alt={`${resolveTeamHeroName(slot)} headshot`}
                                            className="h-8 w-8 rounded-md border border-zinc-700 object-cover"
                                            loading="lazy"
                                          />
                                          <span className="min-w-0">
                                            <span className="block truncate">{resolveTeamHeroName(slot)}</span>
                                            <span className="mt-0.5 flex items-center gap-1 text-[11px] text-zinc-400 group-hover:text-zinc-300">
                                              {rarityIcon ? (
                                                <img
                                                  src={`/api/shared-icons/rarity?name=${encodeURIComponent(rarityIcon)}`}
                                                  alt={`${meta?.rarity || "Rarity"} icon`}
                                                  className="h-3.5 w-3.5 rounded-sm"
                                                />
                                              ) : null}
                                              <span>{rarityStarsText(meta?.rarity || null)}</span>
                                              {weaponIcon ? (
                                                <img
                                                  src={`/api/shared-icons/weapon_type?name=${encodeURIComponent(weaponIcon)}`}
                                                  alt={`${meta?.weapon || "Weapon"} icon`}
                                                  className="h-3.5 w-3.5 rounded-sm"
                                                />
                                              ) : null}
                                              {moveIcon ? (
                                                <img
                                                  src={`/api/shared-icons/move?name=${encodeURIComponent(moveIcon)}`}
                                                  alt={`${meta?.move || "Move"} icon`}
                                                  className="h-3.5 w-3.5 rounded-sm"
                                                />
                                              ) : null}
                                              <span>{meta?.tier != null ? `T${meta.tier}` : "T-"}</span>
                                            </span>
                                          </span>
                                        </Link>

                                        <div className="mt-2 max-w-md">
                                          <TeamSlotTypeahead
                                            inputName={`slot_${index + 1}`}
                                            heroes={teamSlotHeroOptions}
                                            initialSlug={slot}
                                            placeholder="Type to search owned heroes"
                                          />
                                        </div>

                                        <details className="mt-1">
                                          <summary className="cursor-pointer text-[11px] text-zinc-400 hover:text-zinc-200">▾ Change hero</summary>
                                          <div className="mt-1 max-h-48 overflow-y-auto rounded border border-zinc-800 bg-zinc-950/80 p-1">
                                            <button
                                              type="submit"
                                              name={`clear_slot_${index + 1}`}
                                              value="1"
                                              className="mb-1 w-full rounded border border-rose-900/70 px-2 py-1 text-left text-[11px] text-rose-300 hover:bg-rose-950/50"
                                            >
                                              Remove from slot
                                            </button>

                                            {(barracks || []).map((entry) => {
                                              const pickMeta = heroMetaBySlug.get(entry.hero_slug);
                                              const pickRarityIcon = rarityIconName(pickMeta?.rarity || null);
                                              const pickWeaponIcon = weaponIconName(pickMeta?.weapon || null);
                                              const pickMoveIcon = moveIconName(pickMeta?.move || null);

                                              return (
                                                <button
                                                  key={`${team.id}_${index + 1}_pick_${entry.hero_slug}`}
                                                  type="submit"
                                                  name={`slot_${index + 1}`}
                                                  value={entry.hero_slug}
                                                  className="mb-1 flex w-full items-center gap-2 rounded border border-zinc-800 px-2 py-1 text-left hover:bg-zinc-800"
                                                >
                                                  <img
                                                    src={`/api/headshots/${entry.hero_slug}`}
                                                    alt={`${entry.hero_name} headshot`}
                                                    className="h-6 w-6 rounded border border-zinc-700 object-cover"
                                                    loading="lazy"
                                                  />
                                                  <span className="min-w-0 text-[11px] text-zinc-200">
                                                    <span className="block truncate">{entry.hero_name}</span>
                                                    <span className="mt-0.5 flex items-center gap-1 text-zinc-400">
                                                      {pickRarityIcon ? (
                                                        <img
                                                          src={`/api/shared-icons/rarity?name=${encodeURIComponent(pickRarityIcon)}`}
                                                          alt={`${pickMeta?.rarity || "Rarity"} icon`}
                                                          className="h-3 w-3 rounded-sm"
                                                        />
                                                      ) : null}
                                                      <span>{rarityStarsText(pickMeta?.rarity || null)}</span>
                                                      {pickWeaponIcon ? (
                                                        <img
                                                          src={`/api/shared-icons/weapon_type?name=${encodeURIComponent(pickWeaponIcon)}`}
                                                          alt={`${pickMeta?.weapon || "Weapon"} icon`}
                                                          className="h-3 w-3 rounded-sm"
                                                        />
                                                      ) : null}
                                                      {pickMoveIcon ? (
                                                        <img
                                                          src={`/api/shared-icons/move?name=${encodeURIComponent(pickMoveIcon)}`}
                                                          alt={`${pickMeta?.move || "Move"} icon`}
                                                          className="h-3 w-3 rounded-sm"
                                                        />
                                                      ) : null}
                                                      <span>{pickMeta?.tier != null ? `T${pickMeta.tier}` : "T-"}</span>
                                                    </span>
                                                  </span>
                                                </button>
                                              );
                                            })}
                                          </div>
                                        </details>
                                      </div>
                                    );
                                  })()
                                ) : (
                                  <>
                                    <div className="max-w-md">
                                      <TeamSlotTypeahead
                                        inputName={`slot_${index + 1}`}
                                        heroes={teamSlotHeroOptions}
                                        initialSlug={slot}
                                        placeholder="Type to search owned heroes"
                                      />
                                    </div>

                                  <details>
                                    <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300">Empty (click to choose)</summary>
                                    <div className="mt-1 max-h-48 overflow-y-auto rounded border border-zinc-800 bg-zinc-950/80 p-1">
                                      {(barracks || []).map((entry) => {
                                        const pickMeta = heroMetaBySlug.get(entry.hero_slug);
                                        const pickRarityIcon = rarityIconName(pickMeta?.rarity || null);
                                        const pickWeaponIcon = weaponIconName(pickMeta?.weapon || null);
                                        const pickMoveIcon = moveIconName(pickMeta?.move || null);

                                        return (
                                          <button
                                            key={`${team.id}_${index + 1}_empty_pick_${entry.hero_slug}`}
                                            type="submit"
                                            name={`slot_${index + 1}`}
                                            value={entry.hero_slug}
                                            className="mb-1 flex w-full items-center gap-2 rounded border border-zinc-800 px-2 py-1 text-left hover:bg-zinc-800"
                                          >
                                            <img
                                              src={`/api/headshots/${entry.hero_slug}`}
                                              alt={`${entry.hero_name} headshot`}
                                              className="h-6 w-6 rounded border border-zinc-700 object-cover"
                                              loading="lazy"
                                            />
                                            <span className="min-w-0 text-[11px] text-zinc-200">
                                              <span className="block truncate">{entry.hero_name}</span>
                                              <span className="mt-0.5 flex items-center gap-1 text-zinc-400">
                                                {pickRarityIcon ? (
                                                  <img
                                                    src={`/api/shared-icons/rarity?name=${encodeURIComponent(pickRarityIcon)}`}
                                                    alt={`${pickMeta?.rarity || "Rarity"} icon`}
                                                    className="h-3 w-3 rounded-sm"
                                                  />
                                                ) : null}
                                                <span>{rarityStarsText(pickMeta?.rarity || null)}</span>
                                                {pickWeaponIcon ? (
                                                  <img
                                                    src={`/api/shared-icons/weapon_type?name=${encodeURIComponent(pickWeaponIcon)}`}
                                                    alt={`${pickMeta?.weapon || "Weapon"} icon`}
                                                    className="h-3 w-3 rounded-sm"
                                                  />
                                                ) : null}
                                                {pickMoveIcon ? (
                                                  <img
                                                    src={`/api/shared-icons/move?name=${encodeURIComponent(pickMoveIcon)}`}
                                                    alt={`${pickMeta?.move || "Move"} icon`}
                                                    className="h-3 w-3 rounded-sm"
                                                  />
                                                ) : null}
                                                <span>{pickMeta?.tier != null ? `T${pickMeta.tier}` : "T-"}</span>
                                              </span>
                                            </span>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </details>
                                  </>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <input
                      name="description"
                      defaultValue={team.description ?? ""}
                      placeholder="Description"
                      className="mt-3 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
                    />
                    <div className="mt-3 flex gap-2">
                      <button type="submit" className="rounded border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-800">
                        Save changes
                      </button>
                      <button
                        type="submit"
                        formAction={removeUserTeam}
                        className="rounded border border-rose-800 px-2 py-1 text-xs text-rose-300 hover:bg-rose-950"
                      >
                        Delete team
                      </button>
                    </div>
                  </form>
                );
              })}
            </div>
          </div>

          <div className="mt-8 border-t border-zinc-800 pt-5">
            <h3 className="text-lg font-semibold">Notes</h3>
            <p className="mt-1 text-xs text-zinc-400">Notes are account-bound and synced online for this login.</p>

            <form action={createUserNote} className="mt-3 grid gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
              <input type="hidden" name="redirect_to" value="/barracks" readOnly />
              <input
                name="title"
                placeholder="New note title"
                required
                className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
              />
              <textarea
                name="content"
                placeholder="Write notes about builds / plans"
                rows={3}
                className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
              />
              <input
                name="hero_slug"
                placeholder="Optional hero slug link (e.g. alear___gifted_dragons)"
                list="barracks-slug-suggestions"
                className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
              />
              <button
                type="submit"
                className="w-fit rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800"
              >
                Save note
              </button>
            </form>

            <div className="mt-3 space-y-2">
              {!notes?.length ? (
                <p className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-sm text-zinc-300">
                  No notes yet. Add your first note above.
                </p>
              ) : null}
              {(notes || []).map((note) => (
                <form key={note.id} action={updateUserNote} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                  <input type="hidden" name="id" value={note.id} readOnly />
                  <input type="hidden" name="redirect_to" value="/barracks" readOnly />
                  <input
                    name="title"
                    defaultValue={note.title}
                    required
                    className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
                  />
                  <textarea
                    name="content"
                    defaultValue={note.content ?? ""}
                    rows={3}
                    className="mt-2 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
                  />
                  <div className="mt-2 flex gap-2">
                    <button type="submit" className="rounded border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-800">
                      Save
                    </button>
                    <button
                      type="submit"
                      formAction={removeUserNote}
                      className="rounded border border-rose-800 px-2 py-1 text-xs text-rose-300 hover:bg-rose-950"
                    >
                      Delete
                    </button>
                  </div>
                  <p className="mt-2 text-[11px] text-zinc-500">
                    {note.hero_slug ? (
                      <>
                        Hero: <Link href={`/heroes/${note.hero_slug}`} className="text-zinc-400 hover:text-zinc-200">{note.hero_slug}</Link>
                        {" • "}
                      </>
                    ) : null}
                    Updated: {note.updated_at ? new Date(note.updated_at).toLocaleString() : "-"}
                  </p>
                </form>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
