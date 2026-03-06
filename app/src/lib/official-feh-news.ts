export type OfficialFehNewsItem = {
  href: string;
  kind: string;
  date: string;
  title: string;
};

const OFFICIAL_FEH_TOPICS_INCLUDE_URL = "https://fire-emblem-heroes.com/en/include/topics_title.html";
const OFFICIAL_FEH_BASE_URL = "https://fire-emblem-heroes.com";

function decodeHtml(text: string) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanHtmlText(text: string) {
  return decodeHtml(text.replace(/<[^>]+>/g, " "));
}

export async function fetchOfficialFehNews(limit = 4): Promise<OfficialFehNewsItem[]> {
  try {
    const response = await fetch(OFFICIAL_FEH_TOPICS_INCLUDE_URL, {
      next: { revalidate: 900 },
    });

    if (!response.ok) {
      return [];
    }

    const html = await response.text();
    const items: OfficialFehNewsItem[] = [];
    const itemPattern =
      /<li>\s*<a href="([^"]+)">[\s\S]*?<span class="icon">([\s\S]*?)<\/span>[\s\S]*?<span class="date">([\s\S]*?)<\/span>[\s\S]*?<p class="heading">([\s\S]*?)<\/p>/gi;

    let match: RegExpExecArray | null;
    while ((match = itemPattern.exec(html)) && items.length < limit) {
      const [, rawHref, rawKind, rawDate, rawTitle] = match;

      items.push({
        href: new URL(rawHref, OFFICIAL_FEH_BASE_URL).toString(),
        kind: cleanHtmlText(rawKind),
        date: cleanHtmlText(rawDate),
        title: cleanHtmlText(rawTitle),
      });
    }

    return items;
  } catch {
    return [];
  }
}
