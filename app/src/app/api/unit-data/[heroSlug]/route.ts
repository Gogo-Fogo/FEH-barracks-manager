import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { dbRoot } from "@/lib/db-root";
import {
  loadFandomFullbodyPosesBySlug,
  loadFandomQuoteTextBySlug,
} from "@/lib/local-unit-data";

const DEFAULT_POSE_ORDER = ["portrait", "attack", "special", "damage"];

async function readJsonSafe(filePath: string) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ heroSlug: string }> }
) {
  const { heroSlug } = await params;

  // Unit build / IVs / raw guide text
  const unitFile = await readJsonSafe(
    path.join(dbRoot(), "units", `${heroSlug}.json`)
  );

  // Quotes
  const quotesFile = await readJsonSafe(
    path.join(dbRoot(), "quotes", "fandom", `${heroSlug}.json`)
  );
  let quoteText: string | null = quotesFile?.quote_text ?? null;
  if (!quoteText) {
    quoteText = await loadFandomQuoteTextBySlug(heroSlug);
  }

  // Fullbody poses
  let poses: string[] = [];
  try {
    const fbDir = path.join(dbRoot(), "unit_assets", "fandom", "fullbody", heroSlug);
    const files = await fs.readdir(fbDir);
    const poseSet = new Set<string>();
    for (const f of files) {
      const m = f.match(/_(portrait|attack|special|damage)\.(webp|png|jpe?g)$/i);
      if (m?.[1]) poseSet.add(m[1].toLowerCase());
    }
    poses = DEFAULT_POSE_ORDER.filter((p) => poseSet.has(p));
  } catch {
    /* no local fullbody */
  }
  if (!poses.length) poses = await loadFandomFullbodyPosesBySlug(heroSlug);
  if (!poses.length) poses = ["portrait"];

  // Background options
  let backgroundOptions: string[] = [];
  try {
    const bgDir = path.join(
      dbRoot(), "unit_assets", "fandom", "shared", "unit_backgrounds"
    );
    backgroundOptions = (await fs.readdir(bgDir))
      .filter((f) => /\.(png|webp|jpe?g)$/i.test(f))
      .sort();
  } catch {
    /* not available */
  }

  return NextResponse.json(
    { unitFile: unitFile ?? null, quoteText, poses, backgroundOptions },
    { headers: { "Cache-Control": "no-store" } }
  );
}
