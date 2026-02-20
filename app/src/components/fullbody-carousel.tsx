"use client";

import { useState } from "react";

type FullbodyCarouselProps = {
  heroName: string;
  poses: string[];
  heroSlug: string;
  quotes?: string[];
  initialBackgroundName?: string;
  backgroundOptions?: string[];
  persistBackgroundPreference?: boolean;
};

function poseLabel(pose: string) {
  return pose.charAt(0).toUpperCase() + pose.slice(1);
}

export function FullbodyCarousel({
  heroName,
  poses,
  heroSlug,
  quotes,
  initialBackgroundName,
  backgroundOptions,
  persistBackgroundPreference = true,
}: FullbodyCarouselProps) {
  const safePoses = poses.length ? poses : ["portrait"];
  const safeQuotes = (quotes || []).filter(Boolean);
  const safeBackgrounds =
    backgroundOptions?.length
      ? backgroundOptions
      : initialBackgroundName
        ? [initialBackgroundName]
        : [];

  const [index, setIndex] = useState(0);
  const [quoteIndex, setQuoteIndex] = useState(() =>
    safeQuotes.length ? Math.floor(Math.random() * safeQuotes.length) : 0
  );
  const [isExpanded, setIsExpanded] = useState(false);
  const initialBackgroundIndex = Math.max(0, safeBackgrounds.indexOf(initialBackgroundName || ""));
  const [backgroundIndex, setBackgroundIndex] = useState(initialBackgroundIndex);

  const currentPose = safePoses[index] || safePoses[0];
  const normalizedQuoteIndex = safeQuotes.length
    ? ((quoteIndex % safeQuotes.length) + safeQuotes.length) % safeQuotes.length
    : 0;
  const currentQuote = safeQuotes[normalizedQuoteIndex] || "";
  const currentBackground = safeBackgrounds[backgroundIndex] || initialBackgroundName;

  const prev = () => setIndex((i) => (i - 1 + safePoses.length) % safePoses.length);
  const next = () => setIndex((i) => (i + 1) % safePoses.length);
  const prevQuote = () => setQuoteIndex((i) => (i - 1 + safeQuotes.length) % safeQuotes.length);
  const nextQuote = () => setQuoteIndex((i) => (i + 1) % safeQuotes.length);

  const persistBackground = (backgroundName: string) => {
    if (!backgroundName) return;

    try {
      document.cookie = `hero_bg_${heroSlug}=${encodeURIComponent(backgroundName)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    } catch {
      // ignore cookie write issues
    }

    if (!persistBackgroundPreference) return;

    void fetch("/api/hero-background-preference", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        heroSlug,
        backgroundName,
      }),
    });
  };

  const prevBackground = () => {
    if (!safeBackgrounds.length) return;
    setBackgroundIndex((i) => {
      const nextIndex = (i - 1 + safeBackgrounds.length) % safeBackgrounds.length;
      const nextBackground = safeBackgrounds[nextIndex];
      if (nextBackground) persistBackground(nextBackground);
      return nextIndex;
    });
  };

  const nextBackground = () => {
    if (!safeBackgrounds.length) return;
    setBackgroundIndex((i) => {
      const nextIndex = (i + 1) % safeBackgrounds.length;
      const nextBackground = safeBackgrounds[nextIndex];
      if (nextBackground) persistBackground(nextBackground);
      return nextIndex;
    });
  };

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      {safeQuotes.length ? (
        <div className="mb-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
          {safeQuotes.length > 1 ? (
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={prevQuote}
                className="rounded-md border border-zinc-700 px-2 py-0.5 text-xs hover:bg-zinc-800"
                aria-label="Previous quote"
              >
                ←
              </button>
              <p className="text-xs text-zinc-400">
                Quote {normalizedQuoteIndex + 1}/{safeQuotes.length}
              </p>
              <button
                type="button"
                onClick={nextQuote}
                className="rounded-md border border-zinc-700 px-2 py-0.5 text-xs hover:bg-zinc-800"
                aria-label="Next quote"
              >
                →
              </button>
            </div>
          ) : (
            <p className="text-xs text-zinc-400">Quote 1/1</p>
          )}

          <p className="mt-2 text-base italic leading-relaxed text-zinc-100">“{currentQuote}”</p>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setIsExpanded(true)}
        className="hero-art-composite relative mx-auto block w-full max-w-[420px] overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 text-left leading-none transition hover:border-zinc-500"
        aria-label={`Expand ${heroName} ${currentPose} art`}
      >
        {currentBackground ? (
          <img
            src={`/api/shared-icons/unit_backgrounds?name=${encodeURIComponent(currentBackground)}`}
            alt=""
            className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-35"
            aria-hidden="true"
          />
        ) : null}

        <img
          src={`/api/fullbody/${heroSlug}?pose=${encodeURIComponent(currentPose)}`}
          alt={`${heroName} ${currentPose} art`}
          className="relative block h-auto w-full max-h-[76vh] object-contain"
        />
      </button>

      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={prev}
          className="rounded-md border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-800"
          aria-label="Previous pose"
        >
          ←
        </button>

        <p className="text-xs text-zinc-300">
          {poseLabel(currentPose)} ({index + 1}/{safePoses.length})
        </p>

        <button
          type="button"
          onClick={next}
          className="rounded-md border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-800"
          aria-label="Next pose"
        >
          →
        </button>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={prevBackground}
          className="rounded-md border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Previous background"
          disabled={safeBackgrounds.length <= 1}
        >
          ←
        </button>

        <p className="text-xs text-zinc-300">
          Background ({safeBackgrounds.length ? backgroundIndex + 1 : 0}/{safeBackgrounds.length})
        </p>

        <button
          type="button"
          onClick={nextBackground}
          className="rounded-md border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Next background"
          disabled={safeBackgrounds.length <= 1}
        >
          →
        </button>
      </div>

      {isExpanded ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setIsExpanded(false)}
        >
          <button
            type="button"
            className="absolute left-4 top-1/2 -translate-y-1/2 rounded-md border border-zinc-500 bg-zinc-900/80 px-3 py-2 text-lg text-zinc-100 hover:bg-zinc-800"
            onClick={(event) => {
              event.stopPropagation();
              prev();
            }}
            aria-label="Previous pose (expanded)"
          >
            ←
          </button>

          <button
            type="button"
            className="absolute right-4 top-1/2 -translate-y-1/2 rounded-md border border-zinc-500 bg-zinc-900/80 px-3 py-2 text-lg text-zinc-100 hover:bg-zinc-800"
            onClick={(event) => {
              event.stopPropagation();
              next();
            }}
            aria-label="Next pose (expanded)"
          >
            →
          </button>

          <button
            type="button"
            className="absolute right-4 top-4 rounded-md border border-zinc-500 bg-zinc-900/80 px-3 py-1 text-sm text-zinc-100 hover:bg-zinc-800"
            onClick={(event) => {
              event.stopPropagation();
              setIsExpanded(false);
            }}
            aria-label="Close expanded art"
          >
            Close
          </button>

          <div
            className="flex max-h-[92vh] max-w-[92vw] flex-col items-center gap-2"
            onClick={(event) => event.stopPropagation()}
          >
            <img
              src={`/api/fullbody/${heroSlug}?pose=${encodeURIComponent(currentPose)}`}
              alt={`${heroName} ${currentPose} art expanded`}
              className="max-h-[86vh] max-w-[92vw] rounded-lg border border-zinc-600 object-contain"
            />
            <p className="text-sm text-zinc-300">
              {poseLabel(currentPose)} ({index + 1}/{safePoses.length})
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
