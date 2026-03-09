#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const INPUT_FILE = path.join(ROOT, "db", "banner_pull_guides.json");
const OUTPUT_FILE = path.join(ROOT, "app", "src", "lib", "bundled-banner-guides.json");
const DEFAULT_MAX_GUIDES = 48;
const DEFAULT_SECTION_LIMIT = 3;
const DEFAULT_SECTION_CONTENT_LIMIT = 420;
const DEFAULT_NOTES_LIMIT = 220;

function sanitizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function trimText(value, limit) {
  const text = sanitizeText(value);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)} …[truncated]`;
}

function isLikelySummonGuideTitle(title) {
  const text = sanitizeText(title).toLowerCase();
  if (!text) return false;

  if (/who should you pull|should you summon|best banners?\s+to summon|banner rankings?/.test(text)) {
    return true;
  }

  if (
    /summoner support|summoner duels|summon simulators?|summon results board|active summon simulators/.test(text)
  ) {
    return false;
  }

  return text.includes(" banner");
}

function normalizeGuide(guide) {
  return {
    id: sanitizeText(guide?.id) || undefined,
    url: sanitizeText(guide?.url) || undefined,
    title: sanitizeText(guide?.title) || undefined,
    scraped_at: sanitizeText(guide?.scraped_at) || undefined,
    guide_sections: Array.isArray(guide?.guide_sections)
      ? guide.guide_sections.slice(0, DEFAULT_SECTION_LIMIT).map((section) => ({
          heading: sanitizeText(section?.heading) || undefined,
          content: trimText(section?.content, DEFAULT_SECTION_CONTENT_LIMIT) || undefined,
        }))
      : [],
    recommendations: Array.isArray(guide?.recommendations)
      ? guide.recommendations.map((recommendation) => ({
          hero_name: sanitizeText(recommendation?.hero_name) || undefined,
          hero_slug_guess: sanitizeText(recommendation?.hero_slug_guess) || undefined,
          tier: sanitizeText(recommendation?.tier) || undefined,
          pull_recommendation: sanitizeText(recommendation?.pull_recommendation) || undefined,
          notes: trimText(recommendation?.notes, DEFAULT_NOTES_LIMIT) || undefined,
        }))
      : [],
  };
}

async function main() {
  const raw = await fs.readFile(INPUT_FILE, "utf8");
  const parsed = JSON.parse(raw);
  const items = Array.isArray(parsed?.items) ? parsed.items : [];

  const normalized = items
    .filter((guide) => isLikelySummonGuideTitle(guide?.title || guide?.id || ""))
    .sort((a, b) => {
      const at = a?.scraped_at ? Date.parse(a.scraped_at) : 0;
      const bt = b?.scraped_at ? Date.parse(b.scraped_at) : 0;
      return bt - at;
    })
    .slice(0, DEFAULT_MAX_GUIDES)
    .map(normalizeGuide);

  await fs.writeFile(OUTPUT_FILE, `${JSON.stringify({ items: normalized }, null, 2)}\n`, "utf8");
  console.log(`Done. ${normalized.length} bundled banner guides written to app/src/lib/bundled-banner-guides.json`);
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
