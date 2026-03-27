/**
 * Sound utility module wrapping the Web Audio API.
 * Mirrors the synth functions from the legacy sound-engine.js.
 *
 * Usage:
 *   import { SoundEngine } from "@/utils/sounds.ts";
 *   SoundEngine.play("combo:2");
 *   SoundEngine.setEnabled(true);
 */

type OscType = OscillatorType;

let audioCtx: AudioContext | null = null;
let enabled = false;

// slot -> pack name (from gamification settings)
let packConfig: Record<string, string> = {};
// packId -> slot -> URL
let packRegistry: Record<string, Record<string, string>> = {};
const audioCache: Record<string, HTMLAudioElement> = {};

function getAudioCtx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (
      (globalThis as unknown as { AudioContext: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ||
      (globalThis as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    )();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function noiseBurst(ctx: AudioContext, t: number, dur: number, freq: number, vol: number) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const flt = ctx.createBiquadFilter();
  flt.type = "bandpass";
  flt.frequency.value = freq;
  flt.Q.value = 2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(flt);
  flt.connect(g);
  g.connect(ctx.destination);
  src.start(t);
  src.stop(t + dur);
}

function tone(
  ctx: AudioContext,
  t: number,
  type: OscType,
  freq: number,
  vol: number,
  attack: number,
  decay: number,
) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.001, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.001, t + attack + decay);
  o.connect(g);
  g.connect(ctx.destination);
  o.start(t);
  o.stop(t + attack + decay + 0.01);
}

function playPing() {
  const ctx = getAudioCtx(), t = ctx.currentTime;
  noiseBurst(ctx, t, 0.04, 4000, 0.15);
  tone(ctx, t, "sine", 880, 0.2, 0.005, 0.1);
  tone(ctx, t + 0.01, "sine", 1320, 0.08, 0.005, 0.06);
}

function playDouble() {
  const ctx = getAudioCtx(), t = ctx.currentTime;
  noiseBurst(ctx, t, 0.03, 5000, 0.12);
  tone(ctx, t, "sine", 784, 0.2, 0.005, 0.1);
  noiseBurst(ctx, t + 0.1, 0.03, 6000, 0.14);
  tone(ctx, t + 0.1, "sine", 1047, 0.22, 0.005, 0.12);
}

function playTriple() {
  const ctx = getAudioCtx(), t = ctx.currentTime;
  [784, 988, 1319].forEach((freq, i) => {
    const off = i * 0.09;
    noiseBurst(ctx, t + off, 0.025, 5000 + i * 1000, 0.1);
    tone(ctx, t + off, "sine", freq, 0.2, 0.005, 0.15);
    tone(ctx, t + off, "sine", freq * 2.01, 0.04, 0.01, 0.1);
  });
}

function playMega() {
  const ctx = getAudioCtx(), t = ctx.currentTime;
  const ob = ctx.createOscillator(), gb = ctx.createGain();
  ob.type = "sine";
  ob.frequency.setValueAtTime(150, t);
  ob.frequency.exponentialRampToValueAtTime(40, t + 0.2);
  gb.gain.setValueAtTime(0.35, t);
  gb.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
  ob.connect(gb);
  gb.connect(ctx.destination);
  ob.start(t);
  ob.stop(t + 0.25);
  noiseBurst(ctx, t, 0.06, 3000, 0.25);
  [523, 784, 1047].forEach((freq) => tone(ctx, t + 0.03, "triangle", freq, 0.12, 0.01, 0.25));
}

function playUltra() {
  const ctx = getAudioCtx(), t = ctx.currentTime;
  const buf = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const flt = ctx.createBiquadFilter();
  flt.type = "bandpass";
  flt.Q.value = 3;
  flt.frequency.setValueAtTime(300, t);
  flt.frequency.exponentialRampToValueAtTime(4000, t + 0.2);
  const gn = ctx.createGain();
  gn.gain.setValueAtTime(0.2, t);
  gn.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
  src.connect(flt);
  flt.connect(gn);
  gn.connect(ctx.destination);
  src.start(t);
  src.stop(t + 0.4);
  [523, 659, 784, 1047].forEach((freq) => {
    tone(ctx, t + 0.15, "sawtooth", freq, 0.08, 0.01, 0.3);
    tone(ctx, t + 0.15, "sine", freq, 0.1, 0.005, 0.35);
  });
}

function playRampage() {
  const ctx = getAudioCtx(), t = ctx.currentTime;
  noiseBurst(ctx, t, 0.1, 800, 0.3);
  const od = ctx.createOscillator(), gd = ctx.createGain();
  od.type = "sine";
  od.frequency.setValueAtTime(80, t);
  od.frequency.exponentialRampToValueAtTime(30, t + 0.3);
  gd.gain.setValueAtTime(0.4, t);
  gd.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
  od.connect(gd);
  gd.connect(ctx.destination);
  od.start(t);
  od.stop(t + 0.35);
  [392, 523, 659, 784, 1047].forEach((freq, i) => {
    const off = 0.06 + i * 0.05;
    tone(ctx, t + off, "square", freq, 0.06, 0.01, 0.25);
    tone(ctx, t + off, "sine", freq, 0.1, 0.005, 0.3);
  });
}

function playGodlike() {
  const ctx = getAudioCtx(), t = ctx.currentTime;
  const buf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const flt = ctx.createBiquadFilter();
  flt.type = "lowpass";
  flt.frequency.setValueAtTime(8000, t);
  flt.frequency.exponentialRampToValueAtTime(200, t + 0.5);
  const gn = ctx.createGain();
  gn.gain.setValueAtTime(0.3, t);
  gn.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
  src.connect(flt);
  flt.connect(gn);
  gn.connect(ctx.destination);
  src.start(t);
  src.stop(t + 0.6);
  const ob = ctx.createOscillator(), gb = ctx.createGain();
  ob.type = "sine";
  ob.frequency.setValueAtTime(45, t);
  ob.frequency.exponentialRampToValueAtTime(25, t + 0.8);
  gb.gain.setValueAtTime(0.35, t);
  gb.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
  ob.connect(gb);
  gb.connect(ctx.destination);
  ob.start(t);
  ob.stop(t + 0.8);
  [262, 330, 392, 523, 659, 784, 1047, 1319].forEach((freq) => {
    [-4, 0, 4].forEach((det) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      o.detune.value = det;
      g.gain.setValueAtTime(0.001, t + 0.1);
      g.gain.linearRampToValueAtTime(0.04, t + 0.2);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(t + 0.1);
      o.stop(t + 1.0);
    });
  });
}

function playLevelUp() {
  const ctx = getAudioCtx(), t = ctx.currentTime;
  noiseBurst(ctx, t, 0.05, 6000, 0.12);
  tone(ctx, t, "triangle", 523, 0.2, 0.01, 0.15);
  tone(ctx, t + 0.1, "triangle", 784, 0.2, 0.01, 0.15);
  tone(ctx, t + 0.2, "triangle", 1047, 0.22, 0.01, 0.2);
}

function playShutdown() {
  const ctx = getAudioCtx(), t = ctx.currentTime;
  tone(ctx, t, "sawtooth", 600, 0.25, 0.01, 0.3);
  tone(ctx, t + 0.08, "sawtooth", 400, 0.2, 0.01, 0.25);
  tone(ctx, t + 0.18, "sawtooth", 200, 0.18, 0.01, 0.3);
  tone(ctx, t + 0.3, "sine", 80, 0.3, 0.01, 0.4);
  noiseBurst(ctx, t + 0.1, 0.15, 3000, 0.1);
}

export type SoundSlot =
  | "ping"
  | "double"
  | "triple"
  | "mega"
  | "ultra"
  | "rampage"
  | "godlike"
  | "levelup"
  | "shutdown";

export type SoundEvent =
  | "decide"
  | "combo:2"
  | "combo:3"
  | "combo:4"
  | "combo:5"
  | "combo:6"
  | "combo:7"
  | "levelup"
  | "shutdown";

const SYNTH_MAP: Record<SoundSlot, () => void> = {
  ping: playPing,
  double: playDouble,
  triple: playTriple,
  mega: playMega,
  ultra: playUltra,
  rampage: playRampage,
  godlike: playGodlike,
  levelup: playLevelUp,
  shutdown: playShutdown,
};

const EVENT_MAP: Record<SoundEvent, SoundSlot> = {
  decide: "ping",
  "combo:2": "double",
  "combo:3": "triple",
  "combo:4": "mega",
  "combo:5": "ultra",
  "combo:6": "rampage",
  "combo:7": "godlike",
  levelup: "levelup",
  shutdown: "shutdown",
};

function getActivePack(): string | null {
  const vals = Object.values(packConfig);
  return vals.length > 0 ? vals[0] : null;
}

function playFileInternal(url: string) {
  if (!audioCache[url]) {
    audioCache[url] = new Audio(url);
    audioCache[url].volume = 0.7;
  }
  const a = audioCache[url];
  a.currentTime = 0;
  a.play().catch((e) => console.error("playFile error:", e));
}

function playSlotInternal(slot: SoundSlot) {
  const pack = packConfig[slot] || getActivePack();
  if (pack && pack !== "synth" && packRegistry[pack]) {
    const url = packRegistry[pack][slot];
    if (url) {
      playFileInternal(url);
      return;
    }
  }
  const fn = SYNTH_MAP[slot];
  if (fn) fn();
}

export const SoundEngine = {
  init(soundsConfig: Record<string, string>, registry?: Record<string, Record<string, string>>) {
    packConfig = soundsConfig || {};
    if (registry) packRegistry = registry;
  },

  registerPack(packId: string, slots: Record<string, string>) {
    packRegistry[packId] = slots;
  },

  play(event: SoundEvent | string) {
    if (!enabled) return;
    const slot = (EVENT_MAP[event as SoundEvent] ?? event) as SoundSlot;
    playSlotInternal(slot);
  },

  playSlot(slot: SoundSlot) {
    playSlotInternal(slot);
  },

  playFile(url: string) {
    playFileInternal(url);
  },

  setEnabled(val: boolean) {
    enabled = !!val;
    if (enabled && !audioCtx) getAudioCtx();
  },

  isEnabled(): boolean {
    return enabled;
  },

  getPacks(): Record<string, Record<string, string>> {
    return packRegistry;
  },

  getSynths(): Record<SoundSlot, () => void> {
    return SYNTH_MAP;
  },

  getActivePack(): string | null {
    return getActivePack();
  },
};
