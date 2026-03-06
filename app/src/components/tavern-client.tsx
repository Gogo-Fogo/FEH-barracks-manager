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
  getParticipantDetails,
  type ParticipantDetails,
  fetchTavernMessages,
  sendTavernMessage,
  deleteTavernMessage,
  type TavernMessage,
} from "@/app/tavern/actions";

// ─── Exported types ───────────────────────────────────────────────────────────

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
  tierPower: number;
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
    tierPower: LeaderEntry[];
    total: LeaderEntry[];
    fiveStar: LeaderEntry[];
    red: LeaderEntry[];
    favorites: LeaderEntry[];
  };
};

// ─── Constants ────────────────────────────────────────────────────────────────

// Image is 1696 × 2528  →  ratio ≈ 0.6709 (width / height)
const IMG_RATIO = 1696 / 2528;
const FLOAT_DELAYS = ["0s", "1.3s", "2.5s"];
const CROSSFADE_SECS = 2.5;
const MUSIC_VOL = 0.18;

type TabKey = "leaderboard" | "profile" | "friends" | "add" | "chat";

const TAB_META: Array<{ key: TabKey; icon: string; label: string }> = [
  { key: "leaderboard", icon: "🏆", label: "Leaderboard" },
  { key: "profile",     icon: "👤", label: "Profile"     },
  { key: "friends",     icon: "👥", label: "Friends"     },
  { key: "add",         icon: "➕", label: "Add Friend"  },
  { key: "chat",        icon: "💬", label: "Chat"        },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function TavernClient(props: TavernClientProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Stage participants frozen on mount so router.refresh() doesn't reshuffle
  const [participants] = useState(() => props.participants);
  const myUserId = participants[0]?.userId ?? "";

  // Panel
  const [panelOpen, setPanelOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("leaderboard");

  // Info card on hero portrait
  const [activeCard, setActiveCard] = useState<string | null>(null);

  // Toast
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

  // Profile form (controlled, synced on refresh)
  const [displayNameInput, setDisplayNameInput] = useState(props.myDisplayName);
  const [selectedSlug, setSelectedSlug] = useState(props.myAvatarSlug ?? "");
  useEffect(() => { setDisplayNameInput(props.myDisplayName); }, [props.myDisplayName]);
  useEffect(() => { setSelectedSlug(props.myAvatarSlug ?? ""); }, [props.myAvatarSlug]);

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ id: string; displayName: string }>>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Player profile (opened from info card)
  const [profileTarget, setProfileTarget] = useState<TavernParticipant | null>(null);
  const [profileDetails, setProfileDetails] = useState<ParticipantDetails | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSubTab, setProfileSubTab] = useState<"heroes" | "favorites" | "teams">("heroes");

  // Chat
  const [chatMessages, setChatMessages] = useState<TavernMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const chatPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Lock body scroll
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

  // ── Audio crossfade ────────────────────────────────────────────────────────
  useEffect(() => {
    const src = "/tavern/hearthside-whispers.mp3";
    const a = new Audio(src);
    const b = new Audio(src);
    a.volume = MUSIC_VOL;
    b.volume = 0;
    audioA.current = a;
    audioB.current = b;

    const getActive = () => (activeSlot.current === 0 ? a : b);
    const getNext   = () => (activeSlot.current === 0 ? b : a);

    function doFade() {
      if (fadingRef.current) return;
      fadingRef.current = true;
      const cur = getActive();
      const nxt = getNext();
      nxt.currentTime = 0;
      if (!mutedRef.current) nxt.play().catch(() => {});
      const startVol = cur.volume;
      const steps = Math.round((CROSSFADE_SECS * 1000) / 50);
      let step = 0;
      if (fadeIntervalRef.current) clearInterval(fadeIntervalRef.current);
      fadeIntervalRef.current = setInterval(() => {
        step++;
        const t = step / steps;
        cur.volume = Math.max(0, startVol * (1 - t));
        nxt.volume = mutedRef.current ? 0 : Math.min(MUSIC_VOL, MUSIC_VOL * t);
        if (step >= steps) {
          clearInterval(fadeIntervalRef.current!);
          cur.pause();
          cur.currentTime = 0;
          cur.volume = 0;
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
      if (this.duration - this.currentTime <= CROSSFADE_SECS) doFade();
    }

    a.addEventListener("timeupdate", onTimeUpdate);
    b.addEventListener("timeupdate", onTimeUpdate);

    const tryPlay = () => { if (!mutedRef.current) a.play().catch(() => {}); };
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

  // ── Panel helpers ──────────────────────────────────────────────────────────
  function openPanel(tab: TabKey) {
    if (panelOpen && activeTab === tab) {
      setPanelOpen(false);
    } else {
      setActiveTab(tab);
      setPanelOpen(true);
    }
    setActiveCard(null);
  }

  async function openPlayerProfile(participant: TavernParticipant) {
    setProfileTarget(participant);
    setProfileDetails(null);
    setProfileLoading(true);
    setProfileSubTab("heroes");
    setActiveTab("player" as TabKey);
    setPanelOpen(true);
    setActiveCard(null);
    try {
      const details = await getParticipantDetails(participant.userId);
      setProfileDetails(details);
    } finally {
      setProfileLoading(false);
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

  const pendingCount = props.pendingRequests.length;

  // ── Chat helpers ───────────────────────────────────────────────────────────

  function formatRelativeTime(isoString: string): string {
    const diff = Date.now() - new Date(isoString).getTime();
    const secs = Math.floor(diff / 1000);
    if (secs < 60) return "just now";
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  async function loadChat(scrollToEnd = false) {
    const msgs = await fetchTavernMessages();
    setChatMessages(msgs);
    requestAnimationFrame(() => {
      const el = chatScrollRef.current;
      if (!el) return;
      if (scrollToEnd) {
        el.scrollTop = el.scrollHeight;
      } else {
        const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        if (nearBottom) el.scrollTop = el.scrollHeight;
      }
    });
  }

  async function handleSendChat(e: React.FormEvent) {
    e.preventDefault();
    if (!chatInput.trim() || chatSending) return;
    setChatSending(true);
    try {
      const result = await sendTavernMessage(chatInput.trim());
      if (result.ok) {
        setChatInput("");
        await loadChat(true);
      } else {
        showToast(result.message, false);
      }
    } finally {
      setChatSending(false);
    }
  }

  async function handleDeleteMessage(messageId: string) {
    const result = await deleteTavernMessage(messageId);
    if (result.ok) {
      setChatMessages((prev) => prev.filter((m) => m.id !== messageId));
    } else {
      showToast(result.message, false);
    }
  }

  // Poll chat when panel is open on chat tab
  useEffect(() => {
    if (panelOpen && activeTab === "chat") {
      loadChat(true);
      chatPollRef.current = setInterval(() => loadChat(false), 30_000);
      return () => { if (chatPollRef.current) clearInterval(chatPollRef.current); };
    }
    if (chatPollRef.current) clearInterval(chatPollRef.current);
  }, [activeTab, panelOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const lbCategories = [
    { label: "Tier Power",     entries: props.leaderboard.tierPower, icon: "⚡", color: "text-yellow-300", decimal: true },
    { label: "Most Heroes",    entries: props.leaderboard.total,     icon: "⚔",  color: "text-zinc-100",   decimal: false },
    { label: "Most 5★",        entries: props.leaderboard.fiveStar,  icon: "★",  color: "text-amber-300",  decimal: false },
    { label: "Most Red",       entries: props.leaderboard.red,       icon: "🔴", color: "text-red-300",    decimal: false },
    { label: "Most Favorites", entries: props.leaderboard.favorites, icon: "❤",  color: "text-rose-300",   decimal: false },
  ];

  const panelTitle =
    activeTab === "leaderboard" ? "🏆 Leaderboard" :
    activeTab === "profile"     ? "👤 Profile" :
    activeTab === "friends"     ? "👥 Friends" :
    activeTab === "chat"        ? "💬 Tavern Chat" :
    activeTab === ("player" as TabKey) ? `📋 ${profileTarget?.displayName ?? "Profile"}` :
    "➕ Add Friend";

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    // Outer shell — fills viewport, letterboxes the portrait container
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-black">

      {/*
        Portrait container:
          - width  = min(100vw, 100dvh × ratio) so the full height shows first
          - aspect-ratio fills height from the width
          - On portrait screens: fills width; some dark space above/below
          - On landscape desktops: fills height; dark bars on sides
      */}
      <div
        className="relative overflow-hidden"
        style={{
          width: `min(100vw, calc(100dvh * ${IMG_RATIO}))`,
          aspectRatio: `${IMG_RATIO}`,
        }}
      >

        {/* ── Full-portrait background image ── */}
        <img
          src="/tavern/stage.png"
          alt=""
          className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover object-top"
          draggable={false}
        />

        {/* Atmospheric vignette */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.05) 20%, rgba(0,0,0,0.05) 55%, rgba(0,0,0,0.7) 100%)",
          }}
        />

        {/* ── Top bar ── */}
        <div className="absolute left-0 right-0 top-0 z-30 flex h-10 items-center gap-2 px-2 sm:h-11 sm:px-3">
          {/* Frosted pill for back button */}
          <Link
            href="/barracks"
            className="flex items-center gap-1.5 rounded-full border border-white/20 bg-black/45 px-3 py-1 text-xs text-zinc-200 backdrop-blur-sm hover:bg-black/65"
          >
            ← Barracks
          </Link>

          {/* Spacer + centered title */}
          <div className="flex-1 text-center">
            <span
              className="font-semibold text-amber-100 drop-shadow-[0_1px_6px_rgba(0,0,0,0.9)]"
              style={{ fontSize: "clamp(13px, 3vw, 18px)", fontFamily: "Georgia, serif", letterSpacing: "0.06em" }}
            >
              The Tavern
            </span>
          </div>

          {/* Mute button */}
          <button
            type="button"
            onClick={toggleMute}
            className="flex items-center justify-center rounded-full border border-white/20 bg-black/45 p-1.5 text-xs text-white/80 backdrop-blur-sm hover:bg-black/65"
            title={muted ? "Unmute" : "Mute"}
          >
            {muted ? "🔇" : "♪"}
          </button>
        </div>

        {/* ── Stage area — heroes fill the portrait ── */}
        <div
          className="absolute bottom-0 left-0 right-0 top-10 z-10 flex items-end justify-around px-1 sm:top-11"
          style={{ paddingBottom: "clamp(72px, 16%, 108px)" }}
          onClick={(e) => {
            const t = e.target as HTMLElement;
            if (!t.closest("[data-info-card]") && !t.closest("[data-hero-portrait]")) {
              setActiveCard(null);
              if (panelOpen) setPanelOpen(false);
            }
          }}
        >
          {participants.map((p, idx) => {
            const portraitSrc = p.avatarHeroSlug
              ? `/api/fullbody/${p.avatarHeroSlug}?pose=portrait`
              : null;
            const isOpen = activeCard === p.userId;

            return (
              <div
                key={p.userId}
                className="relative flex flex-col items-center"
                style={{ flex: 1, maxWidth: "48%" }}
              >
                {/* Floating name */}
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

                {/* Portrait — BIG */}
                <div
                  data-hero-portrait
                  className="relative w-full cursor-pointer transition-transform duration-200 hover:scale-105 active:scale-95"
                  style={{ height: "clamp(150px, 49cqh, 520px)" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveCard(isOpen ? null : p.userId);
                    if (panelOpen) setPanelOpen(false);
                  }}
                >
                  {portraitSrc ? (
                    <img
                      src={portraitSrc}
                      alt={p.displayName}
                      className="pointer-events-none h-full w-full object-contain object-bottom drop-shadow-[0_4px_24px_rgba(0,0,0,0.95)]"
                      draggable={false}
                    />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-end gap-2 pb-4 opacity-50">
                      <div className="text-5xl">?</div>
                      <div className="text-xs text-white/60">No avatar</div>
                    </div>
                  )}
                </div>

                {/* Info card */}
                {isOpen && (
                  <div
                    data-info-card
                    className="absolute bottom-[calc(100%+8px)] left-1/2 z-40 w-48 -translate-x-1/2 rounded-xl border border-amber-700/50 bg-zinc-900/97 p-4 shadow-[0_0_24px_rgba(0,0,0,0.9)] backdrop-blur-md sm:w-52"
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
                      <div className="flex justify-between border-b border-zinc-700/50 pb-1.5">
                        <span className="text-zinc-400">🛡 Teams</span>
                        <span className="font-bold text-zinc-100">{p.teamsCount}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); openPlayerProfile(p); }}
                      className="mt-3 w-full rounded-lg border border-amber-700/50 bg-amber-900/30 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-900/60"
                    >
                      View Heroes, Favorites & Teams →
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Floating action buttons (Wizardry-style) ── */}
        <div
          className="absolute right-2 z-20 flex flex-col items-end gap-2 sm:right-3"
          style={{ bottom: "clamp(56px, 13%, 96px)" }}
        >
          {TAB_META.map(({ key, icon, label }) => {
            const badge = key === "friends" && pendingCount > 0;
            const active = panelOpen && activeTab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => openPanel(key)}
                className={`relative flex items-center gap-2 rounded-xl border px-2.5 py-2 text-sm font-medium backdrop-blur-sm transition-colors sm:gap-2.5 sm:px-4 sm:py-2.5 ${
                  active
                    ? "border-amber-500/60 bg-amber-900/70 text-amber-100"
                    : "border-white/20 bg-black/55 text-zinc-200 hover:bg-black/75 hover:text-white"
                }`}
              >
                <span className="text-base leading-none sm:text-lg">{icon}</span>
                <span className="hidden sm:inline">{label}</span>
                {badge && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-black">
                    {pendingCount}
                  </span>
                )}
              </button>
            );
          })}

          {/* Leave button (Wizardry feel) */}
          <Link
            href="/barracks"
            className="mt-1 flex items-center gap-2 rounded-xl border border-white/15 bg-black/45 px-2.5 py-2 text-sm font-medium text-zinc-400 backdrop-blur-sm hover:bg-black/65 hover:text-zinc-200 sm:gap-2.5 sm:px-4 sm:py-2.5"
          >
            <span className="text-base leading-none sm:text-lg">🚪</span>
            <span className="hidden sm:inline">Leave Tavern</span>
          </Link>
        </div>

        {/* ── Backdrop — dims the tavern art when popup is open ── */}
        {panelOpen && (
          <div
            className="absolute inset-0 z-[25] bg-black/50 backdrop-blur-[2px]"
            onClick={() => setPanelOpen(false)}
          />
        )}

        {/* ── Popup modal — centred in the portrait frame ── */}
        <div
          className={`absolute left-1/2 z-30 flex w-[96%] max-h-[78%] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-amber-900/40 bg-zinc-900/98 shadow-[0_8px_48px_rgba(0,0,0,0.85)] backdrop-blur-md transition-all duration-200 sm:w-[92%] sm:max-h-[72%] ${
            panelOpen
              ? "opacity-100 scale-100 pointer-events-auto"
              : "opacity-0 scale-95 pointer-events-none"
          }`}
          style={{ top: "8%" }}
        >
          {/* Panel header */}
          <div className="flex shrink-0 flex-col gap-2 border-b border-zinc-700/50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
            <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3">
              <h3 className="min-w-0 text-sm font-semibold text-zinc-100">{panelTitle}</h3>
              {/* Tab switcher pills */}
              <div className="flex flex-wrap gap-1">
                {TAB_META.map(({ key, icon }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setActiveTab(key)}
                    className={`rounded-full px-2 py-0.5 text-base leading-none transition-colors ${
                      activeTab === key
                        ? "bg-amber-700/60 text-amber-100"
                        : "text-zinc-500 hover:text-zinc-300"
                    }`}
                    title={TAB_META.find((t) => t.key === key)?.label}
                  >
                    {icon}
                    {key === "friends" && pendingCount > 0 && (
                      <sup className="ml-0.5 text-[9px] text-amber-400">{pendingCount}</sup>
                    )}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPanelOpen(false)}
              className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full border border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 sm:static"
            >
              ✕
            </button>
          </div>

          {/* Scrollable content */}
          <div ref={chatScrollRef} className="app-scrollbar flex-1 overflow-y-auto px-3 py-3 sm:px-4">

            {/* ─── Leaderboard ─────────────────────────────────────────── */}
            {activeTab === "leaderboard" && (
              <div className="space-y-2.5">
                {props.leaderboard.total.length < 2 ? (
                  <p className="py-4 text-center text-xs text-zinc-500">
                    Add friends to start competing!
                  </p>
                ) : (
                  lbCategories.map(({ label, entries, icon, color, decimal }) => {
                    const winner = entries[0];
                    const fmt = (n: number) => decimal ? n.toFixed(1) : String(n);
                    return (
                      <div key={label} className="rounded-lg border border-zinc-700/50 bg-zinc-800/60 p-3">
                        <div className="mb-2 text-[10px] uppercase tracking-wider text-zinc-400">{label}</div>
                        <div className="flex items-center gap-2.5">
                          {winner.avatarSlug ? (
                            <img
                              src={`/api/headshots/${winner.avatarSlug}`}
                              alt={winner.displayName}
                              className="h-10 w-10 shrink-0 rounded-full border-2 border-amber-600/40 object-cover"
                            />
                          ) : (
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-zinc-600 bg-zinc-700 text-base">?</div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-xs font-medium text-zinc-200">{winner.displayName}</div>
                            <div className={`text-base font-bold ${color}`}>{icon} {fmt(winner.score)}</div>
                          </div>
                        </div>
                        {entries.slice(1).length > 0 && (
                          <div className="mt-1.5 space-y-0.5 border-t border-zinc-700/30 pt-1.5">
                            {entries.slice(1).map((e, i) => (
                              <div key={i} className="flex justify-between text-[10px] text-zinc-500">
                                <span className="truncate">{e.displayName}</span>
                                <span className="shrink-0 pl-2">{fmt(e.score)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* ─── Profile ──────────────────────────────────────────────── */}
            {activeTab === "profile" && (
              <div className="space-y-5">
                <div>
                  <p className="mb-2 text-xs text-zinc-400">Display name (shown to friends)</p>
                  <form onSubmit={handleSaveName} className="flex flex-col gap-2 sm:flex-row">
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

                <div>
                  <p className="mb-2 text-xs text-zinc-400">Avatar hero (shown on the stage)</p>
                  <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                    {selectedSlug || props.myAvatarSlug ? (
                      <img
                        src={`/api/headshots/${selectedSlug || props.myAvatarSlug}`}
                        alt="Avatar preview"
                        className="h-12 w-12 shrink-0 rounded-full border-2 border-amber-600/50 object-cover"
                      />
                    ) : (
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-zinc-600 bg-zinc-800 text-xl text-zinc-500">?</div>
                    )}
                    {props.myBarracks.length > 0 ? (
                      <form onSubmit={handleSetAvatar} className="flex min-w-0 w-full flex-col gap-2 sm:flex-1 sm:flex-row">
                        <select
                          value={selectedSlug}
                          onChange={(e) => setSelectedSlug(e.target.value)}
                          className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
                        >
                          <option value="" disabled>Pick a hero…</option>
                          {props.myBarracks.map((h) => (
                            <option key={h.hero_slug} value={h.hero_slug}>{h.hero_name}</option>
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
                      <p className="text-xs text-zinc-500">Add heroes to your barracks first.</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ─── Friends ──────────────────────────────────────────────── */}
            {activeTab === "friends" && (
              <div className="space-y-4">
                {props.pendingRequests.length > 0 && (
                  <div>
                    <h3 className="mb-2 text-xs font-semibold text-amber-300">🔔 Pending Requests</h3>
                    <ul className="space-y-2">
                      {props.pendingRequests.map((req) => (
                        <li key={req.id} className="flex flex-col items-start gap-2 rounded-lg border border-zinc-700/50 bg-zinc-800/50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                          <span className="min-w-0 truncate text-xs text-zinc-200">{req.requesterName}</span>
                          <div className="flex shrink-0 gap-1.5">
                            <button type="button" onClick={() => handleAccept(req.id)} className="rounded border border-emerald-700 bg-emerald-900/30 px-2 py-0.5 text-[10px] text-emerald-300 hover:bg-emerald-900/60">
                              Accept
                            </button>
                            <button type="button" onClick={() => handleDecline(req.id)} className="rounded border border-zinc-600 px-2 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-700">
                              Decline
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div>
                  <h3 className="mb-2 text-xs font-semibold text-zinc-300">🧑‍🤝‍🧑 Friends</h3>
                  {props.friends.length === 0 ? (
                    <p className="text-xs text-zinc-500">No friends yet. Use ➕ Add Friend!</p>
                  ) : (
                    <ul className="space-y-2">
                      {props.friends.map((f) => (
                        <li key={f.friendshipId} className="flex flex-col items-start gap-2 rounded-lg border border-zinc-700/50 bg-zinc-800/40 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex min-w-0 items-center gap-2">
                            {f.avatarHeroSlug ? (
                              <img src={`/api/headshots/${f.avatarHeroSlug}`} alt={f.displayName} className="h-8 w-8 shrink-0 rounded-full border border-zinc-600 object-cover" />
                            ) : (
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-600 bg-zinc-700 text-sm text-zinc-500">?</div>
                            )}
                            <div className="min-w-0">
                              <div className="truncate text-xs font-medium text-zinc-200">{f.displayName}</div>
                              <div className="text-[10px] text-zinc-500">{f.stats.totalHeroes} heroes · {f.stats.fiveStarHeroes} ★</div>
                            </div>
                          </div>
                          <button type="button" onClick={() => handleRemove(f.friendshipId)} className="shrink-0 rounded border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-500 hover:border-red-800 hover:text-red-400">
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {/* ─── Player Profile ──────────────────────────────────────── */}
            {activeTab === ("player" as TabKey) && profileTarget && (
              <div className="space-y-3">
                {/* Player header */}
                <div className="flex items-center gap-3 rounded-xl border border-zinc-700/50 bg-zinc-800/60 p-3">
                  {profileTarget.avatarHeroSlug ? (
                    <img
                      src={`/api/headshots/${profileTarget.avatarHeroSlug}`}
                      alt={profileTarget.displayName}
                      className="h-12 w-12 shrink-0 rounded-full border-2 border-amber-600/50 object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-zinc-600 bg-zinc-700 text-xl">?</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-amber-100">
                      {profileTarget.displayName}
                      {profileTarget.isMe && <span className="ml-2 text-xs text-amber-400">You</span>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-3 text-[10px] text-zinc-400">
                      <span>⚔ {profileTarget.totalHeroes}</span>
                      <span>★ {profileTarget.fiveStarHeroes}</span>
                      <span>❤ {profileTarget.favoritesCount}</span>
                      <span>🛡 {profileTarget.teamsCount}</span>
                    </div>
                  </div>
                </div>

                {/* Sub-tabs */}
                <div className="flex flex-wrap gap-1 rounded-lg border border-zinc-700/50 bg-zinc-800/40 p-1">
                  {(["heroes", "favorites", "teams"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setProfileSubTab(t)}
                      className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors capitalize ${
                        profileSubTab === t
                          ? "bg-zinc-700 text-zinc-100"
                          : "text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      {t === "heroes" ? "⚔ Heroes" : t === "favorites" ? "❤ Favorites" : "🛡 Teams"}
                    </button>
                  ))}
                </div>

                {/* Loading */}
                {profileLoading && (
                  <p className="py-6 text-center text-xs text-zinc-500">Loading…</p>
                )}

                {/* Heroes sub-tab */}
                {!profileLoading && profileSubTab === "heroes" && profileDetails && (
                  profileDetails.heroes.length === 0 ? (
                    <p className="py-4 text-center text-xs text-zinc-500">No heroes in barracks.</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {profileDetails.heroes.map((h) => (
                        <div key={h.hero_slug} className="flex flex-col items-center gap-1 rounded-lg border border-zinc-700/40 bg-zinc-800/50 p-2">
                          <img
                            src={`/api/headshots/${h.hero_slug}`}
                            alt={h.hero_name}
                            className="h-10 w-10 rounded-full border border-zinc-600 object-cover"
                          />
                          <div className="w-full truncate text-center text-[10px] leading-tight text-zinc-300">{h.hero_name}</div>
                          {h.tier != null && (
                            <div className="text-[9px] text-amber-400">T{h.tier}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )
                )}

                {/* Favorites sub-tab */}
                {!profileLoading && profileSubTab === "favorites" && profileDetails && (
                  profileDetails.favorites.length === 0 ? (
                    <p className="py-4 text-center text-xs text-zinc-500">No favorites yet.</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {profileDetails.favorites.map((h) => (
                        <div key={h.hero_slug} className="flex flex-col items-center gap-1 rounded-lg border border-rose-900/40 bg-rose-950/20 p-2">
                          <img
                            src={`/api/headshots/${h.hero_slug}`}
                            alt={h.hero_name}
                            className="h-10 w-10 rounded-full border border-rose-700/40 object-cover"
                          />
                          <div className="w-full truncate text-center text-[10px] leading-tight text-zinc-300">{h.hero_name}</div>
                          {h.tier != null && (
                            <div className="text-[9px] text-amber-400">T{h.tier}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )
                )}

                {/* Teams sub-tab */}
                {!profileLoading && profileSubTab === "teams" && profileDetails && (
                  profileDetails.teams.length === 0 ? (
                    <p className="py-4 text-center text-xs text-zinc-500">No teams yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {profileDetails.teams.map((team) => (
                        <div key={team.id} className="rounded-lg border border-zinc-700/50 bg-zinc-800/50 p-3">
                          <div className="mb-2 text-xs font-semibold text-zinc-200">{team.name}</div>
                          {team.description && (
                            <div className="mb-2 text-[10px] text-zinc-500">{team.description}</div>
                          )}
                          <div className="flex gap-1.5 flex-wrap">
                            {team.slots.map((slug) => (
                              <img
                                key={slug}
                                src={`/api/headshots/${slug}`}
                                alt={slug}
                                className="h-9 w-9 rounded-full border border-zinc-600 object-cover"
                                title={slug}
                              />
                            ))}
                            {team.slots.length === 0 && (
                              <span className="text-[10px] text-zinc-500">Empty team</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                )}
              </div>
            )}

            {/* ─── Add Friend ───────────────────────────────────────────── */}
            {activeTab === "add" && (
              <div className="space-y-3">
                <form onSubmit={handleSearch} className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by display name…"
                    className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-amber-500 focus:outline-none"
                  />
                  <button type="submit" disabled={isSearching} className="rounded-md border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700 disabled:opacity-50">
                    {isSearching ? "…" : "Go"}
                  </button>
                </form>

                {searchResults.length > 0 ? (
                  <ul className="space-y-2">
                    {searchResults.map((r) => (
                      <li key={r.id} className="flex flex-col items-start gap-2 rounded-lg border border-zinc-700/50 bg-zinc-800/50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                        <span className="min-w-0 truncate text-xs text-zinc-200">{r.displayName}</span>
                        <button type="button" onClick={() => handleSendRequest(r.id)} className="shrink-0 rounded border border-amber-700 bg-amber-900/30 px-2 py-0.5 text-[10px] text-amber-300 hover:bg-amber-900/60">
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

            {/* ─── Chat ──────────────────────────────────────────────────── */}
            {activeTab === "chat" && (
              <div className="space-y-3">
                {chatMessages.length === 0 ? (
                  <p className="py-8 text-center text-xs text-zinc-500">
                    No messages yet. Be the first to speak!
                  </p>
                ) : (
                  chatMessages.map((msg) => (
                    <div key={msg.id} className="flex gap-2.5">
                      {msg.avatarHeroSlug ? (
                        <img
                          src={`/api/headshots/${msg.avatarHeroSlug}`}
                          alt={msg.displayName}
                          className="mt-0.5 h-8 w-8 shrink-0 rounded-full border border-zinc-700 object-cover"
                        />
                      ) : (
                        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800 text-xs text-zinc-500">
                          ?
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="mb-0.5 flex items-baseline gap-1.5">
                          <span className="max-w-[40%] truncate text-xs font-semibold text-amber-200">
                            {msg.displayName}
                          </span>
                          <span className="shrink-0 text-[10px] text-zinc-600">
                            {formatRelativeTime(msg.createdAt)}
                          </span>
                          {msg.userId === myUserId && (
                            <button
                              type="button"
                              onClick={() => handleDeleteMessage(msg.id)}
                              className="ml-auto shrink-0 text-[9px] text-zinc-600 hover:text-red-400"
                              title="Delete message"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                        <p className="break-words text-xs text-zinc-300">{msg.content}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

          </div>

          {/* ── Chat input bar — pinned below the scrollable area ── */}
          {panelOpen && activeTab === "chat" && (
            <div className="shrink-0 border-t border-zinc-700/50 px-4 py-2.5">
              <form onSubmit={handleSendChat} className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  maxLength={500}
                  placeholder="Say something to the tavern…"
                  className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-amber-500 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={chatSending || !chatInput.trim()}
                  className="rounded-md border border-amber-700 bg-amber-900/30 px-3 py-1.5 text-sm text-amber-200 hover:bg-amber-900/60 disabled:opacity-50"
                >
                  {chatSending ? "…" : "Send"}
                </button>
              </form>
            </div>
          )}
        </div>

        {/* ── Toast ── */}
        {toast && (
          <div
            className={`pointer-events-none absolute bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-xl border px-4 py-2 text-sm shadow-xl backdrop-blur-md ${
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
            50%       { transform: translateY(-7px); }
          }
        `}</style>
      </div>
    </div>
  );
}
