/** Inline HTML/CSS/JS for the review UI. */

export function getReviewPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Auto-Bot Review</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0a0e14; color: #c9d1d9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; height: 100vh; overflow: hidden; }

  /* Login */
  #login-screen { display: flex; align-items: center; justify-content: center; height: 100vh; background: radial-gradient(ellipse at 50% 30%, rgba(31,111,235,0.08) 0%, transparent 70%); }
  #login-box { background: #12161e; border: 1px solid #1e2736; border-radius: 16px; padding: 44px; width: 400px; box-shadow: 0 8px 32px rgba(0,0,0,0.4); }
  #login-box h2 { margin-bottom: 8px; color: #e6edf3; font-size: 24px; text-align: center; font-weight: 700; }
  #login-subtitle { text-align: center; color: #6e7681; font-size: 13px; margin-bottom: 28px; }
  #login-box input { width: 100%; padding: 11px 14px; margin-bottom: 14px; background: #0a0e14; border: 1px solid #1e2736; border-radius: 10px; color: #c9d1d9; font-size: 14px; transition: border-color 0.15s, box-shadow 0.15s; }
  #login-box input:focus { outline: none; border-color: #8b5cf6; box-shadow: 0 0 0 3px rgba(139,92,246,0.15); }
  #login-box button { width: 100%; padding: 11px; background: linear-gradient(135deg, #1f6feb, #8b5cf6); border: none; border-radius: 10px; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; transition: transform 0.1s, box-shadow 0.15s; }
  #login-box button:hover { transform: translateY(-1px); box-shadow: 0 4px 16px rgba(139,92,246,0.3); }
  #login-box button:active { transform: translateY(0); }
  #login-error { color: #f85149; font-size: 13px; margin-top: 10px; display: none; text-align: center; }
  #setup-hint { color: #6e7681; font-size: 12px; margin-top: 18px; text-align: center; }

  /* ===== Review layout: verdict panel (left) + transcript (right) + bottom bar ===== */
  #review-screen { display: none; height: 100vh; grid-template-columns: 380px 1fr; grid-template-rows: auto 1fr auto; overflow: hidden; }

  /* Progress bar */
  #progress-bar-container { grid-column: 1 / -1; grid-row: 1; height: 3px; background: #1a1f2b; }
  #progress-bar { height: 100%; background: linear-gradient(90deg, #1f6feb, #8b5cf6); width: 0%; transition: width 0.4s ease; border-radius: 0 2px 2px 0; }

  /* Left verdict panel */
  #verdict-panel {
    grid-column: 1; grid-row: 2;
    display: flex; flex-direction: column; gap: 0;
    background: #0f1219; border-right: 1px solid #1a1f2b;
    overflow-y: auto; overflow-x: hidden;
    scrollbar-width: thin; scrollbar-color: #1e2736 transparent;
  }
  #verdict-panel::-webkit-scrollbar { width: 4px; }
  #verdict-panel::-webkit-scrollbar-thumb { background: #1e2736; border-radius: 2px; }

  /* Verdict card transition wrapper */
  #verdict-content {
    padding: 24px 20px;
    transition: opacity 0.15s ease, transform 0.15s ease;
  }
  #verdict-content.fade-out { opacity: 0; transform: translateX(-8px); }
  #verdict-content.fade-in { opacity: 0; transform: translateX(8px); }

  /* Question section */
  #q-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #6e7681; margin-bottom: 8px; }
  #q-header { font-size: 20px; font-weight: 700; color: #e6edf3; line-height: 1.3; margin-bottom: 10px; }
  #q-populated { font-size: 14px; line-height: 1.6; color: #9ca3af; margin-bottom: 20px; }

  /* Verdict badge */
  #verdict-badge {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 5px 12px; border-radius: 20px; font-size: 11px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 20px;
    background: rgba(248,81,73,0.12); color: #f85149; border: 1px solid rgba(248,81,73,0.2);
  }
  #verdict-badge::before { content: ''; display: block; width: 6px; height: 6px; border-radius: 50%; background: #f85149; }

  /* Defense card */
  .evidence-section { margin-bottom: 16px; }
  .evidence-label {
    font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px;
    color: #58a6ff; margin-bottom: 8px;
  }
  .evidence-text {
    font-size: 13px; line-height: 1.65; color: #b0b8c4;
    padding: 12px 14px; background: #141820; border-radius: 10px; border: 1px solid #1a1f2b;
  }

  /* Thinking (collapsible) */
  #thinking-toggle {
    display: flex; align-items: center; gap: 6px;
    font-size: 11px; color: #6e7681; cursor: pointer; user-select: none;
    padding: 8px 0; border: none; background: none; width: 100%;
    transition: color 0.15s;
  }
  #thinking-toggle:hover { color: #8b949e; }
  #thinking-toggle .arrow { transition: transform 0.2s; font-size: 9px; }
  #thinking-toggle .arrow.open { transform: rotate(90deg); }
  #thinking-content {
    max-height: 0; overflow: hidden; transition: max-height 0.25s ease;
  }
  #thinking-content.open { max-height: 500px; }
  #thinking-text {
    font-size: 13px; line-height: 1.6; color: #8b949e;
    padding: 10px 14px; background: #141820; border-radius: 10px; border: 1px solid #1a1f2b;
    font-style: italic; margin-bottom: 12px;
  }

  /* Meta chips */
  #meta-row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; padding-top: 16px; border-top: 1px solid #1a1f2b; }
  .meta-chip {
    display: inline-flex; align-items: center; gap: 4px;
    background: #141820; border: 1px solid #1a1f2b; border-radius: 6px;
    padding: 3px 10px; font-size: 11px; color: #6e7681; white-space: nowrap;
  }
  .meta-chip strong { color: #c9d1d9; font-weight: 600; }

  /* ===== Transcript (right side) ===== */
  #transcript-panel {
    grid-column: 2; grid-row: 2;
    padding: 20px 24px; padding-right: 24px; overflow: hidden; min-height: 0;
  }
  #transcript-body {
    column-gap: 24px; column-rule: 1px solid #141820;
    column-fill: auto; height: 100%; overflow-x: scroll; overflow-y: hidden;
    scrollbar-width: none;
  }
  #transcript-body::-webkit-scrollbar { display: none; }
  #col-indicator { position: fixed; bottom: 56px; right: 24px; font-size: 11px; color: #3d4452; z-index: 10; }

  .t-line {
    font-size: 13.5px; line-height: 1.75; margin-bottom: 10px; padding: 6px 10px 6px 12px;
    border-left: 3px solid transparent; color: #6e7681; break-inside: avoid;
    border-radius: 0 6px 6px 0; transition: background 0.2s;
  }
  .t-agent { border-left-color: #1f6feb; color: #79b8ff; }
  .t-customer { border-left-color: #8b5cf6; color: #d2b3ff; }
  .t-system { border-left-color: #2d333b; color: #484f58; }
  .t-line.t-highlight { background: rgba(139,92,246,0.1); }
  .t-line.t-evidence { background: rgba(250,176,5,0.1); border-left-color: #fab005 !important; }
  .t-line.t-evidence .t-speaker { color: #fab005 !important; }
  .t-speaker { font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; margin-right: 8px; }
  .t-agent .t-speaker { color: #1f6feb; }
  .t-customer .t-speaker { color: #8b5cf6; }
  .t-system .t-speaker { color: #484f58; }

  /* ===== Bottom bar ===== */
  #bottom-bar {
    grid-column: 1 / -1; grid-row: 3;
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 24px; background: #0f1219; border-top: 1px solid #1a1f2b;
    height: 44px;
  }
  #hotkeys { display: flex; gap: 4px; align-items: center; }
  .hk {
    display: inline-flex; align-items: center; gap: 4px;
    font-size: 11px; color: #484f58; padding: 4px 10px; border-radius: 6px;
    transition: background 0.15s;
  }
  .hk:hover { background: #141820; }
  .hk kbd {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 20px; height: 18px; padding: 0 5px;
    background: #141820; border: 1px solid #1e2736; border-radius: 4px;
    font-family: 'SF Mono', 'Fira Code', monospace; font-size: 10px; color: #8b949e;
  }
  .hk-confirm { color: #6e7681; }
  .hk-confirm kbd { border-color: rgba(31,111,235,0.4); color: #58a6ff; }
  .hk-flip { color: #6e7681; }
  .hk-flip kbd { border-color: rgba(139,92,246,0.4); color: #bc8cff; }

  #bar-center { display: flex; align-items: center; gap: 12px; }
  #speed-tracker { font-size: 11px; color: #3d4452; font-variant-numeric: tabular-nums; }
  #speed-tracker strong { color: #6e7681; }

  #bar-right { display: flex; gap: 8px; align-items: center; }
  #reviewer-tag { font-size: 11px; color: #3d4452; }
  #reviewer-tag strong { color: #6e7681; }
  .bar-btn {
    background: none; border: 1px solid #1e2736; border-radius: 6px;
    padding: 3px 10px; color: #6e7681; font-size: 10px; cursor: pointer;
    transition: all 0.15s; text-transform: uppercase; letter-spacing: 0.5px;
  }
  .bar-btn:hover { background: #141820; color: #8b949e; border-color: #2d333b; }

  /* ===== Empty state ===== */
  #empty-state { display: none; height: 100vh; align-items: center; justify-content: center; text-align: center; background: radial-gradient(ellipse at 50% 40%, rgba(139,92,246,0.05) 0%, transparent 60%); }
  #empty-state h2 { color: #e6edf3; margin-bottom: 8px; font-size: 22px; }
  #empty-state p { color: #484f58; font-size: 15px; }

  /* ===== Toasts ===== */
  #toast-container { position: fixed; bottom: 56px; left: 50%; transform: translateX(-50%); z-index: 1000; display: flex; flex-direction: column-reverse; gap: 6px; align-items: center; pointer-events: none; }
  .toast {
    padding: 7px 18px; border-radius: 20px; font-size: 12px; font-weight: 600;
    backdrop-filter: blur(12px); box-shadow: 0 4px 20px rgba(0,0,0,0.4);
    animation: toastIn 0.15s ease, toastOut 0.25s ease 1.1s forwards;
    letter-spacing: 0.3px;
  }
  .toast-confirm { background: rgba(31,111,235,0.85); color: #fff; }
  .toast-flip { background: rgba(139,92,246,0.85); color: #fff; }
  .toast-undo { background: rgba(110,64,201,0.85); color: #fff; }
  .toast-error { background: rgba(218,54,51,0.85); color: #fff; }
  .toast-info { background: rgba(30,39,54,0.9); color: #c9d1d9; border: 1px solid #2d333b; }
  .toast-complete { background: rgba(139,92,246,0.85); color: #fff; }
  @keyframes toastIn { from { opacity: 0; transform: translateY(6px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
  @keyframes toastOut { from { opacity: 1; } to { opacity: 0; transform: translateY(-4px); } }

  /* ===== Gamification ===== */

  /* Combo counter */
  #combo-counter {
    font-size: 12px; font-weight: 800; font-variant-numeric: tabular-nums;
    min-width: 28px; text-align: center; transition: all 0.2s; letter-spacing: -0.5px;
  }
  .combo-dim { color: #3d4452; }
  .combo-hot { color: #58a6ff; text-shadow: 0 0 8px rgba(88,166,255,0.4); }
  .combo-fire { color: #fab005; text-shadow: 0 0 10px rgba(250,176,5,0.5); animation: comboPulse 1.5s ease infinite; }
  .combo-inferno { color: #ef4444; text-shadow: 0 0 14px rgba(239,68,68,0.6); animation: comboPulse 0.8s ease infinite; }
  .combo-godlike { color: #a855f7; text-shadow: 0 0 18px rgba(168,85,247,0.7), 0 0 40px rgba(168,85,247,0.3); animation: comboPulse 0.5s ease infinite; }
  @keyframes comboPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.7; } }

  /* Kill streak banner */
  .streak-banner {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) scale(0.5);
    font-size: 28px; font-weight: 900; text-transform: uppercase; letter-spacing: 3px;
    z-index: 2000; pointer-events: none; opacity: 0;
    text-shadow: 0 0 30px currentColor, 0 2px 0 rgba(0,0,0,0.5);
    animation: streakBannerIn 0.15s ease forwards, streakBannerOut 0.3s ease 0.9s forwards;
  }
  @keyframes streakBannerIn { to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
  @keyframes streakBannerOut { to { opacity: 0; transform: translate(-50%, -60%) scale(1.1); } }
  .streak-banner.s-double { color: #58a6ff; }
  .streak-banner.s-triple { color: #fab005; font-size: 32px; }
  .streak-banner.s-mega { color: #ef4444; font-size: 36px; }
  .streak-banner.s-ultra { color: #ec4899; font-size: 40px; }
  .streak-banner.s-rampage { color: #a855f7; font-size: 44px; }
  .streak-banner.s-godlike { color: #fbbf24; font-size: 50px; text-shadow: 0 0 40px #fbbf24, 0 0 80px rgba(251,191,36,0.4), 0 2px 0 rgba(0,0,0,0.5); }
  @keyframes shakeLight { 0%,100%{transform:translate(0)} 10%{transform:translate(-2px,1px)} 30%{transform:translate(2px,-1px)} 50%{transform:translate(-1px,2px)} 70%{transform:translate(1px,-2px)} 90%{transform:translate(-2px,0)} }
  @keyframes shakeMedium { 0%,100%{transform:translate(0)} 10%{transform:translate(-4px,2px)} 30%{transform:translate(4px,-3px)} 50%{transform:translate(-3px,4px)} 70%{transform:translate(3px,-2px)} 90%{transform:translate(-4px,1px)} }
  @keyframes shakeHard { 0%,100%{transform:translate(0)} 10%{transform:translate(-6px,4px)} 20%{transform:translate(6px,-4px)} 30%{transform:translate(-5px,6px)} 40%{transform:translate(5px,-3px)} 50%{transform:translate(-7px,2px)} 60%{transform:translate(4px,-6px)} 70%{transform:translate(-3px,5px)} 80%{transform:translate(6px,-2px)} 90%{transform:translate(-4px,3px)} }
  @keyframes shakeInsane { 0%,100%{transform:translate(0)} 5%{transform:translate(-8px,6px)} 15%{transform:translate(10px,-8px)} 25%{transform:translate(-10px,8px)} 35%{transform:translate(8px,-6px)} 45%{transform:translate(-12px,4px)} 55%{transform:translate(10px,-10px)} 65%{transform:translate(-6px,10px)} 75%{transform:translate(12px,-4px)} 85%{transform:translate(-8px,8px)} 95%{transform:translate(6px,-6px)} }
  .shake-light { animation: shakeLight 0.3s ease; }
  .shake-medium { animation: shakeMedium 0.35s ease; }
  .shake-hard { animation: shakeHard 0.4s ease; }
  .shake-insane { animation: shakeInsane 0.5s ease; }

  /* Floating XP numbers */
  .float-xp {
    position: fixed; pointer-events: none; font-size: 12px; font-weight: 700;
    color: #58a6ff; z-index: 2000; animation: floatUp 0.5s ease forwards;
  }
  .float-xp-gold { color: #fab005; }
  @keyframes floatUp { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(-28px); } }

  /* Level badge + XP bar */
  #level-badge {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: 11px; font-weight: 600; color: #6e7681; transition: all 0.3s;
  }
  #xp-bar-wrap {
    display: inline-block; width: 40px; height: 3px;
    background: #1a1f2b; border-radius: 2px; overflow: hidden; vertical-align: middle;
  }
  #xp-bar {
    height: 100%; background: linear-gradient(90deg, #1f6feb, #8b5cf6);
    border-radius: 2px; transition: width 0.4s ease; width: 0%;
  }
  #xp-display { font-size: 10px; color: #484f58; font-variant-numeric: tabular-nums; }
  .level-up-glow { animation: levelGlow 1.2s ease; }
  @keyframes levelGlow {
    0% { text-shadow: 0 0 0 transparent; }
    30% { text-shadow: 0 0 12px rgba(139,92,246,0.6); color: #bc8cff; }
    100% { text-shadow: 0 0 0 transparent; }
  }

  /* Streak badge */
  #streak-badge { font-size: 11px; font-weight: 600; color: #fab005; }

  /* Session count */
  #session-count { font-size: 11px; color: #3d4452; font-variant-numeric: tabular-nums; }

  /* Audio player (bottom bar) */
  .ap { display: flex; align-items: center; gap: 6px; }
  .ap-play {
    width: 22px; height: 22px; border-radius: 50%; border: none; cursor: pointer;
    background: #1f6feb; color: #fff; display: flex; align-items: center; justify-content: center;
    transition: all 0.15s; flex-shrink: 0; padding: 0;
  }
  .ap-play:hover { background: #58a6ff; box-shadow: 0 0 8px rgba(88,166,255,0.3); }
  .ap-play svg { width: 9px; height: 9px; fill: #fff; }
  .ap-track { width: 140px; height: 4px; background: #1a1f2b; border-radius: 2px; cursor: pointer; position: relative; transition: height 0.15s; }
  .ap-track:hover { height: 6px; }
  .ap-track:hover .ap-thumb { opacity: 1; }
  .ap-fill { height: 100%; background: #1f6feb; border-radius: 2px; width: 0%; pointer-events: none; transition: width 0.1s; position: relative; }
  .ap-thumb { position: absolute; right: -4px; top: 50%; transform: translateY(-50%); width: 8px; height: 8px; border-radius: 50%; background: #58a6ff; opacity: 0; transition: opacity 0.15s; pointer-events: none; }
  .ap-time { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 9px; color: #3d4452; white-space: nowrap; }
  .ap-seek {
    background: #141820; border: 1px solid #1e2736; border-radius: 4px;
    color: #6e7681; cursor: pointer; font-size: 10px; padding: 2px 6px;
    font-family: 'SF Mono', 'Fira Code', monospace; transition: all 0.15s;
  }
  .ap-seek:hover { background: #1a1f2b; color: #8b949e; border-color: #2d333b; }

  /* Sound toggle */
  .sound-toggle { font-size: 13px; line-height: 1; padding: 3px 6px !important; }

  /* Combo toast */
  .toast-combo { background: rgba(139,92,246,0.9); color: #fff; }

  /* Session summary */
  #session-summary { margin-top: 16px; }
  #summary-stats {
    display: flex; gap: 8px; align-items: center; justify-content: center;
    font-size: 15px; color: #8b949e; flex-wrap: wrap;
  }
  .summary-sep { color: #2d333b; }

  /* Confetti */
  #confetti-container { position: relative; height: 60px; overflow: hidden; margin-top: 20px; }
  .confetti-particle {
    position: absolute; width: 6px; height: 6px; border-radius: 50%;
    top: 100%; animation: confettiBurst 1.5s ease forwards;
  }
  @keyframes confettiBurst {
    0% { transform: translateY(0) rotate(0deg); opacity: 1; }
    50% { opacity: 1; }
    100% { transform: translateY(-80px) translateX(var(--drift, 10px)) rotate(360deg); opacity: 0; }
  }
  .confetti-particle:nth-child(odd) { --drift: -15px; width: 5px; height: 8px; border-radius: 2px; }
  .confetti-particle:nth-child(3n) { --drift: 20px; }
  .confetti-particle:nth-child(5n) { --drift: -25px; }
  .confetti-particle:nth-child(7n) { --drift: 30px; }

  /* Confirmation modal */
  #confirm-overlay {
    display: none; position: fixed; inset: 0; z-index: 3000;
    background: rgba(0,0,0,0.65); backdrop-filter: blur(4px);
    align-items: center; justify-content: center;
  }
  #confirm-overlay.open { display: flex; }
  #confirm-box {
    background: #12161e; border: 1px solid #1e2736; border-radius: 16px;
    padding: 32px 36px; width: 400px; box-shadow: 0 8px 40px rgba(0,0,0,0.5);
    animation: confirmIn 0.15s ease;
  }
  @keyframes confirmIn { from { opacity: 0; transform: scale(0.95) translateY(8px); } to { opacity: 1; transform: none; } }
  #confirm-box h3 { color: #e6edf3; font-size: 17px; font-weight: 700; margin-bottom: 8px; }
  #confirm-box p { color: #8b949e; font-size: 13px; line-height: 1.5; margin-bottom: 20px; }
  #confirm-box .confirm-label { font-size: 11px; color: #6e7681; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.8px; font-weight: 600; }
  #confirm-input {
    width: 100%; padding: 10px 14px; background: #0a0e14; border: 1px solid #1e2736;
    border-radius: 10px; color: #c9d1d9; font-size: 16px; font-weight: 600;
    text-align: center; letter-spacing: 2px; text-transform: uppercase;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  #confirm-input:focus { outline: none; border-color: #8b5cf6; box-shadow: 0 0 0 3px rgba(139,92,246,0.15); }
  #confirm-actions { display: flex; gap: 8px; margin-top: 16px; justify-content: flex-end; }
  #confirm-actions button { padding: 8px 20px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.15s; }
  #confirm-cancel-btn { background: transparent; border: 1px solid #1e2736; color: #6e7681; }
  #confirm-cancel-btn:hover { background: #141820; border-color: #2d333b; }
  #confirm-submit-btn { background: #8b5cf6; border: none; color: #fff; opacity: 0.3; pointer-events: none; }
  #confirm-submit-btn.enabled { opacity: 1; pointer-events: auto; }
  #confirm-submit-btn.enabled:hover { background: #7c3aed; }

</style>
</head>
<body>

<!-- Login -->
<div id="login-screen">
  <div id="login-box">
    <h2>Auto-Bot Review</h2>
    <div id="login-subtitle">Human-in-the-loop audit verification</div>
    <input type="text" id="login-user" placeholder="Username" autocomplete="username">
    <input type="password" id="login-pass" placeholder="Password" autocomplete="current-password">
    <button id="login-btn">Sign In</button>
    <div id="login-error"></div>
    <div id="setup-hint"></div>
  </div>
</div>

<!-- Review -->
<div id="review-screen">
  <div id="progress-bar-container"><div id="progress-bar"></div></div>

  <!-- Left: Verdict panel -->
  <div id="verdict-panel">
    <div id="verdict-content">
      <div id="q-label">Question</div>
      <div id="q-header"></div>
      <div id="verdict-badge">Bot answered NO</div>
      <div id="q-populated"></div>

      <div class="evidence-section">
        <div class="evidence-label">Defense</div>
        <div class="evidence-text" id="q-defense"></div>
      </div>

      <button id="thinking-toggle">
        <span class="arrow">&#9654;</span>
        <span>Bot reasoning</span>
        <span style="margin-left:auto; font-size:10px; color:#3d4452"><kbd style="background:#141820;border:1px solid #1e2736;border-radius:3px;padding:0 4px;font-family:monospace;font-size:10px;color:#6e7681">D</kbd></span>
      </button>
      <div id="thinking-content">
        <div id="thinking-text"></div>
      </div>

      <div id="meta-row">
        <div class="meta-chip">Audit <strong id="m-finding"></strong></div>
        <div class="meta-chip">Q<strong id="m-qindex"></strong></div>
        <div class="meta-chip">Left <strong id="m-remaining"></strong></div>
      </div>
    </div>
  </div>

  <!-- Right: Transcript -->
  <div id="transcript-panel">
    <div id="transcript-body"></div>
    <div id="col-indicator"></div>
  </div>

  <!-- Bottom bar -->
  <div id="bottom-bar">
    <div id="hotkeys">
      <div class="hk hk-confirm"><kbd>Y</kbd> Confirm</div>
      <div class="hk hk-flip"><kbd>N</kbd> Flip</div>
      <div class="hk"><kbd>B</kbd> Back</div>
      <div class="hk"><kbd>D</kbd> Detail</div>
      <div class="hk"><kbd>H</kbd><kbd>L</kbd> Scroll</div>
      <div class="hk"><kbd>P</kbd> Play</div>
      <div class="hk"><kbd>&larr;</kbd><kbd>&rarr;</kbd> Seek</div>
    </div>
    <div class="ap" id="audio-player">
      <audio id="rec-audio" preload="none" style="display:none"></audio>
      <button class="ap-play" id="ap-play" title="Play recording">
        <svg id="ap-icon-play" viewBox="0 0 16 16"><path d="M4 2l10 6-10 6z"/></svg>
        <svg id="ap-icon-pause" viewBox="0 0 16 16" style="display:none"><path d="M3 1h3v14H3zM10 1h3v14h-3z"/></svg>
      </button>
      <button class="ap-seek" id="ap-back" title="Back 5s (Left arrow)">&larr;5s</button>
      <div class="ap-track" id="ap-track"><div class="ap-fill" id="ap-fill"><div class="ap-thumb"></div></div></div>
      <button class="ap-seek" id="ap-fwd" title="Forward 5s (Right arrow)">5s&rarr;</button>
      <span class="ap-time" id="ap-time">0:00</span>
    </div>
    <div id="bar-center">
      <span id="combo-counter" class="combo-dim"></span>
      <div id="speed-tracker">avg <strong id="speed-avg">--</strong>s</div>
      <span id="session-count">0 today</span>
    </div>
    <div id="bar-right">
      <span id="level-badge">Lv.1 <span id="xp-bar-wrap"><span id="xp-bar"></span></span> <span id="xp-display">0xp</span></span>
      <span id="streak-badge"></span>
      <span id="reviewer-tag"></span>
      <button class="bar-btn sound-toggle" id="sound-toggle" title="Toggle sound">&#128263;</button>
      <button class="bar-btn" id="logout-btn">Logout</button>
    </div>
  </div>
</div>

<!-- Empty state -->
<div id="empty-state">
  <div>
    <h2>All caught up</h2>
    <p id="empty-default">No items pending review. Check back later.</p>
    <div id="session-summary" style="display:none">
      <div id="summary-stats"></div>
    </div>
    <div id="confetti-container"></div>
  </div>
</div>

<!-- Toasts -->
<div id="toast-container"></div>

<!-- Confirmation modal for last audit question -->
<div id="confirm-overlay">
  <div id="confirm-box">
    <h3>Final Question for This Audit</h3>
    <p>This is the last item for this audit. Submitting will finalize the review. Type <strong>YES</strong> to proceed.</p>
    <div class="confirm-label">Type YES to confirm</div>
    <input type="text" id="confirm-input" autocomplete="off" spellcheck="false">
    <div id="confirm-actions">
      <button id="confirm-cancel-btn">Cancel</button>
      <button id="confirm-submit-btn">Submit</button>
    </div>
  </div>
</div>

<script>
(function() {
  const API = '/review/api';
  let currentItem = null;
  let peekItem = null;
  let currentTranscript = null;
  let reviewer = null;
  let busy = false;
  let currentAuditRemaining = 0;
  let pendingDecision = null;
  const transcriptCache = {};

  // Speed tracking
  let decisionTimes = [];
  let lastDecisionTs = null;
  let totalDecided = 0;
  let totalItems = 0;

  // Gamification state
  const LEVEL_THRESHOLDS = [0, 100, 300, 600, 1100, 2000, 3500, 5500, 8000, 12000];
  const COMBO_TIMEOUT = 10000;
  let combo = 0;
  let lastReviewTs = 0;
  let sessionReviews = 0;
  let sessionXpGained = 0;
  let bestCombo = 0;
  let soundEnabled = false;
  let audioCtx = null;

  const $login = document.getElementById('login-screen');
  const $review = document.getElementById('review-screen');
  const $empty = document.getElementById('empty-state');

  // -- Toast --
  function toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.textContent = msg;
    document.getElementById('toast-container').appendChild(el);
    setTimeout(() => el.remove(), 1400);
  }

  // -- Gamification: Persistence --
  function getGameState() {
    try { return JSON.parse(localStorage.getItem('review_game_' + reviewer) || '{}'); } catch { return {}; }
  }
  function saveGameState(patch) {
    const state = Object.assign(getGameState(), patch);
    localStorage.setItem('review_game_' + reviewer, JSON.stringify(state));
  }
  function loadGameState() {
    const state = getGameState();
    soundEnabled = localStorage.getItem('review_sound') === '1';
    updateSoundIcon();
    updateLevelDisplay(state.xp || 0);
    updateStreakDisplay(state);
    combo = 0;
    sessionReviews = 0;
    sessionXpGained = 0;
    bestCombo = 0;
    lastReviewTs = 0;
    updateComboDisplay();
    updateSessionCount();
  }

  // -- Gamification: Level --
  function getLevel(xp) {
    for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
      if (xp >= LEVEL_THRESHOLDS[i]) return i + 1;
    }
    return 1;
  }
  function updateLevelDisplay(xp) {
    const level = getLevel(xp);
    const cur = LEVEL_THRESHOLDS[level - 1] || 0;
    const next = LEVEL_THRESHOLDS[level] || LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1];
    const pct = next > cur ? ((xp - cur) / (next - cur)) * 100 : 100;
    const badge = document.getElementById('level-badge');
    if (badge) badge.innerHTML = 'Lv.' + level + ' <span id="xp-bar-wrap"><span id="xp-bar" style="width:' + pct + '%"></span></span> <span id="xp-display">' + xp.toLocaleString() + 'xp</span>';
  }

  // -- Gamification: Combo --
  function updateComboDisplay() {
    const el = document.getElementById('combo-counter');
    if (!el) return;
    if (combo <= 0) { el.textContent = ''; el.className = 'combo-dim'; return; }
    el.textContent = combo + 'x';
    if (combo >= 23) el.className = 'combo-godlike';
    else if (combo >= 12) el.className = 'combo-inferno';
    else if (combo >= 5) el.className = 'combo-fire';
    else if (combo >= 3) el.className = 'combo-hot';
    else el.className = 'combo-dim';
  }

  // Streak definitions
  const STREAKS = [
    { at: 2,  label: 'DOUBLE KILL',  cls: 's-double',  sfx: 'double' },
    { at: 3,  label: 'TRIPLE KILL',  cls: 's-triple',  sfx: 'triple' },
    { at: 4,  label: 'MEGA KILL',    cls: 's-mega',    sfx: 'mega' },
    { at: 5,  label: 'ULTRA KILL',   cls: 's-ultra',   sfx: 'ultra' },
    { at: 6,  label: 'RAMPAGE',      cls: 's-rampage',  sfx: 'rampage' },
    { at: 7,  label: 'GODLIKE',      cls: 's-godlike',  sfx: 'godlike' },
  ];

  const SHAKE_MAP = { 's-double': 'shake-light', 's-triple': 'shake-light', 's-mega': 'shake-medium', 's-ultra': 'shake-hard', 's-rampage': 'shake-hard', 's-godlike': 'shake-insane' };
  function screenShake(cls) {
    const s = SHAKE_MAP[cls]; if (!s) return;
    document.body.classList.remove('shake-light','shake-medium','shake-hard','shake-insane');
    void document.body.offsetWidth; // force reflow
    document.body.classList.add(s);
    document.body.addEventListener('animationend', function handler() {
      document.body.classList.remove(s);
      document.body.removeEventListener('animationend', handler);
    });
  }
  function showStreakBanner(streak) {
    const el = document.createElement('div');
    el.className = 'streak-banner ' + streak.cls;
    el.textContent = streak.label;
    document.body.appendChild(el);
    screenShake(streak.cls);
    setTimeout(function() { el.remove(); }, 1300);
  }

  function tickCombo() {
    const now = Date.now();
    if (lastReviewTs && (now - lastReviewTs) > COMBO_TIMEOUT) combo = 0;
    combo++;
    lastReviewTs = now;
    if (combo > bestCombo) bestCombo = combo;
    updateComboDisplay();
    spawnFloatText('+1', document.getElementById('combo-counter'));

    // Check for streak milestone
    let matched = null;
    for (let i = STREAKS.length - 1; i >= 0; i--) {
      if (combo === STREAKS[i].at) { matched = STREAKS[i]; break; }
    }
    if (matched) {
      playSound(matched.sfx);
      showStreakBanner(matched);
    } else {
      playSound('ping');
    }
  }
  function resetCombo() { combo = 0; updateComboDisplay(); }

  // -- Gamification: XP --
  function getComboMultiplier() {
    if (combo >= 20) return 3;
    if (combo >= 10) return 2;
    if (combo >= 5) return 1.5;
    return 1;
  }
  function awardXp(base) {
    const state = getGameState();
    const oldXp = state.xp || 0;
    const oldLevel = getLevel(oldXp);
    const mult = getComboMultiplier();
    const gained = Math.round(base * mult);
    const newXp = oldXp + gained;
    const newLevel = getLevel(newXp);
    saveGameState({ xp: newXp });
    sessionXpGained += gained;
    updateLevelDisplay(newXp);
    const label = mult > 1 ? '+' + gained + ' (' + mult + 'x)' : '+' + gained;
    spawnFloatText(label, document.getElementById('level-badge'), true);
    if (newLevel > oldLevel) {
      toast('Level ' + newLevel, 'combo');
      playSound('levelup');
      const badge = document.getElementById('level-badge');
      if (badge) { badge.classList.add('level-up-glow'); setTimeout(function() { badge.classList.remove('level-up-glow'); }, 1200); }
    }
  }

  // -- Gamification: Session count --
  function updateSessionCount() {
    const el = document.getElementById('session-count');
    if (el) el.textContent = sessionReviews + ' today';
  }

  // -- Gamification: Streak --
  function updateStreak() {
    const state = getGameState();
    const today = new Date().toISOString().slice(0, 10);
    const todayCount = (state.todayDate === today) ? (state.todayCount || 0) + 1 : 1;
    let streakDays = state.streakDays || 0;
    let lastStreakDate = state.lastStreakDate || '';
    if (todayCount >= 5 && lastStreakDate !== today) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      streakDays = (lastStreakDate === yesterday) ? streakDays + 1 : 1;
      lastStreakDate = today;
    }
    saveGameState({ todayDate: today, todayCount: todayCount, streakDays: streakDays, lastStreakDate: lastStreakDate });
    updateStreakDisplay({ streakDays: streakDays });
  }
  function updateStreakDisplay(state) {
    const el = document.getElementById('streak-badge');
    if (!el) return;
    const days = (state && state.streakDays) || 0;
    el.textContent = days > 0 ? days + 'd\\uD83D\\uDD25' : '';
  }

  // -- Gamification: Sound --
  function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }
  // Noise burst helper: short filtered noise for percussive transients
  function noiseBurst(ctx, t, dur, freq, vol) {
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const flt = ctx.createBiquadFilter(); flt.type = 'bandpass'; flt.frequency.value = freq; flt.Q.value = 2;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(flt); flt.connect(g); g.connect(ctx.destination);
    src.start(t); src.stop(t + dur);
  }
  // Tone helper: oscillator with attack/decay envelope
  function tone(ctx, t, type, freq, vol, attack, decay) {
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + attack + decay);
    o.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + attack + decay + 0.01);
    return o;
  }
  // Ping: crisp pop + warm tone (like a satisfying UI confirmation)
  function playPing() {
    const ctx = getAudioCtx(); const t = ctx.currentTime;
    noiseBurst(ctx, t, 0.04, 4000, 0.15);
    tone(ctx, t, 'sine', 880, 0.2, 0.005, 0.1);
    tone(ctx, t + 0.01, 'sine', 1320, 0.08, 0.005, 0.06);
  }
  // Double: two quick bright taps ascending
  function playDouble() {
    const ctx = getAudioCtx(); const t = ctx.currentTime;
    noiseBurst(ctx, t, 0.03, 5000, 0.12);
    tone(ctx, t, 'sine', 784, 0.2, 0.005, 0.1);
    noiseBurst(ctx, t + 0.1, 0.03, 6000, 0.14);
    tone(ctx, t + 0.1, 'sine', 1047, 0.22, 0.005, 0.12);
  }
  // Triple: three-note rising chime with shimmer
  function playTriple() {
    const ctx = getAudioCtx(); const t = ctx.currentTime;
    [784, 988, 1319].forEach(function(freq, i) {
      const off = i * 0.09;
      noiseBurst(ctx, t + off, 0.025, 5000 + i * 1000, 0.1);
      tone(ctx, t + off, 'sine', freq, 0.2, 0.005, 0.15);
      tone(ctx, t + off, 'sine', freq * 2.01, 0.04, 0.01, 0.1); // shimmer detune
    });
  }
  // Mega: bass thump + metallic impact ring
  function playMega() {
    const ctx = getAudioCtx(); const t = ctx.currentTime;
    // Sub impact
    const ob = ctx.createOscillator(); const gb = ctx.createGain();
    ob.type = 'sine'; ob.frequency.setValueAtTime(150, t);
    ob.frequency.exponentialRampToValueAtTime(40, t + 0.2);
    gb.gain.setValueAtTime(0.35, t); gb.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    ob.connect(gb); gb.connect(ctx.destination); ob.start(t); ob.stop(t + 0.25);
    // Noise crack
    noiseBurst(ctx, t, 0.06, 3000, 0.25);
    // Metallic ring
    [523, 784, 1047].forEach(function(freq) {
      tone(ctx, t + 0.03, 'triangle', freq, 0.12, 0.01, 0.25);
    });
  }
  // Ultra: cinematic whoosh + power stab
  function playUltra() {
    const ctx = getAudioCtx(); const t = ctx.currentTime;
    // Filtered noise whoosh
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const flt = ctx.createBiquadFilter(); flt.type = 'bandpass'; flt.Q.value = 3;
    flt.frequency.setValueAtTime(300, t); flt.frequency.exponentialRampToValueAtTime(4000, t + 0.2);
    const gn = ctx.createGain(); gn.gain.setValueAtTime(0.2, t); gn.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(flt); flt.connect(gn); gn.connect(ctx.destination);
    src.start(t); src.stop(t + 0.4);
    // Power chord stab
    [523, 659, 784, 1047].forEach(function(freq) {
      tone(ctx, t + 0.15, 'sawtooth', freq, 0.08, 0.01, 0.3);
      tone(ctx, t + 0.15, 'sine', freq, 0.1, 0.005, 0.35);
    });
    // Bass punch
    const o2 = ctx.createOscillator(); const g2 = ctx.createGain();
    o2.type = 'sine'; o2.frequency.setValueAtTime(100, t + 0.15);
    o2.frequency.exponentialRampToValueAtTime(50, t + 0.35);
    g2.gain.setValueAtTime(0.3, t + 0.15); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    o2.connect(g2); g2.connect(ctx.destination); o2.start(t + 0.15); o2.stop(t + 0.4);
  }
  // Rampage: war drum hit + brass fanfare
  function playRampage() {
    const ctx = getAudioCtx(); const t = ctx.currentTime;
    // War drum (low noise burst + sub)
    noiseBurst(ctx, t, 0.1, 800, 0.3);
    const od = ctx.createOscillator(); const gd = ctx.createGain();
    od.type = 'sine'; od.frequency.setValueAtTime(80, t);
    od.frequency.exponentialRampToValueAtTime(30, t + 0.3);
    gd.gain.setValueAtTime(0.4, t); gd.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    od.connect(gd); gd.connect(ctx.destination); od.start(t); od.stop(t + 0.35);
    // Brass-like fanfare (square + sine harmonics)
    [392, 523, 659, 784, 1047].forEach(function(freq, i) {
      const off = 0.06 + i * 0.05;
      tone(ctx, t + off, 'square', freq, 0.06, 0.01, 0.25);
      tone(ctx, t + off, 'sine', freq, 0.1, 0.005, 0.3);
    });
  }
  // GODLIKE: thunder crack + massive choir chord + sub rumble
  function playGodlike() {
    const ctx = getAudioCtx(); const t = ctx.currentTime;
    // Thunder crack (long noise sweep)
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const flt = ctx.createBiquadFilter(); flt.type = 'lowpass';
    flt.frequency.setValueAtTime(8000, t); flt.frequency.exponentialRampToValueAtTime(200, t + 0.5);
    const gn = ctx.createGain(); gn.gain.setValueAtTime(0.3, t);
    gn.gain.setValueAtTime(0.3, t + 0.05); gn.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    src.connect(flt); flt.connect(gn); gn.connect(ctx.destination);
    src.start(t); src.stop(t + 0.6);
    // Sub rumble
    const ob = ctx.createOscillator(); const gb = ctx.createGain();
    ob.type = 'sine'; ob.frequency.setValueAtTime(45, t);
    ob.frequency.exponentialRampToValueAtTime(25, t + 0.8);
    gb.gain.setValueAtTime(0.35, t); gb.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    ob.connect(gb); gb.connect(ctx.destination); ob.start(t); ob.stop(t + 0.8);
    // Massive choir chord (detuned sine layers)
    [262, 330, 392, 523, 659, 784, 1047, 1319].forEach(function(freq) {
      [-4, 0, 4].forEach(function(det) {
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = freq; o.detune.value = det;
        g.gain.setValueAtTime(0.001, t + 0.1);
        g.gain.linearRampToValueAtTime(0.04, t + 0.2);
        g.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
        o.connect(g); g.connect(ctx.destination);
        o.start(t + 0.1); o.stop(t + 1.0);
      });
    });
  }
  // Level up: bright ascending sweep
  function playLevelUp() {
    const ctx = getAudioCtx(); const t = ctx.currentTime;
    noiseBurst(ctx, t, 0.05, 6000, 0.12);
    tone(ctx, t, 'triangle', 523, 0.2, 0.01, 0.15);
    tone(ctx, t + 0.1, 'triangle', 784, 0.2, 0.01, 0.15);
    tone(ctx, t + 0.2, 'triangle', 1047, 0.22, 0.01, 0.2);
  }
  const SOUND_MAP = { ping: playPing, confirm: playPing, flip: playPing, double: playDouble, triple: playTriple, mega: playMega, ultra: playUltra, rampage: playRampage, godlike: playGodlike, levelup: playLevelUp };
  function playSound(type) {
    if (!soundEnabled) return;
    const fn = SOUND_MAP[type];
    if (fn) fn();
  }
  function updateSoundIcon() {
    const el = document.getElementById('sound-toggle');
    if (el) el.textContent = soundEnabled ? '\\uD83D\\uDD0A' : '\\uD83D\\uDD07';
  }
  document.getElementById('sound-toggle').addEventListener('click', function() {
    soundEnabled = !soundEnabled;
    localStorage.setItem('review_sound', soundEnabled ? '1' : '0');
    updateSoundIcon();
    if (soundEnabled && !audioCtx) getAudioCtx();
  });

  // -- Gamification: Floating text --
  function spawnFloatText(text, anchor, isXp) {
    if (!anchor) return;
    const el = document.createElement('span');
    el.className = 'float-xp' + (isXp ? ' float-xp-gold' : '');
    el.textContent = text;
    const rect = anchor.getBoundingClientRect();
    el.style.left = (rect.left + rect.width / 2) + 'px';
    el.style.top = rect.top + 'px';
    document.body.appendChild(el);
    setTimeout(function() { el.remove(); }, 500);
  }

  // -- Gamification: Session summary + confetti --
  function renderSessionSummary() {
    const defaultEl = document.getElementById('empty-default');
    const summaryEl = document.getElementById('session-summary');
    if (!defaultEl || !summaryEl) return;
    if (sessionReviews === 0) {
      summaryEl.style.display = 'none';
      defaultEl.style.display = 'block';
      return;
    }
    defaultEl.style.display = 'none';
    summaryEl.style.display = 'block';
    const avgTime = decisionTimes.length > 0 ? (decisionTimes.reduce(function(a,b){return a+b;}, 0) / decisionTimes.length).toFixed(1) : '--';
    document.getElementById('summary-stats').innerHTML =
      '<span>' + sessionReviews + ' reviews</span>' +
      '<span class="summary-sep">/</span>' +
      '<span>' + bestCombo + 'x best combo</span>' +
      '<span class="summary-sep">/</span>' +
      '<span>avg ' + avgTime + 's</span>' +
      '<span class="summary-sep">/</span>' +
      '<span>+' + sessionXpGained + ' XP</span>';
  }
  function spawnConfetti() {
    if (sessionReviews === 0) return;
    const container = document.getElementById('confetti-container');
    if (!container) return;
    container.innerHTML = '';
    const colors = ['#8b5cf6', '#1f6feb', '#58a6ff', '#bc8cff', '#fab005'];
    for (let i = 0; i < 15; i++) {
      const p = document.createElement('div');
      p.className = 'confetti-particle';
      p.style.left = (20 + Math.random() * 60) + '%';
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = (Math.random() * 0.3) + 's';
      p.style.animationDuration = (1 + Math.random() * 0.5) + 's';
      container.appendChild(p);
    }
  }

  // -- API --
  async function api(path, opts = {}) {
    const res = await fetch(API + path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  // -- Progress bar --
  function updateProgress(remaining) {
    const total = totalItems || (totalDecided + remaining);
    if (total <= 0) return;
    const pct = Math.min(100, (totalDecided / total) * 100);
    document.getElementById('progress-bar').style.width = pct + '%';
  }

  // -- Speed tracker --
  function trackDecision() {
    const now = Date.now();
    if (lastDecisionTs) {
      const elapsed = (now - lastDecisionTs) / 1000;
      decisionTimes.push(elapsed);
      if (decisionTimes.length > 20) decisionTimes.shift();
      const avg = decisionTimes.reduce((a, b) => a + b, 0) / decisionTimes.length;
      document.getElementById('speed-avg').textContent = avg.toFixed(1);
    }
    lastDecisionTs = now;
    totalDecided++;
  }

  // -- Transition animation --
  function animateTransition(cb) {
    const el = document.getElementById('verdict-content');
    el.classList.add('fade-out');
    setTimeout(() => {
      cb();
      el.classList.remove('fade-out');
      el.classList.add('fade-in');
      requestAnimationFrame(() => {
        el.classList.remove('fade-in');
      });
    }, 120);
  }

  // -- Login --
  function checkSetup() {
    document.getElementById('setup-hint').textContent = 'Reviewers are created by the admin via the dashboard.';
  }

  function showLoginError(msg) {
    const el = document.getElementById('login-error');
    el.textContent = msg;
    el.style.display = 'block';
  }

  document.getElementById('login-btn').addEventListener('click', doLogin);
  document.getElementById('login-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  document.getElementById('login-user').addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('login-pass').focus(); });

  async function doLogin() {
    const u = document.getElementById('login-user').value.trim();
    const p = document.getElementById('login-pass').value;
    if (!u || !p) { showLoginError('Enter username & password'); return; }
    try {
      const data = await api('/login', { method: 'POST', body: JSON.stringify({ username: u, password: p }) });
      reviewer = data.username;
      enterReview();
    } catch (err) {
      showLoginError(err.message);
    }
  }

  async function enterReview() {
    $login.style.display = 'none';
    document.getElementById('reviewer-tag').innerHTML = '<strong>' + reviewer + '</strong>';
    loadGameState();
    // Get initial stats to know total
    try {
      const stats = await api('/stats');
      totalItems = stats.pending + stats.decided;
      totalDecided = stats.decided;
    } catch {}
    await loadNext();
  }

  // -- Review --
  async function loadNext() {
    try {
      const data = await api('/next');
      if (!data.current) {
        showEmpty();
        return;
      }
      currentItem = data.current;
      peekItem = data.peek;
      currentTranscript = data.transcript;
      currentAuditRemaining = data.auditRemaining ?? 0;
      if (currentTranscript && currentItem) {
        transcriptCache[currentItem.findingId] = currentTranscript;
      }
      showReview();
    } catch (err) {
      if (err.message === 'unauthorized') {
        $review.style.display = 'none';
        $empty.style.display = 'none';
        $login.style.display = 'flex';
        return;
      }
      toast(err.message, 'error');
    }
  }

  function showReview() {
    $empty.style.display = 'none';
    $review.style.display = 'grid';
    renderCurrent();
  }

  function showEmpty() {
    $review.style.display = 'none';
    $empty.style.display = 'flex';
    renderSessionSummary();
    spawnConfetti();
  }

  function renderCurrent() {
    if (!currentItem) return;
    document.getElementById('q-header').textContent = currentItem.header;
    document.getElementById('q-populated').textContent = currentItem.populated;
    document.getElementById('q-defense').textContent = currentItem.defense || 'No defense provided';
    document.getElementById('thinking-text').textContent = currentItem.thinking || 'No reasoning provided';
    document.getElementById('m-finding').textContent = currentItem.findingId;
    document.getElementById('m-qindex').textContent = String(currentItem.questionIndex);

    const remaining = peekItem ? '...' : '0';
    document.getElementById('m-remaining').textContent = remaining;

    // Close thinking on new item
    document.getElementById('thinking-content').classList.remove('open');
    document.querySelector('#thinking-toggle .arrow').classList.remove('open');

    loadRecording(currentItem.findingId);
    renderTranscript();
  }

  // -- Thinking toggle --
  document.getElementById('thinking-toggle').addEventListener('click', toggleThinking);
  function toggleThinking() {
    const content = document.getElementById('thinking-content');
    const arrow = document.querySelector('#thinking-toggle .arrow');
    content.classList.toggle('open');
    arrow.classList.toggle('open');
  }

  // -- Transcript --
  let colOffset = 0;
  let colStep = 0;
  let totalCols = 1;

  function sizeTranscript() {
    const progBar = document.getElementById('progress-bar-container');
    const bottomBar = document.getElementById('bottom-bar');
    const body = document.getElementById('transcript-body');
    const panel = document.getElementById('transcript-panel');
    const h = window.innerHeight - progBar.offsetHeight - bottomBar.offsetHeight - 40;
    body.style.height = h + 'px';
    const panelW = panel.clientWidth - 48; // subtract padding
    const colW = Math.floor(panelW / 3);
    const gap = 24;
    colStep = colW + gap;
    body.style.columnWidth = colW + 'px';
    requestAnimationFrame(() => {
      totalCols = Math.max(1, Math.ceil(body.scrollWidth / colStep));
      colOffset = Math.min(colOffset, Math.max(0, totalCols - 3));
      body.scrollLeft = colOffset * colStep;
      updateColIndicator();
    });
  }

  function scrollColumns(dir) {
    const body = document.getElementById('transcript-body');
    const maxOffset = Math.max(0, totalCols - 3);
    colOffset = Math.max(0, Math.min(colOffset + dir, maxOffset));
    body.scrollTo({ left: colOffset * colStep, behavior: 'smooth' });
    updateColIndicator();
  }

  function updateColIndicator() {
    const el = document.getElementById('col-indicator');
    if (totalCols <= 3) { el.textContent = ''; return; }
    const from = colOffset + 1;
    const to = Math.min(colOffset + 3, totalCols);
    el.textContent = from + '-' + to + ' / ' + totalCols;
  }

  window.addEventListener('resize', () => { colOffset = 0; sizeTranscript(); });

  // Extract quoted snippets and key phrases from defense + thinking text
  function extractEvidenceSnippets(defense, thinking) {
    const snippets = [];
    const combined = (defense || '') + ' ' + (thinking || '');
    // Extract text in single quotes: 'Can I get your reservation number please?'
    const quoted = combined.match(/'([^']{10,})'/g);
    if (quoted) {
      for (const q of quoted) snippets.push(q.slice(1, -1).toLowerCase());
    }
    // Extract text in double quotes
    const dquoted = combined.match(/"([^"]{10,})"/g);
    if (dquoted) {
      for (const q of dquoted) snippets.push(q.slice(1, -1).toLowerCase());
    }
    return snippets;
  }

  function renderTranscript() {
    const body = document.getElementById('transcript-body');
    body.innerHTML = '';
    if (!currentTranscript?.diarized && !currentTranscript?.raw) {
      body.innerHTML = '<p style="color:#3d4452;padding:20px">No transcript available</p>';
      return;
    }
    const text = currentTranscript.diarized || currentTranscript.raw;
    const defense = (currentItem?.defense || '').toLowerCase();
    const thinking = (currentItem?.thinking || '').toLowerCase();
    const evidenceSnippets = extractEvidenceSnippets(currentItem?.defense, currentItem?.thinking);
    const lines = text.split('\\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      const div = document.createElement('div');
      div.className = 't-line';

      const match = line.match(/^\\[?(AGENT|CUSTOMER|SYSTEM|Agent|Customer|System)\\]?[:\\s]*(.*)/i);
      if (match) {
        const speaker = match[1].toUpperCase();
        const content = match[2] || '';
        div.classList.add(speaker === 'AGENT' ? 't-agent' : speaker === 'CUSTOMER' ? 't-customer' : 't-system');
        const label = document.createElement('span');
        label.className = 't-speaker';
        label.textContent = speaker;
        div.appendChild(label);
        div.appendChild(document.createTextNode(content));

        const contentLow = content.toLowerCase();

        // Primary: exact snippet match from quoted text in defense/thinking (amber)
        let isEvidence = false;
        if (evidenceSnippets.length > 0 && content.length > 10) {
          for (const snippet of evidenceSnippets) {
            if (contentLow.includes(snippet) || snippet.includes(contentLow.slice(0, 40))) {
              isEvidence = true;
              break;
            }
          }
        }

        if (isEvidence) {
          div.classList.add('t-evidence');
        } else if (defense && content.length > 20) {
          // Secondary: keyword match from defense (subtle purple)
          const words = defense.split(/\\s+/).filter(w => w.length > 5);
          const matchCount = words.filter(w => contentLow.includes(w)).length;
          if (matchCount >= 3) {
            div.classList.add('t-highlight');
          }
        }
      } else {
        div.textContent = line;
      }
      body.appendChild(div);
    }
    colOffset = 0;
    sizeTranscript();
  }

  // -- Decide --
  async function decide(decision) {
    if (!currentItem || busy) return;

    // Gate: if this is the last question for the audit, require typed confirmation
    if (currentAuditRemaining === 1) {
      pendingDecision = decision;
      showConfirmModal();
      return;
    }

    executeDecision(decision);
  }

  async function executeDecision(decision) {
    if (!currentItem || busy) return;
    busy = true;
    const item = currentItem;

    trackDecision();
    tickCombo();
    sessionReviews++;
    updateSessionCount();
    awardXp(decision === 'confirm' ? 10 : 15);
    playSound(decision);
    updateStreak();

    // Swap state immediately (before fetch) to prevent animation/response race
    let didSwap = false;
    if (peekItem) {
      didSwap = true;
      currentItem = peekItem;
      peekItem = null;
      if (transcriptCache[currentItem.findingId]) {
        currentTranscript = transcriptCache[currentItem.findingId];
      }
      animateTransition(() => renderCurrent());
    }

    toast(decision === 'confirm' ? 'Confirmed fail' : 'Flipped to pass', decision === 'confirm' ? 'confirm' : 'flip');

    try {
      const res = await fetch(API + '/decide', {
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        body: JSON.stringify({
          findingId: item.findingId,
          questionIndex: item.questionIndex,
          decision,
        }),
      });
      const data = await res.json();

      // 409 = item already decided (race condition) — silently skip
      if (res.status === 409) { busy = false; return; }
      if (!res.ok) throw new Error(data.error || 'Request failed');

      if (data.auditComplete) {
        toast('Audit complete', 'complete');
      }

      const remaining = data.next?.remaining ?? 0;
      updateProgress(remaining);

      if (data.next?.current) {
        currentAuditRemaining = data.next.auditRemaining ?? 0;
        if (didSwap) {
          // We already swapped to peek. Just update the next peek.
          peekItem = data.next.peek;
        } else {
          // No swap happened (no peek available). Use API response.
          currentItem = data.next.current;
          peekItem = data.next.peek;
          currentTranscript = data.next.transcript;
          if (currentTranscript && currentItem) {
            transcriptCache[currentItem.findingId] = currentTranscript;
          }
          renderCurrent();
        }
        // Always cache transcript for the claimed item
        if (data.next.transcript && data.next.current) {
          transcriptCache[data.next.current.findingId] = data.next.transcript;
        }
        document.getElementById('m-remaining').textContent = String(remaining);
      } else if (!didSwap) {
        showEmpty();
      } else {
        // Swapped to last item, nothing more coming
        document.getElementById('m-remaining').textContent = '0';
        peekItem = null;
      }
    } catch (err) {
      toast(err.message, 'error');
    }
    busy = false;
  }

  // -- Confirmation modal --
  function showConfirmModal() {
    const overlay = document.getElementById('confirm-overlay');
    const input = document.getElementById('confirm-input');
    const submitBtn = document.getElementById('confirm-submit-btn');
    overlay.classList.add('open');
    input.value = '';
    submitBtn.classList.remove('enabled');
    setTimeout(() => input.focus(), 50);
  }

  function hideConfirmModal() {
    document.getElementById('confirm-overlay').classList.remove('open');
    document.getElementById('confirm-input').value = '';
    pendingDecision = null;
  }

  document.getElementById('confirm-input').addEventListener('input', (e) => {
    const btn = document.getElementById('confirm-submit-btn');
    if (e.target.value.trim().toUpperCase() === 'YES') {
      btn.classList.add('enabled');
    } else {
      btn.classList.remove('enabled');
    }
  });

  document.getElementById('confirm-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.value.trim().toUpperCase() === 'YES' && pendingDecision) {
      e.preventDefault();
      const decision = pendingDecision;
      hideConfirmModal();
      executeDecision(decision);
    } else if (e.key === 'Escape') {
      hideConfirmModal();
    }
  });

  document.getElementById('confirm-cancel-btn').addEventListener('click', hideConfirmModal);

  document.getElementById('confirm-submit-btn').addEventListener('click', () => {
    if (!pendingDecision) return;
    const decision = pendingDecision;
    hideConfirmModal();
    executeDecision(decision);
  });

  // -- Back --
  async function goBack() {
    if (busy) return;
    busy = true;
    try {
      const data = await api('/back', { method: 'POST' });
      animateTransition(() => {
        currentItem = data.current;
        currentTranscript = data.transcript;
        peekItem = data.peek;
        currentAuditRemaining = data.auditRemaining ?? 0;
        if (currentTranscript && currentItem) {
          transcriptCache[currentItem.findingId] = currentTranscript;
        }
        showReview();
        renderCurrent();
        document.getElementById('m-remaining').textContent = String(data.remaining);
      });
      toast('Undid last decision', 'undo');
      resetCombo();
      totalDecided = Math.max(0, totalDecided - 1);
      updateProgress(data.remaining);
    } catch (err) {
      toast(err.message, 'error');
    }
    busy = false;
  }

  // -- Keyboard --
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (document.getElementById('confirm-overlay').classList.contains('open')) return;

    switch (e.key.toLowerCase()) {
      case 'y': decide('confirm'); break;
      case 'n': decide('flip'); break;
      case 'b':
      case 'backspace': e.preventDefault(); goBack(); break;
      case 'd': toggleThinking(); break;
      case 'l': scrollColumns(1); break;
      case 'h': scrollColumns(-1); break;
      case 'p': if (recAudio.paused) recAudio.play(); else recAudio.pause(); break;
      case 'arrowleft': e.preventDefault(); recAudio.currentTime = Math.max(0, recAudio.currentTime - (e.shiftKey ? 15 : 5)); break;
      case 'arrowright': e.preventDefault(); recAudio.currentTime = Math.min(recAudio.duration||0, recAudio.currentTime + (e.shiftKey ? 15 : 5)); break;
    }
  });

  // -- Logout --
  document.getElementById('logout-btn').addEventListener('click', async () => {
    try { await api('/logout', { method: 'POST' }); } catch {}
    sessionStorage.removeItem('review_user');
    reviewer = null;
    currentItem = null;
    peekItem = null;
    decisionTimes = [];
    lastDecisionTs = null;
    totalDecided = 0;
    combo = 0;
    sessionReviews = 0;
    sessionXpGained = 0;
    bestCombo = 0;
    lastReviewTs = 0;
    $review.style.display = 'none';
    $empty.style.display = 'none';
    $login.style.display = 'flex';
    document.getElementById('login-user').value = '';
    document.getElementById('login-pass').value = '';
    document.getElementById('login-error').style.display = 'none';
  });

  // -- Audio player --
  var recAudio = document.getElementById('rec-audio');
  var apPlay = document.getElementById('ap-play');
  var apIconPlay = document.getElementById('ap-icon-play');
  var apIconPause = document.getElementById('ap-icon-pause');
  var apTrack = document.getElementById('ap-track');
  var apFill = document.getElementById('ap-fill');
  var apTime = document.getElementById('ap-time');
  var currentRecFinding = null;

  function fmtTime(s) { var m = Math.floor(s/60); var sec = Math.floor(s%60); return m + ':' + (sec<10?'0':'') + sec; }
  function updateApTime() {
    var cur = recAudio.currentTime||0; var dur = recAudio.duration||0;
    apTime.textContent = fmtTime(cur) + '/' + fmtTime(dur);
    if (dur > 0) apFill.style.width = (cur/dur*100) + '%';
  }
  function loadRecording(findingId) {
    if (!findingId || findingId === currentRecFinding) return;
    currentRecFinding = findingId;
    recAudio.src = '/audit/recording?id=' + encodeURIComponent(findingId);
    recAudio.load();
    apFill.style.width = '0%';
    apTime.textContent = '0:00';
    apIconPlay.style.display = 'block';
    apIconPause.style.display = 'none';
  }
  apPlay.addEventListener('click', function() {
    if (recAudio.paused) recAudio.play(); else recAudio.pause();
  });
  recAudio.addEventListener('play', function() { apIconPlay.style.display='none'; apIconPause.style.display='block'; });
  recAudio.addEventListener('pause', function() { apIconPlay.style.display='block'; apIconPause.style.display='none'; });
  recAudio.addEventListener('ended', function() { apIconPlay.style.display='block'; apIconPause.style.display='none'; });
  recAudio.addEventListener('timeupdate', updateApTime);
  recAudio.addEventListener('loadedmetadata', updateApTime);
  apTrack.addEventListener('click', function(e) {
    var rect = apTrack.getBoundingClientRect();
    var pct = (e.clientX - rect.left) / rect.width;
    if (recAudio.duration) recAudio.currentTime = pct * recAudio.duration;
  });
  document.getElementById('ap-back').addEventListener('click', function() { recAudio.currentTime = Math.max(0, recAudio.currentTime - 5); });
  document.getElementById('ap-fwd').addEventListener('click', function() { recAudio.currentTime = Math.min(recAudio.duration||0, recAudio.currentTime + 5); });

  // -- Init: try resuming session --
  (async () => {
    try {
      const data = await api('/next');
      reviewer = sessionStorage.getItem('review_user') || 'reviewer';
      document.getElementById('reviewer-tag').innerHTML = '<strong>' + reviewer + '</strong>';
      loadGameState();
      try {
        const stats = await api('/stats');
        totalItems = stats.pending + stats.decided;
        totalDecided = stats.decided;
        updateProgress(stats.pending);
      } catch {}
      if (data.current) {
        currentItem = data.current;
        peekItem = data.peek;
        currentTranscript = data.transcript;
        if (currentTranscript && currentItem) transcriptCache[currentItem.findingId] = currentTranscript;
        $login.style.display = 'none';
        showReview();
      } else {
        $login.style.display = 'none';
        showEmpty();
      }
    } catch {
      checkSetup();
    }
  })();
})();
</script>
</body>
</html>`;
}
