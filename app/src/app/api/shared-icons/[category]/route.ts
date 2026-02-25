import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { dbRoot } from "@/lib/db-root";

function inferContentType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

export async function GET(request: Request, { params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  const name = new URL(request.url).searchParams.get("name");
  if (!name) return new NextResponse("Missing icon name", { status: 400 });

  const candidates = [
    path.join(dbRoot(), "unit_assets", "fandom", "shared", category, name),
  ];

  for (const filePath of candidates) {
    try {
      const data = await fs.readFile(filePath);
      return new NextResponse(data, {
        status: 200,
        headers: {
          "Content-Type": inferContentType(filePath),
          "Cache-Control": "public, max-age=604800",
        },
      });
    } catch {
      // continue
    }
  }

  // Fall back to bundled static icons in /public/icons/ (always available on Vercel)
  const staticUrl = `/icons/${encodeURIComponent(category)}/${encodeURIComponent(name)}`;
  return NextResponse.redirect(new URL(staticUrl, request.url), 302);
}
