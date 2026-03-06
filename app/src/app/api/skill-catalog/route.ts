import { NextResponse } from "next/server";
import { loadSkillCatalog } from "@/lib/skill-catalog";

export async function GET() {
  const items = await loadSkillCatalog();
  const liteItems = items.map((item) => ({
    id: item.id,
    name: item.name,
    category: item.category,
    category_label: item.category_label,
    subcategory: item.subcategory,
    source_url: item.source_url,
  }));

  return NextResponse.json(
    {
      total_items: liteItems.length,
      items: liteItems,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      },
    }
  );
}
