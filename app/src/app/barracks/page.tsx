import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthSignOutButton } from "@/components/auth-signout-button";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import {
  addToBarracks,
  removeBarracksEntry,
  updateBarracksEntry,
} from "./actions";

export default async function BarracksPage() {
  if (!isSupabaseConfigured()) {
    redirect("/login");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [{ data: heroes }, { data: barracks }] = await Promise.all([
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
  ]);

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
          <h2 className="text-lg font-semibold">Add hero to barracks</h2>

          {!heroes?.length ? (
            <p className="mt-3 text-sm text-zinc-300">
              No heroes found in database yet. Run the import script first.
            </p>
          ) : (
            <form action={addToBarracks} className="mt-4 flex flex-wrap items-end gap-3">
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
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="font-medium">{entry.hero_name}</p>
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
        </section>
      </main>
    </div>
  );
}
