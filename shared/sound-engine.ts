/**
 * Centralized sound engine served as client-side JS.
 * Used by queue-page (review/judge) and gamification page.
 *
 * Exposes window.SoundEngine with:
 *   init(config, registry) - configure from GAME_CONFIG.sounds + pack registry
 *   registerPack(id, slots) - register a pack's slot->URL mapping
 *   play(event)        - play sound for a named event (decide, combo:2, levelup, etc.)
 *   playSlot(slot)     - play a specific slot directly (ping, double, triple, etc.)
 *   playFile(url)      - play a file URL directly
 *   setEnabled(bool)   - toggle sound on/off
 *   isEnabled()        - check if sound is on
 *   getPacks()         - return pack registry (packId -> slot -> url)
 *   getSynths()        - return synth slot functions
 */

export function getSoundEngineJs(): string {
  return `(function() {
  'use strict';

  // ===== AudioContext helpers =====
  var audioCtx = null;
  var enabled = false;
  var packConfig = {};  // slot -> pack name from GAME_CONFIG.sounds
  var audioCache = {};

  function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function noiseBurst(ctx, t, dur, freq, vol) {
    var buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    var src = ctx.createBufferSource(); src.buffer = buf;
    var flt = ctx.createBiquadFilter(); flt.type = 'bandpass'; flt.frequency.value = freq; flt.Q.value = 2;
    var g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(flt); flt.connect(g); g.connect(ctx.destination);
    src.start(t); src.stop(t + dur);
  }

  function tone(ctx, t, type, freq, vol, attack, decay) {
    var o = ctx.createOscillator(); var g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + attack + decay);
    o.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + attack + decay + 0.01);
    return o;
  }

  // ===== Synth functions (v2 - noise + filtered) =====
  function playPing() {
    var ctx = getAudioCtx(); var t = ctx.currentTime;
    noiseBurst(ctx, t, 0.04, 4000, 0.15);
    tone(ctx, t, 'sine', 880, 0.2, 0.005, 0.1);
    tone(ctx, t + 0.01, 'sine', 1320, 0.08, 0.005, 0.06);
  }
  function playDouble() {
    var ctx = getAudioCtx(); var t = ctx.currentTime;
    noiseBurst(ctx, t, 0.03, 5000, 0.12);
    tone(ctx, t, 'sine', 784, 0.2, 0.005, 0.1);
    noiseBurst(ctx, t + 0.1, 0.03, 6000, 0.14);
    tone(ctx, t + 0.1, 'sine', 1047, 0.22, 0.005, 0.12);
  }
  function playTriple() {
    var ctx = getAudioCtx(); var t = ctx.currentTime;
    [784, 988, 1319].forEach(function(freq, i) {
      var off = i * 0.09;
      noiseBurst(ctx, t + off, 0.025, 5000 + i * 1000, 0.1);
      tone(ctx, t + off, 'sine', freq, 0.2, 0.005, 0.15);
      tone(ctx, t + off, 'sine', freq * 2.01, 0.04, 0.01, 0.1);
    });
  }
  function playMega() {
    var ctx = getAudioCtx(); var t = ctx.currentTime;
    var ob = ctx.createOscillator(); var gb = ctx.createGain();
    ob.type = 'sine'; ob.frequency.setValueAtTime(150, t);
    ob.frequency.exponentialRampToValueAtTime(40, t + 0.2);
    gb.gain.setValueAtTime(0.35, t); gb.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    ob.connect(gb); gb.connect(ctx.destination); ob.start(t); ob.stop(t + 0.25);
    noiseBurst(ctx, t, 0.06, 3000, 0.25);
    [523, 784, 1047].forEach(function(freq) {
      tone(ctx, t + 0.03, 'triangle', freq, 0.12, 0.01, 0.25);
    });
  }
  function playUltra() {
    var ctx = getAudioCtx(); var t = ctx.currentTime;
    var buf = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    var src = ctx.createBufferSource(); src.buffer = buf;
    var flt = ctx.createBiquadFilter(); flt.type = 'bandpass'; flt.Q.value = 3;
    flt.frequency.setValueAtTime(300, t); flt.frequency.exponentialRampToValueAtTime(4000, t + 0.2);
    var gn = ctx.createGain(); gn.gain.setValueAtTime(0.2, t); gn.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(flt); flt.connect(gn); gn.connect(ctx.destination);
    src.start(t); src.stop(t + 0.4);
    [523, 659, 784, 1047].forEach(function(freq) {
      tone(ctx, t + 0.15, 'sawtooth', freq, 0.08, 0.01, 0.3);
      tone(ctx, t + 0.15, 'sine', freq, 0.1, 0.005, 0.35);
    });
    var o2 = ctx.createOscillator(); var g2 = ctx.createGain();
    o2.type = 'sine'; o2.frequency.setValueAtTime(100, t + 0.15);
    o2.frequency.exponentialRampToValueAtTime(50, t + 0.35);
    g2.gain.setValueAtTime(0.3, t + 0.15); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    o2.connect(g2); g2.connect(ctx.destination); o2.start(t + 0.15); o2.stop(t + 0.4);
  }
  function playRampage() {
    var ctx = getAudioCtx(); var t = ctx.currentTime;
    noiseBurst(ctx, t, 0.1, 800, 0.3);
    var od = ctx.createOscillator(); var gd = ctx.createGain();
    od.type = 'sine'; od.frequency.setValueAtTime(80, t);
    od.frequency.exponentialRampToValueAtTime(30, t + 0.3);
    gd.gain.setValueAtTime(0.4, t); gd.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    od.connect(gd); gd.connect(ctx.destination); od.start(t); od.stop(t + 0.35);
    [392, 523, 659, 784, 1047].forEach(function(freq, i) {
      var off = 0.06 + i * 0.05;
      tone(ctx, t + off, 'square', freq, 0.06, 0.01, 0.25);
      tone(ctx, t + off, 'sine', freq, 0.1, 0.005, 0.3);
    });
  }
  function playGodlike() {
    var ctx = getAudioCtx(); var t = ctx.currentTime;
    var buf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    var src = ctx.createBufferSource(); src.buffer = buf;
    var flt = ctx.createBiquadFilter(); flt.type = 'lowpass';
    flt.frequency.setValueAtTime(8000, t); flt.frequency.exponentialRampToValueAtTime(200, t + 0.5);
    var gn = ctx.createGain(); gn.gain.setValueAtTime(0.3, t);
    gn.gain.setValueAtTime(0.3, t + 0.05); gn.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    src.connect(flt); flt.connect(gn); gn.connect(ctx.destination);
    src.start(t); src.stop(t + 0.6);
    var ob = ctx.createOscillator(); var gb = ctx.createGain();
    ob.type = 'sine'; ob.frequency.setValueAtTime(45, t);
    ob.frequency.exponentialRampToValueAtTime(25, t + 0.8);
    gb.gain.setValueAtTime(0.35, t); gb.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    ob.connect(gb); gb.connect(ctx.destination); ob.start(t); ob.stop(t + 0.8);
    [262, 330, 392, 523, 659, 784, 1047, 1319].forEach(function(freq) {
      [-4, 0, 4].forEach(function(det) {
        var o = ctx.createOscillator(); var g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = freq; o.detune.value = det;
        g.gain.setValueAtTime(0.001, t + 0.1);
        g.gain.linearRampToValueAtTime(0.04, t + 0.2);
        g.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
        o.connect(g); g.connect(ctx.destination);
        o.start(t + 0.1); o.stop(t + 1.0);
      });
    });
  }
  function playLevelUp() {
    var ctx = getAudioCtx(); var t = ctx.currentTime;
    noiseBurst(ctx, t, 0.05, 6000, 0.12);
    tone(ctx, t, 'triangle', 523, 0.2, 0.01, 0.15);
    tone(ctx, t + 0.1, 'triangle', 784, 0.2, 0.01, 0.15);
    tone(ctx, t + 0.2, 'triangle', 1047, 0.22, 0.01, 0.2);
  }
  function playShutdown() {
    var ctx = getAudioCtx(); var t = ctx.currentTime;
    // Descending power-down sweep
    tone(ctx, t, 'sawtooth', 600, 0.25, 0.01, 0.3);
    tone(ctx, t + 0.08, 'sawtooth', 400, 0.2, 0.01, 0.25);
    tone(ctx, t + 0.18, 'sawtooth', 200, 0.18, 0.01, 0.3);
    tone(ctx, t + 0.3, 'sine', 80, 0.3, 0.01, 0.4);
    noiseBurst(ctx, t + 0.1, 0.15, 3000, 0.1);
  }

  // Synth slot map
  var SYNTH_MAP = {
    ping: playPing, double: playDouble, triple: playTriple,
    mega: playMega, ultra: playUltra, rampage: playRampage,
    godlike: playGodlike, levelup: playLevelUp, shutdown: playShutdown
  };

  // ===== Dynamic pack URL registry (populated by init) =====
  // packRegistry: { packId: { slot: fullUrl } }
  var packRegistry = {};

  // ===== Event-to-slot mapping =====
  var EVENT_MAP = {
    'decide':  'ping',
    'combo:2': 'double',
    'combo:3': 'triple',
    'combo:4': 'mega',
    'combo:5': 'ultra',
    'combo:6': 'rampage',
    'combo:7': 'godlike',
    'levelup': 'levelup',
    'shutdown': 'shutdown'
  };

  // ===== File playback =====
  function playFileInternal(url) {
    if (!audioCache[url]) {
      audioCache[url] = new Audio(url);
      audioCache[url].volume = 0.7;
    }
    var a = audioCache[url];
    a.currentTime = 0;
    a.play().catch(function(e) { console.error('playFile error:', e); });
  }

  // ===== Play a slot (ping, double, etc.) =====
  function playSlotInternal(slot) {
    var pack = packConfig[slot] || getActivePack();
    if (pack && pack !== 'synth' && packRegistry[pack]) {
      var url = packRegistry[pack][slot];
      if (url) {
        playFileInternal(url);
        return;
      }
    }
    var fn = SYNTH_MAP[slot];
    if (fn) fn();
  }

  function getActivePack() {
    if (!packConfig) return null;
    var vals = Object.values(packConfig);
    if (vals.length === 0) return null;
    return vals[0] || null;
  }

  // ===== Public API =====
  window.SoundEngine = {
    init: function(soundsConfig, registry) {
      packConfig = soundsConfig || {};
      if (registry) packRegistry = registry;
    },

    /** Register a pack with its slot->URL mapping */
    registerPack: function(packId, slots) {
      packRegistry[packId] = slots;
    },

    play: function(event) {
      if (!enabled) return;
      var slot = EVENT_MAP[event] || event;
      playSlotInternal(slot);
    },

    playSlot: function(slot) {
      playSlotInternal(slot);
    },

    playFile: function(url) {
      playFileInternal(url);
    },

    setEnabled: function(val) {
      enabled = !!val;
      if (enabled && !audioCtx) getAudioCtx();
    },

    isEnabled: function() {
      return enabled;
    },

    getPacks: function() {
      return packRegistry;
    },

    getSynths: function() {
      return SYNTH_MAP;
    },

    getActivePack: function() {
      return getActivePack();
    }
  };
})();
`;
}
