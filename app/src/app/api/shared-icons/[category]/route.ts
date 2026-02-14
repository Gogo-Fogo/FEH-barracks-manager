import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

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
    path.join(process.cwd(), "db", "unit_assets", "fandom", "shared", category, name),
    path.join(process.cwd(), "..", "db", "unit_assets", "fandom", "shared", category, name),
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

  return new NextResponse("Not found", { status: 404 });
}
