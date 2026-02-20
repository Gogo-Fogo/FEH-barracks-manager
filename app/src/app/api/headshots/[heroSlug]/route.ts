import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { loadFandomHeadshotUrlBySlug, loadUnitImageUrlBySlug } from "@/lib/local-unit-data";

async function proxyRemoteImage(url: string) {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
      redirect: "follow",
      cache: "force-cache",
    });

    if (!response.ok) return null;

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.startsWith("image/")) return null;

    const imageBytes = await response.arrayBuffer();
    return new NextResponse(imageBytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return null;
  }
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

function inferContentType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".webp") return "image/webp";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  return "application/octet-stream";
}

async function findHeadshotFile(heroSlug: string) {
  const roots = [
    path.join(process.cwd(), "db", "unit_assets", "fandom", "headshots"),
    path.join(process.cwd(), "..", "db", "unit_assets", "fandom", "headshots"),
  ];

  const candidateDirs = new Set<string>();
  const baseToken = heroSlug.split("___")[0]?.toLowerCase() || "";
  const normalizedTarget = normalizeSlug(heroSlug);

  for (const root of roots) {
    candidateDirs.add(path.join(root, heroSlug));

    try {
      const dirs = (await fs.readdir(root, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);

      const normalizedMatch = dirs.find((dirName) => normalizeSlug(dirName) === normalizedTarget);
      if (normalizedMatch) {
        candidateDirs.add(path.join(root, normalizedMatch));
      }

      if (baseToken) {
        const basePrefixMatches = dirs.filter((dirName) => dirName.toLowerCase().startsWith(`${baseToken}___`));
        for (const match of basePrefixMatches) {
          candidateDirs.add(path.join(root, match));
        }
      }
    } catch {
      // continue
    }
  }

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

function placeholderSvg(heroSlug: string) {
  const label = heroSlug
    .split("___")
    .map((part) => part.replace(/_/g, " "))
    .join(" • ")
    .slice(0, 40);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect width="256" height="256" fill="#111827"/>
  <circle cx="128" cy="96" r="44" fill="#374151"/>
  <rect x="56" y="156" width="144" height="64" rx="24" fill="#374151"/>
  <text x="128" y="242" text-anchor="middle" fill="#9ca3af" font-family="Arial, sans-serif" font-size="12">${label}</text>
</svg>`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ heroSlug: string }> }
) {
  try {
    const { heroSlug } = await params;
    const filePath = await findHeadshotFile(heroSlug);

    if (!filePath) {
      const fandomHeadshot = await loadFandomHeadshotUrlBySlug(heroSlug);
      if (fandomHeadshot) {
        const proxied = await proxyRemoteImage(fandomHeadshot);
        if (proxied) return proxied;
        return NextResponse.redirect(fandomHeadshot, 302);
      }

      const remoteImage = await loadUnitImageUrlBySlug(heroSlug);
      if (remoteImage) {
        const proxied = await proxyRemoteImage(remoteImage);
        if (proxied) return proxied;
        return NextResponse.redirect(remoteImage, 302);
      }

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
