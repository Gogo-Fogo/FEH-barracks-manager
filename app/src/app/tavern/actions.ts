"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function requireText(value: FormDataEntryValue | null, label: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function optionalText(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function withNotice(path: string, notice: string, tone: "success" | "warn" = "success") {
  const url = new URL(path, "http://local");
  url.searchParams.set("notice", notice);
  url.searchParams.set("tone", tone);
  return `${url.pathname}${url.search}`;
}

// ─── Profile ────────────────────────────────────────────────────────────────

export async function updateDisplayName(formData: FormData) {
  const displayName = requireText(formData.get("display_name"), "Display name").slice(0, 32);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be logged in.");

  const { error } = await supabase
    .from("profiles")
    .upsert({ id: user.id, display_name: displayName, updated_at: new Date().toISOString() });

  if (error) throw new Error(error.message);

  revalidatePath("/tavern");
  redirect(withNotice("/tavern", "Display name updated."));
}

export async function setAvatarHero(formData: FormData) {
  const heroSlug = requireText(formData.get("hero_slug"), "Hero");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be logged in.");

  const { error } = await supabase
    .from("profiles")
    .upsert({ id: user.id, avatar_hero_slug: heroSlug, updated_at: new Date().toISOString() });

  if (error) throw new Error(error.message);

  revalidatePath("/tavern");
  redirect(withNotice("/tavern", "Avatar hero updated."));
}

// ─── Friend requests ─────────────────────────────────────────────────────────

export async function sendFriendRequest(formData: FormData) {
  const addresseeId = requireText(formData.get("addressee_id"), "User");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be logged in.");

  if (addresseeId === user.id) {
    redirect(withNotice("/tavern", "You can't befriend yourself.", "warn"));
  }

  const { error } = await supabase
    .from("user_friendships")
    .insert({ requester_id: user.id, addressee_id: addresseeId });

  if (error) {
    if (error.code === "23505") {
      redirect(withNotice("/tavern", "Friend request already sent.", "warn"));
    }
    throw new Error(error.message);
  }

  revalidatePath("/tavern");
  redirect(withNotice("/tavern", "Friend request sent!"));
}

export async function acceptFriendRequest(formData: FormData) {
  const friendshipId = requireText(formData.get("friendship_id"), "Request");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be logged in.");

  const { error } = await supabase
    .from("user_friendships")
    .update({ status: "accepted" })
    .eq("id", friendshipId)
    .eq("addressee_id", user.id);

  if (error) throw new Error(error.message);

  revalidatePath("/tavern");
  redirect(withNotice("/tavern", "Friend request accepted! Welcome to the tavern."));
}

export async function declineFriendRequest(formData: FormData) {
  const friendshipId = requireText(formData.get("friendship_id"), "Request");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be logged in.");

  const { error } = await supabase
    .from("user_friendships")
    .delete()
    .eq("id", friendshipId)
    .eq("addressee_id", user.id);

  if (error) throw new Error(error.message);

  revalidatePath("/tavern");
  redirect(withNotice("/tavern", "Friend request declined.", "warn"));
}

export async function removeFriend(formData: FormData) {
  const friendshipId = requireText(formData.get("friendship_id"), "Friendship");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be logged in.");

  const { error } = await supabase
    .from("user_friendships")
    .delete()
    .eq("id", friendshipId);

  if (error) throw new Error(error.message);

  revalidatePath("/tavern");
  redirect(withNotice("/tavern", "Friend removed.", "warn"));
}

// ─── Friend search ────────────────────────────────────────────────────────────

export async function searchUsers(formData: FormData) {
  const query = optionalText(formData.get("q"));
  const redirectUrl = new URL("/tavern", "http://local");
  if (query) redirectUrl.searchParams.set("friend_search", query);
  redirect(`${redirectUrl.pathname}${redirectUrl.search}`);
}
