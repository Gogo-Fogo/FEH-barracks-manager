"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function requireText(value: FormDataEntryValue | null, label: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function optionalText(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

export async function addToBarracks(formData: FormData) {
  const heroSlug = requireText(formData.get("hero_slug"), "Hero slug");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("You must be logged in.");

  const { data: heroRow, error: heroError } = await supabase
    .from("heroes")
    .select("name")
    .eq("hero_slug", heroSlug)
    .single();

  if (heroError || !heroRow?.name) {
    throw new Error("Selected hero was not found in the catalog.");
  }

  const { error } = await supabase.from("user_barracks").upsert(
    {
      user_id: user.id,
      hero_slug: heroSlug,
      hero_name: heroRow.name,
    },
    { onConflict: "user_id,hero_slug" }
  );

  if (error) throw new Error(error.message);

  revalidatePath("/barracks");
}

export async function updateBarracksEntry(formData: FormData) {
  const id = requireText(formData.get("id"), "Entry id");
  const mergesRaw = optionalText(formData.get("merges")) || "0";
  const notes = optionalText(formData.get("notes"));

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
}

export async function removeBarracksEntry(formData: FormData) {
  const id = requireText(formData.get("id"), "Entry id");

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
}
