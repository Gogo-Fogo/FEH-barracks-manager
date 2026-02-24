import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dbRoot } from "@/lib/db-root";

type UnitFile = {
  name?: string;
  ivs?: string;
  raw_text_data?: string;
  recommended_build?: Record<string, string>;
};

type BannerPullGuide = {
  id?: string;
  url?: string;
  title?: string;
  scraped_at?: string;
  guide_sections?: Array<{ heading?: string; content?: string }>;
  recommendations?: Array<{
    hero_name?: string;
    hero_slug_guess?: string;
    tier?: string;
    pull_recommendation?: string;
    notes?: string;
  }>;
};

type BannerPullGuidesFile = {
  items?: BannerPullGuide[];
};

const DEFAULT_RAW_TEXT_LIMIT = 6000;

function sanitizeText(value: string | null | undefined) {
  return (value || "").replace(/\s+/g, " ").trim();
}

async function readUnitFile(heroSlug: string): Promise<UnitFile | null> {
  const candidates = [
    path.join(dbRoot(), "units", `${heroSlug}.json`),
  ];

  for (const filePath of candidates) {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      return JSON.parse(raw) as UnitFile;
    } catch {
      // continue
    }
  }

  return null;
}

function trimForExport(text: string, limit: number) {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)} …[truncated]`;
}

function normalizeSlug(value: string) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .toLowerCase()
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

async function loadBannerPullGuides(): Promise<BannerPullGuide[]> {
  const candidates = [
    path.join(dbRoot(), "banner_pull_guides.json"),
  ];

  for (const filePath of candidates) {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as BannerPullGuidesFile;
      return Array.isArray(parsed.items) ? parsed.items : [];
    } catch {
      // continue
    }
  }

  return [];
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const mode = new URL(request.url).searchParams.get("mode") || "compact";
  const includeFullRawText = mode === "full";

  const [{ data: barracks }, { data: teams }, { data: notes }] = await Promise.all([
    supabase
      .from("user_barracks")
      .select("hero_slug,hero_name,merges,notes,updated_at")
      .eq("user_id", user.id)
      .order("hero_name", { ascending: true }),
    supabase
      .from("user_teams")
      .select("name,description,slots,updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false }),
    supabase
      .from("user_notes")
      .select("title,content,hero_slug,updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(30),
  ]);

  const heroSlugs = (barracks || []).map((b) => b.hero_slug).filter(Boolean);
  const heroMetaBySlug = new Map<
    string,
    { tier: number | null; weapon: string | null; move: string | null; tag: string | null }
  >();

  if (heroSlugs.length) {
    const { data: heroMetaRows } = await supabase
      .from("heroes")
      .select("hero_slug,tier,weapon,move,tag")
      .in("hero_slug", heroSlugs);

    for (const row of heroMetaRows || []) {
      heroMetaBySlug.set(row.hero_slug, {
        tier: row.tier,
        weapon: row.weapon,
        move: row.move,
        tag: row.tag,
      });
    }
  }

  const lines: string[] = [];
  const now = new Date().toISOString();
  const bannerGuides = await loadBannerPullGuides();

  const barracksBySlug = new Map<string, { hero_slug: string; hero_name: string }>();
  for (const b of barracks || []) {
    barracksBySlug.set(normalizeSlug(b.hero_slug), { hero_slug: b.hero_slug, hero_name: b.hero_name });
  }

  lines.push("# FEH Barracks AI Context Export");
  lines.push(`Generated: ${now}`);
  lines.push(`User ID: ${user.id}`);
  lines.push(`Mode: ${includeFullRawText ? "full" : "compact"}`);
  lines.push("");

  lines.push("## Index");
  lines.push("1. Summary");
  lines.push("2. AI Assistant Instructions");
  lines.push("3. Limitations");
  lines.push("4. Teams");
  lines.push("5. Barracks");
  lines.push("6. User Notes");
  lines.push("7. Character Guide Context (owned heroes only)");
  lines.push("8. Banner Pull Guidance (Game8)");
  lines.push("");

  lines.push("## Summary");
  lines.push(`- Barracks heroes: ${(barracks || []).length}`);
  lines.push(`- Team presets: ${(teams || []).length}`);
  lines.push(`- Notes included: ${(notes || []).length}`);
  lines.push(`- Banner pull guides loaded: ${bannerGuides.length}`);
  lines.push("");

  lines.push("## AI Assistant Instructions");
  lines.push("- This file is an account-context export for FEH planning.");
  lines.push("- Prioritize recommendations using ONLY heroes owned in this file unless user explicitly asks for wishlist/summon targets.");
  lines.push("- Use team presets + barracks + notes together to infer playstyle and gaps.");
  lines.push("- Treat tier as a signal, not the only rule: synergy, role coverage, and available merges matter.");
  lines.push("- If user asks summon advice for a specific banner, first identify banner units from user input (or ask for banner roster) and compare against owned roster + roles.");
  lines.push("- If banner roster is not provided in this export, ask follow-up for banner unit list before final recommendation.");
  lines.push("- Keep advice concise: top 1-3 summon priorities, why, and what role gap each fills.");
  lines.push("");

  lines.push("## Limitations");
  lines.push("- This export does NOT include all live Game8 banner pages by default.");
  lines.push("- It includes owned-hero guide context and account state for token-efficient analysis.");
  lines.push("");

  lines.push("## Teams");
  if (!(teams || []).length) {
    lines.push("- None");
  } else {
    for (const team of teams || []) {
      const slots = Array.isArray(team.slots) ? team.slots.map((s) => String(s)) : [];
      lines.push(`- ${team.name}`);
      if (team.description) lines.push(`  - Description: ${sanitizeText(team.description)}`);
      lines.push(`  - Slots: ${slots.length ? slots.join(", ") : "(empty)"}`);
      lines.push(`  - Updated: ${team.updated_at || "-"}`);
    }
  }
  lines.push("");

  lines.push("## Barracks");
  if (!(barracks || []).length) {
    lines.push("- None");
  } else {
    for (const entry of barracks || []) {
      lines.push(`- ${entry.hero_name} (${entry.hero_slug})`);
      const meta = heroMetaBySlug.get(entry.hero_slug);
      lines.push(`  - Tier: ${meta?.tier ?? "-"}`);
      lines.push(`  - Class: ${meta?.weapon || "-"} / ${meta?.move || "-"}`);
      lines.push(`  - Tag: ${meta?.tag || "-"}`);
      lines.push(`  - Merges: ${entry.merges ?? 0}`);
      if (entry.notes) lines.push(`  - Player Notes: ${sanitizeText(entry.notes)}`);
      lines.push(`  - Updated: ${entry.updated_at || "-"}`);
    }
  }
  lines.push("");

  lines.push("## User Notes");
  if (!(notes || []).length) {
    lines.push("- None");
  } else {
    for (const note of notes || []) {
      lines.push(`- ${note.title}`);
      if (note.hero_slug) lines.push(`  - Hero Link: ${note.hero_slug}`);
      if (note.content) lines.push(`  - Content: ${sanitizeText(note.content)}`);
      lines.push(`  - Updated: ${note.updated_at || "-"}`);
    }
  }
  lines.push("");

  lines.push("## Character Guide Context (owned heroes only)");
  if (!(barracks || []).length) {
    lines.push("- None");
  } else {
    for (const entry of barracks || []) {
      const unit = await readUnitFile(entry.hero_slug);
      lines.push(`### ${entry.hero_name} (${entry.hero_slug})`);

      if (!unit) {
        lines.push("- Guide source file not found locally.");
        lines.push("");
        continue;
      }

      if (unit.ivs) {
        lines.push(`- IV Recommendation: ${sanitizeText(unit.ivs)}`);
      }

      const buildEntries = Object.entries(unit.recommended_build || {}).filter(([, value]) => sanitizeText(value));
      if (buildEntries.length) {
        lines.push("- Recommended Build:");
        for (const [key, value] of buildEntries) {
          lines.push(`  - ${key}: ${sanitizeText(value)}`);
        }
      }

      const rawText = sanitizeText(unit.raw_text_data);
      if (rawText) {
        lines.push("- Raw Guide Text:");
        lines.push(
          includeFullRawText
            ? `  ${rawText}`
            : `  ${trimForExport(rawText, DEFAULT_RAW_TEXT_LIMIT)}`
        );
      } else {
        lines.push("- Raw Guide Text: (missing)");
      }

      lines.push("");
    }
  }

  lines.push("## Banner Pull Guidance (Game8)");
  if (!bannerGuides.length) {
    lines.push("- No banner pull-guide data found. Run `node scraper/game8_banner_pull_scraper.js` first.");
  } else {
    for (const guide of bannerGuides) {
      lines.push(`### ${guide.title || guide.id || "Banner Guide"}`);
      if (guide.url) lines.push(`- URL: ${guide.url}`);
      if (guide.scraped_at) lines.push(`- Scraped: ${guide.scraped_at}`);

      const sections = (guide.guide_sections || []).slice(0, 3);
      if (sections.length) {
        lines.push("- Guide Summary:");
        for (const section of sections) {
          lines.push(`  - ${sanitizeText(section.heading || "Section")}: ${trimForExport(sanitizeText(section.content), 280)}`);
        }
      }

      const recs = guide.recommendations || [];
      if (!recs.length) {
        lines.push("- Recommendations: none parsed.");
        lines.push("");
        continue;
      }

      const matchedOwned: Array<{ rec: NonNullable<BannerPullGuide["recommendations"]>[number]; owned: { hero_slug: string; hero_name: string } }> = [];
      const others = [];

      for (const rec of recs) {
        const recSlug = normalizeSlug(rec.hero_slug_guess || "");
        const recName = sanitizeText(rec.hero_name).toLowerCase();
        const direct = recSlug ? barracksBySlug.get(recSlug) : null;

        let owned = direct;
        if (!owned && recSlug.includes("_")) {
          const base = recSlug.split("_")[0];
          owned = Array.from(barracksBySlug.entries())
            .find(([slug]) => slug.startsWith(`${base}_`))
            ?.[1];
        }
        if (!owned && recName) {
          const nameMatch = Array.from(barracksBySlug.values()).find((b) =>
            sanitizeText(b.hero_name).toLowerCase().includes(recName) || recName.includes(sanitizeText(b.hero_name).toLowerCase())
          );
          owned = nameMatch || undefined;
        }

        if (owned) {
          matchedOwned.push({ rec, owned });
        } else {
          others.push(rec);
        }
      }

      lines.push(`- Featured units parsed: ${recs.length}`);
      lines.push(`- Owned featured units: ${matchedOwned.length}`);

      if (matchedOwned.length) {
        lines.push("- Owned banner targets:");
        for (const item of matchedOwned.slice(0, 12)) {
          lines.push(
            `  - ${item.owned.hero_name} (${item.owned.hero_slug}) | Banner Tier: ${item.rec.tier || "-"} | Pull: ${item.rec.pull_recommendation || "-"}`
          );
        }
      }

      if (others.length) {
        lines.push("- Not owned (top parsed):");
        for (const rec of others.slice(0, 10)) {
          lines.push(`  - ${rec.hero_name || rec.hero_slug_guess || "Unknown"} | Banner Tier: ${rec.tier || "-"} | Pull: ${rec.pull_recommendation || "-"}`);
        }
      }

      lines.push("");
    }
  }

  const fileStamp = now.replace(/[:.]/g, "-");
  const filename = `feh-ai-context-${fileStamp}.md`;

  return new NextResponse(lines.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store, max-age=0, must-revalidate",
    },
  });
}
