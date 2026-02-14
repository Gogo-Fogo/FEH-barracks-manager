import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthSignOutButton } from "@/components/auth-signout-button";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/client";
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

  const [{ data: heroes }, { data: barracks }, { data: favorites }, { data: notes }, { data: teams }] = await Promise.all([
    supabase
      .from("heroes")
      .select("hero_slug,name,weapon,move,tier")
      .order("name", { ascending: true })
      .limit(400),
    supabase
      .from("user_barracks")
      .select("id,hero_slug,hero_name,merges,notes,updated_at")
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

  const favoriteSet = new Set((favorites || []).map((f) => f.hero_slug));
  const barracksSlugOptions = (barracks || []).map((b) => ({ hero_slug: b.hero_slug, hero_name: b.hero_name }));

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
            <Link
              href="/heroes"
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800"
            >
              Open hero browser
            </Link>
          </div>

          {!heroes?.length ? (
            <p className="mt-3 text-sm text-zinc-300">
              No heroes found in database yet. Run the import script first.
            </p>
          ) : (
            <form action={addToBarracks} className="mt-4 flex flex-wrap items-end gap-3">
              <input type="hidden" name="redirect_to" value="/barracks" readOnly />
              <div className="min-w-72 flex-1">
                <label htmlFor="hero_slug" className="mb-1 block text-sm text-zinc-300">
                  Hero
                </label>
                <select
                  id="hero_slug"
                  name="hero_slug"
                  defaultValue={heroes[0]?.hero_slug ?? ""}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100"
                >
                  {heroes.map((hero) => (
                    <option key={hero.hero_slug} value={hero.hero_slug}>
                      {hero.name}
                      {hero.weapon ? ` • ${hero.weapon}` : ""}
                      {hero.move ? ` • ${hero.move}` : ""}
                      {hero.tier != null ? ` • T${hero.tier}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="submit"
                className="rounded-lg bg-indigo-500 px-4 py-2 font-medium text-white hover:bg-indigo-400"
              >
                Add
              </button>
            </form>
          )}

          <div className="mt-6 border-t border-zinc-800 pt-5">
            <h3 className="text-lg font-semibold">My entries</h3>

            {!barracks?.length ? (
              <p className="mt-3 text-sm text-zinc-300">No heroes in your barracks yet.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {barracks.map((entry) => (
                  <form
                    key={entry.id}
                    action={updateBarracksEntry}
                    className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3"
                  >
                    <input type="hidden" name="id" value={entry.id} readOnly />
                    <input type="hidden" name="redirect_to" value="/barracks" readOnly />
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <img
                          src={`/api/headshots/${entry.hero_slug}`}
                          alt={`${entry.hero_name} headshot`}
                          className="h-8 w-8 rounded-full border border-zinc-700 object-cover"
                          loading="lazy"
                        />
                        <Link href={`/heroes/${entry.hero_slug}`} className="font-medium hover:text-indigo-300">
                          {entry.hero_name}
                        </Link>
                      </div>
                      <button
                        type="submit"
                        formAction={removeBarracksEntry}
                        className="rounded-md border border-rose-800 px-2 py-1 text-xs text-rose-300 hover:bg-rose-950"
                      >
                        Remove
                      </button>
                    </div>

                    <div className="mt-3 grid gap-3 md:grid-cols-[120px_1fr_auto]">
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
              <p className="mt-2 text-sm text-zinc-300">No favorites yet. Use ☆ Favorite in Hero Browser.</p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                {(heroes || [])
                  .filter((h) => favoriteSet.has(h.hero_slug))
                  .map((h) => (
                    <form key={h.hero_slug} action={toggleFavorite}>
                      <input type="hidden" name="hero_slug" value={h.hero_slug} readOnly />
                      <input type="hidden" name="redirect_to" value="/barracks" readOnly />
                      <button
                        type="submit"
                        className="rounded-full border border-amber-700 px-3 py-1 text-xs text-amber-300 hover:bg-amber-950"
                      >
                        <img
                          src={`/api/headshots/${h.hero_slug}`}
                          alt={`${h.name} headshot`}
                          className="mr-2 inline h-5 w-5 rounded-full border border-zinc-700 object-cover align-middle"
                          loading="lazy"
                        />
                        ★ {h.name}
                      </button>
                    </form>
                  ))}

                {(favorites || [])
                  .filter((f) => !(heroes || []).some((h) => h.hero_slug === f.hero_slug))
                  .map((f) => (
                    <form key={f.hero_slug} action={toggleFavorite}>
                      <input type="hidden" name="hero_slug" value={f.hero_slug} readOnly />
                      <input type="hidden" name="redirect_to" value="/barracks" readOnly />
                      <button
                        type="submit"
                        className="rounded-full border border-amber-700 px-3 py-1 text-xs text-amber-300 hover:bg-amber-950"
                      >
                        <img
                          src={`/api/headshots/${f.hero_slug}`}
                          alt={`${(f as { heroes?: { name?: string } | null }).heroes?.name || f.hero_slug} headshot`}
                          className="mr-2 inline h-5 w-5 rounded-full border border-zinc-700 object-cover align-middle"
                          loading="lazy"
                        />
                        ★ {(f as { heroes?: { name?: string } | null }).heroes?.name || f.hero_slug}
                      </button>
                    </form>
                  ))}
              </div>
            )}
          </div>

          <div className="mt-8 border-t border-zinc-800 pt-5">
            <h3 className="text-lg font-semibold">Notes</h3>

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
              <button
                type="submit"
                className="w-fit rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800"
              >
                Save note
              </button>
            </form>

            <div className="mt-3 space-y-2">
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
                </form>
              ))}
            </div>
          </div>

          <div className="mt-8 border-t border-zinc-800 pt-5">
            <h3 className="text-lg font-semibold">Team Builder</h3>
            <p className="mt-1 text-xs text-zinc-400">
              Type hero slugs with suggestions from your barracks (or paste comma list).
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
              <input
                name="slots_text"
                placeholder="hero_slug_1, hero_slug_2, hero_slug_3, hero_slug_4"
                className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
              />
              <div className="grid gap-2 md:grid-cols-2">
                <input
                  name="slot_1"
                  placeholder="Slot 1 hero slug"
                  list="barracks-slug-suggestions"
                  className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
                />
                <input
                  name="slot_2"
                  placeholder="Slot 2 hero slug"
                  list="barracks-slug-suggestions"
                  className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
                />
                <input
                  name="slot_3"
                  placeholder="Slot 3 hero slug"
                  list="barracks-slug-suggestions"
                  className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
                />
                <input
                  name="slot_4"
                  placeholder="Slot 4 hero slug"
                  list="barracks-slug-suggestions"
                  className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
                />
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

            <div className="mt-3 space-y-2">
              {(teams || []).map((team) => (
                <form key={team.id} action={updateUserTeam} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                  <input type="hidden" name="id" value={team.id} readOnly />
                  <input type="hidden" name="redirect_to" value="/barracks" readOnly />
                  <input
                    name="name"
                    defaultValue={team.name}
                    required
                    className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
                  />
                  <input
                    name="slots_text"
                    defaultValue={Array.isArray(team.slots) ? team.slots.join(", ") : ""}
                    className="mt-2 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
                  />
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    <input
                      name="slot_1"
                      defaultValue={Array.isArray(team.slots) ? (team.slots[0] as string) || "" : ""}
                      placeholder="Slot 1 hero slug"
                      list="barracks-slug-suggestions"
                      className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
                    />
                    <input
                      name="slot_2"
                      defaultValue={Array.isArray(team.slots) ? (team.slots[1] as string) || "" : ""}
                      placeholder="Slot 2 hero slug"
                      list="barracks-slug-suggestions"
                      className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
                    />
                    <input
                      name="slot_3"
                      defaultValue={Array.isArray(team.slots) ? (team.slots[2] as string) || "" : ""}
                      placeholder="Slot 3 hero slug"
                      list="barracks-slug-suggestions"
                      className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
                    />
                    <input
                      name="slot_4"
                      defaultValue={Array.isArray(team.slots) ? (team.slots[3] as string) || "" : ""}
                      placeholder="Slot 4 hero slug"
                      list="barracks-slug-suggestions"
                      className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
                    />
                  </div>
                  <input
                    name="description"
                    defaultValue={team.description ?? ""}
                    className="mt-2 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
                  />
                  <div className="mt-2 flex gap-2">
                    <button type="submit" className="rounded border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-800">
                      Save
                    </button>
                    <button
                      type="submit"
                      formAction={removeUserTeam}
                      className="rounded border border-rose-800 px-2 py-1 text-xs text-rose-300 hover:bg-rose-950"
                    >
                      Delete
                    </button>
                  </div>
                </form>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
