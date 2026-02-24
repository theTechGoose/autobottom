/**
 * Backup of sound system v1 (oscillator-based arena sounds)
 * Date: 2026-02-23
 * Used in both review/page.ts and judge/page.ts
 */

function playPing() {
  var ctx = getCtx(); var t = ctx.currentTime;
  var o1 = ctx.createOscillator(); var g1 = ctx.createGain();
  o1.type = 'sine'; o1.frequency.setValueAtTime(1400, t);
  o1.frequency.exponentialRampToValueAtTime(900, t + 0.08);
  g1.gain.setValueAtTime(0.18, t);
  g1.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  o1.connect(g1); g1.connect(ctx.destination);
  o1.start(t); o1.stop(t + 0.12);
  var o2 = ctx.createOscillator(); var g2 = ctx.createGain();
  o2.type = 'sine'; o2.frequency.value = 2800;
  g2.gain.setValueAtTime(0.06, t);
  g2.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
  o2.connect(g2); g2.connect(ctx.destination);
  o2.start(t); o2.stop(t + 0.06);
}

function playDouble() {
  var ctx = getCtx(); var t = ctx.currentTime;
  [1200, 1600].forEach(function(freq, i) {
    var o = ctx.createOscillator(); var g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.2, t + i * 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.08 + 0.1);
    o.connect(g); g.connect(ctx.destination);
    o.start(t + i * 0.08); o.stop(t + i * 0.08 + 0.1);
  });
}

function playTriple() {
  var ctx = getCtx(); var t = ctx.currentTime;
  [523, 659, 880].forEach(function(freq, i) {
    var o = ctx.createOscillator(); var g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.22, t + i * 0.07);
    g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.07 + 0.12);
    o.connect(g); g.connect(ctx.destination);
    o.start(t + i * 0.07); o.stop(t + i * 0.07 + 0.12);
  });
}

function playMega() {
  var ctx = getCtx(); var t = ctx.currentTime;
  var ob = ctx.createOscillator(); var gb = ctx.createGain();
  ob.type = 'sine'; ob.frequency.setValueAtTime(120, t);
  ob.frequency.exponentialRampToValueAtTime(60, t + 0.15);
  gb.gain.setValueAtTime(0.3, t);
  gb.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
  ob.connect(gb); gb.connect(ctx.destination);
  ob.start(t); ob.stop(t + 0.2);
  [440, 660, 880, 1100].forEach(function(freq, i) {
    var o = ctx.createOscillator(); var g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.12, t + 0.04 + i * 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.04 + i * 0.05 + 0.15);
    o.connect(g); g.connect(ctx.destination);
    o.start(t + 0.04 + i * 0.05); o.stop(t + 0.04 + i * 0.05 + 0.15);
  });
}

function playUltra() {
  var ctx = getCtx(); var t = ctx.currentTime;
  var os = ctx.createOscillator(); var gs = ctx.createGain();
  os.type = 'sawtooth';
  os.frequency.setValueAtTime(200, t);
  os.frequency.exponentialRampToValueAtTime(1600, t + 0.25);
  gs.gain.setValueAtTime(0.15, t);
  gs.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  os.connect(gs); gs.connect(ctx.destination);
  os.start(t); os.stop(t + 0.3);
  [523, 659, 784, 1047].forEach(function(freq, i) {
    var o = ctx.createOscillator(); var g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.18, t + 0.2);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o.connect(g); g.connect(ctx.destination);
    o.start(t + 0.2); o.stop(t + 0.5);
  });
  var ob = ctx.createOscillator(); var gb = ctx.createGain();
  ob.type = 'sine'; ob.frequency.value = 80;
  gb.gain.setValueAtTime(0.25, t + 0.18);
  gb.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
  ob.connect(gb); gb.connect(ctx.destination);
  ob.start(t + 0.18); ob.stop(t + 0.4);
}

function playRampage() {
  var ctx = getCtx(); var t = ctx.currentTime;
  var ob = ctx.createOscillator(); var gb = ctx.createGain();
  ob.type = 'sine'; ob.frequency.value = 55;
  gb.gain.setValueAtTime(0.3, t);
  gb.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
  ob.connect(gb); gb.connect(ctx.destination);
  ob.start(t); ob.stop(t + 0.5);
  [523, 659, 784, 1047, 1319].forEach(function(freq, i) {
    var o = ctx.createOscillator(); var g = ctx.createGain();
    o.type = 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.1, t + i * 0.06);
    g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.06 + 0.2);
    o.connect(g); g.connect(ctx.destination);
    o.start(t + i * 0.06); o.stop(t + i * 0.06 + 0.2);
    var o2 = ctx.createOscillator(); var g2 = ctx.createGain();
    o2.type = 'sine'; o2.frequency.value = freq * 2;
    g2.gain.setValueAtTime(0.06, t + i * 0.06);
    g2.gain.exponentialRampToValueAtTime(0.001, t + i * 0.06 + 0.15);
    o2.connect(g2); g2.connect(ctx.destination);
    o2.start(t + i * 0.06); o2.stop(t + i * 0.06 + 0.15);
  });
}

function playGodlike() {
  var ctx = getCtx(); var t = ctx.currentTime;
  var ob = ctx.createOscillator(); var gb = ctx.createGain();
  ob.type = 'sine';
  ob.frequency.setValueAtTime(40, t);
  ob.frequency.exponentialRampToValueAtTime(30, t + 0.6);
  gb.gain.setValueAtTime(0.35, t);
  gb.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
  ob.connect(gb); gb.connect(ctx.destination);
  ob.start(t); ob.stop(t + 0.6);
  var os = ctx.createOscillator(); var gs = ctx.createGain();
  os.type = 'sawtooth';
  os.frequency.setValueAtTime(100, t);
  os.frequency.exponentialRampToValueAtTime(3000, t + 0.35);
  gs.gain.setValueAtTime(0.12, t);
  gs.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
  os.connect(gs); gs.connect(ctx.destination);
  os.start(t); os.stop(t + 0.4);
  [261, 329, 392, 523, 659, 784, 1047, 1319, 1568].forEach(function(freq) {
    [-3, 0, 3].forEach(function(detune) {
      var o = ctx.createOscillator(); var g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = freq; o.detune.value = detune;
      g.gain.setValueAtTime(0.04, t + 0.3);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
      o.connect(g); g.connect(ctx.destination);
      o.start(t + 0.3); o.stop(t + 0.9);
    });
  });
}

function playLevelUp() {
  var ctx = getCtx(); var t = ctx.currentTime;
  var o = ctx.createOscillator(); var g = ctx.createGain();
  o.type = 'triangle'; o.frequency.setValueAtTime(523.25, t);
  o.frequency.exponentialRampToValueAtTime(1046.5, t + 0.3);
  g.gain.setValueAtTime(0.22, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
  o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.4);
}
