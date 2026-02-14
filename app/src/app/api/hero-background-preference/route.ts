import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type PreferencePayload = {
  heroSlug?: string;
  backgroundName?: string;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const heroSlug = (searchParams.get("heroSlug") || "").trim();

  if (!heroSlug) {
    return NextResponse.json({ error: "heroSlug is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("user_hero_preferences")
    .select("background_name")
    .eq("user_id", user.id)
    .eq("hero_slug", heroSlug)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    const code = error.code || "";
    const msg = (error.message || "").toLowerCase();
    if (code === "42P01" || code === "PGRST205" || msg.includes("user_hero_preferences")) {
      return NextResponse.json({ backgroundName: null, needsMigration: true });
    }
    if (code === "42501") {
      return NextResponse.json({ backgroundName: null, needsPolicy: true });
    }
    return NextResponse.json({ backgroundName: null, error: error.message });
  }

  return NextResponse.json({ backgroundName: data?.background_name || null });
}

export async function POST(request: Request) {
  let payload: PreferencePayload;
  try {
    payload = (await request.json()) as PreferencePayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const heroSlug = (payload.heroSlug || "").trim();
  const backgroundName = (payload.backgroundName || "").trim();

  if (!heroSlug || !backgroundName) {
    return NextResponse.json({ error: "heroSlug and backgroundName are required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const updatedAt = new Date().toISOString();

  const { data: updatedRows, error: updateError } = await supabase
    .from("user_hero_preferences")
    .update({ background_name: backgroundName, updated_at: updatedAt })
    .eq("user_id", user.id)
    .eq("hero_slug", heroSlug)
    .select("hero_slug");

  const error = updateError;

  if (!error && (!updatedRows || updatedRows.length === 0)) {
    const { error: insertError } = await supabase.from("user_hero_preferences").insert({
      user_id: user.id,
      hero_slug: heroSlug,
      background_name: backgroundName,
      updated_at: updatedAt,
    });

    if (insertError) {
      const code = insertError.code || "";
      const msg = (insertError.message || "").toLowerCase();

      if (code === "42P01" || code === "PGRST205" || msg.includes("user_hero_preferences")) {
        return NextResponse.json(
          {
            ok: false,
            needsMigration: true,
            error: "Missing table: public.user_hero_preferences. Run latest schema SQL in Supabase.",
          },
          { status: 200 }
        );
      }

      if (code === "23503") {
        return NextResponse.json(
          {
            ok: false,
            needsHeroSync: true,
            error: "Hero slug is not present in public.heroes yet. Re-run hero import/sync.",
          },
          { status: 200 }
        );
      }

      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    const response = NextResponse.json({ ok: true });
    response.cookies.set({
      name: `hero_bg_${heroSlug}`,
      value: encodeURIComponent(backgroundName),
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
    });
    return response;
  }

  if (error) {
    const code = error.code || "";
    const msg = (error.message || "").toLowerCase();

    if (code === "42P01" || code === "PGRST205" || msg.includes("user_hero_preferences")) {
      return NextResponse.json(
        {
          ok: false,
          needsMigration: true,
          error: "Missing table: public.user_hero_preferences. Run latest schema SQL in Supabase.",
        },
        { status: 200 }
      );
    }

    if (code === "23503") {
      return NextResponse.json(
        {
          ok: false,
          needsHeroSync: true,
          error: "Hero slug is not present in public.heroes yet. Re-run hero import/sync.",
        },
        { status: 200 }
      );
    }

    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: `hero_bg_${heroSlug}`,
    value: encodeURIComponent(backgroundName),
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}
