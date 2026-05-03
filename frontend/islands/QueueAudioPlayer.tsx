/** Island: audio player bar for /review and /judge. Mirrors prod's
 *  shared/queue-page.ts audio section — single <audio> element, waveform
 *  canvas, play/pause + back-5s/forward-5s buttons, time display, speed
 *  multiplier shown when ≠1×. Reloads on HTMX swap so the audio follows
 *  the currently-displayed question's finding. Also listens for:
 *    - queue:play-toggle  (P / Space)
 *    - queue:seek  (←/→, skip by 5s)
 *    - queue:speed (↑/↓, ±0.5×)
 *    - queue:jump-to-audio (Jump to Audio chip click)
 */
import { useEffect, useRef, useState } from "preact/hooks";

interface Props {
  initialFindingId: string | null;
}

const WF_BARS = 120;
const SEEK_STEP = 5;
const SPEED_STEP = 0.5;
const SPEED_MIN = 0.5;
const SPEED_MAX = 3.0;

function fmt(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec < 10 ? "0" : ""}${sec}`;
}

export default function QueueAudioPlayer({ initialFindingId }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const iconPlayRef = useRef<HTMLSpanElement>(null);
  const iconPauseRef = useRef<HTMLSpanElement>(null);
  // Speed is a ref (not state) so bumping it never triggers a re-render —
  // re-renders were causing currentTime to reset on speed change.
  const speedRef = useRef(1.0);
  const speedDisplayRef = useRef<HTMLSpanElement>(null);
  const [currentFid, setCurrentFid] = useState<string | null>(initialFindingId);

  useEffect(() => {
    const audio = audioRef.current;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!audio || !canvas || !container) return;
    const ctx2d = canvas.getContext("2d");

    let wfData: number[] | null = null;
    let wfProgress = 0;
    let currentLoadFid: string | null = null;

    function sizeCanvas() {
      const w = Math.max(200, Math.floor(container!.clientWidth - 320));
      canvas!.width = w;
      canvas!.height = 48;
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
        const amp = Math.max(2, wfData[i] * H * 0.88);
        const y = (H - amp) / 2;
        const played = (i / BARS) <= wfProgress;
        ctx2d.fillStyle = played ? "#8b5cf6" : "rgba(255,255,255,0.18)";
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
      } catch { /* leave waveform placeholder */ }
    }

    function loadFinding(fid: string | null) {
      if (!fid) return;
      if (fid === currentLoadFid) return;
      currentLoadFid = fid;
      audio!.src = `/audit/recording?id=${encodeURIComponent(fid)}&idx=0`;
      audio!.playbackRate = speedRef.current;
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

    const onPlay = () => {
      if (iconPlayRef.current) iconPlayRef.current.style.display = "none";
      if (iconPauseRef.current) iconPauseRef.current.style.display = "block";
    };
    const onPause = () => {
      if (iconPlayRef.current) iconPlayRef.current.style.display = "block";
      if (iconPauseRef.current) iconPauseRef.current.style.display = "none";
    };
    const onEnded = () => { onPause(); wfProgress = 0; draw(); };
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
      const next = Math.max(SPEED_MIN, Math.min(SPEED_MAX, speedRef.current + delta));
      speedRef.current = next;
      audio!.playbackRate = next;
      // Update display imperatively — no re-render, no audio reload.
      const el = speedDisplayRef.current;
      if (el) {
        el.textContent = `${next.toFixed(1)}×`;
        el.style.visibility = Math.abs(next - 1.0) > 0.001 ? "visible" : "hidden";
        el.style.color = next > 1 ? "var(--blue)" : "var(--yellow)";
      }
    }

    // Public events from other islands / components
    const onJumpToAudio = (e: Event) => {
      const detail = (e as CustomEvent).detail as { ms?: number } | undefined;
      if (detail?.ms != null && audio!.duration) {
        audio!.currentTime = detail.ms / 1000;
        audio!.play().catch(() => {});
      } else {
        // fallback: start from beginning and play
        audio!.currentTime = 0;
        audio!.play().catch(() => {});
      }
    };
    const onPlayToggleEvent = () => togglePlay();
    const onSeekEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail as { delta?: number } | undefined;
      skipBy(detail?.delta ?? SEEK_STEP);
    };
    const onSpeedEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail as { delta?: number } | undefined;
      bumpSpeed(detail?.delta ?? SPEED_STEP);
    };

    // HTMX afterSwap on #queue-content: re-read the hidden finding input
    const onHtmxSwap = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.target?.id !== "queue-content") return;
      const fidInput = document.getElementById("hx-findingId") as HTMLInputElement | null;
      const nextFid = fidInput?.value || null;
      if (nextFid && nextFid !== currentLoadFid) {
        setCurrentFid(nextFid);
        loadFinding(nextFid);
      }
    };

    // Window resize to redraw
    const onResize = () => { sizeCanvas(); };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("timeupdate", updateTime);
    audio.addEventListener("loadedmetadata", updateTime);
    canvas.addEventListener("click", onCanvasClick);
    document.addEventListener("queue:jump-to-audio", onJumpToAudio);
    document.addEventListener("queue:play-toggle", onPlayToggleEvent);
    document.addEventListener("queue:seek", onSeekEvent);
    document.addEventListener("queue:speed", onSpeedEvent);
    document.addEventListener("htmx:afterSwap", onHtmxSwap);
    globalThis.addEventListener("resize", onResize);

    // Also intercept clicks on any [data-action="jump-to-audio"] button so the
    // existing VerdictPanel chip works without knowing about the event name.
    const onChipClick = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const btn = target.closest("[data-action=\"jump-to-audio\"]");
      if (btn) {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent("queue:jump-to-audio"));
      }
    };
    document.addEventListener("click", onChipClick);

    sizeCanvas();
    if (initialFindingId) loadFinding(initialFindingId);

    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("timeupdate", updateTime);
      audio.removeEventListener("loadedmetadata", updateTime);
      canvas.removeEventListener("click", onCanvasClick);
      document.removeEventListener("queue:jump-to-audio", onJumpToAudio);
      document.removeEventListener("queue:play-toggle", onPlayToggleEvent);
      document.removeEventListener("queue:seek", onSeekEvent);
      document.removeEventListener("queue:speed", onSpeedEvent);
      document.removeEventListener("htmx:afterSwap", onHtmxSwap);
      document.removeEventListener("click", onChipClick);
      globalThis.removeEventListener("resize", onResize);
    };
  }, [initialFindingId]);

  const hasFinding = !!currentFid;

  return (
    <div class="queue-audio-bar" ref={containerRef} style={hasFinding ? "" : "visibility:hidden"}>
      <audio ref={audioRef} preload="metadata" style="display:none" />
      <button class="qap-back" type="button" title="Back 5s" onClick={() => document.dispatchEvent(new CustomEvent("queue:seek", { detail: { delta: -SEEK_STEP } }))}>
        ⏮ 5s
      </button>
      <button class="qap-play" type="button" title="Play/Pause" onClick={() => document.dispatchEvent(new CustomEvent("queue:play-toggle"))}>
        <span ref={iconPlayRef}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2l11 6-11 6z" /></svg>
        </span>
        <span ref={iconPauseRef} style="display:none">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2h3v12H3zM10 2h3v12h-3z" /></svg>
        </span>
      </button>
      <button class="qap-fwd" type="button" title="Forward 5s" onClick={() => document.dispatchEvent(new CustomEvent("queue:seek", { detail: { delta: SEEK_STEP } }))}>
        5s ⏭
      </button>
      <canvas class="qap-waveform" ref={canvasRef} />
      <span class="qap-time" ref={timeRef}>0:00 / 0:00</span>
      <span class="qap-speed" ref={speedDisplayRef} style="visibility:hidden">
        1.0×
      </span>
    </div>
  );
}
