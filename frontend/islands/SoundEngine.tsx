/** Island: Web Audio API sound engine for gamification.
 *  Plays combo sounds on decisions via HTMX afterSwap events. */
import { useEffect, useRef } from "preact/hooks";

export default function SoundEngine() {
  const comboRef = useRef(0);
  const lastDecisionRef = useRef(0);
  const COMBO_TIMEOUT_MS = 5000;

  useEffect(() => {
    let audioCtx: AudioContext | null = null;

    function getAudioCtx(): AudioContext {
      if (!audioCtx) audioCtx = new AudioContext();
      return audioCtx;
    }

    function playTone(freq: number, duration: number, type: OscillatorType = "sine") {
      try {
        const ctx = getAudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + duration);
      } catch { /* audio not available */ }
    }

    function playComboSound(combo: number) {
      if (combo <= 1) { playTone(880, 0.08); return; }
      if (combo <= 3) { playTone(988, 0.08); setTimeout(() => playTone(1175, 0.08), 60); return; }
      if (combo <= 6) { playTone(1175, 0.06); setTimeout(() => playTone(1319, 0.06), 50); setTimeout(() => playTone(1568, 0.08), 100); return; }
      // Mega combo
      playTone(1319, 0.05);
      setTimeout(() => playTone(1568, 0.05), 40);
      setTimeout(() => playTone(1760, 0.05), 80);
      setTimeout(() => playTone(2093, 0.1), 120);
    }

    function onDecision() {
      const now = Date.now();
      if (now - lastDecisionRef.current > COMBO_TIMEOUT_MS) {
        comboRef.current = 0;
      }
      comboRef.current++;
      lastDecisionRef.current = now;
      playComboSound(comboRef.current);
    }

    // Listen for HTMX afterSwap on the queue content — means a decision was made
    document.addEventListener("htmx:afterSwap", (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.target?.id === "queue-content") {
        onDecision();
      }
    });

    // Initialize audio context on first user interaction
    const initAudio = () => {
      getAudioCtx();
      document.removeEventListener("click", initAudio);
      document.removeEventListener("keydown", initAudio);
    };
    document.addEventListener("click", initAudio, { once: true });
    document.addEventListener("keydown", initAudio, { once: true });
  }, []);

  return <div style="display:none" data-sound-engine></div>;
}
