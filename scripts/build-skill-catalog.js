const fs = require("node:fs/promises");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const OUTPUT_PATH = path.join(__dirname, "..", "db", "skill_catalog.json");

const CATEGORY_PAGES = [
  {
    category: "weapon",
    label: "Weapon Skills",
    url: "https://game8.co/games/fire-emblem-heroes/archives/265412",
    mode: "tablesorter",
  },
  {
    category: "assist",
    label: "Assist Skills",
    url: "https://game8.co/games/fire-emblem-heroes/archives/265413",
    mode: "tablesorter",
  },
  {
    category: "special",
    label: "Special Skills",
    url: "https://game8.co/games/fire-emblem-heroes/archives/265414",
    mode: "tablesorter",
  },
  {
    category: "passive_a",
    label: "Passive A Skills",
    url: "https://game8.co/games/fire-emblem-heroes/archives/265416",
    mode: "tablesorter",
  },
  {
    category: "passive_b",
    label: "Passive B Skills",
    url: "https://game8.co/games/fire-emblem-heroes/archives/265417",
    mode: "tablesorter",
  },
  {
    category: "passive_c",
    label: "Passive C Skills",
    url: "https://game8.co/games/fire-emblem-heroes/archives/265418",
    mode: "tablesorter",
  },
  {
    category: "sacred_seal",
    label: "Sacred Seals",
    url: "https://game8.co/games/fire-emblem-heroes/archives/267543",
    mode: "sacred-seals",
  },
  {
    category: "attuned",
    label: "Attuned Skills",
    url: "https://game8.co/games/fire-emblem-heroes/archives/430372",
    mode: "tablesorter",
  },
  {
    category: "emblem",
    label: "Emblems",
    url: "https://game8.co/games/fire-emblem-heroes/archives/441906",
    mode: "tablesorter",
  },
];

function cleanText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toAbsoluteUrl(value, baseUrl) {
  if (!value) return null;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
}

function normalizeKey(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function makeEntryId(category, name) {
  return `${category}__${normalizeKey(name)}`;
}

function findNearestHeading(node, tagName) {
  let current = node.previousElementSibling;
  while (current) {
    if (current.tagName === tagName) {
      return cleanText(current.textContent);
    }
    current = current.previousElementSibling;
  }
  return null;
}

function getColumnValue(cells, headers, patterns) {
  const index = headers.findIndex((header) =>
    patterns.some((pattern) => header.includes(pattern))
  );
  if (index === -1 || !cells[index]) return null;
  return cleanText(cells[index].textContent);
}

function parseTablesorterPage(document, page) {
  const tables = [...document.querySelectorAll("table.tablesorter")];
  const items = [];

  for (const table of tables) {
    const headers = [...table.querySelectorAll("tr th")].map((cell) => cleanText(cell.textContent));
    if (!headers.length || !headers[0].includes("Skill Name")) {
      continue;
    }

    const sectionHeading = findNearestHeading(table, "H3");
    const groupHeading = findNearestHeading(table, "H2");
    const subcategory =
      sectionHeading && sectionHeading !== page.label && sectionHeading !== groupHeading
        ? sectionHeading
        : groupHeading && groupHeading !== page.label
          ? groupHeading
          : null;

    const rows = [...table.querySelectorAll("tr")].slice(1);
    for (const row of rows) {
      const cells = [...row.children].filter((cell) => cell.tagName === "TD");
      if (!cells.length) continue;

      const primaryLink = cells[0].querySelector('a[href*="/archives/"]');
      const name = cleanText(primaryLink?.textContent || cells[0].textContent);
      if (!name) continue;

      items.push({
        id: makeEntryId(page.category, name),
        name,
        category: page.category,
        category_label: page.label,
        subcategory,
        source: "game8",
        source_url: toAbsoluteUrl(primaryLink?.getAttribute("href"), page.url),
        effect: getColumnValue(cells, headers, ["effect"]),
        sp: getColumnValue(cells, headers, ["sp"]),
        attack: getColumnValue(cells, headers, ["atk"]),
        range: getColumnValue(cells, headers, ["range"]),
        rating: getColumnValue(cells, headers, ["rating"]),
      });
    }
  }

  return items;
}

function parseSacredSealPage(document, page) {
  const header = [...document.querySelectorAll("h2")].find((element) =>
    /Effects and Obtainability of All Sacred Seals/i.test(cleanText(element.textContent))
  );

  if (!header) {
    return [];
  }

  let table = header.nextElementSibling;
  while (table && table.tagName !== "TABLE") {
    table = table.nextElementSibling;
  }
  if (!table) {
    return [];
  }

  const rows = [...table.querySelectorAll("tr")].slice(1);
  return rows
    .map((row) => {
      const cells = [...row.children].filter((cell) => cell.tagName === "TD");
      if (cells.length < 3) return null;

      const primaryLink = cells[0].querySelector('a[href*="/archives/"]');
      const name = cleanText(primaryLink?.textContent || cells[0].textContent);
      if (!name) return null;

      return {
        id: makeEntryId(page.category, name),
        name,
        category: page.category,
        category_label: page.label,
        subcategory: null,
        source: "game8",
        source_url: toAbsoluteUrl(primaryLink?.getAttribute("href"), page.url),
        effect: cleanText(cells[2].textContent),
        sp: null,
        attack: null,
        range: null,
        rating: cleanText(cells[1].textContent) || null,
      };
    })
    .filter(Boolean);
}

async function fetchDocument(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; FEHBarracksSkillCatalog/1.0)",
      accept: "text/html,application/xhtml+xml",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  const html = await response.text();
  return new JSDOM(html).window.document;
}

async function main() {
  const allItems = [];

  for (const page of CATEGORY_PAGES) {
    const document = await fetchDocument(page.url);
    const items =
      page.mode === "sacred-seals"
        ? parseSacredSealPage(document, page)
        : parseTablesorterPage(document, page);

    console.log(`${page.label}: ${items.length} items`);
    allItems.push(...items);
  }

  const deduped = [];
  const seen = new Set();

  for (const item of allItems) {
    const key = `${item.category}::${normalizeKey(item.name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  deduped.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    if ((a.subcategory || "") !== (b.subcategory || "")) {
      return (a.subcategory || "").localeCompare(b.subcategory || "");
    }
    return a.name.localeCompare(b.name);
  });

  const payload = {
    generated_at: new Date().toISOString(),
    source: "game8",
    source_pages: CATEGORY_PAGES.map(({ category, label, url }) => ({ category, label, url })),
    total_items: deduped.length,
    items: deduped,
  };

  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Wrote ${deduped.length} skills to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
