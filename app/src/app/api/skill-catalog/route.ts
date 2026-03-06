import { NextResponse } from "next/server";
import { loadSkillCatalog } from "@/lib/skill-catalog";

export async function GET() {
  const items = await loadSkillCatalog();
  const apiItems = items.map((item) => ({
    id: item.id,
    name: item.name,
    category: item.category,
    category_label: item.category_label,
    subcategory: item.subcategory,
    source: item.source,
    source_url: item.source_url,
    effect: item.effect,
    sp: item.sp,
    attack: item.attack,
    range: item.range,
    rating: item.rating,
  }));

  return NextResponse.json(
    {
      total_items: apiItems.length,
      items: apiItems,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      },
    }
  );
}
