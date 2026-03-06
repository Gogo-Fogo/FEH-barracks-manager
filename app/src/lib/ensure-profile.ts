import { deriveDefaultDisplayName } from "@/lib/profile-defaults";

type UserLike = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

export async function ensureProfileRow(
  supabase: any,
  user: UserLike,
) {
  const fallbackName = deriveDefaultDisplayName(user);

  try {
    const { data: existing } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle();

    const currentName = String(existing?.display_name || "").trim();
    if (currentName) {
      return currentName;
    }

    await supabase.from("profiles").upsert({
      id: user.id,
      display_name: fallbackName,
      updated_at: new Date().toISOString(),
    });
  } catch {
    // Best-effort bootstrap only; auth flow and page rendering should continue.
  }

  return fallbackName;
}
