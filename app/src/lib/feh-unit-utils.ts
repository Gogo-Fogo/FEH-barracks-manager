/**
 * Pure FEH unit utility functions — no Node.js fs, no Next.js server APIs.
 * Safe to import from both server components and client components.
 */

// ── Artist name extraction ─────────────────────────────────────────────────────

function normalizeArtistText(raw?: string | null) {
  return String(raw || "")
    .replace(/\s+/g, " ")
    .replace(/\s([,.!?;:])/g, "$1")
    .trim();
}

function cleanArtistCandidate(value?: string | null) {
  let candidate = String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^[\s:：\-–—|]+/, "")
    .trim();

  candidate = candidate
    .replace(
      /\s+(Appears In|Illustration|How to Get|Voice Actor(?:\s*\(English\))?|Quotes?|FEH:|Related Guides|Attire|Distribution Date|Starts|Ends|Obtain(?:ed)? Through)\b[\s\S]*$/i,
      ""
    )
    .replace(/[,;!?…]+$/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!candidate) return null;
  if (candidate.length > 100) return null;
  if (/^(none|unknown|n\/?a|information)$/i.test(candidate)) return null;
  if (!/[\p{L}\p{N}]/u.test(candidate)) return null;
  return candidate;
}

function extractLegacyIllustratorFromRawText(rawText?: string | null) {
  const compact = normalizeArtistText(rawText);
  if (!compact) return null;

  const matches = Array.from(
    compact.matchAll(/Illustrator\s+([A-Za-z0-9''().,&\- ]{2,140})/gi)
  );
  for (let i = matches.length - 1; i >= 0; i--) {
    const cleaned = cleanArtistCandidate(matches[i]?.[1]);
    if (cleaned) return cleaned;
  }
  return null;
}

export function extractIllustratorFromRawText(rawText?: string | null): string | null {
  const compact = normalizeArtistText(rawText);
  if (!compact) return null;

  const markers =
    "Appears In|Illustration|FEH:|Related Guides|How to Get|Voice Actor(?:\\s*\\(English\\))?|Quotes?|Attire|Distribution Date|Starts|Ends|Obtain(?:ed)? Through";

  const patterns = [
    new RegExp(
      `Voice Actor(?:\\s*\\(English\\))?\\s+.{1,120}?\\s+Illustrator\\s*[:：\\-]?\\s*(.{1,140}?)(?=\\s+(?:${markers})|$)`,
      "gi"
    ),
    new RegExp(
      `Illustrator\\s*[:：\\-]?\\s*(.{1,160}?)(?=\\s+(?:${markers})|$)`,
      "gi"
    ),
  ];

  const candidates: string[] = [];
  for (const pattern of patterns) {
    for (const match of compact.matchAll(pattern)) {
      const captured = String(match?.[1] || "");
      if (captured) candidates.push(captured);
    }
  }
  for (let i = candidates.length - 1; i >= 0; i--) {
    const cleaned = cleanArtistCandidate(candidates[i]);
    if (cleaned) return cleaned;
  }
  return extractLegacyIllustratorFromRawText(rawText);
}

// ── Quote extraction ───────────────────────────────────────────────────────────

export function extractQuoteCandidates(rawText?: string | null): string[] {
  if (!rawText) return [];

  const allowedSections = new Set([
    "summoning", "castle", "friend greeting", "leveling up", "ally growth",
    "5★ lv. 40 conversation", "special trigger", "defeat", "status page", "turn action",
  ]);

  const sectionHeading = /^(.+?)\s*\[[^\]]*\]\s*$/;
  const noiseHeading   = /^(general|quotes|misc|audio|transcription|rarity|story appearances|random quote)$/i;
  const markerNoise    = /^(\+\[[0-9,]+\]\s*points|\*spit\*|upload file|-|\[[^\]]*\])$/i;

  const lines = rawText.split(/\r?\n+/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const unique: string[] = [];
  let inAllowedSection = false;

  for (const line of lines) {
    if (/^story appearances\b/i.test(line))  { inAllowedSection = false; continue; }
    if (/^random quote\b/i.test(line))       { inAllowedSection = false; continue; }

    const sectionMatch = line.match(sectionHeading);
    if (sectionMatch?.[1]) {
      inAllowedSection = allowedSections.has(sectionMatch[1].toLowerCase());
      continue;
    }

    if (!inAllowedSection) continue;
    if (line.length < 10 || line.length > 220)         continue;
    if (/^https?:\/\//i.test(line))                    continue;
    if (noiseHeading.test(line))                        continue;
    if (markerNoise.test(line))                         continue;
    if (/\(map\)/i.test(line))                          continue;
    if (/&#\d+;|&nbsp;/i.test(line))                   continue;
    if (/^\([^)]*\)$/.test(line))                      continue;
    if (/upload file/i.test(line))                      continue;
    if (/\/Story\b/i.test(line))                        continue;
    if (/^in\s.+\/story$/i.test(line))                 continue;
    if (/^(name|source|fandom|extracted_at)\b/i.test(line)) continue;
    if (!/[A-Za-z]/.test(line))                        continue;
    if (/[ぁ-んァ-ン一-龯]/.test(line))                continue;
    if (/^[\d\[\]().,:;!/?%+\-\s]+$/.test(line))      continue;

    if (!unique.includes(line)) unique.push(line);
    if (unique.length >= 80) break;
  }
  return unique;
}

// ── Guide highlights ───────────────────────────────────────────────────────────

export type GuideHighlights = {
  role: string[];
  strengths: string[];
  weaknesses: string[];
  tips: string[];
  counters: string[];
};

export function normalizeGuideText(raw?: string | null): string {
  return (raw || "").replace(/\s+/g, " ").replace(/\s([,.!?;:])/g, "$1").trim();
}

function pickMatches(sentences: string[], patterns: RegExp[], limit = 3): string[] {
  const selected: string[] = [];
  for (const s of sentences) {
    if (!s || s.length < 20) continue;
    if (patterns.some((p) => p.test(s))) {
      if (!selected.includes(s)) selected.push(s);
      if (selected.length >= limit) break;
    }
  }
  return selected;
}

export function buildGuideHighlights(rawText?: string | null): GuideHighlights {
  const normalized = normalizeGuideText(rawText);
  const sentences  = normalized.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  return {
    role:       pickMatches(sentences, [/\brole\b/i, /\bplaystyle\b/i, /\bexcels\b/i, /\bworks best\b/i]),
    strengths:  pickMatches(sentences, [/\bstrength\b/i, /\bstrong\b/i, /\bexcellent\b/i, /\bhigh\b/i, /\badvantage\b/i]),
    weaknesses: pickMatches(sentences, [/\bweak\b/i, /\bweakness\b/i, /\bstruggle\b/i, /\bvulnerable\b/i, /\bcaution\b/i]),
    tips:       pickMatches(sentences, [/\btip\b/i, /\brecommend\b/i, /\bposition\b/i, /\buse\b/i, /\bprioritize\b/i]),
    counters:   pickMatches(sentences, [/\bcounter\b/i, /\bagainst\b/i, /\bthreat\b/i, /\bmatchup\b/i]),
  };
}

// ── Skill description extraction ───────────────────────────────────────────────

export type SkillHint =
  | "weapon" | "assist" | "special" | "emblem"
  | "passive_a" | "passive_b" | "passive_c" | "sacred_seal" | "attuned";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeSkillKey(value?: string | null): string {
  return (value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[']/g, "'")
    .replace(/[^A-Za-z0-9+/'().\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function cleanDescription(value?: string | null): string | null {
  const cleaned = (value || "").replace(/\s+/g, " ").replace(/\s([,.;!?])/g, "$1").trim();
  if (!cleaned) return null;
  if (cleaned.length <= 520) return cleaned;
  return `${cleaned.slice(0, 517)}...`;
}

/**
 * Extracts a skill's effect description from a single raw_text_data string.
 * (No cross-unit lookup — uses only the provided rawText.)
 */
export function extractSkillDescriptionFromRaw(
  rawText: string | undefined,
  skillName: string,
  hint: SkillHint
): string | null {
  if (!rawText || !skillName || skillName.trim() === "-") return null;
  const compact = rawText.replace(/\s+/g, " ").trim();
  if (!compact) return null;

  const escaped = escapeRegExp(skillName.trim());

  const patterns =
    hint === "weapon"
      ? [
          new RegExp(
            `${escaped}\\s+Might:\\s*\\d+\\s+Range:\\s*\\d+\\s*([\\s\\S]{12,1200}?)(?=\\s+[A-Za-z0-9'+./\\- ]+\\s+Cooldown Count\\s*=|\\s+[A-Za-z0-9'+./\\- ]+\\s+Best IVs|\\s+[A-Za-z0-9'+./\\- ]+\\s+Best Builds|\\s+[A-Za-z0-9'+./\\- ]+\\s+Best Weapon Refine|$)`,
            "i"
          ),
          new RegExp(
            `${escaped}\\s+\\d+\\s+\\d+\\s*([\\s\\S]{12,1200}?)(?=\\s+[345]\u2605|\\s+Assists\\s+This Hero|\\s+Specials\\s+Skill Name|\\s+Passives\\s+Skill Name|$)`,
            "i"
          ),
        ]
      : hint === "special"
        ? [
            new RegExp(
              `${escaped}\\s*\\(Cooldown Count\\s*=\\s*\\d+\\)\\s*([\\s\\S]{10,900}?)(?=\\s+[345]\u2605|\\s+[A-Za-z0-9'+./\\- ]+\\s*\\(Cooldown Count\\s*=|\\s+Passives\\s+Skill Name|\\s+[A-Za-z0-9'+./\\- ]+\\s+as a Source Hero|\\s+How to Get|$)`,
              "i"
            ),
            new RegExp(
              `${escaped}\\s+Cooldown Count\\s*=\\s*\\d+\\s*([\\s\\S]{10,900}?)(?=\\s+[A-Za-z0-9'+./\\- ]+\\s+(?:At start of combat|Inflicts|After combat|Boosts|Treats)|\\s+[A-Za-z0-9'+./\\- ]+\\s+Best IVs|\\s+[A-Za-z0-9'+./\\- ]+\\s+Best Builds|$)`,
              "i"
            ),
          ]
        : [
            new RegExp(
              `${escaped}\\s+(?:Range:\\s*\\d+\\s+)?(?:Might:\\s*\\d+\\s+)?([\\s\\S]{8,900}?)(?=\\s+[345]\u2605|\\s+[A-Za-z0-9'+./\\- ]{2,90}\\s+(?:Might:|Range:|Cooldown Count|Best IVs|Best Builds|How to Get|Stats|Roles)|$)`,
              "i"
            ),
          ];

  for (const pattern of patterns) {
    const match   = compact.match(pattern);
    const cleaned = cleanDescription(match?.[1]);
    if (cleaned) return cleaned;
  }

  const fallback = compact.match(new RegExp(`${escaped}\\s+([\\s\\S]{10,460})`, "i"));
  if (fallback?.[1]) {
    let snippet = fallback[1]
      .replace(/^Might:\s*\d+\s*/i, "")
      .replace(/^Range:\s*\d+\s*/i, "")
      .replace(/^Cooldown Count\s*=\s*\d+\s*/i, "")
      .replace(/^SP:\s*\d+\s*/i, "")
      .replace(/\s+[345]★[\s\S]*$/i, "")
      .replace(
        /\s+[A-Za-z0-9'+./\- ]{2,90}\s+(?:Might:|Range:|Cooldown Count|Best IVs|Best Builds|How to Get|Stats|Roles)[\s\S]*$/i,
        ""
      )
      .trim();

    const effectStart = snippet.search(
      /\b(If|Inflicts|Grants|Restores|Boosts|Treats|At start of|During combat|After combat|Effective against|Moves|Push|Target|Unit can|Enables|Neutralizes|Accelerates|Deals)\b/i
    );
    if (effectStart > 0) snippet = snippet.slice(effectStart).trim();

    const cleaned = cleanDescription(snippet);
    if (cleaned) return cleaned;
  }

  return null;
}

// ── Build helpers ──────────────────────────────────────────────────────────────

export const BUILD_KEY_ORDER = [
  "weapon", "assist", "special", "emblem",
  "passive_a", "passive_b", "passive_c", "sacred_seal", "attuned",
] as const;

export function buildKeyLabel(key: string): string {
  const labels: Record<string, string> = {
    weapon: "Weapon", assist: "Assist", special: "Special", emblem: "Emblem",
    passive_a: "Passive A", passive_b: "Passive B", passive_c: "Passive C",
    sacred_seal: "Sacred Seal", attuned: "Attuned",
  };
  return labels[key] ?? key.replaceAll("_", " ");
}

export function deriveSpecialFromRawText(rawText?: string | null): string | null {
  const compact = normalizeGuideText(rawText);
  if (!compact) return null;

  const patterns = [
    /Skills at 5★[\s\S]{0,750}?\b([A-Z][A-Za-z0-9''+./\- ]{1,60})\s+Cooldown Count\s*=\s*\d+/i,
    /Specials\s+Skill Name\s+Effect\s+Learned At\s+([A-Z][A-Za-z0-9''+./\- ]{1,60})\s*\(Cooldown Count\s*=\s*\d+\)/i,
  ];
  for (const pattern of patterns) {
    const match     = compact.match(pattern);
    const candidate = match?.[1]?.replace(/\s+/g, " ").trim();
    if (!candidate) continue;
    if (/^(skills?|specials?|cooldown|count|effect|learned|at)$/i.test(candidate)) continue;
    return candidate;
  }
  return null;
}

export function skillWikiUrl(skillName: string): string {
  return `https://feheroes.fandom.com/wiki/${skillName.replace(/ /g, "_")}`;
}
