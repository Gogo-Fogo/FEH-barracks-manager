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
