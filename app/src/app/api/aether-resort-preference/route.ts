import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type AetherResortPreferencePayload = {
  slots?: string[];
  backgroundName?: string;
};

const ALLOWED_BACKGROUNDS = new Set([
  "Map_K1001.webp",
  "Map_K1002.webp",
  "Map_K1003.webp",
  "Map_K1004.webp",
  "Map_K1005.webp",
  "Map_K1006.webp",
  "Map_K1007.webp",
]);

function normalizeSlots(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 4);
}

export async function POST(request: Request) {
  let payload: AetherResortPreferencePayload;
  try {
    payload = (await request.json()) as AetherResortPreferencePayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const slots = normalizeSlots(payload.slots);
  const backgroundName = typeof payload.backgroundName === "string" ? payload.backgroundName.trim() : "";
  const safeBackgroundName = ALLOWED_BACKGROUNDS.has(backgroundName) ? backgroundName : "Map_K1001.webp";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error } = await supabase.from("user_aether_resort_preferences").upsert(
    {
      user_id: user.id,
      slots,
      background_name: safeBackgroundName,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (error) {
    const code = error.code || "";
    const msg = (error.message || "").toLowerCase();

    if (code === "42P01" || code === "PGRST205" || msg.includes("user_aether_resort_preferences")) {
      return NextResponse.json(
        {
          ok: false,
          needsMigration: true,
          error: "Missing table: public.user_aether_resort_preferences. Run latest schema SQL in Supabase.",
        },
        { status: 200 }
      );
    }

    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
