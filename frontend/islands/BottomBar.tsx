/** Island: unified bottom bar for /review and /judge. Matches prod's
 *  shared/queue-page.ts `#bottom-bar` — a single horizontal strip combining
 *  audio controls, gamification stats, and nav chrome. Replaces the earlier
 *  GamificationBar + QueueAudioPlayer islands that were stacked (104px total).
 *
 *  Event bus consumed (fired by HotkeyHandler):
 *    - queue:play-toggle (P / Space)
 *    - queue:seek { delta } (←/→, 5s)
 *    - queue:speed { delta } (↑/↓, ±0.5×)
 *    - queue:jump-to-audio { ms } (click on timestamp / Jump to Audio chip)
 */
import { useEffect, useRef, useState } from "preact/hooks";

interface Props {
  mode: "review" | "judge";
  email: string;
  initialFindingId: string | null;
}

interface GameState {
  level?: number;
  totalXp?: number;
  tokenBalance?: number;
  dayStreak?: number;
}

const WF_BARS = 120;
const SEEK_STEP = 5;
const SPEED_MIN = 0.5;
const SPEED_MAX = 3.0;
const COMBO_TIMEOUT_MS = 5000;
const TYPE_FILTER_KEY_REVIEW = "review_typefilter";

function fmt(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec < 10 ? "0" : ""}${sec}`;
}

function comboTier(c: number): string {
  if (c >= 10) return "godlike";
  if (c >= 7) return "inferno";
  if (c >= 4) return "fire";
  if (c >= 2) return "hot";
  return "dim";
}

function xpForLevel(level: number): number {
  return 100 * (level + 1);
}

export default function BottomBar({ mode, email, initialFindingId }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const iconPlayRef = useRef<HTMLSpanElement>(null);
  const iconPauseRef = useRef<HTMLSpanElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [speed, setSpeed] = useState(1.0);
  const [combo, setCombo] = useState(0);
  const [session, setSession] = useState(0);
  const [game, setGame] = useState<GameState>({});
  const [hasAudio, setHasAudio] = useState(!!initialFindingId);
  const [typeFilter, setTypeFilter] = useState<string>(
    typeof localStorage !== "undefined" ? (localStorage.getItem(TYPE_FILTER_KEY_REVIEW) ?? "") : "",
  );

  // Audio + waveform + gamification lifecycle
  useEffect(() => {
    const audio = audioRef.current;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!audio || !canvas || !container) return;
    const ctx2d = canvas.getContext("2d");

    let wfData: number[] | null = null;
    let wfProgress = 0;
    let currentLoadFid: string | null = null;
    let lastDecision = 0;

    function sizeCanvas() {
      const rect = canvas!.getBoundingClientRect();
      canvas!.width = Math.max(120, Math.floor(rect.width));
      canvas!.height = 40;
      draw();
    }

    function draw() {
      if (!ctx2d || !canvas) return;
      const W = canvas.width;
      const H = canvas.height;
      ctx2d.clearRect(0, 0, W, H);
      if (!wfData) {
        ctx2d.fillStyle = "rgba(255,255,255,0.08)";
        ctx2d.fillRect(0, H / 2 - 1, W, 2);
        return;
      }
      const BARS = wfData.length;
      const barW = W / BARS;
      for (let i = 0; i < BARS; i++) {
        const x = i * barW;
        const amp = Math.max(2, wfData[i] * H * 0.85);
        const y = (H - amp) / 2;
        const played = (i / BARS) <= wfProgress;
        ctx2d.fillStyle = played ? (mode === "review" ? "#8b5cf6" : "#14b8a6") : "rgba(255,255,255,0.18)";
        ctx2d.fillRect(x + 0.5, y, Math.max(1, barW - 1.5), amp);
      }
      const cx = wfProgress * W;
      ctx2d.fillStyle = "rgba(255,255,255,0.7)";
      ctx2d.fillRect(cx - 1, 0, 2, H);
    }

    async function loadWaveform(fid: string) {
      wfData = null;
      draw();
      try {
        const r = await fetch(`/audit/recording?id=${encodeURIComponent(fid)}`);
        if (!r.ok) throw new Error("HTTP " + r.status);
        const buf = await r.arrayBuffer();
        const AC = (globalThis as unknown as { AudioContext: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ||
          (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        const ac = new AC!();
        const decoded = await ac.decodeAudioData(buf);
        const ch = decoded.getChannelData(0);
        const block = Math.floor(ch.length / WF_BARS);
        const data: number[] = [];
        for (let i = 0; i < WF_BARS; i++) {
          let sum = 0;
          for (let j = 0; j < block; j++) sum += Math.abs(ch[i * block + j]);
          data.push(sum / (block || 1));
        }
        const mx = Math.max(...data) || 1;
        for (let k = 0; k < data.length; k++) data[k] /= mx;
        wfData = data;
        draw();
      } catch { /* leave placeholder */ }
    }

    function loadFinding(fid: string | null) {
      if (!fid || fid === currentLoadFid) return;
      currentLoadFid = fid;
      audio!.src = `/audit/recording?id=${encodeURIComponent(fid)}&idx=0`;
      audio!.playbackRate = speed;
      setHasAudio(true);
      loadWaveform(fid);
    }

    function updateTime() {
      if (!audio || !timeRef.current) return;
      const cur = audio.currentTime || 0;
      const dur = audio.duration || 0;
      timeRef.current.textContent = `${fmt(cur)} / ${fmt(dur)}`;
      wfProgress = dur > 0 ? cur / dur : 0;
      draw();
    }

    const onPlayEv = () => {
      if (iconPlayRef.current) iconPlayRef.current.style.display = "none";
      if (iconPauseRef.current) iconPauseRef.current.style.display = "block";
    };
    const onPauseEv = () => {
      if (iconPlayRef.current) iconPlayRef.current.style.display = "block";
      if (iconPauseRef.current) iconPauseRef.current.style.display = "none";
    };
    const onEndedEv = () => { onPauseEv(); wfProgress = 0; draw(); };
    const onCanvasClick = (e: MouseEvent) => {
      const rect = canvas!.getBoundingClientRect();
      const pct = (e.clientX - rect.left) / rect.width;
      if (audio!.duration) audio!.currentTime = pct * audio!.duration;
    };

    function togglePlay() {
      if (audio!.paused) audio!.play().catch(() => {});
      else audio!.pause();
    }
    function skipBy(delta: number) {
      if (!audio!.duration) return;
      audio!.currentTime = Math.max(0, Math.min(audio!.duration, (audio!.currentTime || 0) + delta));
    }
    function bumpSpeed(delta: number) {
      setSpeed((prev) => {
        const next = Math.max(SPEED_MIN, Math.min(SPEED_MAX, prev + delta));
        if (audio) audio.playbackRate = next;
        return next;
      });
    }

    // Event bus
    const onPlayToggle = () => togglePlay();
    const onSeek = (e: Event) => {
      const detail = (e as CustomEvent).detail as { delta?: number } | undefined;
      skipBy(detail?.delta ?? SEEK_STEP);
    };
    const onSpeedEv = (e: Event) => {
      const detail = (e as CustomEvent).detail as { delta?: number } | undefined;
      bumpSpeed(detail?.delta ?? 0.5);
    };
    const onJumpTo = (e: Event) => {
      const detail = (e as CustomEvent).detail as { ms?: number } | undefined;
      if (detail?.ms != null && audio!.duration) {
        audio!.currentTime = detail.ms / 1000;
        audio!.play().catch(() => {});
      } else {
        audio!.currentTime = 0;
        audio!.play().catch(() => {});
      }
    };
    const onHtmxSwap = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.target?.id !== "queue-content") return;
      const fidInput = document.getElementById("hx-findingId") as HTMLInputElement | null;
      const nextFid = fidInput?.value || null;
      if (nextFid) loadFinding(nextFid);
      else { setHasAudio(false); wfData = null; draw(); }
    };

    // Decide / undo clicks → combo + session
    const onDocClick = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest(".verdict-btn")) {
        const now = Date.now();
        setCombo((c) => (now - lastDecision > COMBO_TIMEOUT_MS ? 1 : c + 1));
        setSession((s) => s + 1);
        lastDecision = now;
      } else if (target.closest(".verdict-undo")) {
        setCombo(0);
      }
    };

    // Jump-to-audio chip → custom event
    const onChipClick = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const btn = target.closest("[data-action=\"jump-to-audio\"]");
      if (btn) {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent("queue:jump-to-audio"));
      }
    };

    audio.addEventListener("play", onPlayEv);
    audio.addEventListener("pause", onPauseEv);
    audio.addEventListener("ended", onEndedEv);
    audio.addEventListener("timeupdate", updateTime);
    audio.addEventListener("loadedmetadata", updateTime);
    audio.addEventListener("error", () => setHasAudio(false));
    canvas.addEventListener("click", onCanvasClick);
    document.addEventListener("queue:play-toggle", onPlayToggle);
    document.addEventListener("queue:seek", onSeek);
    document.addEventListener("queue:speed", onSpeedEv);
    document.addEventListener("queue:jump-to-audio", onJumpTo);
    document.addEventListener("htmx:afterSwap", onHtmxSwap);
    document.addEventListener("click", onDocClick);
    document.addEventListener("click", onChipClick);
    globalThis.addEventListener("resize", sizeCanvas);

    // Initial game state
    fetch("/agent/api/game-state", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : {}))
      .then((d) => setGame(d as GameState))
      .catch(() => {});

    sizeCanvas();
    if (initialFindingId) loadFinding(initialFindingId);

    return () => {
      audio.removeEventListener("play", onPlayEv);
      audio.removeEventListener("pause", onPauseEv);
      audio.removeEventListener("ended", onEndedEv);
      audio.removeEventListener("timeupdate", updateTime);
      audio.removeEventListener("loadedmetadata", updateTime);
      canvas.removeEventListener("click", onCanvasClick);
      document.removeEventListener("queue:play-toggle", onPlayToggle);
      document.removeEventListener("queue:seek", onSeek);
      document.removeEventListener("queue:speed", onSpeedEv);
      document.removeEventListener("queue:jump-to-audio", onJumpTo);
      document.removeEventListener("htmx:afterSwap", onHtmxSwap);
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("click", onChipClick);
      globalThis.removeEventListener("resize", sizeCanvas);
    };
  }, [initialFindingId, mode, speed]);

  // Gamification derived
  const level = game.level ?? 1;
  const totalXp = game.totalXp ?? 0;
  const levelBase = xpForLevel(level - 1);
  const levelNext = xpForLevel(level);
  const xpIntoLevel = Math.max(0, totalXp - levelBase);
  const xpSpan = Math.max(1, levelNext - levelBase);
  const xpPct = Math.min(100, Math.round((xpIntoLevel / xpSpan) * 100));
  const streak = game.dayStreak ?? 0;
  const tier = comboTier(combo);
  const speedVisible = Math.abs(speed - 1.0) > 0.001;
  const speedColor = speed > 1 ? "var(--blue)" : "var(--yellow)";

  const onFilterChange = (e: Event) => {
    const v = (e.target as HTMLSelectElement).value;
    setTypeFilter(v);
    if (typeof localStorage !== "undefined") {
      if (v) localStorage.setItem(TYPE_FILTER_KEY_REVIEW, v);
      else localStorage.removeItem(TYPE_FILTER_KEY_REVIEW);
    }
    globalThis.location.reload();
  };

  return (
    <div class="bottom-bar" ref={containerRef}>
      <audio ref={audioRef} preload="metadata" style="display:none" />

      {/* Left: help + audio controls */}
      <button
        type="button"
        class="bb-help"
        title="Keyboard shortcuts"
        onClick={() => document.dispatchEvent(new CustomEvent("queue:cheat-sheet-toggle"))}
      >
        <kbd>?</kbd> Keys
      </button>
      <button
        type="button"
        class="bb-skip"
        title="Back 5s"
        onClick={() => document.dispatchEvent(new CustomEvent("queue:seek", { detail: { delta: -SEEK_STEP } }))}
        disabled={!hasAudio}
      >
        ⏮ 5s
      </button>
      <button
        type="button"
        class="bb-play"
        title="Play/Pause"
        onClick={() => document.dispatchEvent(new CustomEvent("queue:play-toggle"))}
        disabled={!hasAudio}
      >
        <span ref={iconPlayRef}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2l11 6-11 6z" /></svg>
        </span>
        <span ref={iconPauseRef} style="display:none">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2h3v12H3zM10 2h3v12h-3z" /></svg>
        </span>
      </button>
      <button
        type="button"
        class="bb-skip"
        title="Forward 5s"
        onClick={() => document.dispatchEvent(new CustomEvent("queue:seek", { detail: { delta: SEEK_STEP } }))}
        disabled={!hasAudio}
      >
        5s ⏭
      </button>
      <canvas class="bb-waveform" ref={canvasRef} style={hasAudio ? "" : "opacity:0.4"} />
      <span class="bb-time" ref={timeRef}>0:00 / 0:00</span>
      <span class="bb-speed" style={speedVisible ? `color:${speedColor}` : "visibility:hidden"}>
        {speed.toFixed(1)}×
      </span>

      {/* Center: gamification stats */}
      <div class="bb-spacer" />
      <div class={`bb-combo bb-combo-${tier}`}>
        <span class="bb-combo-num">{combo}</span>
        <span class="bb-combo-label">combo</span>
      </div>
      <div class="bb-session">
        <span class="bb-session-num">{session}</span>
        <span class="bb-session-label">today</span>
      </div>
      <div class="bb-level">
        <span class="bb-level-badge">Lv.{level}</span>
        <div class="bb-xp-track">
          <div class="bb-xp-fill" style={`width:${xpPct}%`} />
        </div>
        <span class="bb-xp-num mono">{xpIntoLevel}/{xpSpan}</span>
      </div>
      {streak > 0 && (
        <div class="bb-streak" title={`${streak}-day streak`}>🔥 {streak}</div>
      )}

      {/* Right: chrome */}
      <div class="bb-spacer" />
      <span class="bb-tag" title={email}>{mode}</span>
      {mode === "review" && (
        <select class="bb-filter" value={typeFilter} onChange={onFilterChange}>
          <option value="">All types</option>
          <option value="date-leg">Internal only</option>
          <option value="package">Partner only</option>
        </select>
      )}
      <a class="bb-link" href={mode === "review" ? "/review/dashboard" : "/judge/dashboard"}>Dashboard</a>
      <a class="bb-link" href="/chat">Chat</a>
      <a class="bb-link" href="/api/logout">Logout</a>
    </div>
  );
}
