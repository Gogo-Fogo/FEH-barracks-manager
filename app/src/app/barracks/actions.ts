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

function safeRedirectPath(value: string, fallback: string) {
  if (!value || !value.startsWith("/")) return fallback;
  return value;
}

function withNotice(path: string, notice: string, tone: "success" | "warn" = "success") {
  const url = new URL(path, "http://local");
  url.searchParams.set("notice", notice);
  url.searchParams.set("tone", tone);
  return `${url.pathname}${url.search}`;
}

export async function addToBarracks(formData: FormData) {
  const heroInput = requireText(formData.get("hero_slug"), "Hero");
  const redirectTo = safeRedirectPath(optionalText(formData.get("redirect_to")), "/barracks");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("You must be logged in.");

  let { data: heroRow, error: heroError } = await supabase
    .from("heroes")
    .select("hero_slug,name")
    .eq("hero_slug", heroInput)
    .single();

  if (heroError || !heroRow?.name) {
    const byName = await supabase
      .from("heroes")
      .select("hero_slug,name")
      .ilike("name", heroInput)
      .limit(1)
      .maybeSingle();

    heroRow = byName.data ?? null;
    heroError = byName.error ?? null;
  }

  if (heroError || !heroRow?.name || !heroRow.hero_slug) {
    throw new Error("Selected hero was not found in the catalog.");
  }

  const heroSlug = heroRow.hero_slug;

  const { data: existing } = await supabase
    .from("user_barracks")
    .select("id")
    .eq("user_id", user.id)
    .eq("hero_slug", heroSlug)
    .maybeSingle();

  if (existing?.id) {
    revalidatePath("/barracks");
    redirect(withNotice(redirectTo, `${heroRow.name} is already in your barracks.`, "warn"));
  }

  const { error } = await supabase.from("user_barracks").insert({
      user_id: user.id,
      hero_slug: heroSlug,
      hero_name: heroRow.name,
    });

  if (error) throw new Error(error.message);

  revalidatePath("/barracks");
  redirect(withNotice(redirectTo, `${heroRow.name} added to your barracks.`));
}

export async function updateBarracksEntry(formData: FormData) {
  const id = requireText(formData.get("id"), "Entry id");
  const mergesRaw = optionalText(formData.get("merges")) || "0";
  const notes = optionalText(formData.get("notes"));
  const redirectTo = safeRedirectPath(optionalText(formData.get("redirect_to")), "/barracks");

  const merges = Number.parseInt(mergesRaw ?? "0", 10);
  const safeMerges = Number.isFinite(merges) ? Math.max(0, Math.min(20, merges)) : 0;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("You must be logged in.");

  const { error } = await supabase
    .from("user_barracks")
    .update({ merges: safeMerges, notes, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) throw new Error(error.message);

  revalidatePath("/barracks");
  redirect(withNotice(redirectTo, "Barracks entry saved."));
}

export async function removeBarracksEntry(formData: FormData) {
  const id = requireText(formData.get("id"), "Entry id");
  const redirectTo = safeRedirectPath(optionalText(formData.get("redirect_to")), "/barracks");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("You must be logged in.");

  const { error } = await supabase
    .from("user_barracks")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) throw new Error(error.message);

  revalidatePath("/barracks");
  redirect(withNotice(redirectTo, "Barracks entry removed."));
}

export async function toggleFavorite(formData: FormData) {
  const heroSlug = requireText(formData.get("hero_slug"), "Hero slug");
  const redirectTo = safeRedirectPath(optionalText(formData.get("redirect_to")), "/heroes");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("You must be logged in.");

  const { data: existing } = await supabase
    .from("user_favorites")
    .select("hero_slug")
    .eq("user_id", user.id)
    .eq("hero_slug", heroSlug)
    .maybeSingle();

  if (existing?.hero_slug) {
    const { error } = await supabase
      .from("user_favorites")
      .delete()
      .eq("user_id", user.id)
      .eq("hero_slug", heroSlug);
    if (error) throw new Error(error.message);
    revalidatePath("/heroes");
    revalidatePath("/barracks");
    redirect(withNotice(redirectTo, "Removed from favorites.", "warn"));
  } else {
    const { error } = await supabase.from("user_favorites").insert({
      user_id: user.id,
      hero_slug: heroSlug,
    });
    if (error) throw new Error(error.message);
    revalidatePath("/heroes");
    revalidatePath("/barracks");
    redirect(withNotice(redirectTo, "Added to favorites."));
  }
}

export async function createUserNote(formData: FormData) {
  const title = requireText(formData.get("title"), "Title");
  const content = optionalText(formData.get("content"));
  const heroSlug = optionalText(formData.get("hero_slug")) || null;
  const redirectTo = safeRedirectPath(optionalText(formData.get("redirect_to")), "/barracks");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be logged in.");

  const { error } = await supabase.from("user_notes").insert({
    user_id: user.id,
    hero_slug: heroSlug,
    title,
    content,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/barracks");
  redirect(withNotice(redirectTo, "Note saved."));
}

export async function updateUserNote(formData: FormData) {
  const id = requireText(formData.get("id"), "Note id");
  const title = requireText(formData.get("title"), "Title");
  const content = optionalText(formData.get("content"));
  const redirectTo = safeRedirectPath(optionalText(formData.get("redirect_to")), "/barracks");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be logged in.");

  const { error } = await supabase
    .from("user_notes")
    .update({ title, content, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);

  revalidatePath("/barracks");
  redirect(withNotice(redirectTo, "Note updated."));
}

export async function removeUserNote(formData: FormData) {
  const id = requireText(formData.get("id"), "Note id");
  const redirectTo = safeRedirectPath(optionalText(formData.get("redirect_to")), "/barracks");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be logged in.");

  const { error } = await supabase
    .from("user_notes")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);

  revalidatePath("/barracks");
  redirect(withNotice(redirectTo, "Note removed.", "warn"));
}

function parseSlots(raw: string) {
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 4);
}

export async function createUserTeam(formData: FormData) {
  const name = requireText(formData.get("name"), "Team name");
  const description = optionalText(formData.get("description"));
  const slotsText = optionalText(formData.get("slots_text"));
  const slots = slotsText
    ? parseSlots(slotsText)
    : parseSlots(
        ["slot_1", "slot_2", "slot_3", "slot_4"]
          .map((field) => optionalText(formData.get(field)))
          .filter(Boolean)
          .join(",")
      );
  const redirectTo = safeRedirectPath(optionalText(formData.get("redirect_to")), "/barracks");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be logged in.");

  const { error } = await supabase.from("user_teams").insert({
    user_id: user.id,
    name,
    description,
    slots,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/barracks");
  redirect(withNotice(redirectTo, "Team saved."));
}

export async function updateUserTeam(formData: FormData) {
  const id = requireText(formData.get("id"), "Team id");
  const name = requireText(formData.get("name"), "Team name");
  const description = optionalText(formData.get("description"));
  const slotsText = optionalText(formData.get("slots_text"));
  const slots = slotsText
    ? parseSlots(slotsText)
    : parseSlots(
        ["slot_1", "slot_2", "slot_3", "slot_4"]
          .map((field) => optionalText(formData.get(field)))
          .filter(Boolean)
          .join(",")
      );
  const redirectTo = safeRedirectPath(optionalText(formData.get("redirect_to")), "/barracks");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be logged in.");

  const { error } = await supabase
    .from("user_teams")
    .update({
      name,
      description,
      slots,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);

  revalidatePath("/barracks");
  redirect(withNotice(redirectTo, "Team updated."));
}

export async function removeUserTeam(formData: FormData) {
  const id = requireText(formData.get("id"), "Team id");
  const redirectTo = safeRedirectPath(optionalText(formData.get("redirect_to")), "/barracks");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be logged in.");

  const { error } = await supabase
    .from("user_teams")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);

  revalidatePath("/barracks");
  redirect(withNotice(redirectTo, "Team removed.", "warn"));
}
