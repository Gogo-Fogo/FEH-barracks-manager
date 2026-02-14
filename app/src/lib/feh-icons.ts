export function weaponIconName(weapon?: string | null) {
  if (!weapon) return null;
  const w = weapon.toLowerCase();
  const color = w.includes("red") ? "Red" : w.includes("blue") ? "Blue" : w.includes("green") ? "Green" : "Colorless";

  if (w.includes("sword")) return "Icon_Class_Red_Sword.png";
  if (w.includes("lance")) return "Icon_Class_Blue_Lance.png";
  if (w.includes("axe")) return "Icon_Class_Green_Axe.png";
  if (w.includes("staff")) return "Icon_Class_Colorless_Staff.png";
  if (w.includes("tome")) return `Icon_Class_${color}_Tome.png`;
  if (w.includes("bow")) return `Icon_Class_${color}_Bow.png`;
  if (w.includes("dagger")) return `Icon_Class_${color}_Dagger.png`;
  if (w.includes("breath") || w.includes("dragon")) return `Icon_Class_${color}_Breath.png`;
  if (w.includes("beast")) return `Icon_Class_${color}_Beast.png`;
  return null;
}

export function moveIconName(move?: string | null) {
  if (!move) return null;
  const m = move.toLowerCase();
  if (m.includes("infantry")) return "Icon_Move_Infantry.png";
  if (m.includes("armor")) return "Icon_Move_Armored.png";
  if (m.includes("flying")) return "Icon_Move_Flying.png";
  if (m.includes("cavalry")) return "Icon_Move_Cavalry.png";
  return null;
}

export function rarityIconName(rarity?: string | null) {
  if (!rarity) return null;
  const r = rarity.toLowerCase().replace(/\s+/g, "");

  if (r.includes("4.5") || r.includes("4-5") || r.includes("4/5")) return "Icon_Rarity_4.5.png";
  if (r.includes("5")) return "Icon_Rarity_5.png";
  if (r.includes("4")) return "Icon_Rarity_4.png";
  if (r.includes("3")) return "Icon_Rarity_3.png";
  if (r.includes("2")) return "Icon_Rarity_2.png";
  if (r.includes("1")) return "Icon_Rarity_1.png";

  return null;
}

export type HeroRarity = number | "Legendary" | "Mythic";

export function normalizeRarities(
  rarity?: string | null,
  rarities?: Array<number | string> | null
): HeroRarity[] {
  const out: HeroRarity[] = [];
  const pushUnique = (value: HeroRarity) => {
    if (!out.includes(value)) out.push(value);
  };

  if (Array.isArray(rarities)) {
    for (const entry of rarities) {
      if (typeof entry === "number" && entry >= 1 && entry <= 5) {
        pushUnique(entry as HeroRarity);
      } else if (String(entry).toLowerCase() === "legendary") {
        pushUnique("Legendary");
      } else if (String(entry).toLowerCase() === "mythic") {
        pushUnique("Mythic");
      }
    }
  }

  if (!out.length && rarity) {
    const matches = rarity.match(/[1-5](?:\.5)?/g) || [];
    for (const value of matches) {
      if (value === "4.5") {
        pushUnique(4);
        pushUnique(5);
      } else {
        pushUnique(Number(value) as HeroRarity);
      }
    }

    if (/\blegendary\b/i.test(rarity)) pushUnique("Legendary");
    if (/\bmythic\b/i.test(rarity)) pushUnique("Mythic");
  }

  return out.sort((a, b) => {
    const aNum = typeof a === "number" ? a : 99;
    const bNum = typeof b === "number" ? b : 99;
    return aNum - bNum;
  });
}

export function rarityIconNames(rarity?: string | null, rarities?: Array<number | string> | null) {
  return normalizeRarities(rarity, rarities)
    .filter((value): value is number => typeof value === "number")
    .map((star) => `Icon_Rarity_${star}.png`);
}

export function rarityStarsText(rarity?: string | null, rarities?: Array<number | string> | null) {
  const normalized = normalizeRarities(rarity, rarities);
  if (!normalized.length) return rarity || "-";

  const stars = normalized.filter((value): value is number => typeof value === "number");
  const traits = normalized.filter((value): value is "Legendary" | "Mythic" => typeof value === "string");

  const starText = stars.length ? stars.map((value) => `${value}★`).join("/") : "";
  return [starText, ...traits].filter(Boolean).join(" ");
}
