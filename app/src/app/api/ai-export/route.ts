import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type UnitFile = {
  name?: string;
  ivs?: string;
  raw_text_data?: string;
  recommended_build?: Record<string, string>;
};

const DEFAULT_RAW_TEXT_LIMIT = 6000;

function sanitizeText(value: string | null | undefined) {
  return (value || "").replace(/\s+/g, " ").trim();
}

async function readUnitFile(heroSlug: string): Promise<UnitFile | null> {
  const candidates = [
    path.join(process.cwd(), "db", "units", `${heroSlug}.json`),
    path.join(process.cwd(), "..", "db", "units", `${heroSlug}.json`),
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

  const lines: string[] = [];
  const now = new Date().toISOString();

  lines.push("# FEH Barracks AI Context Export");
  lines.push(`Generated: ${now}`);
  lines.push(`User ID: ${user.id}`);
  lines.push(`Mode: ${includeFullRawText ? "full" : "compact"}`);
  lines.push("");

  lines.push("## Summary");
  lines.push(`- Barracks heroes: ${(barracks || []).length}`);
  lines.push(`- Team presets: ${(teams || []).length}`);
  lines.push(`- Notes included: ${(notes || []).length}`);
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
