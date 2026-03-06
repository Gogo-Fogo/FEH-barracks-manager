export const HERO_BLESSING_OPTIONS = [
  "Light",
  "Astra",
  "Anima",
  "Dark",
  "Fire",
  "Water",
  "Wind",
  "Earth",
] as const;

export type HeroBlessingOption = (typeof HERO_BLESSING_OPTIONS)[number];

export type BarracksEntryInventory = {
  blessings: string[];
  skills: string[];
  fodder: string[];
  resources: string[];
};

export type ParsedBarracksEntryNotes = {
  notes: string;
  inventory: BarracksEntryInventory;
};

const META_MARKER = "[[FEH_BARRACKS_META]]";

function cleanText(value: string | null | undefined) {
  return String(value || "").trim();
}

function dedupeList(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = cleanText(value).replace(/\s+/g, " ");
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }

  return result;
}

export function parseInventoryList(value: string | null | undefined) {
  return dedupeList(
    String(value || "")
      .split(/[\n,]+/)
      .map((item) => item.trim())
  );
}

export function stringifyInventoryList(values: string[] | null | undefined) {
  return dedupeList(values || []).join(", ");
}

function normalizeInventory(inventory: Partial<BarracksEntryInventory> | null | undefined): BarracksEntryInventory {
  return {
    blessings: dedupeList(inventory?.blessings || []).filter((value) =>
      HERO_BLESSING_OPTIONS.includes(value as HeroBlessingOption)
    ),
    skills: dedupeList(inventory?.skills || []),
    fodder: dedupeList(inventory?.fodder || []),
    resources: dedupeList(inventory?.resources || []),
  };
}

export function hasTrackedInventory(inventory: BarracksEntryInventory | null | undefined) {
  const normalized = normalizeInventory(inventory);
  return Boolean(
    normalized.blessings.length ||
      normalized.skills.length ||
      normalized.fodder.length ||
      normalized.resources.length
  );
}

export function parseBarracksEntryNotes(rawValue: string | null | undefined): ParsedBarracksEntryNotes {
  const raw = String(rawValue || "");
  const markerIndex = raw.indexOf(META_MARKER);

  if (markerIndex === -1) {
    return {
      notes: raw.trim(),
      inventory: normalizeInventory(null),
    };
  }

  const noteText = raw.slice(0, markerIndex).trim();
  const encoded = raw.slice(markerIndex + META_MARKER.length).trim();

  if (!encoded) {
    return {
      notes: noteText,
      inventory: normalizeInventory(null),
    };
  }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<BarracksEntryInventory>;
    return {
      notes: noteText,
      inventory: normalizeInventory(parsed),
    };
  } catch {
    return {
      notes: raw.trim(),
      inventory: normalizeInventory(null),
    };
  }
}

export function serializeBarracksEntryNotes(
  notes: string | null | undefined,
  inventory: Partial<BarracksEntryInventory> | null | undefined
) {
  const cleanNotes = cleanText(notes);
  const normalizedInventory = normalizeInventory(inventory);

  if (!cleanNotes && !hasTrackedInventory(normalizedInventory)) {
    return null;
  }

  if (!hasTrackedInventory(normalizedInventory)) {
    return cleanNotes || null;
  }

  const encoded = Buffer.from(JSON.stringify(normalizedInventory), "utf8").toString("base64url");
  return cleanNotes ? `${cleanNotes}\n\n${META_MARKER}${encoded}` : `${META_MARKER}${encoded}`;
}
