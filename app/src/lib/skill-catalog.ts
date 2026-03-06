import fs from "node:fs/promises";
import path from "node:path";
import { dbRoot } from "@/lib/db-root";

export type SkillCatalogCategory =
  | "weapon"
  | "assist"
  | "special"
  | "passive_a"
  | "passive_b"
  | "passive_c"
  | "sacred_seal"
  | "attuned"
  | "emblem";

export type SkillCatalogEntry = {
  id: string;
  name: string;
  category: SkillCatalogCategory;
  category_label: string;
  subcategory: string | null;
  source: "game8";
  source_url: string | null;
  effect: string | null;
  sp: string | null;
  attack: string | null;
  range: string | null;
  rating: string | null;
};

type SkillCatalogFile = {
  generated_at?: string;
  source?: string;
  total_items?: number;
  items?: SkillCatalogEntry[];
};

let cachedCatalogPromise: Promise<SkillCatalogEntry[]> | null = null;

async function readSkillCatalogFile() {
  const filePath = path.join(dbRoot(), "skill_catalog.json");
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as SkillCatalogFile;
  return Array.isArray(parsed.items) ? parsed.items : [];
}

export async function loadSkillCatalog() {
  if (!cachedCatalogPromise) {
    cachedCatalogPromise = readSkillCatalogFile().catch(() => []);
  }
  return cachedCatalogPromise;
}

export function normalizeSkillSearchText(value: string) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function buildSkillSearchText(skill: SkillCatalogEntry) {
  return normalizeSkillSearchText(
    [skill.name, skill.category_label, skill.subcategory, skill.effect]
      .filter(Boolean)
      .join(" ")
  );
}
