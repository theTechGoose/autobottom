import { Service } from "@sprig/kit";

type OscType = OscillatorType;

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

@Service({ scope: "singleton" })
export class SoundEngine {
  private audioCtx: AudioContext | null = null;
  private enabled = false;
  private packConfig: Record<string, string> = {};
  private packRegistry: Record<string, Record<string, string>> = {};
  private audioCache: Record<string, HTMLAudioElement> = {};

  private readonly SYNTH_MAP: Record<SoundSlot, () => void> = {
    ping: () => this.playPing(),
    double: () => this.playDouble(),
    triple: () => this.playTriple(),
    mega: () => this.playMega(),
    ultra: () => this.playUltra(),
    rampage: () => this.playRampage(),
    godlike: () => this.playGodlike(),
    levelup: () => this.playLevelUp(),
    shutdown: () => this.playShutdown(),
  };

  private readonly EVENT_MAP: Record<SoundEvent, SoundSlot> = {
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

  private getAudioCtx(): AudioContext {
    if (!this.audioCtx) {
      this.audioCtx = new (
        (
          globalThis as unknown as {
            AudioContext: typeof AudioContext;
            webkitAudioContext?: typeof AudioContext;
          }
        ).AudioContext ||
        (
          globalThis as unknown as {
            webkitAudioContext: typeof AudioContext;
          }
        ).webkitAudioContext
      )();
    }
    if (this.audioCtx.state === "suspended") this.audioCtx.resume();
    return this.audioCtx;
  }

  private noiseBurst(
    ctx: AudioContext,
    t: number,
    dur: number,
    freq: number,
    vol: number,
  ) {
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

  private tone(
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

  private playPing() {
    const ctx = this.getAudioCtx(), t = ctx.currentTime;
    this.noiseBurst(ctx, t, 0.04, 4000, 0.15);
    this.tone(ctx, t, "sine", 880, 0.2, 0.005, 0.1);
    this.tone(ctx, t + 0.01, "sine", 1320, 0.08, 0.005, 0.06);
  }

  private playDouble() {
    const ctx = this.getAudioCtx(), t = ctx.currentTime;
    this.noiseBurst(ctx, t, 0.03, 5000, 0.12);
    this.tone(ctx, t, "sine", 784, 0.2, 0.005, 0.1);
    this.noiseBurst(ctx, t + 0.1, 0.03, 6000, 0.14);
    this.tone(ctx, t + 0.1, "sine", 1047, 0.22, 0.005, 0.12);
  }

  private playTriple() {
    const ctx = this.getAudioCtx(), t = ctx.currentTime;
    [784, 988, 1319].forEach((freq, i) => {
      const off = i * 0.09;
      this.noiseBurst(ctx, t + off, 0.025, 5000 + i * 1000, 0.1);
      this.tone(ctx, t + off, "sine", freq, 0.2, 0.005, 0.15);
      this.tone(ctx, t + off, "sine", freq * 2.01, 0.04, 0.01, 0.1);
    });
  }

  private playMega() {
    const ctx = this.getAudioCtx(), t = ctx.currentTime;
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
    this.noiseBurst(ctx, t, 0.06, 3000, 0.25);
    [523, 784, 1047].forEach((freq) =>
      this.tone(ctx, t + 0.03, "triangle", freq, 0.12, 0.01, 0.25)
    );
  }

  private playUltra() {
    const ctx = this.getAudioCtx(), t = ctx.currentTime;
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
      this.tone(ctx, t + 0.15, "sawtooth", freq, 0.08, 0.01, 0.3);
      this.tone(ctx, t + 0.15, "sine", freq, 0.1, 0.005, 0.35);
    });
  }

  private playRampage() {
    const ctx = this.getAudioCtx(), t = ctx.currentTime;
    this.noiseBurst(ctx, t, 0.1, 800, 0.3);
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
      this.tone(ctx, t + off, "square", freq, 0.06, 0.01, 0.25);
      this.tone(ctx, t + off, "sine", freq, 0.1, 0.005, 0.3);
    });
  }

  private playGodlike() {
    const ctx = this.getAudioCtx(), t = ctx.currentTime;
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

  private playLevelUp() {
    const ctx = this.getAudioCtx(), t = ctx.currentTime;
    this.noiseBurst(ctx, t, 0.05, 6000, 0.12);
    this.tone(ctx, t, "triangle", 523, 0.2, 0.01, 0.15);
    this.tone(ctx, t + 0.1, "triangle", 784, 0.2, 0.01, 0.15);
    this.tone(ctx, t + 0.2, "triangle", 1047, 0.22, 0.01, 0.2);
  }

  private playShutdown() {
    const ctx = this.getAudioCtx(), t = ctx.currentTime;
    this.tone(ctx, t, "sawtooth", 600, 0.25, 0.01, 0.3);
    this.tone(ctx, t + 0.08, "sawtooth", 400, 0.2, 0.01, 0.25);
    this.tone(ctx, t + 0.18, "sawtooth", 200, 0.18, 0.01, 0.3);
    this.tone(ctx, t + 0.3, "sine", 80, 0.3, 0.01, 0.4);
    this.noiseBurst(ctx, t + 0.1, 0.15, 3000, 0.1);
  }

  private getActivePackName(): string | null {
    const vals = Object.values(this.packConfig);
    return vals.length > 0 ? vals[0] : null;
  }

  private playFileInternal(url: string) {
    if (!this.audioCache[url]) {
      this.audioCache[url] = new Audio(url);
      this.audioCache[url].volume = 0.7;
    }
    const a = this.audioCache[url];
    a.currentTime = 0;
    a.play().catch((e) => console.error("playFile error:", e));
  }

  private playSlotInternal(slot: SoundSlot) {
    const pack = this.packConfig[slot] || this.getActivePackName();
    if (pack && pack !== "synth" && this.packRegistry[pack]) {
      const url = this.packRegistry[pack][slot];
      if (url) {
        this.playFileInternal(url);
        return;
      }
    }
    const fn = this.SYNTH_MAP[slot];
    if (fn) fn();
  }

  init(
    soundsConfig: Record<string, string>,
    registry?: Record<string, Record<string, string>>,
  ) {
    this.packConfig = soundsConfig || {};
    if (registry) this.packRegistry = registry;
  }

  registerPack(packId: string, slots: Record<string, string>) {
    this.packRegistry[packId] = slots;
  }

  play(event: SoundEvent | string) {
    if (!this.enabled) return;
    const slot = (this.EVENT_MAP[event as SoundEvent] ?? event) as SoundSlot;
    this.playSlotInternal(slot);
  }

  playSlot(slot: SoundSlot) {
    this.playSlotInternal(slot);
  }

  playFile(url: string) {
    this.playFileInternal(url);
  }

  setEnabled(val: boolean) {
    this.enabled = !!val;
    if (this.enabled && !this.audioCtx) {
      try {
        this.getAudioCtx();
      } catch {
        // AudioContext may not be available in non-browser environments
      }
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getPacks(): Record<string, Record<string, string>> {
    return this.packRegistry;
  }

  getSynths(): Record<SoundSlot, () => void> {
    return this.SYNTH_MAP;
  }

  getActivePack(): string | null {
    return this.getActivePackName();
  }
}
