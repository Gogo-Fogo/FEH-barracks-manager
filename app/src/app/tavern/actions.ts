"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { ok: boolean; message: string };

// ─── Profile ────────────────────────────────────────────────────────────────

export async function updateDisplayName(displayName: string): Promise<ActionResult> {
  const name = (displayName ?? "").trim().slice(0, 32);
  if (!name) return { ok: false, message: "Display name cannot be empty." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not logged in." };

  const { error } = await supabase
    .from("profiles")
    .upsert({ id: user.id, display_name: name, updated_at: new Date().toISOString() });

  if (error) return { ok: false, message: error.message };
  revalidatePath("/tavern");
  return { ok: true, message: "Display name updated." };
}

export async function setAvatarHero(heroSlug: string): Promise<ActionResult> {
  const slug = (heroSlug ?? "").trim();
  if (!slug) return { ok: false, message: "Hero is required." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not logged in." };

  const { error } = await supabase
    .from("profiles")
    .upsert({ id: user.id, avatar_hero_slug: slug, updated_at: new Date().toISOString() });

  if (error) return { ok: false, message: error.message };
  revalidatePath("/tavern");
  return { ok: true, message: "Avatar hero updated." };
}

// ─── Friend requests ─────────────────────────────────────────────────────────

export async function sendFriendRequest(addresseeId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not logged in." };

  if (addresseeId === user.id) {
    return { ok: false, message: "You can't befriend yourself." };
  }

  const { error } = await supabase
    .from("user_friendships")
    .insert({ requester_id: user.id, addressee_id: addresseeId });

  if (error) {
    if (error.code === "23505") return { ok: false, message: "Friend request already sent." };
    return { ok: false, message: error.message };
  }

  revalidatePath("/tavern");
  return { ok: true, message: "Friend request sent!" };
}

export async function acceptFriendRequest(friendshipId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not logged in." };

  const { error } = await supabase
    .from("user_friendships")
    .update({ status: "accepted" })
    .eq("id", friendshipId)
    .eq("addressee_id", user.id);

  if (error) return { ok: false, message: error.message };
  revalidatePath("/tavern");
  return { ok: true, message: "Friend request accepted! Welcome to the tavern." };
}

export async function declineFriendRequest(friendshipId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not logged in." };

  const { error } = await supabase
    .from("user_friendships")
    .delete()
    .eq("id", friendshipId)
    .eq("addressee_id", user.id);

  if (error) return { ok: false, message: error.message };
  revalidatePath("/tavern");
  return { ok: true, message: "Friend request declined." };
}

export async function removeFriend(friendshipId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not logged in." };

  const { error } = await supabase
    .from("user_friendships")
    .delete()
    .eq("id", friendshipId);

  if (error) return { ok: false, message: error.message };
  revalidatePath("/tavern");
  return { ok: true, message: "Friend removed." };
}

// ─── Friend search ────────────────────────────────────────────────────────────

export async function searchUsersAction(
  query: string
): Promise<Array<{ id: string; displayName: string }>> {
  if (!query.trim()) return [];

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  // Exclude self and anyone already in a relationship (any status)
  const { data: existing } = await supabase
    .from("user_friendships")
    .select("requester_id, addressee_id")
    .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`);

  const excludeIds = new Set<string>([user.id]);
  for (const row of existing ?? []) {
    excludeIds.add(row.requester_id);
    excludeIds.add(row.addressee_id);
  }

  const { data: results } = await supabase
    .from("profiles")
    .select("id, display_name")
    .ilike("display_name", `%${query.trim()}%`)
    .limit(20);

  return (results ?? [])
    .filter((r) => !excludeIds.has(r.id))
    .map((r) => ({ id: r.id, displayName: r.display_name || "Summoner" }));
}

// ─── Participant profile (clicked character on stage) ─────────────────────────

export type ParticipantHero = {
  hero_slug: string;
  hero_name: string;
  tier: number | null;
  weapon: string | null;
};

export type ParticipantTeam = {
  id: string;
  name: string;
  description: string | null;
  slots: string[]; // hero slugs
};

export type ParticipantDetails = {
  heroes: ParticipantHero[];
  favorites: ParticipantHero[];
  teams: ParticipantTeam[];
};

export async function getParticipantDetails(
  targetUserId: string
): Promise<ParticipantDetails> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { heroes: [], favorites: [], teams: [] };

  const [barracksRes, favRes, teamsRes] = await Promise.all([
    supabase
      .from("user_barracks")
      .select("hero_slug, hero_name")
      .eq("user_id", targetUserId)
      .order("hero_name", { ascending: true }),
    supabase
      .from("user_favorites")
      .select("hero_slug")
      .eq("user_id", targetUserId),
    supabase
      .from("user_teams")
      .select("id, name, description, slots")
      .eq("user_id", targetUserId)
      .order("name", { ascending: true }),
  ]);

  const barracksRows = barracksRes.data ?? [];
  const favRows      = favRes.data   ?? [];
  const teamRows     = teamsRes.data ?? [];

  // Collect all slugs we need metadata for
  const allSlugs = [...new Set([
    ...barracksRows.map((r) => r.hero_slug),
    ...favRows.map((r) => r.hero_slug),
  ])];

  const heroMetaMap = new Map<string, { tier: number | null; weapon: string | null; name: string }>();
  if (allSlugs.length > 0) {
    const { data: heroMeta } = await supabase
      .from("heroes")
      .select("hero_slug, name, weapon, tier")
      .in("hero_slug", allSlugs);
    for (const h of heroMeta ?? []) {
      heroMetaMap.set(h.hero_slug, { tier: h.tier ?? null, weapon: h.weapon ?? null, name: h.name });
    }
  }

  // Also need names for team slot heroes (not necessarily in barracks)
  const teamSlugSet = new Set<string>();
  for (const t of teamRows) {
    for (const s of (Array.isArray(t.slots) ? t.slots : [])) {
      if (s && !heroMetaMap.has(s)) teamSlugSet.add(s);
    }
  }
  if (teamSlugSet.size > 0) {
    const { data: extra } = await supabase
      .from("heroes")
      .select("hero_slug, name, weapon, tier")
      .in("hero_slug", [...teamSlugSet]);
    for (const h of extra ?? []) {
      heroMetaMap.set(h.hero_slug, { tier: h.tier ?? null, weapon: h.weapon ?? null, name: h.name });
    }
  }

  const barracksNameMap = new Map(barracksRows.map((r) => [r.hero_slug, r.hero_name]));

  const heroes: ParticipantHero[] = barracksRows.map((r) => ({
    hero_slug: r.hero_slug,
    hero_name: r.hero_name,
    tier:      heroMetaMap.get(r.hero_slug)?.tier   ?? null,
    weapon:    heroMetaMap.get(r.hero_slug)?.weapon ?? null,
  }));

  const favorites: ParticipantHero[] = favRows.map((r) => ({
    hero_slug: r.hero_slug,
    hero_name: barracksNameMap.get(r.hero_slug) || heroMetaMap.get(r.hero_slug)?.name || r.hero_slug,
    tier:      heroMetaMap.get(r.hero_slug)?.tier   ?? null,
    weapon:    heroMetaMap.get(r.hero_slug)?.weapon ?? null,
  }));

  const teams: ParticipantTeam[] = teamRows.map((r) => ({
    id:          r.id,
    name:        r.name,
    description: r.description ?? null,
    slots:       Array.isArray(r.slots) ? r.slots.filter(Boolean) : [],
  }));

  return { heroes, favorites, teams };
}

// ─── Global chat ──────────────────────────────────────────────────────────────

export type TavernMessage = {
  id: string;
  userId: string;
  displayName: string;
  avatarHeroSlug: string | null;
  content: string;
  createdAt: string; // ISO
};

export async function fetchTavernMessages(): Promise<TavernMessage[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("tavern_messages")
    .select("id, user_id, display_name, avatar_hero_slug, content, created_at")
    .order("created_at", { ascending: true })
    .limit(100);

  return (data ?? []).map((r) => ({
    id:              r.id,
    userId:          r.user_id,
    displayName:     r.display_name,
    avatarHeroSlug:  r.avatar_hero_slug ?? null,
    content:         r.content,
    createdAt:       r.created_at,
  }));
}

export async function sendTavernMessage(content: string): Promise<ActionResult> {
  const text = content.trim().slice(0, 500);
  if (!text) return { ok: false, message: "Message cannot be empty." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not logged in." };

  // Fetch sender's current display name and avatar
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, avatar_hero_slug")
    .eq("id", user.id)
    .maybeSingle();

  const displayName = profile?.display_name || user.email?.split("@")[0] || "Summoner";
  const avatarHeroSlug = profile?.avatar_hero_slug ?? null;

  const { error } = await supabase.from("tavern_messages").insert({
    user_id:         user.id,
    display_name:    displayName,
    avatar_hero_slug: avatarHeroSlug,
    content:         text,
  });

  if (error) return { ok: false, message: error.message };
  return { ok: true, message: "sent" };
}

export async function deleteTavernMessage(messageId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not logged in." };

  const { error } = await supabase
    .from("tavern_messages")
    .delete()
    .eq("id", messageId)
    .eq("user_id", user.id); // RLS guard

  if (error) return { ok: false, message: error.message };
  return { ok: true, message: "deleted" };
}
