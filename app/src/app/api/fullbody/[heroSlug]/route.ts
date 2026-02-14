import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

const DEFAULT_POSE_ORDER = ["portrait", "attack", "special", "damage"];

function inferContentType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".webp") return "image/webp";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return "application/octet-stream";
}

function normalizeSlug(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .toLowerCase()
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function placeholderSvg(heroSlug: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="440" height="700" viewBox="0 0 440 700">
  <rect width="440" height="700" fill="#111827"/>
  <rect x="70" y="60" width="300" height="580" rx="24" fill="#1f2937" stroke="#374151"/>
  <text x="220" y="360" text-anchor="middle" fill="#9ca3af" font-family="Arial, sans-serif" font-size="22">No fullbody art</text>
  <text x="220" y="390" text-anchor="middle" fill="#6b7280" font-family="Arial, sans-serif" font-size="14">${heroSlug.slice(0, 40)}</text>
</svg>`;
}

async function findFullbody(heroSlug: string, pose: string) {
  const roots = [
    path.join(process.cwd(), "db", "unit_assets", "fandom", "fullbody"),
    path.join(process.cwd(), "..", "db", "unit_assets", "fandom", "fullbody"),
  ];

  for (const root of roots) {
    const candidates = new Set<string>([path.join(root, heroSlug)]);
    try {
      const dirs = (await fs.readdir(root, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);

      const normalized = normalizeSlug(heroSlug);
      const normalizedMatch = dirs.find((d) => normalizeSlug(d) === normalized);
      if (normalizedMatch) candidates.add(path.join(root, normalizedMatch));
    } catch {
      // continue
    }

    for (const dir of candidates) {
      const preferred = [
        `fandom_${heroSlug}_${pose}.webp`,
        `fandom_${heroSlug}_${pose}.png`,
        `fandom_${heroSlug}_${pose}.jpg`,
        `fandom_${heroSlug}_${pose}.jpeg`,
      ];

      for (const file of preferred) {
        const candidate = path.join(dir, file);
        try {
          await fs.access(candidate);
          return candidate;
        } catch {
          // continue
        }
      }

      try {
        const files = await fs.readdir(dir);
        const poseMatch = files.find((f) => f.includes(`_${pose}.`) && /\.(webp|png|jpe?g)$/i.test(f));
        if (poseMatch) return path.join(dir, poseMatch);

        for (const fallbackPose of DEFAULT_POSE_ORDER) {
          const fallback = files.find((f) => f.includes(`_${fallbackPose}.`) && /\.(webp|png|jpe?g)$/i.test(f));
          if (fallback) return path.join(dir, fallback);
        }
      } catch {
        // continue
      }
    }
  }

  return null;
}

export async function GET(request: Request, { params }: { params: Promise<{ heroSlug: string }> }) {
  const { heroSlug } = await params;
  const pose = new URL(request.url).searchParams.get("pose") || "portrait";
  const filePath = await findFullbody(heroSlug, pose);

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
}
