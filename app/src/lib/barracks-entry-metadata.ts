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

export const HERO_BLESSING_META = {
  Light: {
    badge: "LGT",
    description: "Offense mythic setup",
    accent: "amber",
  },
  Astra: {
    badge: "AST",
    description: "Burst offense setup",
    accent: "sky",
  },
  Anima: {
    badge: "ANM",
    description: "Defense mythic setup",
    accent: "rose",
  },
  Dark: {
    badge: "DRK",
    description: "Defense trap coverage",
    accent: "violet",
  },
  Fire: {
    badge: "FIR",
    description: "Seasonal stat bonus",
    accent: "red",
  },
  Water: {
    badge: "WTR",
    description: "Seasonal stat bonus",
    accent: "cyan",
  },
  Wind: {
    badge: "WND",
    description: "Seasonal stat bonus",
    accent: "emerald",
  },
  Earth: {
    badge: "ERT",
    description: "Seasonal stat bonus",
    accent: "stone",
  },
} as const satisfies Record<
  (typeof HERO_BLESSING_OPTIONS)[number],
  {
    badge: string;
    description: string;
    accent: "amber" | "sky" | "rose" | "violet" | "red" | "cyan" | "emerald" | "stone";
  }
>;

export const EQUIPPED_SKILL_SLOTS = [
  {
    key: "weapon",
    label: "Weapon",
    shortLabel: "WPN",
    accent: "amber",
    allowedCategories: ["weapon"],
    helperText: "Primary inheritable or exclusive weapon skill.",
    placeholder: "Search weapon skills",
    emptyStateText: "No matching weapon skills found.",
  },
  {
    key: "assist",
    label: "Assist",
    shortLabel: "AST",
    accent: "sky",
    allowedCategories: ["assist"],
    helperText: "Movement, refresh, heal, or reposition support skill.",
    placeholder: "Search assist skills",
    emptyStateText: "No matching assist skills found.",
  },
  {
    key: "special",
    label: "Special",
    shortLabel: "SPC",
    accent: "violet",
    allowedCategories: ["special"],
    helperText: "Triggered combat special currently equipped on the hero.",
    placeholder: "Search special skills",
    emptyStateText: "No matching special skills found.",
  },
  {
    key: "passive_a",
    label: "Passive A",
    shortLabel: "A",
    accent: "rose",
    allowedCategories: ["passive_a"],
    helperText: "Slot A passive for stats, recoil, finish, clash, and more.",
    placeholder: "Search passive A skills",
    emptyStateText: "No matching passive A skills found.",
  },
  {
    key: "passive_b",
    label: "Passive B",
    shortLabel: "B",
    accent: "emerald",
    allowedCategories: ["passive_b"],
    helperText: "Slot B passive for tempo, follow-up, DR, and utility.",
    placeholder: "Search passive B skills",
    emptyStateText: "No matching passive B skills found.",
  },
  {
    key: "passive_c",
    label: "Passive C",
    shortLabel: "C",
    accent: "cyan",
    allowedCategories: ["passive_c"],
    helperText: "Slot C passive for team support, ploys, and field pressure.",
    placeholder: "Search passive C skills",
    emptyStateText: "No matching passive C skills found.",
  },
  {
    key: "sacred_seal",
    label: "Sacred Seal",
    shortLabel: "SEAL",
    accent: "stone",
    allowedCategories: ["sacred_seal"],
    helperText: "Sacred Seal slot used to round out the build.",
    placeholder: "Search sacred seals",
    emptyStateText: "No matching sacred seals found.",
  },
  {
    key: "attuned",
    label: "Attuned",
    shortLabel: "ATN",
    accent: "amber",
    allowedCategories: ["attuned"],
    helperText: "Attuned slot for Echo or attuned effects.",
    placeholder: "Search attuned skills",
    emptyStateText: "No matching attuned skills found.",
  },
  {
    key: "emblem",
    label: "Emblem",
    shortLabel: "EMB",
    accent: "violet",
    allowedCategories: ["emblem"],
    helperText: "Ring or emblem pairing currently assigned to the hero.",
    placeholder: "Search emblems",
    emptyStateText: "No matching emblems found.",
  },
] as const;

export type HeroBlessingOption = (typeof HERO_BLESSING_OPTIONS)[number];
export type EquippedSkillSlotKey = (typeof EQUIPPED_SKILL_SLOTS)[number]["key"];

export type BarracksTrackedSkill = {
  id: string;
  name: string;
  category: string;
  category_label: string | null;
  subcategory: string | null;
  source: string | null;
  source_url: string | null;
  effect: string | null;
  sp: string | null;
  attack: string | null;
  range: string | null;
  rating: string | null;
};

export type BarracksEquippedSkills = Record<EquippedSkillSlotKey, BarracksTrackedSkill | null>;

export type BarracksEntryInventory = {
  blessings: string[];
  equipped: BarracksEquippedSkills;
  fodder: BarracksTrackedSkill[];
  legacy_skills: BarracksTrackedSkill[];
};

export type ParsedBarracksEntryNotes = {
  notes: string;
  inventory: BarracksEntryInventory;
};

const META_MARKER = "[[FEH_BARRACKS_META]]";

function cleanText(value: string | null | undefined) {
  return String(value || "").trim();
}

function normalizeKey(value: string) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function createEmptyEquippedSkills(): BarracksEquippedSkills {
  return {
    weapon: null,
    assist: null,
    special: null,
    passive_a: null,
    passive_b: null,
    passive_c: null,
    sacred_seal: null,
    attuned: null,
    emblem: null,
  };
}

function normalizeSourceUrl(value: string | null | undefined) {
  const text = cleanText(value);
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) return text;
  return null;
}

function normalizeMetaText(value: string | null | undefined) {
  const text = cleanText(value);
  return text || null;
}

export function parseTrackedSkillInput(value: string | null | undefined): BarracksTrackedSkill | null {
  const text = cleanText(value);
  if (!text) return null;

  try {
    const parsed = JSON.parse(text) as Partial<BarracksTrackedSkill>;
    return normalizeTrackedSkill(parsed);
  } catch {
    return normalizeTrackedSkill(text);
  }
}

export function serializeTrackedSkillInput(skill: BarracksTrackedSkill | null | undefined) {
  const normalized = normalizeTrackedSkill(skill);
  if (!normalized) return "";
  return JSON.stringify(normalized);
}

function normalizeTrackedSkill(value: unknown): BarracksTrackedSkill | null {
  if (!value) return null;

  if (typeof value === "string") {
    const name = cleanText(value);
    if (!name) return null;
    return {
      id: `legacy__${normalizeKey(name)}`,
      name,
      category: "legacy",
      category_label: "Legacy",
      subcategory: null,
      source: null,
      source_url: null,
      effect: null,
      sp: null,
      attack: null,
      range: null,
      rating: null,
    };
  }

  if (typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<BarracksTrackedSkill>;
  const name = cleanText(candidate.name);
  if (!name) return null;

  const category = cleanText(candidate.category) || "legacy";
  return {
    id: cleanText(candidate.id) || `${category}__${normalizeKey(name)}`,
    name,
    category,
    category_label: cleanText(candidate.category_label) || (category === "legacy" ? "Legacy" : null),
    subcategory: cleanText(candidate.subcategory) || null,
    source: normalizeMetaText(candidate.source),
    source_url: normalizeSourceUrl(candidate.source_url),
    effect: normalizeMetaText(candidate.effect),
    sp: normalizeMetaText(candidate.sp),
    attack: normalizeMetaText(candidate.attack),
    range: normalizeMetaText(candidate.range),
    rating: normalizeMetaText(candidate.rating),
  };
}

function dedupeTrackedSkills(values: Array<BarracksTrackedSkill | null>) {
  const seen = new Set<string>();
  const result: BarracksTrackedSkill[] = [];

  for (const value of values) {
    if (!value) continue;
    const normalized = normalizeTrackedSkill(value);
    if (!normalized) continue;
    const key = cleanText(normalized.id) || `${normalized.category}:${normalizeKey(normalized.name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function normalizeEquippedSkills(value: unknown): BarracksEquippedSkills {
  const result = createEmptyEquippedSkills();

  if (!value || typeof value !== "object") {
    return result;
  }

  const candidate = value as Partial<Record<EquippedSkillSlotKey, unknown>>;
  for (const slot of EQUIPPED_SKILL_SLOTS) {
    result[slot.key] = normalizeTrackedSkill(candidate?.[slot.key]) || null;
  }

  return result;
}

function normalizeInventory(inventory: unknown): BarracksEntryInventory {
  const candidate =
    inventory && typeof inventory === "object"
      ? (inventory as Partial<{
          blessings: string[];
          equipped: Partial<Record<EquippedSkillSlotKey, unknown>>;
          fodder: unknown[];
          skills: unknown[];
          legacy_skills: unknown[];
        }>)
      : {};

  return {
    blessings: (candidate.blessings || [])
      .map((value) => cleanText(value))
      .filter((value): value is string => HERO_BLESSING_OPTIONS.includes(value as HeroBlessingOption)),
    equipped: normalizeEquippedSkills(candidate.equipped),
    fodder: dedupeTrackedSkills((candidate.fodder || []).map((value) => normalizeTrackedSkill(value))),
    legacy_skills: dedupeTrackedSkills([
      ...((candidate.legacy_skills || []).map((value) => normalizeTrackedSkill(value))),
      ...((candidate.skills || []).map((value) => normalizeTrackedSkill(value))),
    ]),
  };
}

function pruneInventory(inventory: BarracksEntryInventory) {
  const equipped: Partial<Record<EquippedSkillSlotKey, BarracksTrackedSkill>> = {};

  for (const slot of EQUIPPED_SKILL_SLOTS) {
    const value = inventory.equipped[slot.key];
    if (value) {
      equipped[slot.key] = value;
    }
  }

  return {
    blessings: inventory.blessings,
    equipped,
    fodder: inventory.fodder,
    legacy_skills: inventory.legacy_skills,
  };
}

export function countEquippedSkills(inventory: BarracksEntryInventory | null | undefined) {
  const normalized = normalizeInventory(inventory);
  return EQUIPPED_SKILL_SLOTS.reduce((count, slot) => (normalized.equipped[slot.key] ? count + 1 : count), 0);
}

export function hasTrackedInventory(inventory: BarracksEntryInventory | null | undefined) {
  const normalized = normalizeInventory(inventory);
  return Boolean(
    normalized.blessings.length ||
      countEquippedSkills(normalized) ||
      normalized.fodder.length ||
      normalized.legacy_skills.length
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
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
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

  const encoded = Buffer.from(JSON.stringify(pruneInventory(normalizedInventory)), "utf8").toString("base64url");
  return cleanNotes ? `${cleanNotes}\n\n${META_MARKER}${encoded}` : `${META_MARKER}${encoded}`;
}
