"use client";

import { useEffect, useState } from "react";
import { FullbodyCarousel } from "@/components/fullbody-carousel";
import {
  extractIllustratorFromRawText,
  extractQuoteCandidates,
  buildGuideHighlights,
  extractSkillDescriptionFromRaw,
  deriveSpecialFromRawText,
  normalizeSkillKey,
  BUILD_KEY_ORDER,
  buildKeyLabel,
  skillWikiUrl,
  type GuideHighlights,
  type SkillHint,
} from "@/lib/feh-unit-utils";

// ── Types ──────────────────────────────────────────────────────────────────────

type UnitFile = {
  name?: string;
  ivs?: string;
  raw_text_data?: string;
  recommended_build?: Record<string, string>;
};

type UnitDataResponse = {
  unitFile: UnitFile | null;
  quoteText: string | null;
  poses: string[];
  backgroundOptions: string[];
};

type BuildEntry = {
  key: string;
  value: string;
  description: string | null;
  isDerivedSpecial: boolean;
  href: string | null;
};

// ── Sub-components ─────────────────────────────────────────────────────────────

const ARTIST_LIST_URL = "https://feheroes.fandom.com/wiki/List_of_artists";

function buildArtistProfileUrl(artistName?: string | null) {
  const v = String(artistName || "").trim();
  if (!v) return ARTIST_LIST_URL;
  return `https://feheroes.fandom.com/wiki/${encodeURIComponent(v.replace(/\s+/g, "_"))}`;
}

function SkillValueWithTooltip({
  skillName,
  description,
  href,
}: {
  skillName: string;
  description: string | null;
  href?: string | null;
}) {
  if (!skillName || skillName.trim() === "-") return <span>{skillName || "-"}</span>;

  const tooltipText = description || "Description not yet extracted from current scraped skill text.";
  const badgeClass =
    "inline-flex max-w-full items-center gap-1 rounded-md border border-indigo-700/60 bg-indigo-950/35 px-2 py-1 text-base text-zinc-100 outline-none transition focus-visible:ring-2 focus-visible:ring-indigo-400" +
    (href ? " cursor-pointer hover:border-indigo-500 hover:bg-indigo-950/60" : " cursor-help");

  const inner = (
    <>
      <span className="truncate">{skillName}</span>
      <span className={`text-sm ${href ? "text-indigo-400" : "text-indigo-300"}`}>
        {href ? "↗" : "ⓘ"}
      </span>
    </>
  );

  return (
    <span className="group skill-tooltip relative inline-flex max-w-full items-center gap-1 align-middle">
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className={badgeClass}>
          {inner}
        </a>
      ) : (
        <span className={badgeClass}>{inner}</span>
      )}
      <span className="pointer-events-none absolute bottom-[calc(100%+0.55rem)] left-0 z-40 hidden w-[min(40rem,88vw)] rounded-lg border border-indigo-500/70 bg-zinc-950/97 p-4 text-base leading-7 text-zinc-100 shadow-[0_0_16px_rgba(99,102,241,0.45),0_0_34px_rgba(59,130,246,0.3)] backdrop-blur-sm group-hover:block">
        {tooltipText}
      </span>
    </span>
  );
}

function GuideHighlightsSection({ highlights }: { highlights: GuideHighlights }) {
  const hasAny =
    highlights.role.length || highlights.strengths.length ||
    highlights.weaknesses.length || highlights.tips.length || highlights.counters.length;
  if (!hasAny) return null;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm">
      <h2 className="mb-3 text-base font-semibold">Guide Highlights</h2>
      <div className="grid gap-3 md:grid-cols-2">
        {highlights.role.length > 0 && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
            <h3 className="mb-2 text-sm font-semibold text-indigo-300">Role / Playstyle</h3>
            <ul className="list-disc space-y-1 pl-5 text-zinc-300">
              {highlights.role.map((l) => <li key={l}>{l}</li>)}
            </ul>
          </div>
        )}
        {highlights.strengths.length > 0 && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
            <h3 className="mb-2 text-sm font-semibold text-emerald-300">Strengths</h3>
            <ul className="list-disc space-y-1 pl-5 text-zinc-300">
              {highlights.strengths.map((l) => <li key={l}>{l}</li>)}
            </ul>
          </div>
        )}
        {highlights.weaknesses.length > 0 && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
            <h3 className="mb-2 text-sm font-semibold text-amber-300">Weaknesses</h3>
            <ul className="list-disc space-y-1 pl-5 text-zinc-300">
              {highlights.weaknesses.map((l) => <li key={l}>{l}</li>)}
            </ul>
          </div>
        )}
        {highlights.tips.length > 0 && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
            <h3 className="mb-2 text-sm font-semibold text-cyan-300">Quick Tips</h3>
            <ul className="list-disc space-y-1 pl-5 text-zinc-300">
              {highlights.tips.map((l) => <li key={l}>{l}</li>)}
            </ul>
          </div>
        )}
        {highlights.counters.length > 0 && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 md:col-span-2">
            <h3 className="mb-2 text-sm font-semibold text-rose-300">Counters / Threat Notes</h3>
            <ul className="list-disc space-y-1 pl-5 text-zinc-300">
              {highlights.counters.map((l) => <li key={l}>{l}</li>)}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Data derivation ────────────────────────────────────────────────────────────

function deriveData(unitFile: UnitFile | null, quoteText: string | null, sourceUrl: string | null) {
  const raw         = unitFile?.raw_text_data;
  const artistName  = extractIllustratorFromRawText(raw);
  const quotes      = extractQuoteCandidates(quoteText ?? undefined);
  const highlights  = buildGuideHighlights(raw);

  const recommendedBuild = unitFile?.recommended_build ?? {};
  const baseSpecial = (recommendedBuild.special || "").trim();
  const derivedSpecial = !baseSpecial || baseSpecial === "-" ? deriveSpecialFromRawText(raw) : null;
  const effectiveBuild: Record<string, string> = {
    ...recommendedBuild,
    ...(derivedSpecial ? { special: derivedSpecial } : {}),
  };

  const buildEntries: BuildEntry[] = BUILD_KEY_ORDER
    .map((key) => {
      const value = (effectiveBuild[key] || "").trim();
      if (!value || value === "-") return null;
      const description  = extractSkillDescriptionFromRaw(raw, value, key as SkillHint);
      const href         = key === "weapon" ? sourceUrl : skillWikiUrl(value);
      const isDerived    = key === "special" && Boolean(derivedSpecial);
      return { key, value, description, isDerivedSpecial: isDerived, href } as BuildEntry;
    })
    .filter((e): e is BuildEntry => e !== null);

  const isSpecialMissing = !buildEntries.some((e) => e.key === "special");

  return { artistName, quotes, highlights, buildEntries, isSpecialMissing, ivs: unitFile?.ivs ?? null };
}

// ── Main export ────────────────────────────────────────────────────────────────

export type HeroUnitDataClientProps = {
  heroSlug: string;
  heroName: string;
  sourceUrl: string | null;
  /** Background preference saved in Supabase (may be empty string) */
  savedBackgroundName: string;
  /** Background key derived from the hero's tag (e.g. "BG_DetailedStatus.png") */
  defaultBackgroundName: string;
  persistBackgroundPreference: boolean;
};

export function HeroUnitDataClient({
  heroSlug,
  heroName,
  sourceUrl,
  savedBackgroundName,
  defaultBackgroundName,
  persistBackgroundPreference,
}: HeroUnitDataClientProps) {
  const [data, setData] = useState<UnitDataResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/unit-data/${encodeURIComponent(heroSlug)}`)
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((d: UnitDataResponse) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [heroSlug]);

  // Determine background choices once backgroundOptions arrive
  const backgroundOptions = data?.backgroundOptions ?? [];
  const initialBackgroundName =
    backgroundOptions.includes(savedBackgroundName)   ? savedBackgroundName :
    backgroundOptions.includes(defaultBackgroundName) ? defaultBackgroundName :
    backgroundOptions[0] ?? defaultBackgroundName;

  const derived = data ? deriveData(data.unitFile, data.quoteText, sourceUrl) : null;
  const poses   = data?.poses ?? ["portrait"];

  if (loading) {
    return (
      <div className="mt-6 grid gap-6 md:grid-cols-[minmax(360px,420px)_1fr]">
        {/* Carousel skeleton */}
        <div className="space-y-3">
          <div className="aspect-[440/700] w-full animate-pulse rounded-2xl bg-zinc-800" />
          <div className="h-8 animate-pulse rounded-lg bg-zinc-800" />
        </div>
        {/* Right-column skeleton */}
        <div className="space-y-4">
          <div className="h-32 animate-pulse rounded-xl bg-zinc-800" />
          <div className="h-24 animate-pulse rounded-xl bg-zinc-800" />
          <div className="h-48 animate-pulse rounded-xl bg-zinc-800" />
        </div>
      </div>
    );
  }

  return (
    <section className="mt-6 grid gap-6 md:grid-cols-[minmax(360px,420px)_1fr]">
      {/* Left — fullbody carousel + artist */}
      <div className="space-y-3">
        <FullbodyCarousel
          heroName={heroName}
          heroSlug={heroSlug}
          poses={poses}
          quotes={derived?.quotes ?? []}
          initialBackgroundName={initialBackgroundName}
          backgroundOptions={backgroundOptions}
          persistBackgroundPreference={persistBackgroundPreference}
        />

        <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-300">
          <span className="text-zinc-400">Banner art illustrator:</span>{" "}
          {derived?.artistName ? (
            <a
              href={buildArtistProfileUrl(derived.artistName)}
              target="_blank"
              rel="noreferrer"
              className="text-indigo-300 hover:underline"
            >
              {derived.artistName}
            </a>
          ) : (
            <>
              Unknown{" "}
              <a href={ARTIST_LIST_URL} target="_blank" rel="noreferrer" className="text-indigo-300 hover:underline">
                (check artist list)
              </a>
            </>
          )}
        </div>
      </div>

      {/* Right — IVs, build, guide */}
      <div className="space-y-4">
        {derived?.ivs && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm">
            <h2 className="mb-2 text-base font-semibold">IV Recommendation</h2>
            <p className="text-zinc-300">{derived.ivs}</p>
          </div>
        )}

        {derived && derived.buildEntries.length > 0 && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm">
            <h2 className="mb-2 text-base font-semibold">Recommended Build</h2>
            <p className="mb-2 text-xs text-zinc-400">
              Hover any skill for description · click ↗ to open reference page.
            </p>
            <div className="grid gap-2 md:grid-cols-2">
              {derived.buildEntries.map((entry) => (
                <div key={entry.key} className="rounded-md border border-zinc-800 bg-zinc-900/45 p-2">
                  <p>
                    <span className="text-zinc-400">{buildKeyLabel(entry.key)}:</span>{" "}
                    <SkillValueWithTooltip
                      skillName={entry.value}
                      description={entry.description}
                      href={entry.href}
                    />
                  </p>
                  {entry.isDerivedSpecial && (
                    <p className="mt-1 text-[11px] text-amber-300">
                      Filled from profile text because special was missing in structured build data.
                    </p>
                  )}
                </div>
              ))}
            </div>
            {derived.isSpecialMissing && (
              <p className="mt-3 rounded-md border border-amber-800/80 bg-amber-950/25 px-2 py-1.5 text-xs text-amber-200">
                This hero is currently missing a detected Special/Ult in available data.
              </p>
            )}
          </div>
        )}

        {derived && <GuideHighlightsSection highlights={derived.highlights} />}

        {!data?.unitFile && !loading && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-500">
            Detailed guide data (IVs, build, highlights) is not yet available for this hero.
          </div>
        )}
      </div>
    </section>
  );
}
