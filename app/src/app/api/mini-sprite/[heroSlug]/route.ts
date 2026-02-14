import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

function normalizeSlug(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .toLowerCase()
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function inferContentType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".webp") return "image/webp";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  return "application/octet-stream";
}

async function findMiniSpriteFile(heroSlug: string) {
  const roots = [
    path.join(process.cwd(), "db", "unit_assets", "game8", "mini_sprites"),
    path.join(process.cwd(), "..", "db", "unit_assets", "game8", "mini_sprites"),
  ];

  const normalized = normalizeSlug(heroSlug.replace(/___/g, "_"));

  for (const root of roots) {
    try {
      const files = await fs.readdir(root);
      const exactPrefix = `game8_${normalized}_mini_`;

      const exact = files.find((file) => file.toLowerCase().startsWith(exactPrefix));
      if (exact) return path.join(root, exact);

      const baseToken = normalized.split("_")[0] || "";
      if (baseToken) {
        const fallback = files.find((file) => file.toLowerCase().startsWith(`game8_${baseToken}_`));
        if (fallback) return path.join(root, fallback);
      }
    } catch {
      // continue
    }
  }

  return null;
}

function placeholderSvg(heroSlug: string) {
  const label = heroSlug
    .split("___")
    .map((part) => part.replace(/_/g, " "))
    .join(" • ")
    .slice(0, 40);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <rect width="128" height="128" fill="#1f2937"/>
  <circle cx="64" cy="44" r="20" fill="#4b5563"/>
  <rect x="36" y="70" width="56" height="36" rx="12" fill="#4b5563"/>
  <text x="64" y="121" text-anchor="middle" fill="#9ca3af" font-family="Arial, sans-serif" font-size="9">${label}</text>
</svg>`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ heroSlug: string }> }
) {
  try {
    const { heroSlug } = await params;
    const filePath = await findMiniSpriteFile(heroSlug);

    if (!filePath) {
      return new NextResponse(placeholderSvg(heroSlug), {
        status: 200,
        headers: {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "no-store, max-age=0, must-revalidate",
        },
      });
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
