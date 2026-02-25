"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";

export type TavernParticipant = {
  userId: string;
  displayName: string;
  avatarHeroSlug: string | null;
  isMe: boolean;
  totalHeroes: number;
  fiveStarHeroes: number;
  favoritesCount: number;
  teamsCount: number;
};

type TavernStageClientProps = {
  participants: TavernParticipant[];
};

// Float animation delays so names bob out-of-sync
const FLOAT_DELAYS = ["0s", "1.1s", "2.2s"];

export function TavernStageClient({ participants }: TavernStageClientProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [muted, setMuted] = useState(false);
  const [activeCard, setActiveCard] = useState<string | null>(null); // userId of open info card

  // ── Music ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const audio = new Audio("/tavern/hearthside-whispers.mp3");
    audio.loop = true;
    audio.volume = 0.45;
    audioRef.current = audio;

    // Try autoplay; if blocked by browser policy, start on the first user click.
    const tryPlay = () => {
      if (audioRef.current) {
        audioRef.current.play().catch(() => {});
      }
    };
    tryPlay();
    document.addEventListener("click", tryPlay, { once: true });

    return () => {
      document.removeEventListener("click", tryPlay);
      audio.pause();
      audio.src = "";
    };
  }, []);

  function toggleMute() {
    if (!audioRef.current) return;
    const next = !muted;
    audioRef.current.muted = next;
    if (!next) {
      // Re-attempt play in case autoplay was blocked
      audioRef.current.play().catch(() => {});
    }
    setMuted(next);
  }

  // ── Card dismiss on outside click ─────────────────────────────────────────
  function handleStageClick(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest("[data-info-card]") && !target.closest("[data-hero-portrait]")) {
      setActiveCard(null);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className="relative w-full overflow-hidden rounded-xl"
      style={{
        backgroundImage: "url('/tavern/stage.png')",
        backgroundSize: "cover",
        backgroundPosition: "center 60%",
        minHeight: "480px",
      }}
      onClick={handleStageClick}
    >
      {/* Vignette overlay — darkens top/sides so text is readable */}
      <div
        className="pointer-events-none absolute inset-0 rounded-xl"
        style={{
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.08) 40%, rgba(0,0,0,0.0) 65%, rgba(0,0,0,0.45) 100%)",
        }}
      />

      {/* Mute toggle */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); toggleMute(); }}
        className="absolute right-3 top-3 z-20 rounded-full border border-white/20 bg-black/40 px-2 py-1 text-xs text-white/80 backdrop-blur-sm transition hover:bg-black/60"
        title={muted ? "Unmute music" : "Mute music"}
      >
        {muted ? "🔇" : "♪"}
      </button>

      {/* Hero columns */}
      <div
        className="relative z-10 flex h-full items-end justify-around"
        style={{ minHeight: "480px", paddingBottom: "0px" }}
      >
        {participants.map((p, idx) => {
          const portraitSrc = p.avatarHeroSlug
            ? `/api/fullbody/${p.avatarHeroSlug}?pose=portrait`
            : null;
          const isOpen = activeCard === p.userId;

          return (
            <div key={p.userId} className="relative flex flex-col items-center" style={{ flex: 1 }}>
              {/* Floating name label */}
              <div
                className="relative z-10 mb-1 select-none px-3 py-1 text-center"
                style={{
                  animation: `tavernFloat 3s ease-in-out infinite`,
                  animationDelay: FLOAT_DELAYS[idx] ?? "0s",
                }}
              >
                <span
                  className="rounded-lg border border-amber-400/30 bg-black/50 px-3 py-1 text-sm font-semibold text-amber-100 shadow-lg backdrop-blur-sm"
                  style={{ textShadow: "0 1px 6px rgba(0,0,0,0.9)" }}
                >
                  {p.isMe ? `${p.displayName} ★` : p.displayName}
                </span>
              </div>

              {/* Portrait */}
              <div
                data-hero-portrait
                className="relative cursor-pointer transition-transform duration-200 hover:scale-105 active:scale-95"
                style={{ height: "310px", width: "100%", maxWidth: "220px" }}
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveCard(isOpen ? null : p.userId);
                }}
              >
                {portraitSrc ? (
                  <img
                    src={portraitSrc}
                    alt={p.displayName}
                    className="h-full w-full object-contain object-bottom drop-shadow-[0_4px_16px_rgba(0,0,0,0.8)]"
                    draggable={false}
                  />
                ) : (
                  /* Placeholder silhouette when no avatar is set */
                  <div className="flex h-full w-full flex-col items-center justify-center gap-2 opacity-50">
                    <div className="text-6xl">?</div>
                    <div className="text-xs text-white/60">No avatar set</div>
                  </div>
                )}
              </div>

              {/* Info card */}
              {isOpen && (
                <div
                  data-info-card
                  className="absolute bottom-[320px] left-1/2 z-30 w-56 -translate-x-1/2 rounded-xl border border-amber-700/50 bg-zinc-900/95 p-4 shadow-[0_0_24px_rgba(0,0,0,0.8)] backdrop-blur-md"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Headshot */}
                  <div className="mb-3 flex items-center gap-3">
                    {p.avatarHeroSlug ? (
                      <img
                        src={`/api/headshots/${p.avatarHeroSlug}`}
                        alt={p.displayName}
                        className="h-12 w-12 rounded-full border-2 border-amber-600/60 object-cover"
                      />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-zinc-600 bg-zinc-800 text-xl">
                        ?
                      </div>
                    )}
                    <div>
                      <div className="font-semibold text-amber-100">{p.displayName}</div>
                      {p.isMe && <div className="text-xs text-amber-400">You</div>}
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="space-y-1.5 text-sm">
                    <div className="flex items-center justify-between border-b border-zinc-700/50 pb-1.5">
                      <span className="text-zinc-400">⚔ Heroes owned</span>
                      <span className="font-bold text-zinc-100">{p.totalHeroes}</span>
                    </div>
                    <div className="flex items-center justify-between border-b border-zinc-700/50 pb-1.5">
                      <span className="text-zinc-400">★ At 5★</span>
                      <span className="font-bold text-amber-300">{p.fiveStarHeroes}</span>
                    </div>
                    <div className="flex items-center justify-between border-b border-zinc-700/50 pb-1.5">
                      <span className="text-zinc-400">❤ Favorites</span>
                      <span className="font-bold text-rose-300">{p.favoritesCount}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-400">🛡 Teams</span>
                      <span className="font-bold text-zinc-100">{p.teamsCount}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Inline keyframe for float — injected as a style tag */}
      <style>{`
        @keyframes tavernFloat {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-8px); }
        }
      `}</style>
    </div>
  );
}
