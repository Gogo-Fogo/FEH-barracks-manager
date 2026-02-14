"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type ResortHeroOption = {
  hero_slug: string;
  hero_name: string;
  source: "barracks" | "favorite" | "both";
};

type SpriteState = {
  x: number;
  y: number;
  vx: number;
  vy: number;
};

type AetherResortClientProps = {
  options: ResortHeroOption[];
  initialSlots: string[];
  initialBackgroundName: string;
};

const LOCAL_STORAGE_KEY = "aether_resort_prefs_v1";
const SPRITE_SIZE = 96;
const MAP_W = 298;
const MAP_H = 480;
const BACKGROUNDS = [
  "Map_K1001.webp",
  "Map_K1002.webp",
  "Map_K1003.webp",
  "Map_K1004.webp",
  "Map_K1005.webp",
  "Map_K1006.webp",
  "Map_K1007.webp",
];

function deterministicStart(index: number) {
  const presets = [
    { x: 26, y: 86 },
    { x: 178, y: 112 },
    { x: 44, y: 302 },
    { x: 166, y: 336 },
  ];
  return presets[index] || { x: 30 + index * 12, y: 90 + index * 24 };
}

function deterministicVelocity(index: number) {
  const presets = [
    { vx: 0.14, vy: 0.11 },
    { vx: -0.12, vy: 0.09 },
    { vx: 0.1, vy: -0.12 },
    { vx: -0.13, vy: -0.1 },
  ];
  return presets[index] || { vx: 0.11, vy: 0.1 };
}

export function AetherResortClient({ options, initialSlots, initialBackgroundName }: AetherResortClientProps) {
  const initialBackgroundIndex = useMemo(() => {
    const idx = BACKGROUNDS.indexOf(initialBackgroundName);
    return idx >= 0 ? idx : 0;
  }, [initialBackgroundName]);

  const [backgroundIndex, setBackgroundIndex] = useState(initialBackgroundIndex);

  const [slots, setSlots] = useState<string[]>(initialSlots);
  const [prefsReady, setPrefsReady] = useState(false);
  const [sprites, setSprites] = useState<SpriteState[]>(
    Array.from({ length: 4 }, (_, idx) => {
      const start = deterministicStart(idx);
      const vel = deterministicVelocity(idx);
      return { ...start, ...vel };
    })
  );

  const mapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    const markReady = () => {
      window.requestAnimationFrame(() => {
        if (!active) return;
        setPrefsReady(true);
      });
    };

    try {
      const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
      if (!raw) {
        markReady();
        return;
      }
      const parsed = JSON.parse(raw) as { slots?: string[]; backgroundName?: string };

      window.requestAnimationFrame(() => {
        if (!active) return;

        if (Array.isArray(parsed.slots)) {
          const allowed = new Set(options.map((o) => o.hero_slug));
          const restored = parsed.slots
            .slice(0, 4)
            .map((slug) => (typeof slug === "string" && allowed.has(slug) ? slug : ""));
          while (restored.length < 4) restored.push("");
          setSlots(restored);
        }

        if (typeof parsed.backgroundName === "string") {
          const idx = BACKGROUNDS.indexOf(parsed.backgroundName);
          if (idx >= 0) setBackgroundIndex(idx);
        }

        markReady();
      });
    } catch {
      // ignore local fallback parse errors
      markReady();
    }

    return () => {
      active = false;
    };
  }, [options]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const rect = mapRef.current?.getBoundingClientRect();
      const maxX = Math.max(0, (rect?.width || MAP_W) - SPRITE_SIZE);
      const maxY = Math.max(0, (rect?.height || MAP_H) - SPRITE_SIZE);

      setSprites((prev) =>
        prev.map((sprite) => {
          let x = sprite.x + sprite.vx;
          let y = sprite.y + sprite.vy;
          let vx = sprite.vx;
          let vy = sprite.vy;

          if (x <= 0 || x >= maxX) {
            vx = -vx;
            x = Math.max(0, Math.min(maxX, x));
          }

          if (y <= 0 || y >= maxY) {
            vy = -vy;
            y = Math.max(0, Math.min(maxY, y));
          }

          return { x, y, vx, vy };
        })
      );
    }, 16);

    return () => window.clearInterval(id);
  }, []);

  const setSlotHero = (slotIndex: number, heroSlug: string) => {
    setSlots((prev) => {
      const next = [...prev];
      next[slotIndex] = heroSlug;
      return next;
    });
  };

  const currentBackground = BACKGROUNDS[backgroundIndex] || BACKGROUNDS[0];

  const prevBackground = () => {
    setBackgroundIndex((i) => (i - 1 + BACKGROUNDS.length) % BACKGROUNDS.length);
  };

  const nextBackground = () => {
    setBackgroundIndex((i) => (i + 1) % BACKGROUNDS.length);
  };

  useEffect(() => {
    if (!prefsReady) return;

    try {
      window.localStorage.setItem(
        LOCAL_STORAGE_KEY,
        JSON.stringify({
          slots,
          backgroundName: BACKGROUNDS[backgroundIndex] || BACKGROUNDS[0],
        })
      );
    } catch {
      // ignore local fallback write failures
    }

    void fetch("/api/aether-resort-preference", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slots,
        backgroundName: BACKGROUNDS[backgroundIndex] || BACKGROUNDS[0],
      }),
    }).catch(() => {
      // no-op
    });
  }, [slots, backgroundIndex, prefsReady]);

  return (
    <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      <h2 className="text-lg font-semibold">Aether Resort (Prototype)</h2>
      <p className="mt-1 text-xs text-zinc-400">
        Select up to 4 heroes from your barracks/favorites. They will roam slowly around the resort map.
      </p>

      <div className="mt-4 overflow-x-auto">
        <div className="flex min-w-max gap-2">
          {Array.from({ length: 4 }).map((_, idx) => {
            const heroSlug = slots[idx] || "";
            return (
              <label
                key={idx}
                className="flex w-[230px] items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-2 text-xs text-zinc-300"
              >
                <img
                  src={heroSlug ? `/api/headshots/${heroSlug}` : "/window.svg"}
                  alt={`Slot ${idx + 1} headshot`}
                  className="h-8 w-8 rounded border border-zinc-700 object-cover"
                  draggable={false}
                />
                <span className="shrink-0">S{idx + 1}</span>
                <select
                  value={heroSlug}
                  onChange={(event) => setSlotHero(idx, event.target.value)}
                  className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
                >
                  <option value="">(empty)</option>
                  {options.map((hero) => (
                    <option key={hero.hero_slug} value={hero.hero_slug}>
                      {hero.hero_name} {hero.source === "both" ? "• both" : hero.source === "barracks" ? "• barracks" : "• favorite"}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-2 text-xs text-zinc-300">
        <button
          type="button"
          onClick={prevBackground}
          className="rounded-md border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-800"
          aria-label="Previous resort background"
        >
          ←
        </button>

        <p>
          Resort Background ({backgroundIndex + 1}/{BACKGROUNDS.length}) - {currentBackground.replace(".webp", "")}
        </p>

        <button
          type="button"
          onClick={nextBackground}
          className="rounded-md border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-800"
          aria-label="Next resort background"
        >
          →
        </button>
      </div>

      <div
        ref={mapRef}
        className="relative mx-auto mt-5 w-full max-w-[520px] overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900"
        style={{ aspectRatio: `${MAP_W} / ${MAP_H}` }}
      >
        <img
          src={`/aether-resort/backgrounds/${currentBackground}`}
          alt="Aether Resort background"
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          draggable={false}
        />

        {slots.map((heroSlug, idx) => {
          if (!heroSlug) return null;
          const pos = sprites[idx];
          return (
            <div
              key={`${idx}-${heroSlug}`}
              className="absolute"
              style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
            >
              <img
                src={`/api/mini-sprite/${heroSlug}`}
                alt={`${heroSlug} mini sprite`}
                className="h-[96px] w-[96px] object-contain drop-shadow-[0_0_10px_rgba(0,0,0,0.45)]"
                draggable={false}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
