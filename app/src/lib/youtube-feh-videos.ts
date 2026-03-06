import type { OfficialFehNewsItem } from "@/lib/official-feh-news";

export type FehVideoItem = {
  videoId: string;
  href: string;
  title: string;
  channel: string;
  descriptionText: string;
  publishedText: string;
  viewCountText: string;
  durationText: string;
  thumbnailUrl: string;
  sourceTopicTitle: string;
};

const YOUTUBE_BASE_URL = "https://www.youtube.com";
const YOUTUBE_SEARCH_URL = "https://www.youtube.com/results";
const YT_INITIAL_DATA_MARKER = "var ytInitialData = ";
const FEH_RELEVANCE_MARKERS = [
  "fire emblem heroes",
  " feh ",
  "feh ",
  " aether raids",
  "summoner duels",
  "hall of forms",
  "forging bonds",
  "tempest trials",
  "grand hero battle",
  "bound hero battle",
  "voting gauntlet",
  "binding worlds",
  "seers snare",
  "seer s snare",
  "resplendent",
  "mythic hero",
  "legendary hero",
  "emblem hero",
  "attuned",
  "rearmed",
  "harmonic hero",
  "duo hero",
  "ascended",
  "arcane",
];

function normalizeText(text: string) {
  return text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9. ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTopicMonth(dateText: string) {
  const [monthRaw, , yearRaw] = dateText.split("/");
  const month = Number(monthRaw || "0");
  const year = Number(yearRaw || "0");
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  if (!month || month < 1 || month > 12 || !year) return "";
  return `${monthNames[month - 1]} ${year}`;
}

function simplifyTopicTitle(item: OfficialFehNewsItem) {
  const title = item.title;
  const versionMatch = title.match(/\b\d+\.\d+\.\d+\b/);
  if (versionMatch) {
    return `${versionMatch[0]} update`;
  }

  if (/event calendar/i.test(title)) {
    const monthLabel = parseTopicMonth(item.date);
    return monthLabel ? `${monthLabel} event calendar` : "event calendar";
  }

  return title
    .replace(/^what'?s in store for the\s+/i, "")
    .replace(/^it'?s the\s+/i, "")
    .replace(/\bis here!?$/i, "")
    .replace(/[!]/g, "")
    .trim();
}

function buildQueries(newsItems: OfficialFehNewsItem[]) {
  const queries = new Map<string, string>();

  for (const item of newsItems.slice(0, 3)) {
    const topic = simplifyTopicTitle(item);
    const query = `Fire Emblem Heroes ${topic}`;
    queries.set(query, item.title);
  }

  return Array.from(queries.entries()).map(([query, sourceTopicTitle]) => ({
    query,
    sourceTopicTitle,
  }));
}

function extractInitialDataJson(html: string) {
  const start = html.indexOf(YT_INITIAL_DATA_MARKER);
  if (start < 0) return null;

  const jsonStart = start + YT_INITIAL_DATA_MARKER.length;
  const jsonEnd = html.indexOf(";</script>", jsonStart);
  if (jsonEnd < 0) return null;

  return html.slice(jsonStart, jsonEnd);
}

function collectVideoRenderers(node: unknown, results: Array<Record<string, unknown>>) {
  if (!node || typeof node !== "object") return;

  if (Array.isArray(node)) {
    for (const item of node) {
      collectVideoRenderers(item, results);
    }
    return;
  }

  const asRecord = node as Record<string, unknown>;
  const videoRenderer = asRecord.videoRenderer;
  if (videoRenderer && typeof videoRenderer === "object" && !Array.isArray(videoRenderer)) {
    results.push(videoRenderer as Record<string, unknown>);
  }

  for (const value of Object.values(asRecord)) {
    collectVideoRenderers(value, results);
  }
}

function readRunText(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const runs = (value as { runs?: Array<{ text?: string }>; simpleText?: string }).runs;
  if (Array.isArray(runs) && runs.length) {
    return runs.map((run) => run.text || "").join("").trim();
  }
  return String((value as { simpleText?: string }).simpleText || "").trim();
}

function parseViewCount(text: string) {
  const match = text.replace(/,/g, "").match(/([\d.]+)\s*([KMB])?/i);
  if (!match) return 0;
  const base = Number(match[1] || "0");
  const suffix = (match[2] || "").toUpperCase();
  const multiplier = suffix === "K" ? 1_000 : suffix === "M" ? 1_000_000 : suffix === "B" ? 1_000_000_000 : 1;
  return Math.round(base * multiplier);
}

function parsePublishedAgeDays(text: string) {
  const normalized = normalizeText(text);
  const match = normalized.match(/(\d+)\s+(minute|hour|day|week|month|year)/);
  if (!match) return 9999;

  const value = Number(match[1] || "0");
  const unit = match[2];

  if (unit === "minute") return value / 1440;
  if (unit === "hour") return value / 24;
  if (unit === "day") return value;
  if (unit === "week") return value * 7;
  if (unit === "month") return value * 30;
  if (unit === "year") return value * 365;
  return 9999;
}

function durationToSeconds(text: string) {
  const parts = text.split(":").map((part) => Number(part || "0"));
  if (!parts.length || parts.some((part) => Number.isNaN(part))) return 0;

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return parts[0];
}

function buildSearchTerms(query: string) {
  return normalizeText(query)
    .split(" ")
    .filter((term) => term.length > 2)
    .filter((term) => !["fire", "emblem", "heroes", "update", "new"].includes(term));
}

function buildCombinedVideoText(video: Pick<FehVideoItem, "title" | "channel" | "descriptionText">) {
  return normalizeText([video.title, video.channel, video.descriptionText].filter(Boolean).join(" "));
}

function hasFehMarker(text: string) {
  return FEH_RELEVANCE_MARKERS.some((marker) => text.includes(marker));
}

function matchesTopicTerms(text: string, query: string) {
  const queryTerms = buildSearchTerms(query);
  if (!queryTerms.length) return true;
  return queryTerms.some((term) => text.includes(term));
}

function isFehRelevantVideo(video: FehVideoItem, query: string) {
  const combinedText = buildCombinedVideoText(video);
  if (!hasFehMarker(combinedText)) {
    return false;
  }
  return matchesTopicTerms(combinedText, query);
}

function scoreVideo(video: FehVideoItem, query: string) {
  const normalizedTitle = normalizeText(video.title);
  const normalizedCombined = buildCombinedVideoText(video);
  const queryTerms = buildSearchTerms(query);
  const matchCount = queryTerms.filter((term) => normalizedCombined.includes(term)).length;
  const viewScore = Math.log10(parseViewCount(video.viewCountText) + 10);
  const ageDays = parsePublishedAgeDays(video.publishedText);
  const recencyScore = Math.max(0, 25 - ageDays);
  const topicMentionScore =
    normalizedTitle.includes("fire emblem heroes") || normalizedTitle.includes(" feh ") || normalizedTitle.startsWith("feh ")
      ? 8
      : 0;
  const fehMarkerScore = hasFehMarker(normalizedCombined) ? 18 : -40;
  const durationSeconds = durationToSeconds(video.durationText);
  const longFormPenalty = durationSeconds > 0 && durationSeconds < 61 ? -30 : 0;

  return matchCount * 16 + viewScore * 4 + recencyScore + topicMentionScore + fehMarkerScore + longFormPenalty;
}

async function searchYouTube(query: string, sourceTopicTitle: string): Promise<FehVideoItem[]> {
  const searchUrl = new URL(YOUTUBE_SEARCH_URL);
  searchUrl.searchParams.set("search_query", query);

  const response = await fetch(searchUrl.toString(), {
    headers: {
      "User-Agent": "Mozilla/5.0",
    },
    next: { revalidate: 900 },
  });

  if (!response.ok) {
    return [];
  }

  const html = await response.text();
  const rawJson = extractInitialDataJson(html);
  if (!rawJson) {
    return [];
  }

  const data = JSON.parse(rawJson) as unknown;
  const renderers: Array<Record<string, unknown>> = [];
  collectVideoRenderers(data, renderers);

  const videos = renderers
    .map((video): FehVideoItem | null => {
      const href = String(
        ((video.navigationEndpoint as { commandMetadata?: { webCommandMetadata?: { url?: string } } })?.commandMetadata
          ?.webCommandMetadata?.url || "")
      );
      if (!href.startsWith("/watch")) return null;

      const title = readRunText(video.title);
      const channel = readRunText(video.longBylineText) || readRunText(video.ownerText);
      const descriptionText = readRunText(video.detailedMetadataSnippets) || readRunText(video.descriptionSnippet);
      const publishedText = readRunText(video.publishedTimeText);
      const viewCountText = readRunText(video.viewCountText);
      const durationText = readRunText(video.lengthText);
      const thumbnails =
        ((video.thumbnail as { thumbnails?: Array<{ url?: string }> })?.thumbnails || []).filter((thumb) => thumb?.url) || [];
      const thumbnailUrl = String(thumbnails[thumbnails.length - 1]?.url || "");
      const videoId = String((video.videoId as string) || "");

      if (!title || !channel || !videoId) return null;

      return {
        videoId,
        href: new URL(href, YOUTUBE_BASE_URL).toString(),
        title,
        channel,
        descriptionText,
        publishedText,
        viewCountText,
        durationText,
        thumbnailUrl,
        sourceTopicTitle,
      };
    })
    .filter((video): video is FehVideoItem => Boolean(video));

  return videos
    .filter((video) => parsePublishedAgeDays(video.publishedText) <= 60)
    .filter((video) => durationToSeconds(video.durationText) >= 61)
    .filter((video) => isFehRelevantVideo(video, query))
    .sort((a, b) => scoreVideo(b, query) - scoreVideo(a, query))
    .slice(0, 8);
}

export async function fetchRecentFehVideos(newsItems: OfficialFehNewsItem[], limit = 3): Promise<FehVideoItem[]> {
  const queries = buildQueries(newsItems);
  if (!queries.length) return [];

  try {
    const batches = await Promise.all(
      queries.map(({ query, sourceTopicTitle }) => searchYouTube(query, sourceTopicTitle))
    );

    const deduped = new Map<string, FehVideoItem>();
    for (const videos of batches) {
      for (const video of videos) {
        if (!deduped.has(video.videoId)) {
          deduped.set(video.videoId, video);
        }
      }
    }

    return Array.from(deduped.values())
      .sort((a, b) => {
        const aScore = scoreVideo(a, `Fire Emblem Heroes ${a.sourceTopicTitle}`);
        const bScore = scoreVideo(b, `Fire Emblem Heroes ${b.sourceTopicTitle}`);
        return bScore - aScore;
      })
      .slice(0, limit);
  } catch {
    return [];
  }
}
