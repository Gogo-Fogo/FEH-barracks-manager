import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { TavernStageClient, TavernParticipant } from "@/components/tavern-stage-client";
import {
  updateDisplayName,
  setAvatarHero,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  removeFriend,
  searchUsers,
} from "./actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ─── Types ────────────────────────────────────────────────────────────────────

type TavernPageProps = {
  searchParams: Promise<{ notice?: string; tone?: string; friend_search?: string }>;
};

type UserStats = {
  totalHeroes: number;
  fiveStarHeroes: number;
  redHeroes: number;
  favoritesCount: number;
  teamsCount: number;
};

type FriendRow = {
  friendshipId: string;
  userId: string;
  displayName: string;
  avatarHeroSlug: string | null;
  stats: UserStats;
};

// ─── Stat helpers ─────────────────────────────────────────────────────────────

async function loadUserStats(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<UserStats> {
  const [barracksRes, favRes, teamsRes] = await Promise.all([
    supabase
      .from("user_barracks")
      .select("hero_slug, hero_name")
      .eq("user_id", userId),
    supabase
      .from("user_favorites")
      .select("hero_slug")
      .eq("user_id", userId),
    supabase
      .from("user_teams")
      .select("id")
      .eq("user_id", userId),
  ]);

  const barracksRows = barracksRes.data ?? [];
  const favRows = favRes.data ?? [];
  const teamRows = teamsRes.data ?? [];

  // We also need hero weapon data to count reds — join with heroes table
  const heroSlugs = barracksRows.map((r) => r.hero_slug);

  let redHeroes = 0;
  let fiveStarHeroes = 0;

  if (heroSlugs.length > 0) {
    const { data: heroMeta } = await supabase
      .from("heroes")
      .select("hero_slug, weapon, rarity")
      .in("hero_slug", heroSlugs);

    const metaMap = new Map((heroMeta ?? []).map((h) => [h.hero_slug, h]));
    for (const slug of heroSlugs) {
      const meta = metaMap.get(slug);
      if (!meta) continue;
      // Red weapons: Sword, Red Tome, Red Dagger, Red Bow, Red Beast, Dragonstone (Red)
      const weapon = (meta.weapon ?? "").toLowerCase();
      if (
        weapon === "sword" ||
        weapon === "red tome" ||
        weapon === "red dagger" ||
        weapon === "red bow" ||
        weapon === "red beast" ||
        weapon === "dragonstone" ||
        weapon.startsWith("red")
      ) {
        redHeroes++;
      }
      // 5★ rarity check
      const rarity = (meta.rarity ?? "").toLowerCase();
      if (rarity.includes("5")) {
        fiveStarHeroes++;
      }
    }
  }

  return {
    totalHeroes: barracksRows.length,
    fiveStarHeroes,
    redHeroes,
    favoritesCount: favRows.length,
    teamsCount: teamRows.length,
  };
}

// Server-side Fisher-Yates shuffle for picking random friends to show on stage
function pickRandom<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function TavernPage({ searchParams }: TavernPageProps) {
  if (!isSupabaseConfigured()) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400">
        Supabase is not configured.
      </div>
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { notice, tone, friend_search } = await searchParams;

  // ── Own profile ─────────────────────────────────────────────────────────────
  const { data: myProfile } = await supabase
    .from("profiles")
    .select("display_name, avatar_hero_slug")
    .eq("id", user.id)
    .maybeSingle();

  const myDisplayName = myProfile?.display_name || user.email?.split("@")[0] || "Summoner";
  const myAvatarSlug: string | null = myProfile?.avatar_hero_slug ?? null;

  // ── Own stats ───────────────────────────────────────────────────────────────
  const myStats = await loadUserStats(supabase, user.id);

  // ── Own barracks (for avatar picker) ────────────────────────────────────────
  const { data: myBarracksRaw } = await supabase
    .from("user_barracks")
    .select("hero_slug, hero_name")
    .eq("user_id", user.id)
    .order("hero_name", { ascending: true })
    .limit(500);
  const myBarracks = myBarracksRaw ?? [];

  // ── Accepted friends ────────────────────────────────────────────────────────
  const { data: friendshipsRaw } = await supabase
    .from("user_friendships")
    .select("id, requester_id, addressee_id, status")
    .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
    .eq("status", "accepted");

  const acceptedFriendships = friendshipsRaw ?? [];
  const friendUserIds = acceptedFriendships.map((f) =>
    f.requester_id === user.id ? f.addressee_id : f.requester_id
  );

  // ── Pending incoming requests ───────────────────────────────────────────────
  const { data: pendingRaw } = await supabase
    .from("user_friendships")
    .select("id, requester_id, status")
    .eq("addressee_id", user.id)
    .eq("status", "pending");
  const pendingRequests = pendingRaw ?? [];

  // ── Fetch friend profiles ───────────────────────────────────────────────────
  let friends: FriendRow[] = [];

  if (friendUserIds.length > 0) {
    const { data: friendProfiles } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_hero_slug")
      .in("id", friendUserIds);

    const profileMap = new Map((friendProfiles ?? []).map((p) => [p.id, p]));

    // Load stats for each friend (sequential to avoid blasting too many requests)
    for (const friendship of acceptedFriendships) {
      const friendId = friendship.requester_id === user.id ? friendship.addressee_id : friendship.requester_id;
      const profile = profileMap.get(friendId);
      const stats = await loadUserStats(supabase, friendId);
      friends.push({
        friendshipId: friendship.id,
        userId: friendId,
        displayName: profile?.display_name || "Summoner",
        avatarHeroSlug: profile?.avatar_hero_slug ?? null,
        stats,
      });
    }
  }

  // ── Stage participants: me + up to 2 random friends ─────────────────────────
  const stageFriends = pickRandom(friends, 2);
  const stageParticipants: TavernParticipant[] = [
    {
      userId: user.id,
      displayName: myDisplayName,
      avatarHeroSlug: myAvatarSlug,
      isMe: true,
      totalHeroes: myStats.totalHeroes,
      fiveStarHeroes: myStats.fiveStarHeroes,
      favoritesCount: myStats.favoritesCount,
      teamsCount: myStats.teamsCount,
    },
    ...stageFriends.map((f) => ({
      userId: f.userId,
      displayName: f.displayName,
      avatarHeroSlug: f.avatarHeroSlug,
      isMe: false,
      totalHeroes: f.stats.totalHeroes,
      fiveStarHeroes: f.stats.fiveStarHeroes,
      favoritesCount: f.stats.favoritesCount,
      teamsCount: f.stats.teamsCount,
    })),
  ];

  // ── Leaderboard ──────────────────────────────────────────────────────────────
  type LeaderEntry = { displayName: string; avatarSlug: string | null; score: number };
  const allPlayers = [
    { displayName: myDisplayName, avatarSlug: myAvatarSlug, stats: myStats },
    ...friends.map((f) => ({ displayName: f.displayName, avatarSlug: f.avatarHeroSlug, stats: f.stats })),
  ];

  function buildLeaderboard(key: keyof UserStats): LeaderEntry[] {
    return [...allPlayers]
      .sort((a, b) => b.stats[key] - a.stats[key])
      .map((p) => ({ displayName: p.displayName, avatarSlug: p.avatarSlug, score: p.stats[key] }));
  }

  const lbTotal = buildLeaderboard("totalHeroes");
  const lbFiveStar = buildLeaderboard("fiveStarHeroes");
  const lbRed = buildLeaderboard("redHeroes");
  const lbFavorites = buildLeaderboard("favoritesCount");

  // ── Pending request requester display names ──────────────────────────────────
  const requesterIds = pendingRequests.map((r) => r.requester_id);
  let requesterProfiles: Array<{ id: string; display_name: string | null }> = [];
  if (requesterIds.length > 0) {
    const { data } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", requesterIds);
    requesterProfiles = data ?? [];
  }
  const requesterMap = new Map(requesterProfiles.map((p) => [p.id, p.display_name || "Summoner"]));

  // ── Friend search ────────────────────────────────────────────────────────────
  let searchResults: Array<{ id: string; display_name: string | null }> = [];
  if (friend_search) {
    const alreadyIds = new Set([user.id, ...friendUserIds]);
    const pendingIds = new Set(pendingRequests.map((r) => r.requester_id));
    const { data: results } = await supabase
      .from("profiles")
      .select("id, display_name")
      .ilike("display_name", `%${friend_search}%`)
      .limit(20);

    searchResults = (results ?? []).filter(
      (r) => !alreadyIds.has(r.id) && !pendingIds.has(r.id)
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-100">
      <main className="mx-auto w-full max-w-4xl space-y-8">

        {/* ── Top nav ── */}
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-amber-200">🍺 The Tavern</h1>
            <p className="text-sm text-zinc-400">Gather round, summoners</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {pendingRequests.length > 0 && (
              <span className="flex items-center gap-1 rounded-full border border-amber-600/50 bg-amber-950/50 px-3 py-1 text-sm text-amber-300">
                🔔 {pendingRequests.length} friend {pendingRequests.length === 1 ? "request" : "requests"}
              </span>
            )}
            <Link
              href="/barracks"
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
            >
              ← Back to Barracks
            </Link>
          </div>
        </header>

        {/* ── Notice ── */}
        {notice && (
          <p
            className={`rounded-lg border p-3 text-sm ${
              tone === "warn"
                ? "border-amber-800 bg-amber-950/40 text-amber-200"
                : "border-emerald-800 bg-emerald-950/40 text-emerald-200"
            }`}
          >
            {notice}
          </p>
        )}

        {/* ── Tavern Stage ── */}
        <section className="overflow-hidden rounded-xl border border-amber-900/40 shadow-[0_0_40px_rgba(180,120,40,0.15)]">
          <TavernStageClient participants={stageParticipants} />
          {friends.length === 0 && (
            <p className="bg-zinc-900/80 px-4 py-2 text-center text-xs text-zinc-500">
              Add friends to fill the tavern with more heroes!
            </p>
          )}
        </section>

        {/* ── Leaderboard ── */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
          <h2 className="mb-4 text-lg font-semibold text-amber-200">🏆 Leaderboard</h2>
          {allPlayers.length < 2 ? (
            <p className="text-sm text-zinc-500">Add friends to start comparing collections!</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(
                [
                  { label: "Most Heroes", entries: lbTotal, icon: "⚔", color: "text-zinc-100" },
                  { label: "Most 5★", entries: lbFiveStar, icon: "★", color: "text-amber-300" },
                  { label: "Most Red Heroes", entries: lbRed, icon: "🔴", color: "text-red-300" },
                  { label: "Most Favorites", entries: lbFavorites, icon: "❤", color: "text-rose-300" },
                ] as const
              ).map(({ label, entries, icon, color }) => {
                const winner = entries[0];
                return (
                  <div
                    key={label}
                    className="flex flex-col items-center gap-2 rounded-lg border border-zinc-700/50 bg-zinc-800/60 p-3 text-center"
                  >
                    <div className="text-xs font-medium text-zinc-400">{label}</div>
                    {winner.avatarSlug ? (
                      <img
                        src={`/api/headshots/${winner.avatarSlug}`}
                        alt={winner.displayName}
                        className="h-12 w-12 rounded-full border-2 border-amber-600/40 object-cover"
                      />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-zinc-600 bg-zinc-700 text-xl">
                        ?
                      </div>
                    )}
                    <div className="text-xs font-medium text-zinc-200">{winner.displayName}</div>
                    <div className={`text-lg font-bold ${color}`}>
                      {icon} {winner.score}
                    </div>
                    {/* Runner-ups */}
                    {entries.slice(1).map((e, i) => (
                      <div key={i} className="text-xs text-zinc-500">
                        {e.displayName}: {e.score}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── My Profile ── */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
          <h2 className="mb-4 text-lg font-semibold">👤 My Profile</h2>
          <div className="flex flex-wrap gap-8">
            {/* Display name */}
            <div className="min-w-[200px] flex-1">
              <p className="mb-2 text-sm text-zinc-400">Display name shown to friends</p>
              <form action={updateDisplayName} className="flex gap-2">
                <input
                  type="text"
                  name="display_name"
                  defaultValue={myDisplayName}
                  maxLength={32}
                  placeholder="Your tavern name"
                  className="flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-amber-500 focus:outline-none"
                />
                <button
                  type="submit"
                  className="rounded-md border border-amber-700 bg-amber-900/30 px-3 py-1.5 text-sm text-amber-200 hover:bg-amber-900/60"
                >
                  Save
                </button>
              </form>
            </div>

            {/* Avatar hero picker */}
            <div className="min-w-[200px] flex-1">
              <p className="mb-2 text-sm text-zinc-400">Avatar hero (shown on the stage)</p>
              <div className="flex items-center gap-3">
                {myAvatarSlug ? (
                  <img
                    src={`/api/headshots/${myAvatarSlug}`}
                    alt="Your avatar"
                    className="h-12 w-12 rounded-full border-2 border-amber-600/50 object-cover"
                  />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-zinc-600 bg-zinc-800 text-xl text-zinc-500">
                    ?
                  </div>
                )}
                {myBarracks.length > 0 ? (
                  <form action={setAvatarHero} className="flex flex-1 gap-2">
                    <select
                      name="hero_slug"
                      defaultValue={myAvatarSlug ?? ""}
                      className="flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
                    >
                      <option value="" disabled>Pick a hero…</option>
                      {myBarracks.map((h) => (
                        <option key={h.hero_slug} value={h.hero_slug}>
                          {h.hero_name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      className="rounded-md border border-amber-700 bg-amber-900/30 px-3 py-1.5 text-sm text-amber-200 hover:bg-amber-900/60"
                    >
                      Set
                    </button>
                  </form>
                ) : (
                  <p className="text-sm text-zinc-500">Add heroes to your barracks first.</p>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ── Incoming friend requests ── */}
        {pendingRequests.length > 0 && (
          <section className="rounded-xl border border-amber-800/40 bg-zinc-900 p-6">
            <h2 className="mb-4 text-lg font-semibold text-amber-200">🔔 Friend Requests</h2>
            <ul className="space-y-2">
              {pendingRequests.map((req) => (
                <li
                  key={req.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-zinc-700/50 bg-zinc-800/50 px-4 py-2"
                >
                  <span className="text-sm text-zinc-200">
                    {requesterMap.get(req.requester_id) || "Unknown Summoner"}
                  </span>
                  <div className="flex gap-2">
                    <form action={acceptFriendRequest}>
                      <input type="hidden" name="friendship_id" value={req.id} />
                      <button
                        type="submit"
                        className="rounded-md border border-emerald-700 bg-emerald-900/30 px-3 py-1 text-xs text-emerald-300 hover:bg-emerald-900/60"
                      >
                        Accept
                      </button>
                    </form>
                    <form action={declineFriendRequest}>
                      <input type="hidden" name="friendship_id" value={req.id} />
                      <button
                        type="submit"
                        className="rounded-md border border-zinc-600 px-3 py-1 text-xs text-zinc-400 hover:bg-zinc-700"
                      >
                        Decline
                      </button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── My friends ── */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
          <h2 className="mb-4 text-lg font-semibold">🧑‍🤝‍🧑 My Friends</h2>
          {friends.length === 0 ? (
            <p className="text-sm text-zinc-500">No friends yet. Search below to add some!</p>
          ) : (
            <ul className="space-y-2">
              {friends.map((f) => (
                <li
                  key={f.friendshipId}
                  className="flex items-center justify-between gap-3 rounded-lg border border-zinc-700/50 bg-zinc-800/40 px-4 py-2"
                >
                  <div className="flex items-center gap-3">
                    {f.avatarHeroSlug ? (
                      <img
                        src={`/api/headshots/${f.avatarHeroSlug}`}
                        alt={f.displayName}
                        className="h-9 w-9 rounded-full border border-zinc-600 object-cover"
                      />
                    ) : (
                      <div className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-600 bg-zinc-700 text-sm text-zinc-500">
                        ?
                      </div>
                    )}
                    <div>
                      <div className="text-sm font-medium text-zinc-200">{f.displayName}</div>
                      <div className="text-xs text-zinc-500">
                        {f.stats.totalHeroes} heroes · {f.stats.fiveStarHeroes} at 5★
                      </div>
                    </div>
                  </div>
                  <form action={removeFriend}>
                    <input type="hidden" name="friendship_id" value={f.friendshipId} />
                    <button
                      type="submit"
                      className="rounded-md border border-zinc-700 px-3 py-1 text-xs text-zinc-500 hover:border-red-800 hover:text-red-400"
                    >
                      Remove
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Add friend ── */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
          <h2 className="mb-4 text-lg font-semibold">➕ Add a Friend</h2>
          <form action={searchUsers} className="flex gap-2">
            <input
              type="text"
              name="q"
              defaultValue={friend_search ?? ""}
              placeholder="Search by display name…"
              className="flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-amber-500 focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-md border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700"
            >
              Search
            </button>
          </form>

          {friend_search && (
            <div className="mt-3">
              {searchResults.length === 0 ? (
                <p className="text-sm text-zinc-500">
                  No summoners found matching &ldquo;{friend_search}&rdquo;.
                </p>
              ) : (
                <ul className="space-y-2">
                  {searchResults.map((r) => (
                    <li
                      key={r.id}
                      className="flex items-center justify-between rounded-lg border border-zinc-700/50 bg-zinc-800/50 px-4 py-2"
                    >
                      <span className="text-sm text-zinc-200">{r.display_name || "Unnamed Summoner"}</span>
                      <form action={sendFriendRequest}>
                        <input type="hidden" name="addressee_id" value={r.id} />
                        <button
                          type="submit"
                          className="rounded-md border border-amber-700 bg-amber-900/30 px-3 py-1 text-xs text-amber-300 hover:bg-amber-900/60"
                        >
                          Send Request
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

      </main>
    </div>
  );
}
