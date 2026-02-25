import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import {
  TavernClient,
  type TavernParticipant,
  type UserStats,
  type FriendRow,
  type LeaderEntry,
  type PendingRequest,
} from "@/components/tavern-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function loadUserStats(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<UserStats> {
  const [barracksRes, favRes, teamsRes] = await Promise.all([
    supabase.from("user_barracks").select("hero_slug").eq("user_id", userId),
    supabase.from("user_favorites").select("hero_slug").eq("user_id", userId),
    supabase.from("user_teams").select("id").eq("user_id", userId),
  ]);

  const heroSlugs = (barracksRes.data ?? []).map((r) => r.hero_slug);
  const favRows   = favRes.data   ?? [];
  const teamRows  = teamsRes.data ?? [];

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

      const rarity = (meta.rarity ?? "").toLowerCase();
      if (rarity.includes("5")) fiveStarHeroes++;
    }
  }

  return {
    totalHeroes:   heroSlugs.length,
    fiveStarHeroes,
    redHeroes,
    favoritesCount: favRows.length,
    teamsCount:     teamRows.length,
  };
}

function pickRandom<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function TavernPage() {
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

  // ── Own profile ──────────────────────────────────────────────────────────
  const { data: myProfile } = await supabase
    .from("profiles")
    .select("display_name, avatar_hero_slug")
    .eq("id", user.id)
    .maybeSingle();

  const myDisplayName = myProfile?.display_name || user.email?.split("@")[0] || "Summoner";
  const myAvatarSlug: string | null = myProfile?.avatar_hero_slug ?? null;

  // ── Own stats ────────────────────────────────────────────────────────────
  const myStats = await loadUserStats(supabase, user.id);

  // ── Own barracks (avatar picker) ─────────────────────────────────────────
  const { data: myBarracksRaw } = await supabase
    .from("user_barracks")
    .select("hero_slug, hero_name")
    .eq("user_id", user.id)
    .order("hero_name", { ascending: true })
    .limit(500);
  const myBarracks = myBarracksRaw ?? [];

  // ── Accepted friends ─────────────────────────────────────────────────────
  const { data: friendshipsRaw } = await supabase
    .from("user_friendships")
    .select("id, requester_id, addressee_id, status")
    .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
    .eq("status", "accepted");

  const acceptedFriendships = friendshipsRaw ?? [];
  const friendUserIds = acceptedFriendships.map((f) =>
    f.requester_id === user.id ? f.addressee_id : f.requester_id
  );

  // ── Pending incoming requests ────────────────────────────────────────────
  const { data: pendingRaw } = await supabase
    .from("user_friendships")
    .select("id, requester_id")
    .eq("addressee_id", user.id)
    .eq("status", "pending");
  const pendingRawRows = pendingRaw ?? [];

  // ── Friend profiles + stats ──────────────────────────────────────────────
  const friends: FriendRow[] = [];

  if (friendUserIds.length > 0) {
    const { data: friendProfiles } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_hero_slug")
      .in("id", friendUserIds);

    const profileMap = new Map((friendProfiles ?? []).map((p) => [p.id, p]));

    for (const friendship of acceptedFriendships) {
      const friendId =
        friendship.requester_id === user.id
          ? friendship.addressee_id
          : friendship.requester_id;
      const profile = profileMap.get(friendId);
      const stats   = await loadUserStats(supabase, friendId);
      friends.push({
        friendshipId:  friendship.id,
        userId:        friendId,
        displayName:   profile?.display_name || "Summoner",
        avatarHeroSlug: profile?.avatar_hero_slug ?? null,
        stats,
      });
    }
  }

  // ── Stage participants: me + up to 2 random friends ──────────────────────
  const stageFriends = pickRandom(friends, 2);
  const stageParticipants: TavernParticipant[] = [
    {
      userId:        user.id,
      displayName:   myDisplayName,
      avatarHeroSlug: myAvatarSlug,
      isMe:          true,
      totalHeroes:   myStats.totalHeroes,
      fiveStarHeroes: myStats.fiveStarHeroes,
      favoritesCount: myStats.favoritesCount,
      teamsCount:    myStats.teamsCount,
    },
    ...stageFriends.map((f) => ({
      userId:        f.userId,
      displayName:   f.displayName,
      avatarHeroSlug: f.avatarHeroSlug,
      isMe:          false,
      totalHeroes:   f.stats.totalHeroes,
      fiveStarHeroes: f.stats.fiveStarHeroes,
      favoritesCount: f.stats.favoritesCount,
      teamsCount:    f.stats.teamsCount,
    })),
  ];

  // ── Leaderboard ──────────────────────────────────────────────────────────
  type AllPlayer = { displayName: string; avatarSlug: string | null; stats: UserStats };
  const allPlayers: AllPlayer[] = [
    { displayName: myDisplayName, avatarSlug: myAvatarSlug, stats: myStats },
    ...friends.map((f) => ({
      displayName: f.displayName,
      avatarSlug:  f.avatarHeroSlug,
      stats:       f.stats,
    })),
  ];

  function buildLeaderboard(key: keyof UserStats): LeaderEntry[] {
    return [...allPlayers]
      .sort((a, b) => b.stats[key] - a.stats[key])
      .map((p) => ({ displayName: p.displayName, avatarSlug: p.avatarSlug, score: p.stats[key] }));
  }

  // ── Pending requester names ───────────────────────────────────────────────
  const requesterIds = pendingRawRows.map((r) => r.requester_id);
  let requesterProfiles: Array<{ id: string; display_name: string | null }> = [];
  if (requesterIds.length > 0) {
    const { data } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", requesterIds);
    requesterProfiles = data ?? [];
  }
  const requesterMap = new Map(requesterProfiles.map((p) => [p.id, p.display_name || "Summoner"]));

  const pendingRequests: PendingRequest[] = pendingRawRows.map((req) => ({
    id:            req.id,
    requesterId:   req.requester_id,
    requesterName: requesterMap.get(req.requester_id) || "Unknown Summoner",
  }));

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <TavernClient
      participants={stageParticipants}
      myDisplayName={myDisplayName}
      myAvatarSlug={myAvatarSlug}
      myBarracks={myBarracks}
      friends={friends}
      pendingRequests={pendingRequests}
      leaderboard={{
        total:     buildLeaderboard("totalHeroes"),
        fiveStar:  buildLeaderboard("fiveStarHeroes"),
        red:       buildLeaderboard("redHeroes"),
        favorites: buildLeaderboard("favoritesCount"),
      }}
    />
  );
}
