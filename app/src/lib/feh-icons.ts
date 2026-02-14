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

export function rarityStarsText(rarity?: string | null) {
  if (!rarity) return "-";
  const values = Array.from(new Set((rarity.match(/[1-5](?:\.5)?/g) || []).map((v) => v.trim())));
  if (!values.length) return rarity;
  return values.map((v) => `${v}★`).join("/");
}
