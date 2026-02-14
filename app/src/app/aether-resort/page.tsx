import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { AetherResortClient } from "@/components/aether-resort-client";

type ResortHeroOption = {
  hero_slug: string;
  hero_name: string;
  source: "barracks" | "favorite" | "both";
};

const BACKGROUNDS = [
  "Map_K1001.webp",
  "Map_K1002.webp",
  "Map_K1003.webp",
  "Map_K1004.webp",
  "Map_K1005.webp",
  "Map_K1006.webp",
  "Map_K1007.webp",
];

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AetherResortPage() {
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

  const [{ data: barracks }, { data: favorites }] = await Promise.all([
    supabase
      .from("user_barracks")
      .select("hero_slug,hero_name")
      .eq("user_id", user.id)
      .order("hero_name", { ascending: true }),
    supabase
      .from("user_favorites")
      .select("hero_slug, heroes(name)")
      .eq("user_id", user.id),
  ]);

  const map = new Map<string, ResortHeroOption>();

  for (const row of barracks || []) {
    if (!row.hero_slug) continue;
    map.set(row.hero_slug, {
      hero_slug: row.hero_slug,
      hero_name: row.hero_name || row.hero_slug,
      source: "barracks",
    });
  }

  for (const row of favorites || []) {
    if (!row.hero_slug) continue;
    const existing = map.get(row.hero_slug);
    const favoriteName = (row as { heroes?: { name?: string } | null }).heroes?.name || row.hero_slug;

    if (existing) {
      map.set(row.hero_slug, {
        ...existing,
        source: "both",
      });
      continue;
    }

    map.set(row.hero_slug, {
      hero_slug: row.hero_slug,
      hero_name: favoriteName,
      source: "favorite",
    });
  }

  const options = Array.from(map.values()).sort((a, b) => a.hero_name.localeCompare(b.hero_name));

  let savedSlots: string[] = [];
  let savedBackgroundName = BACKGROUNDS[0];
  if (options.length) {
    const { data: pref, error: prefError } = await supabase
      .from("user_aether_resort_preferences")
      .select("slots,background_name")
      .eq("user_id", user.id)
      .maybeSingle();

    const code = prefError?.code || "";
    const msg = (prefError?.message || "").toLowerCase();
    const hasTable = !prefError || !(code === "42P01" || code === "PGRST205" || msg.includes("user_aether_resort_preferences"));

    if (hasTable && pref) {
      if (Array.isArray(pref.slots)) {
        savedSlots = pref.slots.filter((v): v is string => typeof v === "string");
      }
      if (typeof pref.background_name === "string" && BACKGROUNDS.includes(pref.background_name)) {
        savedBackgroundName = pref.background_name;
      }
    }
  }

  const allowed = new Set(options.map((o) => o.hero_slug));
  const initialSlots = (savedSlots.length ? savedSlots : options.slice(0, 4).map((h) => h.hero_slug))
    .slice(0, 4)
    .map((slug) => (allowed.has(slug) ? slug : ""));
  while (initialSlots.length < 4) initialSlots.push("");

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-100">
      <main className="mx-auto w-full max-w-6xl rounded-2xl border border-zinc-800 bg-zinc-900 p-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Aether Resort</h1>
            <p className="text-sm text-zinc-300">Replica prototype with roaming Game8 mini sprites.</p>
          </div>

          <div className="flex gap-2">
            <Link
              href="/barracks"
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800"
            >
              Back to barracks
            </Link>
            <Link
              href="/heroes"
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800"
            >
              Hero browser
            </Link>
          </div>
        </header>

        {!options.length ? (
          <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950 p-5 text-sm text-zinc-300">
            No heroes available yet. Add heroes to your barracks or favorites first, then come back.
          </section>
        ) : (
          <AetherResortClient
            options={options}
            initialSlots={initialSlots}
            initialBackgroundName={savedBackgroundName}
          />
        )}
      </main>
    </div>
  );
}
