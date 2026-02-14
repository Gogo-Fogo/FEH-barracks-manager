import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

function inferContentType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".webp") return "image/webp";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  return "application/octet-stream";
}

async function findHeadshotFile(heroSlug: string) {
  const candidateDirs = [
    path.join(process.cwd(), "db", "unit_assets", "fandom", "headshots", heroSlug),
    path.join(process.cwd(), "..", "db", "unit_assets", "fandom", "headshots", heroSlug),
  ];

  const preferred = [
    `fandom_${heroSlug}_headshot.webp`,
    `fandom_${heroSlug}_headshot.png`,
    `fandom_${heroSlug}_headshot.jpg`,
    `fandom_${heroSlug}_headshot.jpeg`,
  ];

  for (const headshotDir of candidateDirs) {
    for (const file of preferred) {
      const candidate = path.join(headshotDir, file);
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // continue
      }
    }

    try {
      const files = await fs.readdir(headshotDir);
      const firstImage = files.find((f) => /\.(webp|png|jpe?g|gif)$/i.test(f));
      if (firstImage) return path.join(headshotDir, firstImage);
    } catch {
      // continue
    }
  }

  return null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ heroSlug: string }> }
) {
  try {
    const { heroSlug } = await params;
    const filePath = await findHeadshotFile(heroSlug);

    if (!filePath) {
      return new NextResponse("Not found", { status: 404 });
    }

    const data = await fs.readFile(filePath);
    return new NextResponse(data, {
      status: 200,
      headers: {
        "Content-Type": inferContentType(filePath),
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
