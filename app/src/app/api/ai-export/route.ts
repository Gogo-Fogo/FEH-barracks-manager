import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  appendRecommendedBuildLines,
  appendTrackedInventoryLines,
  buildSkillOwnershipIndex,
  collectSummonTargets,
  DEFAULT_RAW_TEXT_LIMIT as IMPROVED_RAW_TEXT_LIMIT,
  DEFAULT_SUMMON_TARGET_LIMIT,
  loadBannerPullGuides,
  loadExportUnitFile,
  loadGame8IndexBySlug,
  loadSkillCatalogByName,
  normalizeTeamLabels,
  normalizeSlug,
  normalizeTeamSlots,
  resolveOwnedHero,
  sanitizeText,
  trimForExport,
} from "@/lib/ai-export-support";
import {
  hasTrackedInventory,
  parseBarracksEntryNotes,
} from "@/lib/barracks-entry-metadata";
import { normalizeSkillSearchText } from "@/lib/skill-catalog";

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
  const warnings: string[] = [];

  const [
    { data: barracks, error: barracksError },
    { data: teams, error: teamsError },
    { data: notes, error: notesError },
    { data: favorites, error: favoritesError },
  ] = await Promise.all([
    supabase
      .from("user_barracks")
      .select("hero_slug,hero_name,merges,copies_owned,notes,updated_at")
      .eq("user_id", user.id)
      .order("hero_name", { ascending: true }),
    supabase
      .from("user_teams")
      .select("name,description,slots,slot_labels,updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false }),
    supabase
      .from("user_notes")
      .select("title,content,hero_slug,updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(30),
    supabase
      .from("user_favorites")
      .select("hero_slug, heroes(name)")
      .eq("user_id", user.id),
  ]);

  if (barracksError) warnings.push(`Barracks query warning: ${barracksError.message}`);
  if (teamsError) warnings.push(`Teams query warning: ${teamsError.message}`);
  if (notesError) warnings.push(`Notes query warning: ${notesError.message}`);
  if (favoritesError) warnings.push(`Favorites query warning: ${favoritesError.message}`);
  if ((notes || []).length === 30) {
    warnings.push("User notes export is capped at the 30 most recent notes.");
  }

  const heroSlugs = (barracks || []).map((b) => b.hero_slug).filter(Boolean);
  const heroMetaBySlug = new Map<
    string,
    { tier: number | null; weapon: string | null; move: string | null; tag: string | null }
  >();

  if (heroSlugs.length) {
    const { data: heroMetaRows, error: heroMetaError } = await supabase
      .from("heroes")
      .select("hero_slug,tier,weapon,move,tag")
      .in("hero_slug", heroSlugs);

    if (heroMetaError) {
      warnings.push(`Hero metadata query warning: ${heroMetaError.message}`);
    }

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
  const [bannerGuides, game8IndexBySlug, skillCatalogByName] = await Promise.all([
    loadBannerPullGuides(),
    loadGame8IndexBySlug(),
    loadSkillCatalogByName(),
  ]);
  if (!bannerGuides.length) {
    warnings.push("No banner pull-guide data was available in db/banner_pull_guides.json.");
  }
  if (!skillCatalogByName.size) {
    warnings.push("Skill catalog was unavailable, so recommended build effect lookups were skipped.");
  }

  const barracksBySlug = new Map<string, { hero_slug: string; hero_name: string }>();
  const barracksByName = new Map<string, { hero_slug: string; hero_name: string }>();
  const parsedBarracksEntries = (barracks || []).map((entry) => ({
    entry,
    parsed: parseBarracksEntryNotes(entry.notes),
    meta: heroMetaBySlug.get(entry.hero_slug) ?? null,
  }));
  const barracksByExactSlug = new Map(
    parsedBarracksEntries.map((item) => [item.entry.hero_slug, item] as const)
  );

  for (const item of parsedBarracksEntries) {
    barracksBySlug.set(normalizeSlug(item.entry.hero_slug), {
      hero_slug: item.entry.hero_slug,
      hero_name: item.entry.hero_name,
    });
    barracksByName.set(normalizeSkillSearchText(item.entry.hero_name), {
      hero_slug: item.entry.hero_slug,
      hero_name: item.entry.hero_name,
    });
  }

  const favoriteRows = (favorites || []) as Array<{
    hero_slug?: string | null;
    heroes?: { name?: string | null } | Array<{ name?: string | null }> | null;
  }>;
  const favoriteSlugs = new Set(
    favoriteRows.map((item) => String(item.hero_slug || "").trim()).filter(Boolean)
  );
  const trackedInventoryCount = parsedBarracksEntries.filter((item) =>
    hasTrackedInventory(item.parsed.inventory)
  ).length;
  const ownershipIndex = buildSkillOwnershipIndex(
    parsedBarracksEntries.map((item) => ({
      heroName: item.entry.hero_name,
      inventory: item.parsed.inventory,
    }))
  );
  const teamRows = (teams || []) as Array<{
    name?: string | null;
    description?: string | null;
    slots?: unknown;
    slot_labels?: unknown;
    updated_at?: string | null;
  }>;
  const teamHeroSlugs = new Set<string>();
  for (const team of teamRows) {
    for (const slot of normalizeTeamSlots(team.slots)) {
      if (slot) teamHeroSlugs.add(slot);
    }
  }

  const summonTargets = collectSummonTargets(
    bannerGuides,
    barracksBySlug,
    barracksByName,
    game8IndexBySlug
  ).slice(0, DEFAULT_SUMMON_TARGET_LIMIT);
  const priorityHeroSlugs = new Set<string>([
    ...Array.from(teamHeroSlugs),
    ...Array.from(favoriteSlugs),
    ...summonTargets.map((target) => String(target.heroSlug || "").trim()).filter(Boolean),
  ]);
  let missingOwnedGuideCount = 0;

  lines.push("# FEH Barracks AI Context Export");
  lines.push(`Generated: ${now}`);
  lines.push(`User ID: ${user.id}`);
  lines.push(`Mode: ${includeFullRawText ? "full" : "compact"}`);
  lines.push("");

  lines.push("## Index");
  lines.push("1. Summary");
  lines.push("2. AI Assistant Instructions");
  lines.push("3. Limitations");
  lines.push("4. Warnings");
  lines.push("5. Favorites");
  lines.push("6. Teams");
  lines.push("7. Barracks");
  lines.push("8. User Notes");
  lines.push("9. Character Guide Context (owned heroes only)");
  lines.push("10. Saved Team Build Planning");
  lines.push("11. Summon Targets and Build Planning");
  lines.push("12. Banner Pull Guidance (Game8)");
  lines.push("");

  lines.push("## Summary");
  lines.push(`- Barracks heroes: ${parsedBarracksEntries.length}`);
  lines.push(`- Heroes with tracked inventory: ${trackedInventoryCount}`);
  lines.push(`- Favorite heroes: ${favoriteRows.length}`);
  lines.push(`- Team presets: ${teamRows.length}`);
  lines.push(`- Notes included: ${(notes || []).length}`);
  lines.push(`- Banner pull guides loaded: ${bannerGuides.length}`);
  lines.push(`- Summon targets surfaced: ${summonTargets.length}`);
  lines.push("");

  lines.push("## AI Assistant Instructions");
  lines.push("- This file is an account-context export for FEH planning.");
  lines.push("- Prioritize owned heroes first, but use summon-target sections when the account has clear role gaps or banner opportunities.");
  lines.push("- Use favorites, saved teams, tracked fodder, and player notes together when suggesting builds or replacements.");
  lines.push("- Treat tier as a signal, not the only rule: synergy, role coverage, availability, and inheritance realism matter.");
  lines.push("- `account:` skill coverage only reflects tracked skills, fodder, and equipped builds in this export.");
  lines.push("- Saved Team Build Planning is the highest-signal section for improving existing teams.");
  lines.push("- Summon Targets and Build Planning is the highest-signal section for banner advice and wishlist recommendations.");
  lines.push("- Keep advice concise: top upgrades, why they matter, and what they cost in fodder or summons.");
  lines.push("");

  lines.push("## Limitations");
  lines.push("- Full guide text is truncated in compact mode to keep token cost manageable.");
  lines.push("- Banner guidance depends on local banner guide snapshots, not a live scrape at export time.");
  lines.push("- `account: not tracked on-account` means the skill is not currently represented elsewhere in this export, not that it is impossible to obtain.");
  lines.push("");

  lines.push("## Warnings");
  if (!warnings.length) {
    lines.push("- None");
  } else {
    for (const warning of warnings) {
      lines.push(`- ${warning}`);
    }
  }
  lines.push("");

  lines.push("## Favorites");
  if (!favoriteRows.length) {
    lines.push("- None");
  } else {
    for (const favorite of favoriteRows) {
      const relation = Array.isArray(favorite.heroes) ? favorite.heroes[0] : favorite.heroes;
      const label = sanitizeText(relation?.name) || sanitizeText(favorite.hero_slug || "") || "Unknown";
      lines.push(`- ${label} (${sanitizeText(favorite.hero_slug || "-")})`);
    }
  }
  lines.push("");

  lines.push("## Teams");
  if (!teamRows.length) {
    lines.push("- None");
  } else {
    for (const team of teamRows) {
      const slots = normalizeTeamSlots(team.slots);
      const labels = normalizeTeamLabels(team.slot_labels);
      lines.push(`- ${sanitizeText(team.name || "Untitled Team")}`);
      if (team.description) lines.push(`  - Description: ${sanitizeText(team.description)}`);
      for (let i = 0; i < Math.max(slots.length, labels.length); i += 1) {
        const slotSlug = slots[i] || "";
        const slotLabel = labels[i] || `Slot ${i + 1}`;
        const resolvedName = slotSlug ? barracksByExactSlug.get(slotSlug)?.entry.hero_name || slotSlug : "(empty)";
        lines.push(`  - ${slotLabel}: ${resolvedName}`);
      }
      lines.push(`  - Updated: ${sanitizeText(team.updated_at || "-")}`);
    }
  }
  lines.push("");

  lines.push("## Barracks");
  if (!parsedBarracksEntries.length) {
    lines.push("- None");
  } else {
    for (const item of parsedBarracksEntries) {
      lines.push(`- ${item.entry.hero_name} (${item.entry.hero_slug})`);
      lines.push(`  - Tier: ${item.meta?.tier ?? "-"}`);
      lines.push(`  - Class: ${item.meta?.weapon || "-"} / ${item.meta?.move || "-"}`);
      lines.push(`  - Tag: ${item.meta?.tag || "-"}`);
      lines.push(`  - Favorite: ${favoriteSlugs.has(item.entry.hero_slug) ? "yes" : "no"}`);
      lines.push(`  - Merges: ${item.entry.merges ?? 0}`);
      lines.push(`  - Dupes on hand: ${item.entry.copies_owned ?? 0}`);
      appendTrackedInventoryLines(lines, item.parsed.inventory, "  ");
      if (item.parsed.notes) lines.push(`  - Player Notes: ${sanitizeText(item.parsed.notes)}`);
      lines.push(`  - Updated: ${sanitizeText(item.entry.updated_at || "-")}`);
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
  if (!parsedBarracksEntries.length) {
    lines.push("- None");
  } else {
    for (const item of parsedBarracksEntries) {
      const unit = await loadExportUnitFile(item.entry.hero_slug, priorityHeroSlugs.has(item.entry.hero_slug));
      lines.push(`### ${item.entry.hero_name} (${item.entry.hero_slug})`);
      if (item.parsed.notes) lines.push(`- Player Notes: ${sanitizeText(item.parsed.notes)}`);
      appendTrackedInventoryLines(lines, item.parsed.inventory);

      if (!unit) {
        missingOwnedGuideCount += 1;
        lines.push("- Guide/build data was not found locally, in bundled export data, or via fallback for this hero.");
        lines.push("");
        continue;
      }

      if (unit.ivs) lines.push(`- IV Recommendation: ${sanitizeText(unit.ivs)}`);
      if (unit.artist) lines.push(`- Artist: ${sanitizeText(unit.artist)}`);
      appendRecommendedBuildLines(lines, unit, skillCatalogByName, ownershipIndex, item.parsed.inventory);

      const rawText = sanitizeText(unit.raw_text_data);
      if (rawText) {
        lines.push("- Raw Guide Text:");
        lines.push(
          includeFullRawText
            ? `  ${rawText}`
            : `  ${trimForExport(rawText, IMPROVED_RAW_TEXT_LIMIT)}`
        );
      } else {
        lines.push("- Raw Guide Text: (missing)");
      }

      lines.push("");
    }
  }
  if (missingOwnedGuideCount) {
    lines.push(
      `> Missing guide/build data for ${missingOwnedGuideCount} owned hero(es). Team, favorite, and summon-target heroes were prioritized for fallback resolution.`
    );
    lines.push("");
  }

  lines.push("## Saved Team Build Planning");
  if (!teamRows.length) {
    lines.push("- None");
  } else {
    for (const team of teamRows) {
      const slots = normalizeTeamSlots(team.slots);
      const labels = normalizeTeamLabels(team.slot_labels);
      lines.push(`### ${sanitizeText(team.name || "Untitled Team")}`);
      if (team.description) lines.push(`- Description: ${sanitizeText(team.description)}`);
      lines.push(`- Updated: ${sanitizeText(team.updated_at || "-")}`);

      if (!slots.some(Boolean)) {
        lines.push("- Slots: (empty)");
        lines.push("");
        continue;
      }

      for (let i = 0; i < slots.length; i += 1) {
        const heroSlug = slots[i] || "";
        const slotLabel = labels[i] || `Slot ${i + 1}`;
        if (!heroSlug) {
          lines.push(`- ${slotLabel}: (empty)`);
          continue;
        }

        const barracksEntry = barracksByExactSlug.get(heroSlug);
        const unit = await loadExportUnitFile(heroSlug, true);
        lines.push(`- ${slotLabel}: ${barracksEntry?.entry.hero_name || heroSlug} (${heroSlug})`);
        if (barracksEntry?.parsed.notes) {
          lines.push(`  - Player Notes: ${sanitizeText(barracksEntry.parsed.notes)}`);
        }
        if (!unit) {
          lines.push("  - Build planning data unavailable.");
          continue;
        }

        if (unit.ivs) lines.push(`  - IV Recommendation: ${sanitizeText(unit.ivs)}`);
        appendRecommendedBuildLines(
          lines,
          unit,
          skillCatalogByName,
          ownershipIndex,
          barracksEntry?.parsed.inventory ?? null,
          "  "
        );
      }

      lines.push("");
    }
  }

  lines.push("## Summon Targets and Build Planning");
  if (!summonTargets.length) {
    lines.push("- None");
  } else {
    for (const target of summonTargets) {
      const unit = target.heroSlug ? await loadExportUnitFile(target.heroSlug, true) : null;
      lines.push(`### ${target.heroName}${target.heroSlug ? ` (${target.heroSlug})` : ""}`);
      lines.push(`- Source banner: ${target.bannerTitle}`);
      if (target.bannerUrl) lines.push(`- Banner URL: ${target.bannerUrl}`);
      if (target.scrapedAt) lines.push(`- Banner scraped: ${target.scrapedAt}`);
      lines.push(`- Banner tier: ${target.tier || "-"}`);
      lines.push(`- Pull recommendation: ${target.pullRecommendation || "-"}`);
      if (target.notes) lines.push(`- Banner notes: ${target.notes}`);

      if (!unit) {
        lines.push("- Build planning data unavailable for this target.");
        lines.push("");
        continue;
      }

      if (unit.ivs) lines.push(`- IV Recommendation: ${sanitizeText(unit.ivs)}`);
      if (unit.artist) lines.push(`- Artist: ${sanitizeText(unit.artist)}`);
      appendRecommendedBuildLines(lines, unit, skillCatalogByName, ownershipIndex, null);
      lines.push("");
    }
  }

  lines.push("## Banner Pull Guidance (Game8)");
  if (!bannerGuides.length) {
    lines.push("- No banner pull-guide data found. Run `node scraper/game8_banner_pull_scraper.js` first.");
  } else {
    const sortedGuides = [...bannerGuides].sort((a, b) => {
      const at = a.scraped_at ? Date.parse(a.scraped_at) : 0;
      const bt = b.scraped_at ? Date.parse(b.scraped_at) : 0;
      return bt - at;
    });

    for (const guide of sortedGuides) {
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
      lines.push(`- Featured units parsed: ${recs.length}`);
      const ownedTargets: string[] = [];
      const unownedTargets: string[] = [];
      for (const rec of recs) {
        const owned = resolveOwnedHero(rec, barracksBySlug, barracksByName);
        const heroLabel = sanitizeText(rec.hero_name || rec.hero_slug_guess || "Unknown");
        const suffix = ` | Banner Tier: ${sanitizeText(rec.tier) || "-"} | Pull: ${sanitizeText(rec.pull_recommendation) || "-"}`;
        if (owned) {
          ownedTargets.push(`${owned.hero_name} (${owned.hero_slug})${suffix}`);
        } else {
          unownedTargets.push(`${heroLabel}${suffix}`);
        }
      }

      lines.push(`- Owned featured units: ${ownedTargets.length}`);
      if (ownedTargets.length) {
        lines.push("- Owned banner targets:");
        for (const item of ownedTargets.slice(0, 12)) {
          lines.push(`  - ${item}`);
        }
      }

      if (unownedTargets.length) {
        lines.push("- Not owned (top parsed):");
        for (const item of unownedTargets.slice(0, 10)) {
          lines.push(`  - ${item}`);
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
