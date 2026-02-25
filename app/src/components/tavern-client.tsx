"use client";

import { useState, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  updateDisplayName,
  setAvatarHero,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  removeFriend,
  searchUsersAction,
} from "@/app/tavern/actions";

// ─── Exported types (imported by page.tsx) ────────────────────────────────────

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

export type UserStats = {
  totalHeroes: number;
  fiveStarHeroes: number;
  redHeroes: number;
  favoritesCount: number;
  teamsCount: number;
};

export type FriendRow = {
  friendshipId: string;
  userId: string;
  displayName: string;
  avatarHeroSlug: string | null;
  stats: UserStats;
};

export type LeaderEntry = {
  displayName: string;
  avatarSlug: string | null;
  score: number;
};

export type PendingRequest = {
  id: string;
  requesterId: string;
  requesterName: string;
};

type TavernClientProps = {
  participants: TavernParticipant[];
  myDisplayName: string;
  myAvatarSlug: string | null;
  myBarracks: Array<{ hero_slug: string; hero_name: string }>;
  friends: FriendRow[];
  pendingRequests: PendingRequest[];
  leaderboard: {
    total: LeaderEntry[];
    fiveStar: LeaderEntry[];
    red: LeaderEntry[];
    favorites: LeaderEntry[];
  };
};

// ─── Constants ────────────────────────────────────────────────────────────────

const FLOAT_DELAYS = ["0s", "1.1s", "2.2s"];
const CROSSFADE_SECS = 2.5;
const MUSIC_VOL = 0.45;

// ─── Component ────────────────────────────────────────────────────────────────

export function TavernClient(props: TavernClientProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Stage participants are frozen on mount — router.refresh() won't reshuffle heroes
  const [participants] = useState(() => props.participants);

  // UI state
  type TabKey = "leaderboard" | "profile" | "friends" | "add";
  const [activeTab, setActiveTab] = useState<TabKey>("leaderboard");
  const [activeCard, setActiveCard] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; ok: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Audio
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  const audioA = useRef<HTMLAudioElement | null>(null);
  const audioB = useRef<HTMLAudioElement | null>(null);
  const activeSlot = useRef<0 | 1>(0);
  const fadingRef = useRef(false);
  const fadeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Profile form state (kept controlled so they don't reset on refresh)
  const [displayNameInput, setDisplayNameInput] = useState(props.myDisplayName);
  const [selectedSlug, setSelectedSlug] = useState(props.myAvatarSlug ?? "");
  useEffect(() => { setDisplayNameInput(props.myDisplayName); }, [props.myDisplayName]);
  useEffect(() => { setSelectedSlug(props.myAvatarSlug ?? ""); }, [props.myAvatarSlug]);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ id: string; displayName: string }>>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Lock body scroll while tavern is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // ── Toast ──────────────────────────────────────────────────────────────────
  function showToast(message: string, ok: boolean) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, ok });
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }

  // ── Audio (crossfade loop) ─────────────────────────────────────────────────
  useEffect(() => {
    const src = "/tavern/hearthside-whispers.mp3";
    const a = new Audio(src);
    const b = new Audio(src);
    a.volume = MUSIC_VOL;
    b.volume = 0;
    audioA.current = a;
    audioB.current = b;

    function getActive() { return activeSlot.current === 0 ? a : b; }
    function getNext()   { return activeSlot.current === 0 ? b : a; }

    function doFade() {
      if (fadingRef.current) return;
      fadingRef.current = true;
      const current = getActive();
      const next = getNext();
      next.currentTime = 0;
      if (!mutedRef.current) next.play().catch(() => {});
      const startVol = current.volume;
      const steps = Math.round((CROSSFADE_SECS * 1000) / 50);
      let step = 0;
      if (fadeIntervalRef.current) clearInterval(fadeIntervalRef.current);
      fadeIntervalRef.current = setInterval(() => {
        step++;
        const t = step / steps;
        current.volume = Math.max(0, startVol * (1 - t));
        next.volume = mutedRef.current ? 0 : Math.min(MUSIC_VOL, MUSIC_VOL * t);
        if (step >= steps) {
          clearInterval(fadeIntervalRef.current!);
          current.pause();
          current.currentTime = 0;
          current.volume = 0;
          activeSlot.current = activeSlot.current === 0 ? 1 : 0;
          fadingRef.current = false;
        }
      }, 50);
    }

    function onTimeUpdate(this: HTMLAudioElement) {
      const isActive =
        (this === a && activeSlot.current === 0) ||
        (this === b && activeSlot.current === 1);
      if (!isActive || !this.duration) return;
      if (this.duration - this.currentTime <= CROSSFADE_SECS) {
        doFade();
      }
    }

    a.addEventListener("timeupdate", onTimeUpdate);
    b.addEventListener("timeupdate", onTimeUpdate);

    const tryPlay = () => {
      if (!mutedRef.current) a.play().catch(() => {});
    };
    tryPlay();
    document.addEventListener("click", tryPlay, { once: true });

    return () => {
      document.removeEventListener("click", tryPlay);
      if (fadeIntervalRef.current) clearInterval(fadeIntervalRef.current);
      a.removeEventListener("timeupdate", onTimeUpdate);
      b.removeEventListener("timeupdate", onTimeUpdate);
      a.pause(); a.src = "";
      b.pause(); b.src = "";
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleMute() {
    const next = !muted;
    mutedRef.current = next;
    setMuted(next);
    if (audioA.current) audioA.current.muted = next;
    if (audioB.current) audioB.current.muted = next;
    if (!next) {
      const active = activeSlot.current === 0 ? audioA.current : audioB.current;
      active?.play().catch(() => {});
    }
  }

  // ── Mutations ──────────────────────────────────────────────────────────────
  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault();
    const result = await updateDisplayName(displayNameInput);
    showToast(result.message, result.ok);
    if (result.ok) startTransition(() => router.refresh());
  }

  async function handleSetAvatar(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSlug) { showToast("Pick a hero first.", false); return; }
    const result = await setAvatarHero(selectedSlug);
    showToast(result.message, result.ok);
    if (result.ok) startTransition(() => router.refresh());
  }

  async function handleSendRequest(addresseeId: string) {
    const result = await sendFriendRequest(addresseeId);
    showToast(result.message, result.ok);
    if (result.ok) {
      setSearchResults((prev) => prev.filter((r) => r.id !== addresseeId));
      startTransition(() => router.refresh());
    }
  }

  async function handleAccept(friendshipId: string) {
    const result = await acceptFriendRequest(friendshipId);
    showToast(result.message, result.ok);
    if (result.ok) startTransition(() => router.refresh());
  }

  async function handleDecline(friendshipId: string) {
    const result = await declineFriendRequest(friendshipId);
    showToast(result.message, result.ok);
    if (result.ok) startTransition(() => router.refresh());
  }

  async function handleRemove(friendshipId: string) {
    const result = await removeFriend(friendshipId);
    showToast(result.message, result.ok);
    if (result.ok) startTransition(() => router.refresh());
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    setIsSearching(true);
    try {
      const results = await searchUsersAction(searchQuery);
      setSearchResults(results);
    } finally {
      setIsSearching(false);
    }
  }

  // ── Stage click (dismiss card) ─────────────────────────────────────────────
  function handleStageClick(e: React.MouseEvent) {
    const t = e.target as HTMLElement;
    if (!t.closest("[data-info-card]") && !t.closest("[data-hero-portrait]")) {
      setActiveCard(null);
    }
  }

  const pendingCount = props.pendingRequests.length;

  // ── Leaderboard categories ─────────────────────────────────────────────────
  const lbCategories = [
    { label: "Most Heroes",   entries: props.leaderboard.total,     icon: "⚔",  color: "text-zinc-100"  },
    { label: "Most 5★",       entries: props.leaderboard.fiveStar,  icon: "★",  color: "text-amber-300" },
    { label: "Most Red",      entries: props.leaderboard.red,       icon: "🔴", color: "text-red-300"   },
    { label: "Most Favorites",entries: props.leaderboard.favorites, icon: "❤",  color: "text-rose-300"  },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[100] overflow-hidden">

      {/* ── Background image fills full viewport ── */}
      <img
        src="/tavern/stage.png"
        alt=""
        className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover object-center"
        draggable={false}
      />

      {/* Atmospheric vignette */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.08) 25%, rgba(0,0,0,0.08) 60%, rgba(0,0,0,0.65) 100%)",
        }}
      />

      {/* ── Top bar ── */}
      <div className="absolute left-0 right-0 top-0 z-30 flex h-12 items-center gap-3 border-b border-white/10 bg-black/50 px-4 backdrop-blur-sm">
        <Link
          href="/barracks"
          className="shrink-0 text-sm text-zinc-300 hover:text-white"
        >
          ← Barracks
        </Link>
        <h1 className="flex-1 text-center text-sm font-semibold text-amber-200">
          🍺 The Tavern
        </h1>
        {pendingCount > 0 && (
          <button
            type="button"
            onClick={() => setActiveTab("friends")}
            className="shrink-0 rounded-full border border-amber-600/50 bg-amber-950/70 px-2.5 py-0.5 text-xs text-amber-300 hover:bg-amber-900/70"
          >
            🔔 {pendingCount}
          </button>
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); toggleMute(); }}
          className="shrink-0 rounded-full border border-white/20 bg-black/40 px-2 py-1 text-xs text-white/80 hover:bg-black/60"
          title={muted ? "Unmute music" : "Mute music"}
        >
          {muted ? "🔇" : "♪"}
        </button>
      </div>

      {/* ── Hero stage (left portion on desktop, full-width behind panel on mobile) ── */}
      <div
        className="absolute bottom-[58vh] left-0 right-0 top-12 z-10 lg:bottom-0 lg:right-80"
        onClick={handleStageClick}
      >
        <div className="relative flex h-full w-full items-end justify-around px-2 pb-4">
          {participants.map((p, idx) => {
            const portraitSrc = p.avatarHeroSlug
              ? `/api/fullbody/${p.avatarHeroSlug}?pose=portrait`
              : null;
            const isOpen = activeCard === p.userId;

            return (
              <div
                key={p.userId}
                className="relative flex flex-col items-center"
                style={{ flex: 1, maxWidth: "220px" }}
              >
                {/* Floating name label */}
                <div
                  className="relative z-10 mb-1 select-none"
                  style={{
                    animation: "tavernFloat 3s ease-in-out infinite",
                    animationDelay: FLOAT_DELAYS[idx] ?? "0s",
                  }}
                >
                  <span
                    className="rounded-lg border border-amber-400/30 bg-black/55 px-2.5 py-0.5 text-xs font-semibold text-amber-100 shadow-lg backdrop-blur-sm"
                    style={{ textShadow: "0 1px 6px rgba(0,0,0,0.9)" }}
                  >
                    {p.isMe ? `${p.displayName} ★` : p.displayName}
                  </span>
                </div>

                {/* Portrait */}
                <div
                  data-hero-portrait
                  className="relative cursor-pointer transition-transform duration-200 hover:scale-105 active:scale-95"
                  style={{ height: "min(44vh, 420px)", width: "100%" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveCard(isOpen ? null : p.userId);
                  }}
                >
                  {portraitSrc ? (
                    <img
                      src={portraitSrc}
                      alt={p.displayName}
                      className="h-full w-full object-contain object-bottom drop-shadow-[0_4px_20px_rgba(0,0,0,0.9)]"
                      draggable={false}
                    />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-2 opacity-50">
                      <div className="text-5xl">?</div>
                      <div className="text-xs text-white/60">No avatar set</div>
                    </div>
                  )}
                </div>

                {/* Info card — floats above portrait */}
                {isOpen && (
                  <div
                    data-info-card
                    className="absolute bottom-[calc(min(44vh,420px)+8px)] left-1/2 z-40 w-52 -translate-x-1/2 rounded-xl border border-amber-700/50 bg-zinc-900/95 p-4 shadow-[0_0_24px_rgba(0,0,0,0.85)] backdrop-blur-md"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="mb-3 flex items-center gap-3">
                      {p.avatarHeroSlug ? (
                        <img
                          src={`/api/headshots/${p.avatarHeroSlug}`}
                          alt={p.displayName}
                          className="h-11 w-11 shrink-0 rounded-full border-2 border-amber-600/60 object-cover"
                        />
                      ) : (
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-zinc-600 bg-zinc-800 text-lg">
                          ?
                        </div>
                      )}
                      <div>
                        <div className="text-sm font-semibold text-amber-100">{p.displayName}</div>
                        {p.isMe && <div className="text-xs text-amber-400">You</div>}
                      </div>
                    </div>
                    <div className="space-y-1.5 text-xs">
                      <div className="flex justify-between border-b border-zinc-700/50 pb-1.5">
                        <span className="text-zinc-400">⚔ Heroes</span>
                        <span className="font-bold text-zinc-100">{p.totalHeroes}</span>
                      </div>
                      <div className="flex justify-between border-b border-zinc-700/50 pb-1.5">
                        <span className="text-zinc-400">★ At 5★</span>
                        <span className="font-bold text-amber-300">{p.fiveStarHeroes}</span>
                      </div>
                      <div className="flex justify-between border-b border-zinc-700/50 pb-1.5">
                        <span className="text-zinc-400">❤ Favorites</span>
                        <span className="font-bold text-rose-300">{p.favoritesCount}</span>
                      </div>
                      <div className="flex justify-between">
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
      </div>

      {/* ── Right / bottom panel ──
            Mobile  : slides up from bottom, 58 vh tall, full-width, rounded top corners
            Desktop : right sidebar, 320 px wide, full height below top-bar
      ── */}
      <div
        className="absolute bottom-0 left-0 right-0 z-20 flex h-[58vh] flex-col rounded-t-2xl border-t border-amber-900/30 bg-zinc-900/92 backdrop-blur-md
                   lg:bottom-0 lg:left-auto lg:top-12 lg:h-auto lg:w-80 lg:rounded-none lg:border-l lg:border-t-0"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile drag handle */}
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-zinc-600 lg:hidden" />

        {/* Tab bar */}
        <div className="flex shrink-0 border-b border-zinc-700/50">
          {(
            [
              { key: "leaderboard" as TabKey, icon: "🏆", label: "Board" },
              { key: "profile"     as TabKey, icon: "👤", label: "Profile" },
              {
                key: "friends" as TabKey,
                icon: "👥",
                label: pendingCount > 0 ? `Friends·${pendingCount}` : "Friends",
              },
              { key: "add" as TabKey, icon: "➕", label: "Add" },
            ]
          ).map(({ key, icon, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors ${
                activeTab === key
                  ? "border-b-2 border-amber-400 text-amber-200"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <span className="text-base leading-none">{icon}</span>
              <span>{label}</span>
            </button>
          ))}
        </div>

        {/* Scrollable tab content */}
        <div className="flex-1 overflow-y-auto p-4">

          {/* ─── Leaderboard ─────────────────────────────────────────────── */}
          {activeTab === "leaderboard" && (
            <div className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-amber-200/80">
                🏆 Leaderboard
              </h2>
              {props.leaderboard.total.length < 2 ? (
                <p className="text-xs text-zinc-500">
                  Add friends to start competing!
                </p>
              ) : (
                <div className="space-y-2">
                  {lbCategories.map(({ label, entries, icon, color }) => {
                    const winner = entries[0];
                    return (
                      <div
                        key={label}
                        className="rounded-lg border border-zinc-700/50 bg-zinc-800/60 p-3"
                      >
                        <div className="mb-2 text-[10px] uppercase tracking-wider text-zinc-400">
                          {label}
                        </div>
                        <div className="flex items-center gap-2.5">
                          {winner.avatarSlug ? (
                            <img
                              src={`/api/headshots/${winner.avatarSlug}`}
                              alt={winner.displayName}
                              className="h-10 w-10 shrink-0 rounded-full border-2 border-amber-600/40 object-cover"
                            />
                          ) : (
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-zinc-600 bg-zinc-700 text-lg">
                              ?
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-xs font-medium text-zinc-200">
                              {winner.displayName}
                            </div>
                            <div className={`text-base font-bold ${color}`}>
                              {icon} {winner.score}
                            </div>
                          </div>
                        </div>
                        {entries.slice(1).length > 0 && (
                          <div className="mt-2 space-y-0.5 border-t border-zinc-700/30 pt-2">
                            {entries.slice(1).map((e, i) => (
                              <div
                                key={i}
                                className="flex justify-between text-[10px] text-zinc-500"
                              >
                                <span className="truncate">{e.displayName}</span>
                                <span className="shrink-0 pl-2">{e.score}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ─── Profile ─────────────────────────────────────────────────── */}
          {activeTab === "profile" && (
            <div className="space-y-5">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-300/80">
                👤 My Profile
              </h2>

              {/* Display name */}
              <div>
                <p className="mb-2 text-xs text-zinc-400">Display name (shown to friends)</p>
                <form onSubmit={handleSaveName} className="flex gap-2">
                  <input
                    type="text"
                    value={displayNameInput}
                    onChange={(e) => setDisplayNameInput(e.target.value)}
                    maxLength={32}
                    placeholder="Your tavern name"
                    className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-amber-500 focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="rounded-md border border-amber-700 bg-amber-900/30 px-3 py-1.5 text-sm text-amber-200 hover:bg-amber-900/60"
                  >
                    Save
                  </button>
                </form>
              </div>

              {/* Avatar hero picker */}
              <div>
                <p className="mb-2 text-xs text-zinc-400">Avatar hero (shown on the stage)</p>
                <div className="flex items-center gap-3">
                  {selectedSlug || props.myAvatarSlug ? (
                    <img
                      src={`/api/headshots/${selectedSlug || props.myAvatarSlug}`}
                      alt="Avatar preview"
                      className="h-12 w-12 shrink-0 rounded-full border-2 border-amber-600/50 object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-zinc-600 bg-zinc-800 text-xl text-zinc-500">
                      ?
                    </div>
                  )}
                  {props.myBarracks.length > 0 ? (
                    <form onSubmit={handleSetAvatar} className="flex min-w-0 flex-1 gap-2">
                      <select
                        value={selectedSlug}
                        onChange={(e) => setSelectedSlug(e.target.value)}
                        className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
                      >
                        <option value="" disabled>
                          Pick a hero…
                        </option>
                        {props.myBarracks.map((h) => (
                          <option key={h.hero_slug} value={h.hero_slug}>
                            {h.hero_name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        className="rounded-md border border-amber-700 bg-amber-900/30 px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-900/60"
                      >
                        Set
                      </button>
                    </form>
                  ) : (
                    <p className="text-xs text-zinc-500">
                      Add heroes to your barracks first.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ─── Friends ─────────────────────────────────────────────────── */}
          {activeTab === "friends" && (
            <div className="space-y-4">

              {/* Pending incoming requests */}
              {props.pendingRequests.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-semibold text-amber-300">
                    🔔 Pending Requests
                  </h3>
                  <ul className="space-y-2">
                    {props.pendingRequests.map((req) => (
                      <li
                        key={req.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-zinc-700/50 bg-zinc-800/50 px-3 py-2"
                      >
                        <span className="min-w-0 truncate text-xs text-zinc-200">
                          {req.requesterName}
                        </span>
                        <div className="flex shrink-0 gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleAccept(req.id)}
                            className="rounded border border-emerald-700 bg-emerald-900/30 px-2 py-0.5 text-[10px] text-emerald-300 hover:bg-emerald-900/60"
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDecline(req.id)}
                            className="rounded border border-zinc-600 px-2 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-700"
                          >
                            Decline
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Friends list */}
              <div>
                <h3 className="mb-2 text-xs font-semibold text-zinc-300">
                  🧑‍🤝‍🧑 Friends
                </h3>
                {props.friends.length === 0 ? (
                  <p className="text-xs text-zinc-500">
                    No friends yet. Use the ➕ tab to add some!
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {props.friends.map((f) => (
                      <li
                        key={f.friendshipId}
                        className="flex items-center justify-between gap-2 rounded-lg border border-zinc-700/50 bg-zinc-800/40 px-3 py-2"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          {f.avatarHeroSlug ? (
                            <img
                              src={`/api/headshots/${f.avatarHeroSlug}`}
                              alt={f.displayName}
                              className="h-8 w-8 shrink-0 rounded-full border border-zinc-600 object-cover"
                            />
                          ) : (
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-600 bg-zinc-700 text-sm text-zinc-500">
                              ?
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="truncate text-xs font-medium text-zinc-200">
                              {f.displayName}
                            </div>
                            <div className="text-[10px] text-zinc-500">
                              {f.stats.totalHeroes} heroes · {f.stats.fiveStarHeroes} ★
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemove(f.friendshipId)}
                          className="shrink-0 rounded border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-500 hover:border-red-800 hover:text-red-400"
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* ─── Add Friend ──────────────────────────────────────────────── */}
          {activeTab === "add" && (
            <div className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-300/80">
                ➕ Add a Friend
              </h2>
              <form onSubmit={handleSearch} className="flex gap-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by display name…"
                  className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-amber-500 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={isSearching}
                  className="rounded-md border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
                >
                  {isSearching ? "…" : "Go"}
                </button>
              </form>

              {searchResults.length > 0 ? (
                <ul className="space-y-2">
                  {searchResults.map((r) => (
                    <li
                      key={r.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-zinc-700/50 bg-zinc-800/50 px-3 py-2"
                    >
                      <span className="min-w-0 truncate text-xs text-zinc-200">
                        {r.displayName}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleSendRequest(r.id)}
                        className="shrink-0 rounded border border-amber-700 bg-amber-900/30 px-2 py-0.5 text-[10px] text-amber-300 hover:bg-amber-900/60"
                      >
                        Add
                      </button>
                    </li>
                  ))}
                </ul>
              ) : searchQuery && !isSearching ? (
                <p className="text-xs text-zinc-500">
                  No summoners found matching &ldquo;{searchQuery}&rdquo;.
                </p>
              ) : null}
            </div>
          )}

        </div>
      </div>

      {/* ── Toast notification ── */}
      {toast && (
        <div
          className={`pointer-events-none fixed bottom-5 left-1/2 z-[200] -translate-x-1/2 rounded-xl border px-4 py-2 text-sm shadow-xl backdrop-blur-md ${
            toast.ok
              ? "border-emerald-700 bg-emerald-950/90 text-emerald-200"
              : "border-amber-700 bg-amber-950/90 text-amber-200"
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* Float keyframe */}
      <style>{`
        @keyframes tavernFloat {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-8px); }
        }
      `}</style>
    </div>
  );
}
