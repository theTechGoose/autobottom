/** Island: waveform audio player for /audit/report.
 *  Mirrors prod implementation in main:controller.ts:
 *    - Native <audio> tag, hidden
 *    - Custom play button (teal circle)
 *    - Canvas waveform rendered from decoded audio buffer (150 bars)
 *    - Time display (mm:ss / mm:ss)
 *    - Click-to-seek on canvas
 *    - REC 1 / REC 2 / … tabs when the audit covers multiple recordings
 *  All client-side — required because waveform rendering and seek interaction
 *  are inherently browser-only. No business logic here; just audio UX. */
import { useEffect, useRef, useState } from "preact/hooks";

interface Props {
  findingId: string;
  /** Number of individual recordings stitched into this audit. Default 1. */
  recordingCount?: number;
}

export default function AudioPlayer({ findingId, recordingCount = 1 }: Props) {
  const [activeIdx, setActiveIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const playBtnRef = useRef<HTMLButtonElement>(null);
  const iconPlayRef = useRef<HTMLSpanElement>(null);
  const iconPauseRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const errorRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const audio = audioRef.current;
    const canvas = canvasRef.current;
    const playBtn = playBtnRef.current;
    const iconPlay = iconPlayRef.current;
    const iconPause = iconPauseRef.current;
    const timeEl = timeRef.current;
    const errorEl = errorRef.current;
    const container = containerRef.current;
    if (!audio || !canvas || !playBtn || !iconPlay || !iconPause || !timeEl || !errorEl || !container) return;

    const ctx2d = canvas.getContext("2d");
    let wfData: number[] | null = null;
    let wfProgress = 0;
    let cancelled = false;

    function drawWaveform() {
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
        ctx2d.fillStyle = played ? "#14b8a6" : "rgba(255,255,255,0.18)";
        ctx2d.fillRect(x + 0.5, y, Math.max(1, barW - 1.5), amp);
      }
      const cx = wfProgress * W;
      ctx2d.fillStyle = "rgba(255,255,255,0.7)";
      ctx2d.fillRect(cx - 1, 0, 2, H);
    }

    // Load waveform data (fetch, decode, downsample to 150 bars). Re-runs when
    // activeIdx changes so each REC tab gets its own waveform.
    fetch(`/audit/recording?id=${encodeURIComponent(findingId)}&idx=${activeIdx}`)
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        const AC = (globalThis as unknown as { AudioContext: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
          .AudioContext ||
          (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        const ac = new AC!();
        return ac.decodeAudioData(buf);
      })
      .then((decoded) => {
        if (cancelled) return;
        const ch = decoded.getChannelData(0);
        const BARS = 150;
        const block = Math.floor(ch.length / BARS);
        const data: number[] = [];
        for (let i = 0; i < BARS; i++) {
          let sum = 0;
          for (let j = 0; j < block; j++) sum += Math.abs(ch[i * block + j]);
          data.push(sum / (block || 1));
        }
        const mx = Math.max(...data) || 1;
        for (let k = 0; k < data.length; k++) data[k] /= mx;
        wfData = data;
        drawWaveform();
      })
      .catch(() => { drawWaveform(); });

    function fmt(s: number): string {
      const m = Math.floor(s / 60);
      const sec = Math.floor(s % 60);
      return `${m}:${sec < 10 ? "0" : ""}${sec}`;
    }

    function updateTime() {
      if (!audio || !timeEl) return;
      const cur = audio.currentTime || 0;
      const dur = audio.duration || 0;
      timeEl.textContent = `${fmt(cur)} / ${fmt(dur)}`;
      wfProgress = dur > 0 ? cur / dur : 0;
      drawWaveform();
    }

    const onPlayClick = () => {
      if (audio.paused) audio.play();
      else audio.pause();
    };
    const onPlay = () => { iconPlay.style.display = "none"; iconPause.style.display = "block"; };
    const onPause = () => { iconPlay.style.display = "block"; iconPause.style.display = "none"; };
    const onEnded = () => { iconPlay.style.display = "block"; iconPause.style.display = "none"; wfProgress = 0; drawWaveform(); };
    const onCanvasClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const pct = (e.clientX - rect.left) / rect.width;
      if (audio.duration) audio.currentTime = pct * audio.duration;
    };
    const onError = () => {
      container.style.display = "none";
      errorEl.style.display = "inline";
    };

    playBtn.addEventListener("click", onPlayClick);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("timeupdate", updateTime);
    audio.addEventListener("loadedmetadata", updateTime);
    audio.addEventListener("error", onError);
    canvas.addEventListener("click", onCanvasClick);

    drawWaveform(); // initial placeholder

    return () => {
      cancelled = true;
      playBtn.removeEventListener("click", onPlayClick);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("timeupdate", updateTime);
      audio.removeEventListener("loadedmetadata", updateTime);
      audio.removeEventListener("error", onError);
      canvas.removeEventListener("click", onCanvasClick);
    };
  }, [findingId, activeIdx]);

  const showTabs = recordingCount > 1;

  return (
    <>
      <div class="ap" id="audio-player" ref={containerRef}>
        {showTabs && (
          <div class="ap-rec-tabs" role="tablist">
            {Array.from({ length: recordingCount }, (_, i) => (
              <button
                key={i}
                type="button"
                class={`ap-rec-tab ${i === activeIdx ? "active" : ""}`}
                onClick={() => setActiveIdx(i)}
                aria-pressed={i === activeIdx}
              >REC {i + 1}</button>
            ))}
          </div>
        )}
        <audio
          ref={audioRef}
          id="recording-audio"
          class="audio-native"
          preload="metadata"
          src={`/audit/recording?id=${encodeURIComponent(findingId)}&idx=${activeIdx}`}
        />
        <button type="button" class="ap-play" ref={playBtnRef} title="Play recording">
          <span ref={iconPlayRef}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2l11 6-11 6z" /></svg>
          </span>
          <span ref={iconPauseRef} style="display:none">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2h3v12H3zM10 2h3v12h-3z" /></svg>
          </span>
        </button>
        <canvas
          ref={canvasRef}
          id="ap-waveform"
          width={200}
          height={34}
          style="cursor:pointer;border-radius:4px;flex-shrink:0;"
        />
        <span class="ap-time" ref={timeRef}>0:00 / 0:00</span>
      </div>
      <span class="audio-error" ref={errorRef}>No recording</span>
    </>
  );
}
