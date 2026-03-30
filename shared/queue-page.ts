/**
 * Shared queue page generator for review and judge UIs.
 * Both modes get full gamification (XP, levels, streaks, confetti, sounds).
 *
 * Differences by mode:
 *   - Colors: review=purple, judge=teal
 *   - Decisions: review=confirm/flip, judge=uphold/overturn(+reason)
 *   - Hotkeys: review=Y/N/D, judge=Y/A/S/D/F/G
 *   - Verdict badge: review=static "Bot answered NO", judge=dynamic YES/NO
 *   - API: /review/api vs /judge/api
 */
import * as icons from "./icons.ts";
import { env } from "../env.ts";

export function generateQueuePage(mode: "review" | "judge", gamificationJson?: string): string {
  const R = mode === "review";

  // -- Color palette --
  const accent = R ? "#8b5cf6" : "#14b8a6";
  const accentDark = R ? "#7c3aed" : "#0d9488";
  const gradStart = R ? "#1f6feb" : "#0d9488";
  const gradEnd = R ? "#8b5cf6" : "#14b8a6";
  const evidenceLabel = R ? "#58a6ff" : "#14b8a6";
  const btnAccent = R ? "#1f6feb" : "#0d9488";
  const btnHover = R ? "#58a6ff" : "#14b8a6";
  const btnShadow = R ? "rgba(88,166,255,0.3)" : "rgba(20,184,166,0.3)";
  const accentLight = R ? "#bc8cff" : "#2dd4bf";
  const agentBorder = R ? "#1f6feb" : "#0d9488";
  const agentColor = R ? "#79b8ff" : "#5eead4";
  const agentSpeaker = R ? "#1f6feb" : "#0d9488";
  const custBorder = R ? "#8b5cf6" : "#2dd4bf";
  const custColor = R ? "#d2b3ff" : "#99f6e4";
  const custSpeaker = R ? "#8b5cf6" : "#2dd4bf";
  const highlightBg = R ? "rgba(139,92,246,0.1)" : "rgba(20,184,166,0.08)";
  const comboHot = R ? "#58a6ff" : "#14b8a6";
  const comboHotShadow = R ? "rgba(88,166,255,0.4)" : "rgba(20,184,166,0.4)";
  const streakDouble = R ? "#58a6ff" : "#14b8a6";
  const emptyGrad = R
    ? "rgba(139,92,246,0.05)"
    : "rgba(20,184,166,0.04)";
  const confirmShadow = R
    ? "rgba(139,92,246,0.15)"
    : "rgba(20,184,166,0.15)";
  const previewBg = R
    ? "rgba(139,92,246,0.1)"
    : "rgba(20,184,166,0.1)";
  const previewBorder = R
    ? "rgba(139,92,246,0.2)"
    : "rgba(20,184,166,0.2)";
  const floatXp = R ? "#58a6ff" : "#14b8a6";

  // Decision toast colors
  const posToastBg = R ? "rgba(31,111,235,0.85)" : "rgba(63,185,80,0.85)";
  const negToastBg = R ? "rgba(139,92,246,0.85)" : "rgba(239,68,68,0.85)";
  const undoToastBg = R
    ? "rgba(110,64,201,0.85)"
    : "rgba(100,116,139,0.85)";
  const completeToastBg = R
    ? "rgba(139,92,246,0.85)"
    : "rgba(20,184,166,0.85)";

  // Hotkey button colors
  const posKbdBorder = R ? "rgba(31,111,235,0.4)" : "rgba(63,185,80,0.4)";
  const posKbdColor = R ? "#58a6ff" : "#3fb950";
  const negKbdBorder = R ? "rgba(139,92,246,0.4)" : "rgba(239,68,68,0.4)";
  const negKbdColor = R ? "#bc8cff" : "#ef4444";

  // Class names for decisions
  const posClass = R ? "confirm" : "uphold";
  const negClass = R ? "flip" : "overturn";

  // -- Text --
  const title = R ? "Auto-Bot Review" : "Auto-Bot Judge";
  const emptyText = R
    ? "No items pending review. Check back later."
    : "No items pending judge review. Check back later.";
  const lastItemLabel = R ? "Final for audit" : "Final for appeal";
  const confirmTitle = R
    ? "Final Question for This Audit"
    : "Final Question for This Appeal";
  const confirmBody = R
    ? "This is the last item for this audit. Submitting will finalize the review."
    : "This is the last item for this appeal. Submitting will finalize the judgment.";
  const completeMsg = R ? "Audit complete" : "Appeal complete";
  const apiPath = R ? "/review/api" : "/judge/api";
  const storagePrefix = mode;
  const thinkingKey = R ? "D" : "G";
  const confettiColors = R
    ? "'#8b5cf6', '#1f6feb', '#58a6ff', '#bc8cff', '#fab005'"
    : "'#14b8a6', '#0d9488', '#2dd4bf', '#5eead4', '#fab005'";
  const posDecision = R ? "confirm" : "uphold";

  // -- Cheat sheet content (shown on ? press) --
  const cheatSheetHtml = R
    ? `<div class="cs-section">
        <div class="cs-group-label">Decide</div>
        <div class="cs-row"><kbd class="cs-pos">Y</kbd><span>Confirm</span></div>
        <div class="cs-row"><kbd class="cs-neg">N</kbd><span>Flip</span></div>
      </div>
      <div class="cs-section">
        <div class="cs-group-label">Navigate</div>
        <div class="cs-row"><kbd>B</kbd><span>Undo / Back</span></div>
        <div class="cs-row"><kbd>${thinkingKey}</kbd><span>Toggle detail</span></div>
        <div class="cs-row"><kbd>H</kbd> <kbd>L</kbd><span>Scroll cols</span></div>
        <div class="cs-row"><kbd>J</kbd> <kbd>K</kbd><span>Scroll cols (alt)</span></div>
      </div>
      <div class="cs-section">
        <div class="cs-group-label">Playback</div>
        <div class="cs-row"><kbd>P</kbd><span>Play / Pause</span></div>
        <div class="cs-row"><kbd>&larr;</kbd> <kbd>&rarr;</kbd><span>Seek (accel)</span></div>
        <div class="cs-row"><kbd>&uarr;</kbd> <kbd>&darr;</kbd><span>Speed ±0.5×</span></div>
      </div>
      <div class="cs-section">
        <div class="cs-group-label">Search</div>
        <div class="cs-row"><kbd>/</kbd><span>Find in transcript</span></div>
        <div class="cs-row"><kbd>;</kbd><span>Next match</span></div>
      </div>`
    : `<div class="cs-section">
        <div class="cs-group-label">Decide</div>
        <div class="cs-row"><kbd class="cs-pos">Y</kbd><span>Uphold</span></div>
        <div class="cs-divider"></div>
        <div class="cs-row"><kbd class="cs-neg">A</kbd><span>Error</span></div>
        <div class="cs-row"><kbd class="cs-neg">S</kbd><span>Logic</span></div>
        <div class="cs-row"><kbd class="cs-neg">D</kbd><span>Fragment</span></div>
        <div class="cs-row"><kbd class="cs-neg">F</kbd><span>Transcript</span></div>
      </div>
      <div class="cs-section">
        <div class="cs-group-label">Navigate</div>
        <div class="cs-row"><kbd>B</kbd><span>Undo / Back</span></div>
        <div class="cs-row"><kbd>${thinkingKey}</kbd><span>Toggle detail</span></div>
        <div class="cs-row"><kbd>H</kbd> <kbd>L</kbd><span>Scroll cols</span></div>
        <div class="cs-row"><kbd>J</kbd> <kbd>K</kbd><span>Scroll cols (alt)</span></div>
      </div>
      <div class="cs-section">
        <div class="cs-group-label">Playback</div>
        <div class="cs-row"><kbd>P</kbd><span>Play / Pause</span></div>
        <div class="cs-row"><kbd>&larr;</kbd> <kbd>&rarr;</kbd><span>Seek (accel)</span></div>
        <div class="cs-row"><kbd>&uarr;</kbd> <kbd>&darr;</kbd><span>Speed ±0.5×</span></div>
      </div>
      <div class="cs-section">
        <div class="cs-group-label">Search</div>
        <div class="cs-row"><kbd>/</kbd><span>Find in transcript</span></div>
        <div class="cs-row"><kbd>;</kbd><span>Next match</span></div>
      </div>`;

  // -- Verdict badge HTML --
  const verdictBadgeHtml = R
    ? `<div id="verdict-badge">Bot answered NO</div>`
    : `<div id="verdict-badge" class="badge-no">Current Answer: --</div>`;

  // -- Appeal info HTML (judge only) --
  const appealInfoHtml = R
    ? ""
    : `<div id="appeal-info" style="display:none">
        <div id="appeal-type-badge" class="appeal-badge"></div>
        <div id="appeal-comment-callout" class="appeal-callout" style="display:none"></div>
      </div>`;

  // -- Verdict badge CSS --
  const verdictBadgeCss = R
    ? `#verdict-badge {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 5px 12px; border-radius: 20px; font-size: 11px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 20px;
    background: rgba(248,81,73,0.12); color: #f85149; border: 1px solid rgba(248,81,73,0.2);
  }
  #verdict-badge::before { content: ''; display: block; width: 6px; height: 6px; border-radius: 50%; background: #f85149; }`
    : `#verdict-badge {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 5px 12px; border-radius: 20px; font-size: 11px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 20px;
  }
  #verdict-badge::before { content: ''; display: block; width: 6px; height: 6px; border-radius: 50%; }
  #verdict-badge.badge-yes { background: rgba(63,185,80,0.12); color: #3fb950; border: 1px solid rgba(63,185,80,0.2); }
  #verdict-badge.badge-yes::before { background: #3fb950; }
  #verdict-badge.badge-no { background: rgba(248,81,73,0.12); color: #f85149; border: 1px solid rgba(248,81,73,0.2); }
  #verdict-badge.badge-no::before { background: #f85149; }`;

  // -- Keyboard handler cases --
  const keydownCases = R
    ? `case 'y': decide('confirm'); break;
      case 'n': decide('flip'); break;
      case 'd': toggleThinking(); break;`
    : `case 'y': decide('uphold'); break;
      case 'a': decide('overturn', 'error'); break;
      case 's': decide('overturn', 'logic'); break;
      case 'd': decide('overturn', 'fragment'); break;
      case 'f': decide('overturn', 'transcript'); break;
      case 'g': toggleThinking(); break;`;

  // -- Toast message JS --
  const toastDecisionJs = R
    ? `toast(decision === 'confirm' ? 'Confirmed fail' : 'Flipped to pass', decision === 'confirm' ? '${posClass}' : '${negClass}');`
    : `toast(decision === 'uphold' ? 'Upheld' : 'Overturned: ' + (REASON_LABELS[reason] || reason), decision === 'uphold' ? '${posClass}' : '${negClass}');`;

  // -- Confirm preview JS --
  const confirmPreviewJs = R
    ? `preview.textContent = pendingDecision === 'confirm' ? 'Confirm fail' : 'Flip to pass';`
    : `preview.textContent = pendingDecision === 'uphold' ? 'Uphold' : 'Overturn: ' + (REASON_LABELS[pendingReason] || pendingReason);`;

  // -- Verdict badge render JS (inside renderCurrent) --
  const APPEAL_TYPE_LABELS: Record<string, string> = {
    "redo": "Redo",
    "different-recording": "Different Recording",
    "additional-recording": "Additional Recording",
    "upload-recording": "Upload",
  };

  const verdictBadgeRenderJs = R
    ? ""
    : `var badge = document.getElementById('verdict-badge');
    var isYes = isYesAnswer(currentItem.answer);
    badge.className = isYes ? 'badge-yes' : 'badge-no';
    badge.textContent = 'Current Answer: ' + (isYes ? 'YES' : 'NO');

    // Appeal info
    var appealInfo = document.getElementById('appeal-info');
    var appealTypeBadge = document.getElementById('appeal-type-badge');
    var appealCallout = document.getElementById('appeal-comment-callout');
    var APPEAL_LABELS = ${JSON.stringify(APPEAL_TYPE_LABELS)};
    if (currentItem.appealType) {
      appealInfo.style.display = '';
      appealTypeBadge.textContent = 'Appeal: ' + (APPEAL_LABELS[currentItem.appealType] || currentItem.appealType);
      if (currentItem.appealComment) {
        appealCallout.style.display = '';
        appealCallout.innerHTML = '<div class="appeal-callout-label">Team Member Comment</div>' + currentItem.appealComment.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\\n/g, '<br>');
      } else {
        appealCallout.style.display = 'none';
      }
    } else {
      appealInfo.style.display = 'none';
    }`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<script src="/js/sound-engine.js"><\/script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0a0e14; color: #c9d1d9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; height: 100vh; overflow: hidden; }

  /* ===== Layout: verdict panel (left) + transcript (right) + bottom bar ===== */
  #review-screen { display: none; height: 100vh; grid-template-columns: 380px 1fr; grid-template-rows: auto 1fr auto; overflow: hidden; }

  /* Progress bar */
  #progress-bar-container { grid-column: 1 / -1; grid-row: 1; height: 3px; background: #1a1f2b; }
  #progress-bar { height: 100%; background: linear-gradient(90deg, ${gradStart}, ${gradEnd}); width: 0%; transition: width 0.4s ease; border-radius: 0 2px 2px 0; }

  /* Left verdict panel */
  #verdict-panel {
    grid-column: 1; grid-row: 2;
    display: flex; flex-direction: column; gap: 0;
    background: #0f1219; border-right: 1px solid #1a1f2b;
    overflow: hidden;
    scrollbar-width: thin; scrollbar-color: #1e2736 transparent;
  }
  #verdict-scroll {
    flex: 1; overflow-y: auto; overflow-x: hidden;
    scrollbar-width: thin; scrollbar-color: #1e2736 transparent;
  }
  #verdict-scroll::-webkit-scrollbar { width: 4px; }
  #verdict-scroll::-webkit-scrollbar-thumb { background: #1e2736; border-radius: 2px; }
  ${R ? `
  /* Failed questions drawer (review only, inside verdict panel) */
  .ap-pill { display: flex; align-items: center; gap: 7px; padding: 6px 8px; border-radius: 6px; cursor: pointer; margin-bottom: 2px; transition: background 0.15s; font-size: 11px; color: #6e7681; }
  .ap-pill:hover { background: rgba(139,92,246,0.08); }
  .ap-pill.current { background: rgba(139,92,246,0.12); color: #c9d1d9; }
  .ap-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; background: #2d333b; }
  .ap-dot.current { background: #8b5cf6; box-shadow: 0 0 6px rgba(139,92,246,0.5); }
  .ap-dot.confirmed { background: #f85149; }
  .ap-dot.flipped { background: #3fb950; }
  .ap-hdr { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ap-num { font-size: 9px; font-weight: 700; color: #484f58; flex-shrink: 0; width: 16px; text-align: center; }
  /* Audit header (review only) */
  #audit-header { padding: 10px 16px; border-bottom: 1px solid #1a1f2b; background: #0c1018; }
  .ah-row { display: flex; align-items: baseline; gap: 8px; margin-bottom: 2px; }
  .ah-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #484f58; width: 70px; flex-shrink: 0; }
  .ah-val { font-size: 12px; color: #c9d1d9; font-weight: 500; }
  .ah-meta { display: flex; gap: 8px; margin-top: 6px; }
  .ah-badge { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; padding: 2px 6px; border-radius: 3px; }
  /* Completion overlay */
  #audit-complete-overlay { display: none; position: fixed; inset: 0; z-index: 1500; background: rgba(0,0,0,0.75); align-items: center; justify-content: center; }
  #aco-box { background: #161b22; border: 1px solid #2d333b; border-radius: 14px; padding: 32px 40px; text-align: center; min-width: 300px; }
  #aco-box h2 { font-size: 18px; color: #c9d1d9; margin: 12px 0 16px; }
  .aco-stats { display: flex; gap: 20px; justify-content: center; margin-bottom: 12px; }
  .aco-stat { font-size: 13px; color: #8b949e; }
  .aco-stat strong { color: #e6edf3; }
  #aco-next { margin-top: 16px; padding: 10px 28px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; background: #8b5cf6; border: none; color: #fff; }
  ` : ''}
  #decision-btns {
    flex-shrink: 0; display: flex; gap: 10px;
    padding: 12px 16px; border-top: 1px solid #1a1f2b;
    background: #0f1219;
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
  #q-populated { display: none; }

  /* Verdict badge */
  ${verdictBadgeCss}

  /* Appeal info (judge only) */
  #appeal-info { margin-bottom: 14px; }
  .appeal-badge {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 4px 10px; border-radius: 6px; font-size: 10px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.8px;
    background: rgba(251,191,36,0.1); color: #fbbf24; border: 1px solid rgba(251,191,36,0.2);
  }
  .appeal-callout {
    margin-top: 8px; padding: 8px 12px; border-radius: 6px; font-size: 12px; line-height: 1.5;
    background: rgba(251,191,36,0.06); border: 1px solid rgba(251,191,36,0.12); color: #d4c48a;
  }
  .appeal-callout-label {
    font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;
    color: #fbbf24; margin-bottom: 4px;
  }

  /* Defense card */
  .evidence-section { margin-bottom: 16px; }
  .evidence-label {
    font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px;
    color: ${evidenceLabel}; margin-bottom: 8px;
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
  #prompt-toggle {
    display: flex; align-items: center; gap: 6px;
    font-size: 11px; color: #6e7681; cursor: pointer; user-select: none;
    padding: 8px 0; border: none; background: none; width: 100%;
    transition: color 0.15s;
  }
  #prompt-toggle:hover { color: #8b949e; }
  #prompt-toggle .arrow { transition: transform 0.2s; font-size: 9px; }
  #prompt-toggle .arrow.open { transform: rotate(90deg); }
  #prompt-content {
    max-height: 0; overflow: hidden; transition: max-height 0.25s ease;
  }
  #prompt-content.open { max-height: 500px; }
  #prompt-text {
    font-size: 12px; line-height: 1.6; color: #8b949e; white-space: pre-wrap;
    padding: 10px 14px; background: #141820; border-radius: 10px; border: 1px solid #1a1f2b;
  }
  #thinking-text {
    font-size: 13px; line-height: 1.6; color: #8b949e;
    padding: 10px 14px; background: #141820; border-radius: 10px; border: 1px solid #1a1f2b;
    font-style: italic; margin-bottom: 12px;
  }

  /* Record Details accordion */
  #record-details-toggle {
    display: flex; align-items: center; gap: 6px;
    font-size: 11px; color: #6e7681; cursor: pointer; user-select: none;
    padding: 8px 0; border: none; background: none; width: 100%;
    transition: color 0.15s;
  }
  #record-details-toggle:hover { color: #8b949e; }
  #record-details-toggle .rd-arrow { transition: transform 0.2s; font-size: 9px; }
  #record-details-toggle .rd-arrow.open { transform: rotate(90deg); }
  #record-details-content {
    max-height: 0; overflow: hidden; transition: max-height 0.3s ease;
  }
  #record-details-content.open { max-height: 400px; }
  #record-details-body {
    padding: 12px 14px; background: #141820; border-radius: 10px; border: 1px solid #1a1f2b; margin-bottom: 4px;
    display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px;
  }
  .rd-field { font-size: 12px; color: #8b949e; line-height: 1.5; }
  .rd-field span { color: #c9d1d9; }
  .rd-check { font-size: 12px; color: #8b949e; display: flex; align-items: center; gap: 5px; }
  .rd-check.checked { color: #4ade80; }
  .rd-full { grid-column: 1 / -1; }

  /* Meta chips */
  #meta-row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; padding-top: 16px; border-top: 1px solid #1a1f2b; }
  .meta-chip {
    display: inline-flex; align-items: center; gap: 4px;
    background: #141820; border: 1px solid #1a1f2b; border-radius: 6px;
    padding: 4px 12px; font-size: 13px; color: #6e7681; white-space: nowrap;
  }
  .meta-chip strong { color: #c9d1d9; font-weight: 600; font-size: 13px; }
  /* Partner / Internal type badges inside meta row */
  .badge-pkg { display:inline-flex;align-items:center;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;background:rgba(251,191,36,0.12);color:#fbbf24;border:1px solid rgba(251,191,36,0.3); }
  .badge-dl  { display:inline-flex;align-items:center;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;background:rgba(88,166,255,0.12);color:#58a6ff;border:1px solid rgba(88,166,255,0.25); }

  /* ===== Transcript (right side) ===== */
  #transcript-panel {
    grid-column: 2; grid-row: 2;
    padding: 20px 24px; padding-right: 24px; overflow: hidden; min-height: 0;
  }
  #transcript-body {
    column-gap: 24px; column-rule: 1px solid #141820;
    column-fill: auto; height: 100%; overflow-x: scroll; overflow-y: hidden;
    scrollbar-width: thin; scrollbar-color: #2d333b transparent;
  }
  #transcript-body::-webkit-scrollbar { height: 6px; }
  #transcript-body::-webkit-scrollbar-thumb { background: #2d333b; border-radius: 3px; }
  #transcript-body::-webkit-scrollbar-track { background: transparent; }
  #col-indicator { position: fixed; bottom: 56px; right: 24px; font-size: 11px; color: #3d4452; z-index: 10; }

  .t-line {
    font-size: 13.5px; line-height: 1.75; margin-bottom: 10px; padding: 6px 10px 6px 12px;
    border-left: 3px solid transparent; color: #6e7681; break-inside: avoid;
    border-radius: 0 6px 6px 0; transition: background 0.2s;
  }
  .t-team-member { border-left-color: ${agentBorder}; color: ${agentColor}; }
  .t-guest { border-left-color: ${custBorder}; color: ${custColor}; }
  .t-system { border-left-color: #2d333b; color: #484f58; }
  .t-line.t-highlight { background: ${highlightBg}; }
  .t-line.t-evidence { background: rgba(250,176,5,0.1); border-left-color: #fab005 !important; }
  .t-line.t-evidence .t-speaker { color: #fab005 !important; }
  .t-speaker { font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; margin-right: 8px; }
  .t-team-member .t-speaker { color: ${agentSpeaker}; }
  .t-guest .t-speaker { color: ${custSpeaker}; }
  .t-system .t-speaker { color: #484f58; }

  /* ===== Bottom bar ===== */
  #bottom-bar {
    grid-column: 1 / -1; grid-row: 3;
    display: flex; align-items: center; gap: 16px;
    padding: 0 24px; background: #0f1219; border-top: 1px solid #1a1f2b;
    height: 72px;
  }

  /* Help hint (? button) */
  #help-hint {
    display: inline-flex; align-items: center; gap: 5px;
    background: none; border: 1px solid #1e2736; border-radius: 6px;
    padding: 3px 8px; color: #3d4452; font-size: 10px; cursor: pointer;
    transition: all 0.15s; white-space: nowrap; flex-shrink: 0;
  }
  #help-hint:hover { background: #141820; color: #6e7681; border-color: #2d333b; }
  #help-hint kbd {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 16px; height: 16px; padding: 0 4px;
    background: #141820; border: 1px solid #1e2736; border-radius: 3px;
    font-family: 'SF Mono', 'Fira Code', monospace; font-size: 10px; color: #6e7681;
  }

  /* Cheat sheet floating card */
  #cheat-sheet {
    display: none; position: fixed; bottom: 52px; left: 24px; z-index: 2500;
    background: #12161e; border: 1px solid #1e2736; border-radius: 12px;
    padding: 16px 20px; box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    animation: csIn 0.12s ease;
  }
  #cheat-sheet.open { display: flex; gap: 20px; }
  @keyframes csIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  .cs-section { display: flex; flex-direction: column; gap: 4px; min-width: 130px; }
  .cs-group-label {
    font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;
    color: #3d4452; margin-bottom: 2px; padding-bottom: 4px; border-bottom: 1px solid #1a1f2b;
  }
  .cs-row {
    display: flex; align-items: center; gap: 6px;
    font-size: 11px; color: #6e7681; padding: 2px 0;
  }
  .cs-row kbd {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 20px; height: 18px; padding: 0 5px;
    background: #141820; border: 1px solid #1e2736; border-radius: 4px;
    font-family: 'SF Mono', 'Fira Code', monospace; font-size: 10px; color: #8b949e;
  }
  .cs-row kbd.cs-pos { border-color: ${posKbdBorder}; color: ${posKbdColor}; }
  .cs-row kbd.cs-neg { border-color: ${negKbdBorder}; color: ${negKbdColor}; }
  .cs-divider { height: 1px; background: #1a1f2b; margin: 2px 0; }

  #bar-center { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
  #speed-tracker { font-size: 12px; color: #3d4452; font-variant-numeric: tabular-nums; }
  #speed-tracker strong { color: #6e7681; }

  #bar-right { display: flex; gap: 8px; align-items: center; flex-shrink: 0; margin-left: auto; }
  #reviewer-tag { font-size: 12px; color: #3d4452; }
  #reviewer-tag strong { color: #6e7681; }
  .bar-btn {
    background: none; border: 1px solid #1e2736; border-radius: 6px;
    padding: 4px 12px; color: #6e7681; font-size: 12px; cursor: pointer;
    transition: all 0.15s; text-transform: uppercase; letter-spacing: 0.5px;
  }
  .bar-btn:hover { background: #141820; color: #8b949e; border-color: #2d333b; }

  /* ===== Chat drawer ===== */
  #chat-drawer {
    display: none; position: fixed; bottom: 44px; right: 0; top: 0;
    width: 340px; background: #0f1219; border-left: 1px solid #1e2736;
    z-index: 3000; flex-direction: column;
    animation: chatIn 0.15s ease;
  }
  #chat-drawer.open { display: flex; }
  @keyframes chatIn { from { transform: translateX(100%); } to { transform: none; } }
  .chat-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 16px; border-bottom: 1px solid #1e2736;
    font-size: 13px; font-weight: 600; color: #e6edf3;
  }
  .chat-header button {
    background: none; border: none; color: #6e7681; cursor: pointer; font-size: 16px; padding: 2px 6px;
  }
  .chat-header button:hover { color: #e6edf3; }
  .chat-back { display: none; }
  .chat-back.show { display: inline; }
  #chat-user-list, #chat-messages {
    flex: 1; overflow-y: auto; padding: 8px; scrollbar-width: thin; scrollbar-color: #1e2736 transparent;
  }
  .chat-user-item {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 12px; border-radius: 8px; cursor: pointer;
    transition: background 0.1s;
  }
  .chat-user-item:hover { background: #141820; }
  .chat-user-avatar {
    width: 32px; height: 32px; border-radius: 50%;
    background: ${accent}22; color: ${accent};
    display: flex; align-items: center; justify-content: center;
    font-size: 12px; font-weight: 700; flex-shrink: 0;
  }
  .chat-user-info { flex: 1; min-width: 0; }
  .chat-user-name { font-size: 13px; font-weight: 600; color: #e6edf3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .chat-user-preview { font-size: 11px; color: #6e7681; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .chat-user-unread {
    background: #ef4444; color: #fff; font-size: 10px; font-weight: 700;
    min-width: 18px; height: 18px; border-radius: 9px;
    display: flex; align-items: center; justify-content: center; padding: 0 4px;
  }
  #chat-messages { display: none; flex-direction: column; gap: 4px; }
  #chat-messages.open { display: flex; }
  .chat-msg {
    max-width: 80%; padding: 8px 12px; border-radius: 12px;
    font-size: 13px; line-height: 1.4; word-wrap: break-word;
  }
  .chat-msg.sent { align-self: flex-end; background: ${accent}33; color: #e6edf3; border-bottom-right-radius: 4px; }
  .chat-msg.received { align-self: flex-start; background: #1a1f2b; color: #c9d1d9; border-bottom-left-radius: 4px; }
  .chat-msg-time { font-size: 9px; color: #484f58; margin-top: 2px; }
  #chat-input-area {
    display: none; padding: 8px 12px; border-top: 1px solid #1e2736;
    gap: 8px; align-items: center;
  }
  #chat-input-area.open { display: flex; }
  #chat-input {
    flex: 1; background: #141820; border: 1px solid #1e2736; border-radius: 8px;
    padding: 8px 12px; color: #e6edf3; font-size: 13px; outline: none;
    font-family: inherit;
  }
  #chat-input:focus { border-color: ${accent}; }
  #chat-send {
    background: ${accent}; color: #fff; border: none; border-radius: 8px;
    padding: 8px 14px; font-size: 12px; font-weight: 600; cursor: pointer;
    transition: opacity 0.15s;
  }
  #chat-send:hover { opacity: 0.85; }

  /* ===== Empty state ===== */
  #empty-state { display: none; height: 100vh; align-items: center; justify-content: center; text-align: center; background: radial-gradient(ellipse at 50% 40%, ${emptyGrad} 0%, transparent 60%); }
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
  .toast-${posClass} { background: ${posToastBg}; color: #fff; }
  .toast-${negClass} { background: ${negToastBg}; color: #fff; }
  .toast-undo { background: ${undoToastBg}; color: #fff; }
  .toast-error { background: rgba(218,54,51,0.85); color: #fff; }
  .toast-info { background: rgba(30,39,54,0.9); color: #c9d1d9; border: 1px solid #2d333b; }
  .toast-complete { background: ${completeToastBg}; color: #fff; }
  .toast-combo { background: rgba(139,92,246,0.9); color: #fff; }
  .toast-badge { background: rgba(18,22,30,0.95); color: #e6edf3; display: flex; align-items: center; gap: 10px; animation-duration: 0.2s, 0.3s; animation-delay: 0s, 3s; }
  @keyframes toastIn { from { opacity: 0; transform: translateY(6px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
  @keyframes toastOut { from { opacity: 1; } to { opacity: 0; transform: translateY(-4px); } }

  /* ===== Gamification ===== */

  /* Combo counter */
  #combo-counter {
    font-size: 12px; font-weight: 800; font-variant-numeric: tabular-nums;
    min-width: 28px; text-align: center; transition: all 0.2s; letter-spacing: -0.5px;
  }
  .combo-dim { color: #3d4452; }
  .combo-hot { color: ${comboHot}; text-shadow: 0 0 8px ${comboHotShadow}; }
  .combo-fire { color: #fab005; text-shadow: 0 0 10px rgba(250,176,5,0.5); animation: comboPulse 1.5s ease infinite; }
  .combo-inferno { color: #ef4444; text-shadow: 0 0 14px rgba(239,68,68,0.6); animation: comboPulse 0.8s ease infinite; }
  .combo-godlike { color: #a855f7; text-shadow: 0 0 18px rgba(168,85,247,0.7), 0 0 40px rgba(168,85,247,0.3); animation: comboPulse 0.5s ease infinite; }
  @keyframes comboPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.7; } }

  /* Time bank bar */
  #time-bank-bar { display: none; height: 3px; width: 100%; background: #1a1f2b; position: relative; margin-top: 2px; border-radius: 2px; overflow: hidden; }
  #time-bank-bar.active { display: block; }
  #time-bank-fill { height: 100%; width: 0%; transition: width 0.3s linear; border-radius: 2px; }
  .tb-green { background: #3fb950; }
  .tb-yellow { background: #d29922; }
  .tb-red { background: #f85149; }

  /* Game settings modal */
  #game-settings-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); backdrop-filter: blur(8px); z-index: 3000; display: none; align-items: center; justify-content: center; }
  #game-settings-overlay.open { display: flex; }
  #back-spinner { display: none; position: fixed; inset: 0; z-index: 2000; background: rgba(10,14,20,0.55); backdrop-filter: blur(2px); align-items: center; justify-content: center; flex-direction: column; gap: 10px; pointer-events: all; }
  #back-spinner.active { display: flex; }
  .back-spin-ring { width: 30px; height: 30px; border: 3px solid #1e2736; border-top-color: #58a6ff; border-radius: 50%; animation: back-spin 0.65s linear infinite; }
  @keyframes back-spin { to { transform: rotate(360deg); } }
  @keyframes spin { to { transform: rotate(360deg); } }
  .gs-modal { background: #111620; border: 1px solid #1c2333; border-radius: 16px; width: 400px; max-width: 92vw; padding: 24px 28px 20px; box-shadow: 0 16px 48px rgba(0,0,0,0.4); }
  .gs-modal h3 { font-size: 15px; font-weight: 700; color: #e6edf3; margin-bottom: 16px; }
  .gs-field { margin-bottom: 14px; }
  .gs-field label { display: block; font-size: 9px; color: #6e7681; text-transform: uppercase; letter-spacing: 0.8px; font-weight: 600; margin-bottom: 4px; }
  .gs-radio { display: flex; gap: 8px; align-items: center; margin-bottom: 4px; }
  .gs-radio input[type="radio"] { accent-color: ${accent}; }
  .gs-radio span { font-size: 11px; color: #c9d1d9; }
  .gs-radio .gs-inherit-val { color: #6e7681; font-style: italic; }
  .gs-input { width: 80px; padding: 5px 8px; background: #0b0f15; border: 1px solid #1c2333; border-radius: 5px; color: #c9d1d9; font-size: 11px; font-family: var(--mono, monospace); }
  .gs-select { padding: 5px 8px; background: #0b0f15; border: 1px solid #1c2333; border-radius: 5px; color: #c9d1d9; font-size: 11px; }
  .gs-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 18px; padding-top: 14px; border-top: 1px solid #1c2333; }
  .gs-btn { padding: 6px 16px; border: none; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer; }
  .gs-btn.primary { background: ${accent}; color: #fff; }
  .gs-btn.ghost { background: transparent; color: #6e7681; border: 1px solid #1c2333; }

  /* Kill streak banner */
  .streak-banner {
    position: fixed; top: 18%; left: 50%; transform: translate(-50%, 0) scale(0.5);
    font-size: 28px; font-weight: 900; text-transform: uppercase; letter-spacing: 3px;
    z-index: 2000; pointer-events: none; opacity: 0;
    text-shadow: 0 0 30px currentColor, 0 2px 0 rgba(0,0,0,0.5);
    padding: 12px 32px; border-radius: 12px;
    background: rgba(11,15,21,0.65); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
    animation: streakBannerIn 0.15s ease forwards, streakBannerOut 0.3s ease 0.9s forwards;
  }
  @keyframes streakBannerIn { to { opacity: 1; transform: translate(-50%, 0) scale(1); } }
  @keyframes streakBannerOut { to { opacity: 0; transform: translate(-50%, -30%) scale(1.1); } }
  .streak-banner.s-double { color: ${streakDouble}; }
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
    color: ${floatXp}; z-index: 2000; animation: floatUp 0.5s ease forwards;
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
    height: 100%; background: linear-gradient(90deg, ${gradStart}, ${gradEnd});
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
  .ap { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; }
  .ap-play {
    width: 22px; height: 22px; border-radius: 50%; border: none; cursor: pointer;
    background: ${btnAccent}; color: #fff; display: flex; align-items: center; justify-content: center;
    transition: all 0.15s; flex-shrink: 0; padding: 0;
  }
  .ap-play:hover { background: ${btnHover}; box-shadow: 0 0 8px ${btnShadow}; }
  .ap-play svg { width: 9px; height: 9px; fill: #fff; }
  #ap-waveform { flex: 1; min-width: 0; height: 48px; cursor: pointer; border-radius: 3px; display: block; }
  .ap-time { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px; color: #8b949e; white-space: nowrap; }
  .ap-seek {
    background: #141820; border: 1px solid #1e2736; border-radius: 4px;
    color: #6e7681; cursor: pointer; font-size: 10px; padding: 2px 6px;
    font-family: 'SF Mono', 'Fira Code', monospace; transition: all 0.15s;
  }
  .ap-seek:hover { background: #1a1f2b; color: #8b949e; border-color: #2d333b; }

  /* Transcript search overlay */
  #transcript-panel { position: relative; }
  #transcript-search {
    position: absolute; top: 0; left: 0; right: 0; z-index: 20;
    display: none; align-items: center; gap: 8px;
    padding: 8px 16px; background: rgba(15,18,25,0.95); backdrop-filter: blur(8px);
    border-bottom: 1px solid #1e2736;
  }
  #transcript-search.open { display: flex; }
  #search-input {
    flex: 1; background: #0a0e14; border: 1px solid #1e2736; border-radius: 6px;
    padding: 6px 10px; color: #c9d1d9; font-size: 13px; font-family: inherit;
    outline: none; transition: border-color 0.15s;
  }
  #search-input:focus { border-color: ${accent}; }
  #search-count { font-size: 11px; color: #484f58; white-space: nowrap; font-variant-numeric: tabular-nums; min-width: 52px; text-align: right; }
  #search-close {
    background: none; border: none; color: #484f58; cursor: pointer; font-size: 14px;
    padding: 2px 6px; border-radius: 4px; transition: color 0.15s, background 0.15s;
  }
  #search-close:hover { color: #c9d1d9; background: #141820; }
  .t-search-match { background: rgba(250,176,5,0.18) !important; }
  .t-search-active { background: rgba(250,176,5,0.35) !important; outline: 1px solid rgba(250,176,5,0.5); outline-offset: -1px; }

  /* Skip tier indicator */
  #skip-indicator {
    display: flex; align-items: center; gap: 5px; opacity: 0;
    transition: opacity 0.25s ease; pointer-events: none;
  }
  #skip-indicator.visible { opacity: 1; }
  #skip-label {
    font-family: 'SF Mono', 'Fira Code', monospace; font-size: 9px; font-weight: 700;
    color: ${accent}; white-space: nowrap; min-width: 22px; text-align: right;
  }
  #skip-bar-wrap {
    width: 36px; height: 4px; background: #1a1f2b; border-radius: 2px; overflow: hidden;
  }
  #skip-bar {
    height: 100%; width: 0%; border-radius: 2px;
    background: linear-gradient(90deg, ${gradStart}, ${gradEnd});
    transition: width 0.08s ease;
  }
  #skip-bar.decaying { transition: width 1s linear; }

  /* Sound toggle */
  .sound-toggle { font-size: 13px; line-height: 1; padding: 3px 6px !important; }

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

  /* Last-item indicator */
  .meta-chip.last-item {
    background: rgba(250,176,5,0.12); border-color: rgba(250,176,5,0.25); color: #fab005;
    animation: lastPulse 2s ease infinite;
  }
  .meta-chip.last-item strong { color: #fab005; }
  @keyframes lastPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.7; } }

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
  #confirm-input:focus { outline: none; border-color: ${accent}; box-shadow: 0 0 0 3px ${confirmShadow}; }
  #confirm-actions { display: flex; gap: 8px; margin-top: 16px; justify-content: flex-end; }
  #confirm-actions button { padding: 8px 20px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.15s; }
  #confirm-cancel-btn { background: transparent; border: 1px solid #1e2736; color: #6e7681; }
  #confirm-cancel-btn:hover { background: #141820; border-color: #2d333b; }
  #confirm-submit-btn { background: ${accent}; border: none; color: #fff; opacity: 0.3; pointer-events: none; }
  #confirm-submit-btn.enabled { opacity: 1; pointer-events: auto; }
  #confirm-submit-btn.enabled:hover { background: ${accentDark}; }

</style>
<style>@keyframes bot-pulse { 0%,100%{opacity:0.5;transform:scale(0.95)} 50%{opacity:1;transform:scale(1.05)} }</style>
</head>
<body>

<!-- Loading overlay -->
<div id="init-overlay" style="position:fixed;inset:0;z-index:9999;background:#0d1117;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;transition:opacity 0.4s;">
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none" style="width:52px;height:52px;animation:bot-pulse 1.4s ease-in-out infinite;">
    <rect x="4" y="9" width="24" height="19" rx="4" fill="#0d1117"/>
    <rect x="4" y="9" width="24" height="19" rx="4" fill="none" stroke="#3fb950" stroke-width="1.5"/>
    <circle cx="12" cy="18" r="2.5" fill="#3fb950" opacity="0.9"/>
    <circle cx="20" cy="18" r="2.5" fill="#3fb950" opacity="0.9"/>
    <rect x="13.5" y="23" width="5" height="1.5" rx="0.75" fill="#3fb950" opacity="0.7"/>
    <rect x="14" y="5" width="4" height="4" rx="1" fill="#3fb950" opacity="0.6"/>
    <rect x="15.5" y="4" width="1" height="2" rx="0.5" fill="#3fb950" opacity="0.5"/>
    <circle cx="3.5" cy="17.5" r="1.5" fill="#3fb950" opacity="0.55"/>
    <circle cx="28.5" cy="17.5" r="1.5" fill="#3fb950" opacity="0.55"/>
  </svg>
  <div style="color:#3fb950;font-size:13px;font-weight:600;letter-spacing:0.5px;">Loading...</div>
</div>

<!-- Queue screen -->
<div id="review-screen">
  <div id="progress-bar-container"><div id="progress-bar"></div></div>

  <!-- Left: Verdict panel -->
  <div id="verdict-panel">
    ${R ? `
    <!-- Audit header (review only) -->
    <div id="audit-header">
      <div class="ah-row"><span class="ah-label">Guest</span><span class="ah-val" id="ah-guest">--</span></div>
      <div class="ah-row"><span class="ah-label">TM</span><span class="ah-val" id="ah-vo">--</span></div>
      <div class="ah-row"><span class="ah-label">Record</span><span class="ah-val" id="ah-rid">--</span></div>
      <div class="ah-meta">
        <span class="ah-badge" id="ah-type-badge" style="background:rgba(139,92,246,0.15);color:#8b5cf6;">--</span>
        <span class="ah-badge" id="ah-failed-badge" style="background:rgba(248,81,73,0.15);color:#f85149;">--</span>
      </div>
    </div>
    ` : ''}
    <div id="verdict-scroll">
      <div id="verdict-content">
        <div id="q-label">Question</div>
        <div id="q-header"></div>
        ${verdictBadgeHtml}
        ${appealInfoHtml}
        <div id="q-populated"></div>

        <div class="evidence-section">
          <div class="evidence-label">Defense</div>
          <div class="evidence-text" id="q-defense"></div>
        </div>

        <button id="thinking-toggle">
          <span class="arrow">${icons.chevronRight}</span>
          <span>Bot reasoning</span>
          <span style="margin-left:auto; font-size:10px; color:#3d4452"><kbd style="background:#141820;border:1px solid #1e2736;border-radius:3px;padding:0 4px;font-family:monospace;font-size:10px;color:#6e7681">${thinkingKey}</kbd></span>
        </button>
        <div id="thinking-content">
          <div id="thinking-text"></div>
        </div>

        <button id="prompt-toggle">
          <span class="arrow">${icons.chevronRight}</span>
          <span>Question prompt</span>
        </button>
        <div id="prompt-content">
          <div id="prompt-text"></div>
        </div>

        <button id="record-details-toggle">
          <span class="rd-arrow">${icons.chevronRight}</span>
          <span>Record Details</span>
        </button>
        <div id="record-details-content">
          <div id="record-details-body"></div>
        </div>

        ${R ? `
        <button id="failed-q-toggle" style="display:none;width:100%;padding:8px 12px;background:none;border:none;border-top:1px solid #1a1f2b;color:#6e7681;font-size:11px;font-weight:600;cursor:pointer;text-align:left;display:flex;align-items:center;gap:6px;">
          <span class="rd-arrow" id="fq-arrow">${icons.chevronRight}</span>
          <span>Failed Questions</span>
          <span id="fq-count" style="margin-left:auto;font-size:10px;color:#484f58;">0</span>
        </button>
        <div id="failed-q-content" style="max-height:0;overflow:hidden;transition:max-height 0.25s ease;">
          <div id="ap-list" style="padding:4px 8px 8px;"></div>
        </div>
        ` : ''}

        <div id="meta-row">
          <a class="meta-chip" id="m-report-link" href="#" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;" title="Open audit report">Audit <strong id="m-finding" style="color:#a371f7;"></strong></a>
          <div class="meta-chip" id="m-type-chip" style="display:none"></div>
          <a class="meta-chip" id="m-record-link" href="#" target="_blank" rel="noopener" style="display:none;color:inherit;text-decoration:none;" title="Open in CRM">Record <strong id="m-record-id" style="color:#58a6ff;"></strong></a>
          <button id="m-jump-audio" class="meta-chip" style="background:rgba(20,184,166,0.08);border-color:rgba(20,184,166,0.3);color:#2dd4bf;cursor:pointer;display:none;" title="Scroll to graded snippet and play (J)">▶ Jump to Audio</button>
          ${!R ? `<div class="meta-chip" id="m-reviewer" style="display:none;">Reviewer <strong id="m-reviewer-name" style="color:#fbbf24;"></strong></div>` : ''}
          <div class="meta-chip last-item" id="m-last" style="display:none"><strong>${lastItemLabel}</strong></div>
        </div>
      </div>
    </div>
    ${R ? `
    <div id="decision-btns" style="position:relative;">
      <div id="btn-loading-overlay" style="display:none;position:absolute;inset:0;background:rgba(10,10,15,0.82);border-radius:8px;z-index:10;align-items:center;justify-content:center;gap:8px;color:#8b949e;font-size:12px;font-weight:600;letter-spacing:0.5px;">
        <span style="display:inline-block;animation:spin 0.7s linear infinite;font-size:16px;">⟳</span>
        Processing...
      </div>
      <button id="btn-confirm" class="decide-btn" onclick="decide('confirm')" title="Confirm bot was right — keep as No (Y)"
        style="flex:1;display:flex;align-items:center;justify-content:center;gap:8px;padding:10px 0;border-radius:8px;border:1px solid rgba(139,92,246,0.35);background:rgba(139,92,246,0.1);color:#bc8cff;font-size:13px;font-weight:700;cursor:pointer;transition:all 0.15s;">
        <kbd style="background:#1a1427;border:1px solid rgba(139,92,246,0.4);border-radius:3px;padding:1px 5px;font-size:11px;color:#8b5cf6;font-family:monospace;">Y</kbd>
        Confirm No
      </button>
      <button id="btn-flip" class="decide-btn" onclick="decide('flip')" title="Flip — bot was wrong, change to Yes (N)"
        style="flex:1;display:flex;align-items:center;justify-content:center;gap:8px;padding:10px 0;border-radius:8px;border:1px solid rgba(34,197,94,0.35);background:rgba(34,197,94,0.08);color:#4ade80;font-size:13px;font-weight:700;cursor:pointer;transition:all 0.15s;">
        <kbd style="background:#0f1a14;border:1px solid rgba(34,197,94,0.4);border-radius:3px;padding:1px 5px;font-size:11px;color:#22c55e;font-family:monospace;">N</kbd>
        Flip to Yes
      </button>
    </div>` : `
    <div id="decision-btns" style="flex-direction:column;gap:8px;position:relative;">
      <div id="btn-loading-overlay" style="display:none;position:absolute;inset:0;background:rgba(10,10,15,0.82);border-radius:8px;z-index:10;align-items:center;justify-content:center;gap:8px;color:#8b949e;font-size:12px;font-weight:600;letter-spacing:0.5px;">
        <span style="display:inline-block;animation:spin 0.7s linear infinite;font-size:16px;">⟳</span>
        Processing...
      </div>
      <button class="decide-btn" onclick="decide('uphold')" title="Uphold — bot was right, keep as No (Y)"
        style="display:flex;align-items:center;justify-content:center;gap:8px;padding:9px 0;border-radius:8px;border:1px solid rgba(20,184,166,0.35);background:rgba(20,184,166,0.08);color:#2dd4bf;font-size:13px;font-weight:700;cursor:pointer;transition:all 0.15s;">
        <kbd style="background:#0a1e1c;border:1px solid rgba(20,184,166,0.4);border-radius:3px;padding:1px 5px;font-size:11px;color:#14b8a6;font-family:monospace;">Y</kbd>
        Uphold
      </button>
      <div style="display:flex;gap:8px;">
        <button class="decide-btn" onclick="decide('overturn','error')" title="Overturn: Error (A)"
          style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:8px 0;border-radius:8px;border:1px solid rgba(248,81,73,0.3);background:rgba(248,81,73,0.07);color:#f85149;font-size:12px;font-weight:700;cursor:pointer;transition:all 0.15s;">
          <kbd style="background:#1a0f0e;border:1px solid rgba(248,81,73,0.35);border-radius:3px;padding:1px 4px;font-size:10px;color:#f85149;font-family:monospace;">A</kbd>
          Error
        </button>
        <button class="decide-btn" onclick="decide('overturn','logic')" title="Overturn: Logic (S)"
          style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:8px 0;border-radius:8px;border:1px solid rgba(248,81,73,0.3);background:rgba(248,81,73,0.07);color:#f85149;font-size:12px;font-weight:700;cursor:pointer;transition:all 0.15s;">
          <kbd style="background:#1a0f0e;border:1px solid rgba(248,81,73,0.35);border-radius:3px;padding:1px 4px;font-size:10px;color:#f85149;font-family:monospace;">S</kbd>
          Logic
        </button>
        <button class="decide-btn" onclick="decide('overturn','fragment')" title="Overturn: Fragment (D)"
          style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:8px 0;border-radius:8px;border:1px solid rgba(248,81,73,0.3);background:rgba(248,81,73,0.07);color:#f85149;font-size:12px;font-weight:700;cursor:pointer;transition:all 0.15s;">
          <kbd style="background:#1a0f0e;border:1px solid rgba(248,81,73,0.35);border-radius:3px;padding:1px 4px;font-size:10px;color:#f85149;font-family:monospace;">D</kbd>
          Fragment
        </button>
        <button class="decide-btn" onclick="decide('overturn','transcript')" title="Overturn: Transcript (F)"
          style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:8px 0;border-radius:8px;border:1px solid rgba(248,81,73,0.3);background:rgba(248,81,73,0.07);color:#f85149;font-size:12px;font-weight:700;cursor:pointer;transition:all 0.15s;">
          <kbd style="background:#1a0f0e;border:1px solid rgba(248,81,73,0.35);border-radius:3px;padding:1px 4px;font-size:10px;color:#f85149;font-family:monospace;">F</kbd>
          Transcript
        </button>
      </div>
      <button id="btn-dismiss-appeal" onclick="openDismissModal()" title="Dismiss this appeal entirely"
        style="display:flex;align-items:center;justify-content:center;gap:6px;padding:7px 0;border-radius:8px;border:1px solid rgba(139,148,158,0.3);background:rgba(139,148,158,0.06);color:#8b949e;font-size:11px;font-weight:600;cursor:pointer;transition:all 0.15s;width:100%;">
        Dismiss Appeal
      </button>
      <button id="btn-add-genie" onclick="openAddGenieModal()" title="Submit additional or different Genie recording"
        style="display:flex;align-items:center;justify-content:center;gap:6px;padding:7px 0;border-radius:8px;border:1px solid rgba(251,191,36,0.3);background:rgba(251,191,36,0.06);color:#fbbf24;font-size:11px;font-weight:600;cursor:pointer;transition:all 0.15s;width:100%;">
        + Add 2nd Genie / Different Recording
      </button>
    </div>`}
  </div>

  <!-- Right: Transcript -->
  <div id="transcript-panel">
    <div id="transcript-search">
      <input type="text" id="search-input" placeholder="Search transcript..." autocomplete="off" spellcheck="false">
      <span id="search-count"></span>
      <button id="search-close">&times;</button>
    </div>
    <div id="transcript-body"></div>
    <div id="col-indicator"></div>
  </div>

  <!-- Cheat sheet (floating, toggled by ?) -->
  <div id="cheat-sheet">
    ${cheatSheetHtml}
  </div>

  <!-- Bottom bar -->
  <div id="bottom-bar">
    <button id="help-hint" title="Keyboard shortcuts"><kbd>?</kbd> Keys</button>
    <div class="ap" id="audio-player">
      <audio id="rec-audio" preload="metadata" style="display:none"></audio>
      <button class="ap-play" id="ap-play" title="Play recording" tabindex="-1">
        <span id="ap-icon-play">${icons.play16}</span>
        <span id="ap-icon-pause" style="display:none">${icons.pause16}</span>
      </button>
      <button class="ap-seek" id="ap-back" title="Back 5s (Left arrow)">&larr;5s</button>
      <canvas id="ap-waveform"></canvas>
      <button class="ap-seek" id="ap-fwd" title="Forward 5s (Right arrow)">5s&rarr;</button>
      <span class="ap-time" id="ap-time">0:00</span>
      <span id="ap-speed" title="Playback speed (↑/↓)" style="visibility:hidden;font-size:10px;color:#6e7681;font-variant-numeric:tabular-nums;white-space:nowrap;border:1px solid #1e2736;border-radius:4px;padding:1px 5px;cursor:default;width:30px;text-align:center;flex-shrink:0;">1.0×</span>
      <div id="skip-indicator"><span id="skip-label"></span><div id="skip-bar-wrap"><div id="skip-bar"></div></div></div>
    </div>
    <div id="bar-center">
      <span id="combo-counter" class="combo-dim"></span>
      <div id="time-bank-bar"><div id="time-bank-fill" class="tb-green"></div></div>
      <div id="speed-tracker">avg <strong id="speed-avg">--</strong>s</div>
      <span id="session-count">0 today</span>
    </div>
    <div id="bar-right">
      <span id="level-badge">Lv.1 <span id="xp-bar-wrap"><span id="xp-bar"></span></span> <span id="xp-display">0xp</span></span>
      <span id="streak-badge"></span>
      <span id="reviewer-tag"></span>
      ${R ? `<select id="type-filter" title="Filter by audit type" style="font-size:10px;padding:2px 6px;cursor:pointer;background:var(--bg-raised,#161b22);color:#8b949e;border:1px solid #21262d;border-radius:6px;height:26px;"><option value="">All Types</option><option value="date-leg">Internal</option><option value="package">Partner</option></select>` : ""}
      <a class="bar-btn" href="${R ? "/review/dashboard" : "/judge/dashboard"}" style="text-decoration:none">Dashboard</a>
      <button class="bar-btn" id="chat-toggle" title="Messages" style="position:relative">${icons.messageCircle}<span id="chat-badge" style="display:none;position:absolute;top:-4px;right:-4px;background:#ef4444;color:#fff;font-size:9px;font-weight:700;min-width:14px;height:14px;border-radius:7px;display:none;align-items:center;justify-content:center;padding:0 3px">0</span></button>
      <button class="bar-btn sound-toggle" id="sound-toggle" title="Toggle sound">${icons.volumeOff}</button>
      <button class="bar-btn" id="game-settings-btn" title="Gamification settings">${icons.settingsSmall}</button>
      <button class="bar-btn" id="logout-btn">Logout</button>
    </div>
  </div>
</div>

<!-- Empty state -->
<div id="empty-state">
  <div>
    <h2>All caught up</h2>
    <p id="empty-default">${emptyText}</p>
    <div id="session-summary" style="display:none">
      <div id="summary-stats"></div>
    </div>
    <div id="confetti-container"></div>
    <a href="${mode === 'judge' ? '/judge/dashboard' : '/review/dashboard'}" style="display:inline-block;margin-top:18px;padding:8px 20px;border-radius:8px;border:1px solid #1e2736;background:#12161e;color:#8b949e;font-size:12px;font-weight:600;text-decoration:none;transition:all 0.15s;" onmouseover="this.style.borderColor='#2d333b';this.style.color='#c9d1d9';" onmouseout="this.style.borderColor='#1e2736';this.style.color='#8b949e';">← Dashboard</a>
  </div>
</div>

<!-- Toasts -->
<div id="toast-container"></div>

<!-- Confirmation modal for last audit question -->
<div id="confirm-overlay">
  <div id="confirm-box">
    <h3>${confirmTitle}</h3>
    <p>${confirmBody}</p>
    <div id="confirm-action-preview" style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:8px;font-size:12px;font-weight:700;margin-bottom:16px;background:${previewBg};border:1px solid ${previewBorder};color:${accentLight}"></div>
    <div class="confirm-label">Type YES to proceed</div>
    <input type="text" id="confirm-input" autocomplete="off" spellcheck="false">
    <div id="confirm-actions">
      <button id="confirm-cancel-btn">Cancel</button>
      <button id="confirm-submit-btn">Submit</button>
    </div>
  </div>
</div>

${!R ? `<!-- Add Genie modal (judge only) -->
<div id="add-genie-overlay" style="display:none;position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,0.75);align-items:center;justify-content:center;">
  <div style="background:#161b22;border:1px solid #2d333b;border-radius:12px;padding:24px;width:460px;max-width:90vw;">
    <h3 style="font-size:15px;font-weight:700;margin-bottom:12px;color:#c9d1d9;">Add 2nd Genie / Different Recording</h3>
    <!-- Mode toggle -->
    <div style="display:flex;background:#0a0e14;border:1px solid #1e2736;border-radius:6px;padding:3px;gap:3px;margin-bottom:16px;">
      <button id="add-genie-mode-genie" onclick="setAddGenieMode('genie')" style="flex:1;background:#161b22;border:none;border-radius:4px;color:#c9d1d9;font-size:11px;font-weight:600;padding:5px 0;cursor:pointer;">Genie ID(s)</button>
      <button id="add-genie-mode-upload" onclick="setAddGenieMode('upload')" style="flex:1;background:none;border:none;border-radius:4px;color:#6e7681;font-size:11px;font-weight:600;padding:5px 0;cursor:pointer;">Upload Recording</button>
    </div>
    <!-- Genie ID panel -->
    <div id="add-genie-panel-genie">
      <p style="font-size:12px;color:#8b949e;margin-bottom:10px;">First row is pre-filled with the original Genie ID. Add a second row to include an additional or replacement recording.</p>
      <div style="font-size:11px;color:#6e7681;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.8px;font-weight:600;">Genie ID(s)</div>
      <div id="add-genie-rows" style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px;"></div>
      <button id="add-genie-add-row" onclick="addGenieRow()" style="font-size:11px;color:#14b8a6;background:none;border:none;cursor:pointer;padding:2px 0;margin-bottom:12px;text-align:left;">+ Add Another</button>
    </div>
    <!-- Upload panel -->
    <div id="add-genie-panel-upload" style="display:none;">
      <p style="font-size:12px;color:#8b949e;margin-bottom:10px;">Upload an MP3 recording to re-audit against. Optionally trim the audio with start/end markers.</p>
      <div style="font-size:11px;color:#6e7681;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.8px;font-weight:600;">Recording File (MP3)</div>
      <div id="add-genie-dropzone" onclick="document.getElementById('add-genie-file').click()"
        style="width:100%;padding:18px;background:#0a0e14;border:2px dashed #1e2736;border-radius:8px;color:#6e7681;font-size:12px;margin-bottom:10px;box-sizing:border-box;cursor:pointer;text-align:center;transition:border-color 0.15s,background 0.15s;">
        <div id="add-genie-dropzone-label">Drop MP3 here or click to browse</div>
      </div>
      <input type="file" id="add-genie-file" accept="audio/mpeg,audio/mp3,.mp3" style="display:none;">
      <div style="display:flex;gap:8px;margin-bottom:12px;">
        <div style="flex:1;">
          <div style="font-size:11px;color:#6e7681;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.8px;font-weight:600;">Snip Start (mm:ss)</div>
          <input type="text" id="add-genie-snip-start" placeholder="e.g. 0:30" autocomplete="off"
            style="width:100%;padding:8px 10px;background:#0a0e14;border:1px solid #1e2736;border-radius:8px;color:#c9d1d9;font-size:13px;box-sizing:border-box;outline:none;">
        </div>
        <div style="flex:1;">
          <div style="font-size:11px;color:#6e7681;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.8px;font-weight:600;">Snip End (mm:ss)</div>
          <input type="text" id="add-genie-snip-end" placeholder="e.g. 5:00" autocomplete="off"
            style="width:100%;padding:8px 10px;background:#0a0e14;border:1px solid #1e2736;border-radius:8px;color:#c9d1d9;font-size:13px;box-sizing:border-box;outline:none;">
        </div>
      </div>
    </div>
    <!-- Shared comment + actions -->
    <div style="font-size:11px;color:#6e7681;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.8px;font-weight:600;">Comment (optional)</div>
    <input type="text" id="add-genie-comment" autocomplete="off" spellcheck="false" placeholder="Reason for re-audit..."
      style="width:100%;padding:10px 14px;background:#0a0e14;border:1px solid #1e2736;border-radius:8px;color:#c9d1d9;font-size:14px;margin-bottom:16px;outline:none;box-sizing:border-box;">
    <div id="add-genie-error" style="display:none;color:#f85149;font-size:12px;margin-bottom:12px;"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button onclick="closeAddGenieModal()" style="padding:8px 20px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;background:transparent;border:1px solid #1e2736;color:#6e7681;">Cancel</button>
      <button id="add-genie-submit" onclick="submitAddGenie()" style="padding:8px 20px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;background:#14b8a6;border:none;color:#fff;">Submit</button>
    </div>
  </div>
</div>

<!-- Dismiss Appeal modal (judge only) -->
<div id="dismiss-appeal-overlay" style="display:none;position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,0.75);align-items:center;justify-content:center;">
  <div style="background:#161b22;border:1px solid #2d333b;border-radius:12px;padding:24px;width:420px;max-width:90vw;">
    <h3 style="font-size:15px;font-weight:700;margin-bottom:8px;color:#c9d1d9;">Dismiss Appeal</h3>
    <p style="font-size:12px;color:#8b949e;line-height:1.5;margin-bottom:16px;">
      This will remove all pending judge items for this finding, delete the appeal record (making it re-appealable), and send a dismissal notification email.
    </p>
    <div style="font-size:11px;color:#6e7681;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.8px;font-weight:600;">Reason for dismissal</div>
    <textarea id="dismiss-reason" rows="3" placeholder="Enter reason for dismissal..."
      style="width:100%;padding:10px 12px;background:#0a0e14;border:1px solid #1e2736;border-radius:8px;color:#c9d1d9;font-size:13px;box-sizing:border-box;outline:none;resize:vertical;font-family:inherit;"></textarea>
    <div id="dismiss-error" style="display:none;color:#f85149;font-size:12px;margin-top:8px;"></div>
    <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end;">
      <button onclick="closeDismissModal()" style="padding:8px 20px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;background:transparent;border:1px solid #1e2736;color:#6e7681;">Cancel</button>
      <button id="dismiss-submit" onclick="submitDismissAppeal()" style="padding:8px 20px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;background:rgba(139,148,158,0.15);border:1px solid rgba(139,148,158,0.3);color:#c9d1d9;">Confirm Dismiss</button>
    </div>
  </div>
</div>` : ''}

<!-- Back/undo loading spinner -->
<div id="back-spinner">
  <div class="back-spin-ring"></div>
  <span style="font-size:12px;color:#6e7681;letter-spacing:0.3px;">Going back…</span>
</div>

${R ? `
<!-- Audit completion overlay (review only) -->
<div id="audit-complete-overlay">
  <div id="aco-box">
    <div style="font-size:32px;">&#9989;</div>
    <h2>Audit Reviewed</h2>
    <div class="aco-stats">
      <span class="aco-stat"><strong id="aco-confirms">0</strong> confirmed</span>
      <span class="aco-stat"><strong id="aco-flips">0</strong> flipped</span>
    </div>
    <div style="font-size:14px;color:#8b949e;margin-bottom:4px;">Score: <strong id="aco-score" style="color:#e6edf3;">--%</strong></div>
    <button id="aco-next" onclick="window._acoNext()">Next Audit</button>
  </div>
</div>
` : ''}

<!-- Game settings modal -->
<div id="game-settings-overlay">
  <div class="gs-modal">
    <h3>Gamification Settings</h3>
    <div class="gs-field">
      <label>Threshold (seconds per question)</label>
      <div class="gs-radio">
        <input type="radio" name="gs-threshold" id="gs-threshold-inherit" value="inherit" checked>
        <span>Inherit <span class="gs-inherit-val" id="gs-threshold-team"></span></span>
      </div>
      <div class="gs-radio">
        <input type="radio" name="gs-threshold" id="gs-threshold-custom" value="custom">
        <span>Custom: <input type="number" class="gs-input" id="gs-threshold-val" min="0" max="60" value="0"></span>
      </div>
    </div>
    <div class="gs-field">
      <label>Sound Pack</label>
      <div class="gs-radio">
        <input type="radio" name="gs-sounds" id="gs-sounds-inherit" value="inherit" checked>
        <span>Inherit <span class="gs-inherit-val" id="gs-sounds-team"></span></span>
      </div>
      <div class="gs-radio">
        <input type="radio" name="gs-sounds" id="gs-sounds-custom" value="custom">
        <span>Custom: <select class="gs-select" id="gs-sounds-val">
          <option value="synth">Synth (default)</option>
          <option value="smite">SMITE</option>
          <option value="opengameart">OpenGameArt</option>
          <option value="mixkit-punchy">Mixkit Punchy</option>
          <option value="mixkit-epic">Mixkit Epic</option>
        </select></span>
      </div>
    </div>
    <div class="gs-actions">
      <button class="gs-btn ghost" id="gs-cancel">Cancel</button>
      <button class="gs-btn primary" id="gs-save">Save</button>
    </div>
  </div>
</div>

<script>
(function() {
  var MODE = '${mode}';
  var API = '${apiPath}';
  var STORAGE_PREFIX = '${storagePrefix}';
  var GAME_CONFIG = ${gamificationJson || '{"threshold":0,"comboTimeoutMs":10000,"enabled":true,"sounds":{}}'};
  var POSITIVE_DECISION = '${posDecision}';
  var buffer = []; // flat array of BufferItems, each with auditRemaining + transcript
  var reviewer = null;
  var busy = false;
  var pendingDecision = null;
  var pendingReason = null;
  var inflightFids = {}; // findingId → count of in-flight decisions for that finding
  var REASON_LABELS = { error: 'Error', logic: 'Logic', fragment: 'Fragment', transcript: 'Transcript' };
  // Type filter (reviewer mode only)
  var judgeAllowedTypes = ['date-leg', 'package']; // updated from /next response
  var selfTypeFilter = ''; // '' = no self-filter (show all judge-allowed)
  var transcriptCache = {};

  // Audit ownership state (review mode only)
  var auditItems = [];       // all items for current audit
  var auditDecisions = {};   // { questionIndex: 'confirm'|'flip' }
  var currentAuditIdx = 0;   // index into auditItems
  var auditFindingId = null; // findingId for current audit

  // QuickBase record URL bases
  var QB_REALM = '${env.qbRealm}';
  var QB_DATE_TABLE = 'bpb28qsnn';
  var QB_PKG_TABLE  = 'bttffb64u';

  // Playback speed (↑/↓)
  var playbackRate = 1.0;

  // Transcript search state
  var searchMatches = [];
  var searchIndex = -1;
  var searchOpen = false;

  // Accelerating skip state
  var SKIP_TIERS = [1, 5, 10];
  var skipTier = 0;
  var skipLastPressTs = 0;
  var skipDecayTimer = null;
  var skipFadeTimer = null;

  // Speed tracking
  var decisionTimes = [];
  var lastDecisionTs = null;
  var totalDecided = 0;
  var totalItems = 0;

  // Gamification state
  var LEVEL_THRESHOLDS = [0, 100, 300, 600, 1100, 2000, 3500, 5500, 8000, 12000];
  var COMBO_TIMEOUT = GAME_CONFIG.comboTimeoutMs || 10000;
  var STREAK_THRESHOLD = GAME_CONFIG.threshold || 0;
  var combo = 0;
  var lastReviewTs = 0;
  var timeBank = 0;
  var timeBankAnimFrame = null;
  var sessionReviews = 0;
  var sessionXpGained = 0;
  var bestCombo = 0;
  var comboDropped = false;
  SoundEngine.init(GAME_CONFIG.sounds || {}, GAME_CONFIG.packRegistry || {});

  var $review = document.getElementById('review-screen');
  var $empty = document.getElementById('empty-state');

  // -- Toast --
  function toast(msg, type) {
    type = type || 'info';
    var el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.textContent = msg;
    document.getElementById('toast-container').appendChild(el);
    setTimeout(function() { el.remove(); }, 1400);
  }

  var BADGE_TIER_COLORS = { common: '#6b7280', uncommon: '#22c55e', rare: '#3b82f6', epic: '#a855f7', legendary: '#f59e0b' };
  function badgeToast(badge) {
    var el = document.createElement('div');
    var tierColor = BADGE_TIER_COLORS[badge.tier] || '#ffd700';
    el.className = 'toast toast-badge';
    el.style.cssText = 'border:2px solid ' + tierColor + ';box-shadow:0 0 20px ' + tierColor + '40;';
    el.innerHTML = '<span style="font-size:22px">' + (badge.icon || '') + '</span><div style="display:flex;flex-direction:column;gap:2px"><span style="font-weight:700;color:' + tierColor + '">' + escHtml(badge.name || '') + '</span><span style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#6e7681">' + (badge.tier || '') + '</span></div>';
    document.getElementById('toast-container').appendChild(el);
    setTimeout(function() { el.remove(); }, 3500);
  }
  function escHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  // -- Gamification: Persistence --
  function getGameState() {
    try { return JSON.parse(localStorage.getItem(STORAGE_PREFIX + '_game_' + reviewer) || '{}'); } catch(e) { return {}; }
  }
  function saveGameState(patch) {
    var state = Object.assign(getGameState(), patch);
    localStorage.setItem(STORAGE_PREFIX + '_game_' + reviewer, JSON.stringify(state));
  }
  function loadGameState() {
    var state = getGameState();
    SoundEngine.setEnabled(localStorage.getItem(STORAGE_PREFIX + '_sound') === '1');
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
    for (var i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
      if (xp >= LEVEL_THRESHOLDS[i]) return i + 1;
    }
    return 1;
  }
  function updateLevelDisplay(xp) {
    var level = getLevel(xp);
    var cur = LEVEL_THRESHOLDS[level - 1] || 0;
    var next = LEVEL_THRESHOLDS[level] || LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1];
    var pct = next > cur ? ((xp - cur) / (next - cur)) * 100 : 100;
    var badge = document.getElementById('level-badge');
    if (badge) badge.innerHTML = 'Lv.' + level + ' <span id="xp-bar-wrap"><span id="xp-bar" style="width:' + pct + '%"></span></span> <span id="xp-display">' + xp.toLocaleString() + 'xp</span>';
  }

  // -- Gamification: Combo --
  function updateComboDisplay() {
    var el = document.getElementById('combo-counter');
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
  var STREAKS = [
    { at: 2,  label: 'DOUBLE KILL',  cls: 's-double',  sfx: 'double' },
    { at: 3,  label: 'TRIPLE KILL',  cls: 's-triple',  sfx: 'triple' },
    { at: 4,  label: 'MEGA KILL',    cls: 's-mega',    sfx: 'mega' },
    { at: 5,  label: 'ULTRA KILL',   cls: 's-ultra',   sfx: 'ultra' },
    { at: 6,  label: 'RAMPAGE',      cls: 's-rampage',  sfx: 'rampage' },
    { at: 7,  label: 'GODLIKE',      cls: 's-godlike',  sfx: 'godlike' },
  ];

  var SHAKE_MAP = { 's-double': 'shake-light', 's-triple': 'shake-light', 's-mega': 'shake-medium', 's-ultra': 'shake-hard', 's-rampage': 'shake-hard', 's-godlike': 'shake-insane' };
  function screenShake(cls) {
    var s = SHAKE_MAP[cls]; if (!s) return;
    document.body.classList.remove('shake-light','shake-medium','shake-hard','shake-insane');
    void document.body.offsetWidth;
    document.body.classList.add(s);
    document.body.addEventListener('animationend', function handler() {
      document.body.classList.remove(s);
      document.body.removeEventListener('animationend', handler);
    });
  }
  var streakBannerEl = null;
  var streakBannerTimer = null;
  function showStreakBanner(streak) {
    if (streakBannerTimer) { clearTimeout(streakBannerTimer); }
    if (streakBannerEl) { streakBannerEl.remove(); }
    var el = document.createElement('div');
    el.className = 'streak-banner ' + streak.cls;
    el.textContent = streak.label;
    document.body.appendChild(el);
    streakBannerEl = el;
    screenShake(streak.cls);
    streakBannerTimer = setTimeout(function() { el.remove(); streakBannerEl = null; streakBannerTimer = null; }, 1300);
  }

  function tickCombo() {
    var now = Date.now();
    var prevCombo = combo;
    if (STREAK_THRESHOLD > 0) {
      // Threshold mode: unused review time banks forward
      if (!lastReviewTs) {
        timeBank = STREAK_THRESHOLD;
      } else {
        var elapsed = (now - lastReviewTs) / 1000;
        timeBank = timeBank - elapsed + STREAK_THRESHOLD;
        if (timeBank < 0) { if (combo > 0) comboDropped = true; combo = 0; timeBank = 0; }
      }
      combo++;
    } else {
      // Flat timeout mode (original behavior)
      if (lastReviewTs && (now - lastReviewTs) > COMBO_TIMEOUT) { if (combo > 0) comboDropped = true; combo = 0; }
      combo++;
    }
    // Detect combo drop: had a streak, it reset, now back to 1
    if (combo === 1 && comboDropped) {
      comboDropped = false;
      lastReviewTs = now;
      if (combo > bestCombo) bestCombo = combo;
      updateComboDisplay();
      updateTimeBankDisplay();
      SoundEngine.play('shutdown');
      return;
    }
    lastReviewTs = now;
    if (combo > bestCombo) bestCombo = combo;
    updateComboDisplay();
    updateTimeBankDisplay();
    spawnFloatText('+1', document.getElementById('combo-counter'));

    var maxStreak = STREAKS[STREAKS.length - 1];
    // Past max streak: replay the max sound + banner on every review
    if (combo > maxStreak.at) {
      SoundEngine.play('combo:' + maxStreak.at);
      showStreakBanner(maxStreak);
      return;
    }

    var matched = null;
    for (var i = STREAKS.length - 1; i >= 0; i--) {
      if (combo === STREAKS[i].at) { matched = STREAKS[i]; break; }
    }
    if (matched) {
      SoundEngine.play('combo:' + combo);
      showStreakBanner(matched);
    } else {
      SoundEngine.play('decide');
    }
  }
  function resetCombo() { if (combo > 0) comboDropped = true; combo = 0; timeBank = 0; updateComboDisplay(); updateTimeBankDisplay(); }

  // Time bank display
  function updateTimeBankDisplay() {
    var bar = document.getElementById('time-bank-bar');
    var fill = document.getElementById('time-bank-fill');
    if (STREAK_THRESHOLD <= 0) { bar.className = ''; return; }
    bar.className = 'active';
    var maxBank = STREAK_THRESHOLD * 3;
    var pct = Math.min(100, (timeBank / maxBank) * 100);
    fill.style.width = pct + '%';
    fill.className = timeBank > STREAK_THRESHOLD * 2 ? 'tb-green' : timeBank > STREAK_THRESHOLD * 0.5 ? 'tb-yellow' : 'tb-red';
    startTimeBankDrain();
  }
  function startTimeBankDrain() {
    if (timeBankAnimFrame) cancelAnimationFrame(timeBankAnimFrame);
    if (STREAK_THRESHOLD <= 0 || combo <= 0) return;
    var lastFrame = performance.now();
    function drain(now) {
      var dt = (now - lastFrame) / 1000;
      lastFrame = now;
      timeBank = Math.max(0, timeBank - dt);
      var maxBank = STREAK_THRESHOLD * 3;
      var pct = Math.min(100, (timeBank / maxBank) * 100);
      var fill = document.getElementById('time-bank-fill');
      fill.style.width = pct + '%';
      fill.className = timeBank > STREAK_THRESHOLD * 2 ? 'tb-green' : timeBank > STREAK_THRESHOLD * 0.5 ? 'tb-yellow' : 'tb-red';
      if (timeBank <= 0) { combo = 0; updateComboDisplay(); return; }
      timeBankAnimFrame = requestAnimationFrame(drain);
    }
    timeBankAnimFrame = requestAnimationFrame(drain);
  }

  // -- Gamification: XP --
  function getComboMultiplier() {
    if (combo >= 20) return 3;
    if (combo >= 10) return 2;
    if (combo >= 5) return 1.5;
    return 1;
  }
  function awardXp(base) {
    var state = getGameState();
    var oldXp = state.xp || 0;
    var oldLevel = getLevel(oldXp);
    var mult = getComboMultiplier();
    var gained = Math.round(base * mult);
    var newXp = oldXp + gained;
    var newLevel = getLevel(newXp);
    saveGameState({ xp: newXp });
    sessionXpGained += gained;
    updateLevelDisplay(newXp);
    var label = mult > 1 ? '+' + gained + ' (' + mult + 'x)' : '+' + gained;
    spawnFloatText(label, document.getElementById('level-badge'), true);
    if (newLevel > oldLevel) {
      toast('Level ' + newLevel, 'combo');
      SoundEngine.play('levelup');
      var badge = document.getElementById('level-badge');
      if (badge) { badge.classList.add('level-up-glow'); setTimeout(function() { badge.classList.remove('level-up-glow'); }, 1200); }
    }
  }

  // -- Gamification: Session count --
  function updateSessionCount() {
    var el = document.getElementById('session-count');
    if (el) el.textContent = sessionReviews + ' today';
  }

  // -- Gamification: Streak --
  function updateStreak() {
    var state = getGameState();
    var today = new Date().toISOString().slice(0, 10);
    var todayCount = (state.todayDate === today) ? (state.todayCount || 0) + 1 : 1;
    var streakDays = state.streakDays || 0;
    var lastStreakDate = state.lastStreakDate || '';
    if (todayCount >= 5 && lastStreakDate !== today) {
      var yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      streakDays = (lastStreakDate === yesterday) ? streakDays + 1 : 1;
      lastStreakDate = today;
    }
    saveGameState({ todayDate: today, todayCount: todayCount, streakDays: streakDays, lastStreakDate: lastStreakDate });
    updateStreakDisplay({ streakDays: streakDays });
  }
  function updateStreakDisplay(state) {
    var el = document.getElementById('streak-badge');
    if (!el) return;
    var days = (state && state.streakDays) || 0;
    el.textContent = days > 0 ? days + 'd\\uD83D\\uDD25' : '';
  }

  // -- Gamification: Sound (delegated to SoundEngine) --
  function updateSoundIcon() {
    var el = document.getElementById('sound-toggle');
    if (el) el.innerHTML = SoundEngine.isEnabled() ? '${icons.volumeOn.replace(/'/g, "\\'")}' : '${icons.volumeOff.replace(/'/g, "\\'")}';
  }
  document.getElementById('sound-toggle').addEventListener('click', function() {
    var next = !SoundEngine.isEnabled();
    SoundEngine.setEnabled(next);
    localStorage.setItem(STORAGE_PREFIX + '_sound', next ? '1' : '0');
    updateSoundIcon();
  });

  // -- Game settings modal --
  var gsOverlay = document.getElementById('game-settings-overlay');
  document.getElementById('game-settings-btn').addEventListener('click', function() {
    // Load current settings from API
    fetch(API + '/gamification').then(function(r) { return r.json(); }).then(function(data) {
      var personal = data.personal || {};
      var resolved = data.resolved || GAME_CONFIG;
      // Threshold
      document.getElementById('gs-threshold-team').textContent = '(' + (resolved.threshold || 0) + 's)';
      if (personal.threshold !== null && personal.threshold !== undefined) {
        document.getElementById('gs-threshold-custom').checked = true;
        document.getElementById('gs-threshold-val').value = personal.threshold;
      } else {
        document.getElementById('gs-threshold-inherit').checked = true;
      }
      // Sounds
      var activePack = SoundEngine.getActivePack();
      document.getElementById('gs-sounds-team').textContent = '(' + (activePack || 'synth') + ')';
      var personalSounds = personal.sounds;
      if (personalSounds && Object.keys(personalSounds).length > 0) {
        document.getElementById('gs-sounds-custom').checked = true;
        var firstVal = Object.values(personalSounds)[0] || 'synth';
        document.getElementById('gs-sounds-val').value = firstVal;
      } else {
        document.getElementById('gs-sounds-inherit').checked = true;
      }
    }).catch(function() {});
    gsOverlay.classList.add('open');
  });
  document.getElementById('gs-cancel').addEventListener('click', function() { gsOverlay.classList.remove('open'); });
  gsOverlay.addEventListener('click', function(e) { if (e.target === gsOverlay) gsOverlay.classList.remove('open'); });
  document.getElementById('gs-save').addEventListener('click', function() {
    var thresholdMode = document.querySelector('input[name="gs-threshold"]:checked').value;
    var soundsMode = document.querySelector('input[name="gs-sounds"]:checked').value;
    var payload = {
      threshold: thresholdMode === 'custom' ? parseInt(document.getElementById('gs-threshold-val').value) || 0 : null,
      comboTimeoutMs: null,
      enabled: null,
      sounds: null
    };
    if (soundsMode === 'custom') {
      var pack = document.getElementById('gs-sounds-val').value;
      payload.sounds = { ping: pack, double: pack, triple: pack, mega: pack, ultra: pack, rampage: pack, godlike: pack, levelup: pack };
    }
    fetch(API + '/gamification', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    .then(function(r) { return r.json(); })
    .then(function() {
      gsOverlay.classList.remove('open');
      toast('Settings saved. Reload to apply.', 'info');
    })
    .catch(function(err) { toast(err.message, 'error'); });
  });

  // -- Gamification: Floating text --
  function spawnFloatText(text, anchor, isXp) {
    if (!anchor) return;
    var el = document.createElement('span');
    el.className = 'float-xp' + (isXp ? ' float-xp-gold' : '');
    el.textContent = text;
    var rect = anchor.getBoundingClientRect();
    el.style.left = (rect.left + rect.width / 2) + 'px';
    el.style.top = rect.top + 'px';
    document.body.appendChild(el);
    setTimeout(function() { el.remove(); }, 500);
  }

  // -- Gamification: Session summary + confetti --
  function renderSessionSummary() {
    var defaultEl = document.getElementById('empty-default');
    var summaryEl = document.getElementById('session-summary');
    if (!defaultEl || !summaryEl) return;
    if (sessionReviews === 0) {
      summaryEl.style.display = 'none';
      defaultEl.style.display = 'block';
      return;
    }
    defaultEl.style.display = 'none';
    summaryEl.style.display = 'block';
    var avgTime = decisionTimes.length > 0 ? (decisionTimes.reduce(function(a,b){return a+b;}, 0) / decisionTimes.length).toFixed(1) : '--';
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
    var container = document.getElementById('confetti-container');
    if (!container) return;
    container.innerHTML = '';
    var colors = [${confettiColors}];
    for (var i = 0; i < 15; i++) {
      var p = document.createElement('div');
      p.className = 'confetti-particle';
      p.style.left = (20 + Math.random() * 60) + '%';
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = (Math.random() * 0.3) + 's';
      p.style.animationDuration = (1 + Math.random() * 0.5) + 's';
      container.appendChild(p);
    }
  }

  // -- Judge helper: detect yes/no answer --
  function isYesAnswer(a) {
    var s = String(a || '').trim().toLowerCase();
    return s.startsWith('yes') || s === 'true' || s === 'y' || s === '1';
  }

  // -- API --
  function api(path, opts) {
    opts = opts || {};
    return fetch(API + path, {
      headers: { 'Content-Type': 'application/json' },
      method: opts.method || 'GET',
      body: opts.body || undefined,
    }).then(function(res) {
      return res.json().then(function(data) {
        if (!res.ok) throw new Error(data.error || 'Request failed');
        return data;
      });
    });
  }

  // -- Progress bar --
  function updateProgress(remaining) {
    var total = totalItems || (totalDecided + remaining);
    if (total <= 0) return;
    var pct = Math.min(100, (totalDecided / total) * 100);
    document.getElementById('progress-bar').style.width = pct + '%';
  }

  // -- Speed tracker --
  function trackDecision() {
    var now = Date.now();
    if (lastDecisionTs) {
      var elapsed = (now - lastDecisionTs) / 1000;
      decisionTimes.push(elapsed);
      if (decisionTimes.length > 20) decisionTimes.shift();
      var avg = decisionTimes.reduce(function(a, b) { return a + b; }, 0) / decisionTimes.length;
      document.getElementById('speed-avg').textContent = avg.toFixed(1);
    }
    lastDecisionTs = now;
    totalDecided++;
  }

  // -- Transition animation --
  function animateTransition(cb) {
    var el = document.getElementById('verdict-content');
    el.classList.add('fade-out');
    setTimeout(function() {
      cb();
      el.classList.remove('fade-out');
      el.classList.add('fade-in');
      requestAnimationFrame(function() {
        el.classList.remove('fade-in');
      });
    }, 120);
  }

  // -- Type filter helpers (reviewer mode only) --
  function nextUrl() {
    var q = selfTypeFilter ? '?types=' + selfTypeFilter : '';
    return '/next' + q;
  }

  function updateTypeFilterUI() {
    var el = document.getElementById('type-filter');
    if (!el) return;
    el.disabled = judgeAllowedTypes.length <= 1;
    // Remove options that aren't in judgeAllowedTypes
    Array.from(el.options).forEach(function(opt) {
      if (opt.value && !judgeAllowedTypes.includes(opt.value)) {
        opt.disabled = true;
        opt.style.display = 'none';
      } else {
        opt.disabled = false;
        opt.style.display = '';
      }
    });
    if (selfTypeFilter && !judgeAllowedTypes.includes(selfTypeFilter)) {
      selfTypeFilter = '';
    }
    el.value = selfTypeFilter;
  }

  function applyNextData(data) {
    if (data.judgeAllowedTypes) {
      judgeAllowedTypes = data.judgeAllowedTypes;
      updateTypeFilterUI();
    }
    buffer = data.buffer || [];
    for (var i = 0; i < buffer.length; i++) {
      if (buffer[i].transcript) transcriptCache[buffer[i].findingId] = buffer[i].transcript;
    }
    // Review mode: populate audit state from buffer
    if (MODE === 'review' && buffer.length > 0) {
      var newFid = buffer[0].findingId;
      if (newFid !== auditFindingId) {
        auditFindingId = newFid;
        auditItems = buffer.slice();
        auditDecisions = {};
        currentAuditIdx = 0;
        updateAuditHeader();
      } else {
        // Same audit — refresh items but keep decisions
        auditItems = buffer.slice();
      }
      renderAuditProgress();
    }
  }

  // -- Queue --
  function loadNext() {
    return api(nextUrl()).then(function(data) {
      applyNextData(data);
      if (buffer.length === 0) {
        // If self-filter active and no items found, fall back to all judge-allowed types
        if (selfTypeFilter && judgeAllowedTypes.length > 1) {
          var prev = selfTypeFilter === 'date-leg' ? 'internal' : 'partner';
          selfTypeFilter = '';
          updateTypeFilterUI();
          toast('No more ' + prev + ' in queue — showing all types', 'info');
          return api('/next').then(function(data2) {
            applyNextData(data2);
            if (buffer.length === 0) { showEmpty(); return; }
            showReview();
          });
        }
        showEmpty();
        return;
      }
      showReview();
    }).catch(function(err) {
      if (err.message === 'unauthorized') {
        window.location.href = '/login';
        return;
      }
      toast(err.message, 'error');
    });
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
    var currentItem = MODE === 'review' && auditItems.length > 0 ? auditItems[currentAuditIdx] : buffer[0];
    if (!currentItem) return;
    // In review mode, only close search when audit changes (not on intra-audit navigation)
    if (searchOpen) {
      if (MODE === 'review') {
        if (currentItem.findingId !== auditFindingId) closeSearch();
      } else {
        closeSearch();
      }
    }
    document.getElementById('q-header').textContent = currentItem.header;
    document.getElementById('q-populated').textContent = currentItem.populated;
    document.getElementById('q-defense').textContent = currentItem.defense || 'No defense provided';
    document.getElementById('thinking-text').textContent = currentItem.thinking || 'No reasoning provided';
    document.getElementById('m-finding').textContent = currentItem.findingId;

    // Package / Date Leg badge
    var typeChip = document.getElementById('m-type-chip');
    if (typeChip) {
      var isPackage = currentItem.recordingIdField === 'GenieNumber';
      typeChip.innerHTML = isPackage
        ? '<span class="badge-pkg">Partner</span>'
        : '<span class="badge-dl">Internal</span>';
      typeChip.style.display = '';
    }

    // Audit link (m-report-link now wraps the whole Audit chip)
    var reportLink = document.getElementById('m-report-link');
    if (reportLink && currentItem.findingId) {
      reportLink.href = '/audit/report?id=' + encodeURIComponent(currentItem.findingId);
    }

    // Record ID + QB link
    var recId = currentItem.recordId || '';
    var ridEl = document.getElementById('m-record-id');
    var recLink = document.getElementById('m-record-link');
    if (recId && ridEl && recLink) {
      ridEl.textContent = recId;
      var qbTable = (currentItem.recordingIdField === 'GenieNumber') ? QB_PKG_TABLE : QB_DATE_TABLE;
      recLink.href = 'https://' + QB_REALM + '.quickbase.com/db/' + qbTable + '?a=dr&rid=' + encodeURIComponent(recId);
      recLink.style.display = '';
    } else if (recLink) {
      recLink.style.display = 'none';
    }

    ${verdictBadgeRenderJs}

    document.getElementById('m-last').style.display = currentItem.auditRemaining === 1 ? '' : 'none';

    ${!R ? `
    // Reviewer chip (judge mode only)
    var revChip = document.getElementById('m-reviewer');
    var revName = document.getElementById('m-reviewer-name');
    if (revChip && revName) {
      if (currentItem.reviewedBy) {
        revName.textContent = currentItem.reviewedBy.split('@')[0] || currentItem.reviewedBy;
        revChip.title = currentItem.reviewedBy;
        revChip.style.display = '';
      } else {
        revChip.style.display = 'none';
      }
    }` : ''}

    document.getElementById('thinking-content').classList.remove('open');
    document.querySelector('#thinking-toggle .arrow').classList.remove('open');
    document.getElementById('prompt-text').textContent = currentItem.populated || '';
    document.getElementById('prompt-content').classList.remove('open');
    document.querySelector('#prompt-toggle .arrow').classList.remove('open');

    // Record Details
    var rdBody = document.getElementById('record-details-body');
    var rdContent = document.getElementById('record-details-content');
    var rdArrow = document.querySelector('#record-details-toggle .rd-arrow');
    rdContent.classList.remove('open');
    rdArrow.classList.remove('open');
    var meta = currentItem.recordMeta;
    if (meta) {
      var isPackage = currentItem.recordingIdField === 'GenieNumber';
      var rows = '';
      function rdField(label, val) {
        if (!val) return '';
        return '<div class="rd-field">' + label + ': <span>' + val + '</span></div>';
      }
      function rdCheck(label, val) {
        var checked = val && val !== '0' && val.toLowerCase() !== 'false' && val.toLowerCase() !== 'no';
        return '<div class="rd-check' + (checked ? ' checked' : '') + '">' + (checked ? '☑' : '☐') + ' ' + label + '</div>';
      }
      if (isPackage) {
        rows += rdField('Guest name', meta.guestName);
        rows += rdField('Marital Status', meta.maritalStatus);
        rows += rdField('Office', meta.officeName);
        rows += rdField('Total Amount', meta.totalAmountPaid ? '$' + meta.totalAmountPaid : '');
        rows += rdCheck('MCC', meta.hasMCC);
        rows += rdCheck('MSP', meta.mspSubscription);
      } else {
        rows += rdField('Guest name', meta.guestName);
        rows += rdField('Spouse Name', meta.spouseName);
        rows += '<div class="rd-field rd-full">Marital Status: <span>' + (meta.maritalStatus || '—') + '</span></div>';
        rows += '<div class="rd-field rd-full">Destination: <span>' + (meta.destination || '—') + '</span></div>';
        rows += rdField('Arrival', meta.arrivalDate);
        rows += rdField('Departure', meta.departureDate);
        rows += rdField('Room Type / Max Occ.', meta.roomTypeMaxOccupancy);
        rows += rdCheck('WGS', meta.totalWGS);
        rows += rdCheck('MCC', meta.totalMCC);
      }
      rdBody.innerHTML = rows;
      document.getElementById('record-details-toggle').style.display = '';
    } else {
      rdBody.innerHTML = '';
      document.getElementById('record-details-toggle').style.display = 'none';
    }

    loadRecording(currentItem.findingId);
    renderTranscript();
    // Show jump button only if transcript has evidence lines
    setTimeout(function() {
      var first = document.querySelector('.t-evidence');
      var btn = document.getElementById('m-jump-audio');
      if (btn) btn.style.display = first ? '' : 'none';
    }, 0);
  }

  // -- Jump to audio --
  function jumpToAudio() {
    var first = document.querySelector('.t-evidence');
    if (!first) { first = document.querySelector('.t-highlight'); }
    if (!first) return;
    scrollToTranscriptLine(first);
    seekToTranscriptLine(first);
    if (recAudio.paused) recAudio.play().catch(function(){});
  }
  document.getElementById('m-jump-audio').addEventListener('click', jumpToAudio);

  // -- Thinking toggle --
  document.getElementById('thinking-toggle').addEventListener('click', toggleThinking);
  function toggleThinking() {
    var content = document.getElementById('thinking-content');
    var arrow = document.querySelector('#thinking-toggle .arrow');
    content.classList.toggle('open');
    arrow.classList.toggle('open');
  }

  // -- Prompt toggle --
  document.getElementById('prompt-toggle').addEventListener('click', function() {
    var content = document.getElementById('prompt-content');
    var arrow = document.querySelector('#prompt-toggle .arrow');
    content.classList.toggle('open');
    arrow.classList.toggle('open');
  });

  // -- Record Details toggle --
  document.getElementById('record-details-toggle').addEventListener('click', function() {
    var content = document.getElementById('record-details-content');
    var arrow = document.querySelector('#record-details-toggle .rd-arrow');
    content.classList.toggle('open');
    arrow.classList.toggle('open');
  });

  ${R ? `
  // -- Failed Questions drawer toggle (review only) --
  var fqOpen = false;
  document.getElementById('failed-q-toggle').addEventListener('click', function() {
    fqOpen = !fqOpen;
    var content = document.getElementById('failed-q-content');
    var arrow = document.getElementById('fq-arrow');
    content.style.maxHeight = fqOpen ? '300px' : '0';
    arrow.classList.toggle('open', fqOpen);
  });
  ` : ''}

  // -- Transcript --
  var colOffset = 0;
  var colStep = 0;
  var totalCols = 1;

  function sizeTranscript() {
    var progBar = document.getElementById('progress-bar-container');
    var bottomBar = document.getElementById('bottom-bar');
    var body = document.getElementById('transcript-body');
    var panel = document.getElementById('transcript-panel');
    var h = window.innerHeight - progBar.offsetHeight - bottomBar.offsetHeight - 40;
    body.style.height = h + 'px';
    var panelW = panel.clientWidth - 48;
    var colW = Math.floor(panelW / 3);
    var gap = 24;
    colStep = colW + gap;
    body.style.columnWidth = colW + 'px';
    requestAnimationFrame(function() {
      totalCols = Math.max(1, Math.ceil(body.scrollWidth / colStep));
      colOffset = Math.min(colOffset, Math.max(0, totalCols - 3));
      body.scrollLeft = colOffset * colStep;
      updateColIndicator();
    });
  }

  function scrollColumns(dir) {
    var body = document.getElementById('transcript-body');
    var maxOffset = Math.max(0, totalCols - 3);
    colOffset = Math.max(0, Math.min(colOffset + dir, maxOffset));
    body.scrollTo({ left: colOffset * colStep, behavior: 'smooth' });
    updateColIndicator();
  }

  function updateColIndicator() {
    var el = document.getElementById('col-indicator');
    if (totalCols <= 3) { el.textContent = ''; return; }
    var from = colOffset + 1;
    var to = Math.min(colOffset + 3, totalCols);
    el.textContent = from + '-' + to + ' / ' + totalCols;
  }

  window.addEventListener('resize', function() { colOffset = 0; sizeTranscript(); });

  function extractEvidenceSnippets(defense, thinking) {
    var snippets = [];
    var combined = (defense || '') + ' ' + (thinking || '');
    var quoted = combined.match(/'([^']{10,})'/g);
    if (quoted) {
      for (var i = 0; i < quoted.length; i++) snippets.push(quoted[i].slice(1, -1).toLowerCase());
    }
    var dquoted = combined.match(/"([^"]{10,})"/g);
    if (dquoted) {
      for (var i = 0; i < dquoted.length; i++) snippets.push(dquoted[i].slice(1, -1).toLowerCase());
    }
    return snippets;
  }

  function fmtTranscriptTime(ms) {
    var s = Math.floor(ms / 1000);
    var m = Math.floor(s / 60);
    return m + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
  }

  function renderTranscript() {
    var body = document.getElementById('transcript-body');
    body.innerHTML = '';
    var currentItem = buffer[0];
    var currentTranscript = currentItem ? currentItem.transcript : null;
    if (!currentTranscript || (!currentTranscript.diarized && !currentTranscript.raw)) {
      body.innerHTML = '<p style="color:#3d4452;padding:20px">No transcript available</p>';
      return;
    }
    // Use raw when utterance times are available (times are indexed to raw lines, not diarized)
    var times = currentTranscript.utteranceTimes;
    var text = (times && times.length > 0) ? (currentTranscript.raw || currentTranscript.diarized) : (currentTranscript.diarized || currentTranscript.raw);
    var defense = (currentItem && currentItem.defense || '').toLowerCase();
    var thinking = (currentItem && currentItem.thinking || '').toLowerCase();
    var evidenceSnippets = extractEvidenceSnippets(currentItem && currentItem.defense, currentItem && currentItem.thinking);
    var lines = text.split('\\n');
    var timeIdx = 0; // tracks which utteranceTimes entry to use (skip blank lines)
    var lastLine = ''; // for dedup: skip consecutive identical lines
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li];
      if (!line.trim()) continue;
      if (line.trim() === lastLine) { if (times && timeIdx < times.length) timeIdx++; continue; } // skip duplicate
      lastLine = line.trim();
      var div = document.createElement('div');
      div.className = 't-line';

      // Attach timestamp if available (in seconds for audio seeking)
      if (times && timeIdx < times.length) {
        div.setAttribute('data-time', String(times[timeIdx] / 1000));
        timeIdx++;
      }

      var match = line.match(/^\\[?(AGENT|CUSTOMER|SYSTEM|Agent|Customer|System)\\]?[:\\s]*(.*)/i);
      if (match) {
        var speaker = match[1].toUpperCase();
        var content = match[2] || '';
        div.classList.add(speaker === 'AGENT' ? 't-team-member' : speaker === 'CUSTOMER' ? 't-guest' : 't-system');

        // Timestamp chip (shown only when we have real times)
        if (times && div.getAttribute('data-time') !== null) {
          var tChip = document.createElement('span');
          tChip.className = 't-time';
          tChip.textContent = fmtTranscriptTime(times[timeIdx - 1]);
          tChip.style.cssText = 'font-size:9px;color:#3d4452;font-family:monospace;margin-right:5px;flex-shrink:0;user-select:none;cursor:pointer;';
          (function(chip, line) {
            chip.addEventListener('click', function(e) { e.stopPropagation(); seekToTranscriptLine(line); if (recAudio.paused) recAudio.play().catch(function(){}); });
          })(tChip, div);
          div.appendChild(tChip);
        }

        var label = document.createElement('span');
        label.className = 't-speaker';
        label.textContent = speaker === 'AGENT' ? 'TEAM MEMBER' : speaker === 'CUSTOMER' ? 'GUEST' : speaker;
        div.appendChild(label);
        div.appendChild(document.createTextNode(content));

        var contentLow = content.toLowerCase();

        var isEvidence = false;
        if (evidenceSnippets.length > 0 && content.length > 10) {
          for (var si = 0; si < evidenceSnippets.length; si++) {
            if (contentLow.includes(evidenceSnippets[si]) || evidenceSnippets[si].includes(contentLow.slice(0, 40))) {
              isEvidence = true;
              break;
            }
          }
        }

        // Click anywhere on the line to seek + play audio
        if (div.getAttribute('data-time') !== null) {
          div.style.cursor = 'pointer';
          (function(d) {
            d.addEventListener('click', function() { seekToTranscriptLine(d); if (recAudio.paused) recAudio.play().catch(function(){}); });
          })(div);
        }

        if (isEvidence) {
          div.classList.add('t-evidence');
        } else if (defense && content.length > 20) {
          var words = defense.split(/\\s+/).filter(function(w) { return w.length > 5; });
          var matchCount = words.filter(function(w) { return contentLow.includes(w); }).length;
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
  var inflight = 0; // number of /decide requests in flight

  window.decide = function(decision, reason) { decide(decision, reason); };
  function decide(decision, reason) {
    if (MODE === 'review' && auditItems.length === 0) return;
    if (MODE !== 'review' && buffer.length === 0) {
      console.log('[QUEUE] decide(' + decision + ') — buffer empty, ignoring');
      return;
    }
    if (busy) {
      console.log('[QUEUE] decide(' + decision + ') — busy=true, ignoring');
      return;
    }

    // Show confirm dialog when deciding on the last question for an audit
    if (MODE === 'review') {
      var currentItem = auditItems[currentAuditIdx];
      if (!currentItem) return;
      var undecided = 0;
      for (var ui = 0; ui < auditItems.length; ui++) {
        if (!auditDecisions[auditItems[ui].questionIndex]) undecided++;
      }
      console.log('[QUEUE] decide(' + decision + ') — review mode, undecided=' + undecided);
      if (undecided === 1) {
        pendingDecision = decision;
        pendingReason = reason || null;
        showConfirmModal();
        return;
      }
    } else {
      var currentItem = buffer[0];
      console.log('[QUEUE] decide(' + decision + ') — fid=' + currentItem.findingId + ' qi=' + currentItem.questionIndex + ' auditRemaining=' + currentItem.auditRemaining);
      if (currentItem && currentItem.auditRemaining === 1) {
        pendingDecision = decision;
        pendingReason = reason || null;
        showConfirmModal();
        return;
      }
    }

    executeDecision(decision, reason);
  }

  function disableButtons() {
    var decideBtns = document.querySelectorAll('.decide-btn');
    for (var bi = 0; bi < decideBtns.length; bi++) { decideBtns[bi].style.opacity = '0.4'; decideBtns[bi].style.pointerEvents = 'none'; }
    var overlay = document.getElementById('btn-loading-overlay');
    if (overlay) overlay.style.display = 'flex';
    console.log('[QUEUE] disableButtons — inflight=' + inflight + ' inflightFids=' + JSON.stringify(inflightFids) + ' buffer=' + buffer.length);
  }

  function enableButtons() {
    var decideBtns = document.querySelectorAll('.decide-btn');
    for (var bi = 0; bi < decideBtns.length; bi++) { decideBtns[bi].style.opacity = ''; decideBtns[bi].style.pointerEvents = ''; }
    var overlay = document.getElementById('btn-loading-overlay');
    if (overlay) overlay.style.display = 'none';
    console.log('[QUEUE] enableButtons — inflight=' + inflight + ' inflightFids=' + JSON.stringify(inflightFids) + ' buffer=' + buffer.length);
  }

  function executeDecision(decision, reason) {
    if (MODE === 'review' && auditItems.length > 0) {
      // Review mode: audit ownership model
      var item = auditItems[currentAuditIdx];
      if (!item) return;

      auditDecisions[item.questionIndex] = decision === POSITIVE_DECISION ? 'confirm' : 'flip';
      renderAuditProgress();

      trackDecision();
      tickCombo();
      sessionReviews++;
      updateSessionCount();
      awardXp(decision === POSITIVE_DECISION ? 10 : 15);
      updateStreak();

      // Auto-advance to next undecided question
      var advanced = false;
      for (var ai = 1; ai <= auditItems.length; ai++) {
        var nextIdx = (currentAuditIdx + ai) % auditItems.length;
        if (!auditDecisions[auditItems[nextIdx].questionIndex]) {
          currentAuditIdx = nextIdx;
          advanced = true;
          animateTransition(function() { renderCurrent(); renderAuditProgress(); });
          break;
        }
      }
      if (!advanced) {
        // All decided — block and wait for server
        busy = true;
        disableButtons();
      }
    } else {
      // Judge mode: original buffer-shift model
      if (buffer.length === 0) return;
      if (busy && buffer.length === 0) return;

      var item = buffer.shift();

      inflightFids[item.findingId] = (inflightFids[item.findingId] || 0) + 1;

      trackDecision();
      tickCombo();
      sessionReviews++;
      updateSessionCount();
      awardXp(decision === POSITIVE_DECISION ? 10 : 15);
      updateStreak();

      if (buffer.length > 0) {
        var nextFid = buffer[0].findingId;
        if (inflightFids[nextFid] && inflightFids[nextFid] > 0) {
          busy = true;
          disableButtons();
          renderCurrent();
        } else {
          animateTransition(function() { renderCurrent(); });
        }
      } else {
        busy = true;
        disableButtons();
      }
    }

    // Optimistically hide "Final for Audit" badge
    var mLastOpt = document.getElementById('m-last');
    if (mLastOpt) mLastOpt.style.display = 'none';

    ${toastDecisionJs}

    var bodyObj = {
      findingId: item.findingId,
      questionIndex: item.questionIndex,
      decision: decision,
      combo: combo,
      level: getLevel(sessionXpGained),
      speedMs: lastReviewTs > 0 ? Date.now() - lastReviewTs : undefined,
    };
    if (reason) bodyObj.reason = reason;
    if (selfTypeFilter) bodyObj.types = selfTypeFilter;
    if (MODE === 'review' && auditItems.length > 0) {
      var confirms = 0, flips = 0;
      for (var dk in auditDecisions) { if (auditDecisions[dk] === 'confirm') confirms++; else flips++; }
      bodyObj.auditDecisionCounts = { confirms: confirms, flips: flips };
      bodyObj.totalForFinding = auditItems[0].totalForFinding || auditItems.length;
    }

    inflight++;
    console.log('[QUEUE] /decide POST fid=' + item.findingId + ' qi=' + item.questionIndex + ' decision=' + decision + ' inflight=' + inflight + ' inflightFids=' + JSON.stringify(inflightFids));
    fetch(API + '/decide', {
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify(bodyObj),
    }).then(function(res) {
      return res.json().then(function(data) {
        inflight--;
        inflightFids[item.findingId] = Math.max(0, (inflightFids[item.findingId] || 1) - 1);
        console.log('[QUEUE] /decide response fid=' + item.findingId + ' qi=' + item.questionIndex + ' status=' + res.status + ' auditComplete=' + !!data.auditComplete + ' newBuffer=' + (data.buffer||[]).length + ' inflight=' + inflight + ' inflightFids=' + JSON.stringify(inflightFids));

        if (res.status === 409) {
          console.warn('[QUEUE] 409 stale decision fid=' + item.findingId + ' qi=' + item.questionIndex + ' inflight=' + inflight + ' buffer=' + buffer.length);
          if (MODE === 'review') {
            // 409 in review mode = item was already decided server-side.
            // Mark it as decided locally and refresh audit state.
            auditDecisions[item.questionIndex] = decision === POSITIVE_DECISION ? 'confirm' : 'flip';
            renderAuditProgress();
            // Refresh from server to get accurate state
            fetch(API + nextUrl()).then(function(r) { return r.json(); }).then(function(d) {
              applyNextData(d);
              if (buffer.length > 0 || auditItems.length > 0) {
                // Check if all questions are now decided
                var stillUndecided = 0;
                for (var si = 0; si < auditItems.length; si++) {
                  if (!auditDecisions[auditItems[si].questionIndex]) stillUndecided++;
                }
                if (stillUndecided === 0 && auditItems.length > 0) {
                  // All decided — show completion
                  var cConfirms = 0, cFlips = 0;
                  for (var cdk in auditDecisions) { if (auditDecisions[cdk] === 'confirm') cConfirms++; else cFlips++; }
                  var cTotal = auditItems[0].totalForFinding || auditItems.length;
                  var cScore = cTotal > 0 ? Math.round(((cTotal - cConfirms) / cTotal) * 100) : 0;
                  showAuditComplete(cConfirms, cFlips, cScore);
                } else {
                  showReview();
                  renderCurrent();
                }
              } else {
                showEmpty();
              }
              busy = false;
              enableButtons();
            }).catch(function() { busy = false; enableButtons(); });
          } else {
            // Judge mode: original 409 handling
            if (inflight === 0 && buffer.length === 0) {
              fetch(API + nextUrl()).then(function(r) { return r.json(); }).then(function(d) {
                applyNextData(d);
                if (buffer.length > 0) {
                  showReview();
                } else {
                  showEmpty();
                }
                busy = false;
                enableButtons();
              });
            } else if (inflight === 0) {
              var nextFidCheck = buffer.length > 0 && inflightFids[buffer[0].findingId] > 0;
              if (!nextFidCheck) { busy = false; enableButtons(); }
            }
          }
          return;
        }
        if (!res.ok) throw new Error(data.error || 'Request failed');

        if (data.auditComplete) {
          if (MODE === 'review') {
            // Show completion overlay with summary
            var confirms = 0, flips = 0;
            for (var dk in auditDecisions) { if (auditDecisions[dk] === 'confirm') confirms++; else flips++; }
            var totalQ = auditItems.length > 0 ? (auditItems[0].totalForFinding || auditItems.length) : 0;
            var newScore = totalQ > 0 ? Math.round(((totalQ - confirms) / totalQ) * 100) : 0;
            showAuditComplete(confirms, flips, newScore);
            // Apply new buffer from server (next audit)
            applyNextData(data);
          } else {
            toast('${completeMsg}', 'complete');
            var completedFid = item.findingId;
            var purgeBefore = buffer.length;
            buffer = buffer.filter(function(x) { return x.findingId !== completedFid; });
            console.log('[QUEUE] auditComplete fid=' + completedFid + ' — purged ' + (purgeBefore - buffer.length) + ' buffered items, buffer now=' + buffer.length);
          }
        }

        // Badge toasts
        if (data.newBadges && data.newBadges.length) {
          for (var bi = 0; bi < data.newBadges.length; bi++) {
            (function(badge, delay) {
              setTimeout(function() { badgeToast(badge); }, delay);
            })(data.newBadges[bi], bi * 600);
          }
        }

        // Push new buffer items from response (replenish).
        // If an item is already in the buffer, update auditRemaining so the "Final for audit"
        // badge reflects the live counter rather than the stale value from initial load.
        var newItems = data.buffer || [];
        for (var ni = 0; ni < newItems.length; ni++) {
          var existingIdx = -1;
          for (var bi2 = 0; bi2 < buffer.length; bi2++) {
            if (buffer[bi2].findingId === newItems[ni].findingId && buffer[bi2].questionIndex === newItems[ni].questionIndex) {
              existingIdx = bi2; break;
            }
          }
          if (existingIdx >= 0) {
            var oldRemaining = buffer[existingIdx].auditRemaining;
            buffer[existingIdx].auditRemaining = newItems[ni].auditRemaining;
            if (oldRemaining !== newItems[ni].auditRemaining) {
              console.log('[QUEUE] updated auditRemaining fid=' + newItems[ni].findingId + ' qi=' + newItems[ni].questionIndex + ' ' + oldRemaining + ' → ' + newItems[ni].auditRemaining);
            }
          } else {
            buffer.push(newItems[ni]);
            if (newItems[ni].transcript) transcriptCache[newItems[ni].findingId] = newItems[ni].transcript;
          }
        }

        // Review mode: unblock after server response (audit still in progress)
        if (MODE === 'review' && !data.auditComplete && inflight === 0) {
          busy = false;
          enableButtons();
          renderAuditProgress();
        } else {
          // Judge mode: original unblocking logic
          var nextFidStillWaiting = buffer.length > 0 && inflightFids[buffer[0].findingId] > 0;
          if (busy && buffer.length > 0 && !nextFidStillWaiting) {
            showReview();
          } else if (busy && buffer.length === 0) {
            showEmpty();
          }
          if (inflight === 0 && !nextFidStillWaiting) {
            busy = false;
            enableButtons();
          }
        }
      });
    }).catch(function(err) {
      inflight--;
      inflightFids[item.findingId] = Math.max(0, (inflightFids[item.findingId] || 1) - 1);
      console.error('[QUEUE] /decide error fid=' + item.findingId + ' qi=' + item.questionIndex + ':', err.message);
      toast(err.message, 'error');
      if (inflight === 0) {
        busy = false;
        enableButtons();
      }
    });
  }

  // -- Audit ownership helpers (review mode) --
  function updateAuditHeader() {
    if (MODE !== 'review' || auditItems.length === 0) return;
    var meta = auditItems[0].recordMeta || {};
    var el;
    el = document.getElementById('ah-guest'); if (el) el.textContent = meta.guestName || '--';
    el = document.getElementById('ah-vo'); if (el) el.textContent = meta.voName || '--';
    el = document.getElementById('ah-rid'); if (el) el.textContent = auditItems[0].recordId || '--';
    var typeBadge = document.getElementById('ah-type-badge');
    if (typeBadge) {
      var isPkg = auditItems[0].recordingIdField === 'GenieNumber';
      typeBadge.textContent = isPkg ? 'Partner' : 'Internal';
      typeBadge.style.background = isPkg ? 'rgba(251,191,36,0.15)' : 'rgba(139,92,246,0.15)';
      typeBadge.style.color = isPkg ? '#fbbf24' : '#8b5cf6';
    }
    var failedBadge = document.getElementById('ah-failed-badge');
    if (failedBadge) failedBadge.textContent = auditItems.length + ' failed';
  }

  function renderAuditProgress() {
    if (MODE !== 'review') return;
    var list = document.getElementById('ap-list');
    if (!list) return;
    list.innerHTML = '';

    // Show/hide the toggle button
    var toggle = document.getElementById('failed-q-toggle');
    if (toggle) toggle.style.display = auditItems.length > 0 ? 'flex' : 'none';
    var countEl = document.getElementById('fq-count');
    if (countEl) {
      var decided = 0;
      for (var dk in auditDecisions) decided++;
      countEl.textContent = decided + '/' + auditItems.length;
    }

    for (var pi = 0; pi < auditItems.length; pi++) {
      var pill = document.createElement('div');
      pill.className = 'ap-pill' + (pi === currentAuditIdx ? ' current' : '');
      var dec = auditDecisions[auditItems[pi].questionIndex];
      var dotClass = 'ap-dot';
      if (pi === currentAuditIdx) dotClass += ' current';
      else if (dec === 'confirm') dotClass += ' confirmed';
      else if (dec === 'flip') dotClass += ' flipped';
      pill.innerHTML = '<span class="ap-num">' + (pi + 1) + '</span>'
        + '<span class="' + dotClass + '"></span>'
        + '<span class="ap-hdr">' + (auditItems[pi].header || '').substring(0, 40) + '</span>';
      (function(idx) {
        pill.addEventListener('click', function() {
          if (busy) return;
          currentAuditIdx = idx;
          renderCurrent();
          renderAuditProgress();
        });
      })(pi);
      list.appendChild(pill);
    }
  }

  function showAuditComplete(confirms, flips, newScore) {
    var overlay = document.getElementById('audit-complete-overlay');
    if (!overlay) { toast('Audit reviewed — ' + confirms + ' confirmed, ' + flips + ' flipped', 'complete'); return; }
    var el;
    el = document.getElementById('aco-confirms'); if (el) el.textContent = confirms;
    el = document.getElementById('aco-flips'); if (el) el.textContent = flips;
    el = document.getElementById('aco-score'); if (el) el.textContent = newScore + '%';
    overlay.style.display = 'flex';
    window._acoNext = function() {
      overlay.style.display = 'none';
      auditFindingId = null;
      auditDecisions = {};
      currentAuditIdx = 0;
      if (buffer.length > 0) {
        applyNextData({ buffer: buffer });
        showReview();
        renderCurrent();
      } else {
        showEmpty();
      }
      busy = false;
      enableButtons();
    };
    // Auto-dismiss after 5s
    setTimeout(function() { if (overlay.style.display === 'flex') window._acoNext(); }, 5000);
  }

  // -- Confirmation modal --
  function showConfirmModal() {
    var overlay = document.getElementById('confirm-overlay');
    var input = document.getElementById('confirm-input');
    var submitBtn = document.getElementById('confirm-submit-btn');
    var preview = document.getElementById('confirm-action-preview');
    ${confirmPreviewJs}
    overlay.classList.add('open');
    input.value = '';
    submitBtn.classList.remove('enabled');
    setTimeout(function() { input.focus(); }, 50);
  }

  function hideConfirmModal() {
    document.getElementById('confirm-overlay').classList.remove('open');
    document.getElementById('confirm-input').value = '';
    pendingDecision = null;
    pendingReason = null;
  }

  document.getElementById('confirm-input').addEventListener('input', function(e) {
    var btn = document.getElementById('confirm-submit-btn');
    if (e.target.value.trim().toUpperCase() === 'YES') {
      btn.classList.add('enabled');
    } else {
      btn.classList.remove('enabled');
    }
  });

  document.getElementById('confirm-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && e.target.value.trim().toUpperCase() === 'YES' && pendingDecision) {
      e.preventDefault();
      var decision = pendingDecision;
      var reason = pendingReason;
      hideConfirmModal();
      executeDecision(decision, reason);
    } else if (e.key === 'Escape') {
      hideConfirmModal();
    }
  });

  document.getElementById('confirm-cancel-btn').addEventListener('click', hideConfirmModal);

  document.getElementById('confirm-submit-btn').addEventListener('click', function() {
    if (!pendingDecision) return;
    var decision = pendingDecision;
    var reason = pendingReason;
    hideConfirmModal();
    executeDecision(decision, reason);
  });

  // -- Back --
  function goBack() {
    if (busy) return;
    busy = true;
    document.getElementById('back-spinner').classList.add('active');
    var backUrl = '/back' + (selfTypeFilter ? '?types=' + encodeURIComponent(selfTypeFilter) : '');
    api(backUrl, { method: 'POST', body: '{}' }).then(function(data) {
      // Update buffer and audit state
      applyNextData(data);
      // In review mode, remove the undone decision and navigate to the restored question
      if (MODE === 'review' && auditItems.length > 0) {
        // Find the first undecided question (the restored one) and navigate to it
        var foundUndecided = false;
        for (var ui = 0; ui < auditItems.length; ui++) {
          if (!auditDecisions[auditItems[ui].questionIndex]) {
            // Check if this was a previously decided question that's now back
            // Clear any stale decision for items that are back in the active buffer
            delete auditDecisions[auditItems[ui].questionIndex];
            if (!foundUndecided) {
              currentAuditIdx = ui;
              foundUndecided = true;
            }
          }
        }
        // Sync auditDecisions: only keep decisions for items NOT in the active buffer
        var activeQis = {};
        for (var ai = 0; ai < auditItems.length; ai++) activeQis[auditItems[ai].questionIndex] = true;
        var newDecisions = {};
        for (var dk in auditDecisions) {
          if (!activeQis[dk]) newDecisions[dk] = auditDecisions[dk];
        }
        auditDecisions = newDecisions;
        renderAuditProgress();
      }
      toast('Undid last decision', 'undo');
      resetCombo();
      totalDecided = Math.max(0, totalDecided - 1);
      updateProgress(data.remaining);
      document.getElementById('back-spinner').classList.remove('active');
      animateTransition(function() {
        if (buffer.length > 0 || (MODE === 'review' && auditItems.length > 0)) {
          showReview();
          renderCurrent();
        } else {
          showEmpty();
        }
        busy = false;
      });
    }).catch(function(err) {
      document.getElementById('back-spinner').classList.remove('active');
      toast(err.message, 'error');
      busy = false;
    });
  }

  // -- Transcript search --
  function openSearch() {
    var bar = document.getElementById('transcript-search');
    bar.classList.add('open');
    searchOpen = true;
    var input = document.getElementById('search-input');
    input.value = '';
    input.focus();
    clearSearchHighlights();
    searchMatches = [];
    searchIndex = -1;
    document.getElementById('search-count').textContent = '';
  }
  function closeSearch() {
    document.getElementById('transcript-search').classList.remove('open');
    searchOpen = false;
    clearSearchHighlights();
    searchMatches = [];
    searchIndex = -1;
    document.getElementById('search-input').value = '';
    document.getElementById('search-count').textContent = '';
    document.getElementById('search-input').blur();
  }
  function clearSearchHighlights() {
    var els = document.querySelectorAll('.t-search-match, .t-search-active');
    for (var i = 0; i < els.length; i++) {
      els[i].classList.remove('t-search-match', 't-search-active');
    }
  }
  function doSearch(query) {
    clearSearchHighlights();
    searchMatches = [];
    searchIndex = -1;
    if (!query || !query.trim()) {
      document.getElementById('search-count').textContent = '';
      return;
    }
    var q = query.trim().toLowerCase();
    var lines = document.querySelectorAll('#transcript-body .t-line');
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].textContent.toLowerCase().indexOf(q) !== -1) {
        lines[i].classList.add('t-search-match');
        searchMatches.push(lines[i]);
      }
    }
    document.getElementById('search-count').textContent = searchMatches.length > 0
      ? searchMatches.length + ' found' : 'no match';
  }
  function goToSearchMatch(idx) {
    if (searchMatches.length === 0) return;
    // Wrap around
    searchIndex = ((idx % searchMatches.length) + searchMatches.length) % searchMatches.length;
    // Remove previous active
    var prev = document.querySelector('.t-search-active');
    if (prev) prev.classList.remove('t-search-active');
    var el = searchMatches[searchIndex];
    el.classList.add('t-search-active');
    document.getElementById('search-count').textContent = (searchIndex + 1) + '/' + searchMatches.length;
    scrollToTranscriptLine(el);
    seekToTranscriptLine(el);
  }
  function scrollToTranscriptLine(el) {
    var body = document.getElementById('transcript-body');
    // Figure out which column this element is in
    var elLeft = el.offsetLeft;
    var targetCol = Math.floor(elLeft / colStep);
    // Center the target column in view (show it as the middle of 3 visible cols)
    var maxOffset = Math.max(0, totalCols - 3);
    colOffset = Math.max(0, Math.min(targetCol - 1, maxOffset));
    body.scrollTo({ left: colOffset * colStep, behavior: 'smooth' });
    updateColIndicator();
  }
  function seekToTranscriptLine(el) {
    var dur = recAudio.duration;
    if (!dur || isNaN(dur)) return;
    var timeAttr = parseFloat(el.getAttribute('data-time'));
    if (isNaN(timeAttr)) return; // no timestamp on this line, skip seek
    recAudio.currentTime = Math.min(timeAttr, dur);
    updateApTime();
  }

  // Search input handlers
  document.getElementById('search-input').addEventListener('input', function(e) {
    doSearch(e.target.value);
  });
  document.getElementById('search-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (searchMatches.length > 0) {
        goToSearchMatch(searchIndex < 0 ? 0 : searchIndex + 1);
      }
      this.blur(); // unfocus input so outer Enter handler can navigate queue items
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeSearch();
    } else if (e.key === ';') {
      // Allow ; to cycle while search input is focused too
      e.preventDefault();
      if (searchMatches.length > 0) {
        goToSearchMatch(searchIndex < 0 ? 0 : searchIndex + 1);
      }
    }
  });
  document.getElementById('search-close').addEventListener('click', closeSearch);

  // -- Accelerating skip --
  function skipSeek(dir) {
    var now = Date.now();
    var elapsed = now - skipLastPressTs;
    skipLastPressTs = now;

    // If pressed within 1s, bump tier; otherwise start fresh
    if (elapsed < 1000 && skipTier < SKIP_TIERS.length - 1) {
      skipTier++;
    } else if (elapsed >= 1000) {
      skipTier = 0;
    }

    var amount = SKIP_TIERS[skipTier];
    var dur = recAudio.duration;
    if (!dur || isNaN(dur)) { console.warn('[SKIP] skip blocked — duration=' + dur + ' readyState=' + recAudio.readyState); return; }
    var ct = recAudio.currentTime;
    if (isNaN(ct)) ct = 0;
    var newTime = dir > 0 ? Math.min(dur, ct + amount) : Math.max(0, ct - amount);
    console.log('[SKIP] dir=' + dir + ' tier=' + skipTier + ' amount=' + amount + 's ct=' + ct.toFixed(2) + ' → ' + newTime.toFixed(2) + ' (dur=' + dur.toFixed(2) + ')');
    recAudio.currentTime = newTime;

    // Update display immediately — timeupdate only fires during playback, not when paused
    updateApTime();

    // Clear any existing decay
    if (skipDecayTimer) { clearTimeout(skipDecayTimer); skipDecayTimer = null; }
    if (skipFadeTimer) { clearTimeout(skipFadeTimer); skipFadeTimer = null; }

    updateSkipBar(false);
    scheduleSkipDecay();
  }

  function updateSkipBar(decaying) {
    var indicator = document.getElementById('skip-indicator');
    var bar = document.getElementById('skip-bar');
    var label = document.getElementById('skip-label');
    indicator.classList.add('visible');
    label.textContent = SKIP_TIERS[skipTier] + 's';
    // Bar width: tier 0 = 33%, tier 1 = 66%, tier 2 = 100%
    var pct = ((skipTier + 1) / SKIP_TIERS.length) * 100;
    if (decaying) {
      bar.classList.add('decaying');
    } else {
      bar.classList.remove('decaying');
    }
    bar.style.width = pct + '%';
  }

  function scheduleSkipDecay() {
    // After 1s of no press, drop one tier. Repeat until tier 0, then fade out.
    skipDecayTimer = setTimeout(function decayStep() {
      if (skipTier > 0) {
        skipTier--;
        var label = document.getElementById('skip-label');
        label.textContent = SKIP_TIERS[skipTier] + 's';
        // Animate bar draining to the lower tier over 1s
        var nextPct = ((skipTier + 1) / SKIP_TIERS.length) * 100;
        var bar = document.getElementById('skip-bar');
        bar.classList.add('decaying');
        bar.style.width = nextPct + '%';
        // Schedule next decay step
        skipDecayTimer = setTimeout(decayStep, 1000);
      } else {
        // At tier 0 already, drain bar to 0 then fade
        var bar = document.getElementById('skip-bar');
        bar.classList.add('decaying');
        bar.style.width = '0%';
        skipFadeTimer = setTimeout(function() {
          document.getElementById('skip-indicator').classList.remove('visible');
          bar.classList.remove('decaying');
        }, 1000);
      }
    }, 1000);
  }

  // -- Cheat sheet toggle --
  function toggleCheatSheet() {
    document.getElementById('cheat-sheet').classList.toggle('open');
  }
  document.getElementById('help-hint').addEventListener('click', function(e) {
    e.stopPropagation();
    toggleCheatSheet();
  });

  // Close cheat sheet when clicking outside
  document.addEventListener('click', function(e) {
    var cs = document.getElementById('cheat-sheet');
    if (cs.classList.contains('open') && !cs.contains(e.target)) {
      cs.classList.remove('open');
    }
  });

  // -- Speed display --
  function updateSpeedDisplay() {
    var el = document.getElementById('ap-speed');
    if (!el) return;
    el.textContent = playbackRate.toFixed(1) + '\u00d7';
    if (playbackRate === 1.0) {
      el.style.visibility = 'hidden';
      el.style.color = '#6e7681';
    } else {
      el.style.visibility = 'visible';
      el.style.color = playbackRate > 1 ? '#58a6ff' : '#fbbf24';
    }
  }

  // -- Arrow keys: capture phase so scrollable transcript can't steal them --
  document.addEventListener('keydown', function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (document.getElementById('confirm-overlay').classList.contains('open')) return;

    // Speed controls
    if (!e.ctrlKey && e.key === 'ArrowUp') {
      e.preventDefault();
      playbackRate = Math.min(3.0, Math.round((playbackRate + 0.5) * 10) / 10);
      recAudio.playbackRate = playbackRate;
      updateSpeedDisplay();
      return;
    }
    if (!e.ctrlKey && e.key === 'ArrowDown') {
      e.preventDefault();
      playbackRate = Math.max(0.5, Math.round((playbackRate - 0.5) * 10) / 10);
      recAudio.playbackRate = playbackRate;
      updateSpeedDisplay();
      return;
    }

    // Seek arrow keys (capture before browser scroll)
    if (e.key === 'ArrowLeft' && !e.ctrlKey) { e.preventDefault(); skipSeek(-1); return; }
    if (e.key === 'ArrowRight' && !e.ctrlKey) { e.preventDefault(); skipSeek(1); return; }
  }, true); // capture phase

  // -- Keyboard (bubbling phase for all other keys) --
  document.addEventListener('keydown', function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (document.getElementById('confirm-overlay').classList.contains('open')) return;
    if (e.ctrlKey) return; // already handled in capture phase

    switch (e.key) {
      case '?': e.preventDefault(); toggleCheatSheet(); return;
      case '/': e.preventDefault(); openSearch(); return;
      case ';':
        e.preventDefault();
        if (searchMatches.length > 0) goToSearchMatch(searchIndex < 0 ? 0 : searchIndex + 1);
        return;
    }

    switch (e.key.toLowerCase()) {
      ${keydownCases}
      case 'b':
      case 'backspace': e.preventDefault(); goBack(); break;
      case 'l': scrollColumns(1); break;
      case 'h': scrollColumns(-1); break;
      case 'k': scrollColumns(-1); break;
      case 'p':
      case ' ': e.preventDefault(); if (recAudio.paused) recAudio.play(); else recAudio.pause(); break;
      case 'j': e.preventDefault(); jumpToAudio(); break;
    }
  });

  // -- Type filter (reviewer only) --
  (function() {
    var el = document.getElementById('type-filter');
    if (!el) return;
    // Restore persisted preference so the initial buffer respects it
    var saved = localStorage.getItem(STORAGE_PREFIX + '_typefilter');
    if (saved && (saved === 'date-leg' || saved === 'package')) {
      selfTypeFilter = saved;
      el.value = saved;
    }
    el.addEventListener('change', function() {
      selfTypeFilter = this.value;
      localStorage.setItem(STORAGE_PREFIX + '_typefilter', this.value);
      loadNext();
    });
  })();

  // -- Logout --
  document.getElementById('logout-btn').addEventListener('click', function() {
    api('/logout', { method: 'POST', body: '{}' }).catch(function(){});
    window.location.href = '/login';
  });

  // -- Audio player --
  var recAudio = document.getElementById('rec-audio');
  var apPlay = document.getElementById('ap-play');
  var apIconPlay = document.getElementById('ap-icon-play');
  var apIconPause = document.getElementById('ap-icon-pause');
  var apTime = document.getElementById('ap-time');
  var wfCanvas = document.getElementById('ap-waveform');
  var wfCtx = wfCanvas.getContext('2d');
  var wfBars = null; // Float32Array of normalised bar heights
  var currentRecFinding = null;
  var WF_N = 120; // number of bars
  var WF_PLAYED = '${btnHover}';
  var WF_UNPLAYED = '#1e2736';
  var WF_HEAD = '${accentLight}';

  function fmtTime(s) { var m = Math.floor(s/60); var sec = Math.floor(s%60); return m + ':' + (sec<10?'0':'') + sec; }

  function drawWaveform() {
    var dpr = window.devicePixelRatio || 1;
    var rect = wfCanvas.getBoundingClientRect();
    var pw = Math.round(rect.width * dpr), ph = Math.round(rect.height * dpr);
    if (pw > 0 && ph > 0 && (wfCanvas.width !== pw || wfCanvas.height !== ph)) { wfCanvas.width = pw; wfCanvas.height = ph; }
    var w = wfCanvas.width, h = wfCanvas.height;
    wfCtx.clearRect(0, 0, w, h);
    var cur = recAudio.currentTime || 0;
    var dur = recAudio.duration || 0;
    var pct = dur > 0 ? cur / dur : 0;
    if (!wfBars) {
      // Loading placeholder: flat dim line
      wfCtx.fillStyle = WF_UNPLAYED;
      wfCtx.fillRect(0, h/2 - 1, w, 2);
      return;
    }
    var bars = wfBars.length;
    var gap = 1;
    var barW = (w - gap * (bars - 1)) / bars;
    for (var i = 0; i < bars; i++) {
      var amp = wfBars[i];
      var barH = Math.max(2, amp * h * 0.9);
      var x = i * (barW + gap);
      var played = (i / bars) < pct;
      wfCtx.fillStyle = played ? WF_PLAYED : WF_UNPLAYED;
      wfCtx.beginPath();
      var r = Math.min(barW / 2, 1.5);
      var y = (h - barH) / 2;
      wfCtx.roundRect(x, y, barW, barH, r);
      wfCtx.fill();
    }
    // Playhead
    if (dur > 0) {
      wfCtx.fillStyle = WF_HEAD;
      wfCtx.fillRect(Math.round(pct * w) - 1, 0, 2, h);
    }
  }

  function updateApTime() {
    var cur = recAudio.currentTime||0; var dur = recAudio.duration||0;
    apTime.textContent = fmtTime(cur) + '/' + fmtTime(dur);
    drawWaveform();
  }

  function loadWaveform(findingId) {
    wfBars = null;
    drawWaveform();
    fetch('/audit/recording?id=' + encodeURIComponent(findingId))
      .then(function(r) { return r.arrayBuffer(); })
      .then(function(buf) {
        var ctx = new AudioContext();
        return ctx.decodeAudioData(buf).then(function(decoded) {
          var ch = decoded.getChannelData(0);
          var sPerBar = Math.floor(ch.length / WF_N);
          var bars = new Float32Array(WF_N);
          var max = 0;
          for (var i = 0; i < WF_N; i++) {
            var sum = 0;
            for (var j = 0; j < sPerBar; j++) sum += Math.abs(ch[i * sPerBar + j]);
            bars[i] = sum / sPerBar;
            if (bars[i] > max) max = bars[i];
          }
          if (max > 0) for (var i = 0; i < WF_N; i++) bars[i] /= max;
          wfBars = bars;
          ctx.close();
          drawWaveform();
        });
      })
      .catch(function(e) { console.error('[WAVEFORM] decode error', e); });
  }

  function loadRecording(findingId) {
    if (!findingId || findingId === currentRecFinding) return;
    currentRecFinding = findingId;
    recAudio.src = '/audit/recording?id=' + encodeURIComponent(findingId);
    recAudio.load();
    apTime.textContent = '0:00';
    apIconPlay.style.display = 'block';
    apIconPause.style.display = 'none';
    loadWaveform(findingId);
  }
  apPlay.addEventListener('click', function() {
    if (recAudio.paused) recAudio.play(); else recAudio.pause();
  });
  recAudio.addEventListener('play', function() { apIconPlay.style.display='none'; apIconPause.style.display='block'; });
  recAudio.addEventListener('pause', function() { apIconPlay.style.display='block'; apIconPause.style.display='none'; });
  recAudio.addEventListener('ended', function() { apIconPlay.style.display='block'; apIconPause.style.display='none'; });
  recAudio.addEventListener('timeupdate', updateApTime);
  recAudio.addEventListener('loadedmetadata', updateApTime);
  wfCanvas.addEventListener('click', function(e) {
    var rect = wfCanvas.getBoundingClientRect();
    var pct = (e.clientX - rect.left) / rect.width;
    var dur = recAudio.duration;
    if (!dur || isNaN(dur)) { console.warn('[WF-CLICK] blocked — duration=' + dur + ' readyState=' + recAudio.readyState); return; }
    var newTime = pct * dur;
    console.log('[WF-CLICK] pct=' + pct.toFixed(3) + ' → ' + newTime.toFixed(2) + 's (dur=' + dur.toFixed(2) + ')');
    recAudio.currentTime = newTime;
    updateApTime();
  });
  document.getElementById('ap-back').addEventListener('click', function() { recAudio.currentTime = Math.max(0, recAudio.currentTime - 5); });
  document.getElementById('ap-fwd').addEventListener('click', function() {
    var dur = recAudio.duration;
    if (!dur || isNaN(dur)) return;
    recAudio.currentTime = Math.min(dur, recAudio.currentTime + 5);
  });

  ${!R ? `
  // -- Add 2nd Genie / Different Recording (judge only) --
  window.openAddGenieModal = function() { openAddGenieModal(); };
  window.closeAddGenieModal = function() { closeAddGenieModal(); };
  window.submitAddGenie = function() { submitAddGenie(); };
  window.addGenieRow = function() { addGenieRow(); };
  window.setAddGenieMode = function(m) { setAddGenieMode(m); };
  window.openDismissModal = function() { openDismissModal(); };
  window.closeDismissModal = function() { closeDismissModal(); };
  window.submitDismissAppeal = function() { submitDismissAppeal(); };

  var addGenieMode = 'genie';
  function setAddGenieMode(mode) {
    addGenieMode = mode;
    var gPanel = document.getElementById('add-genie-panel-genie');
    var uPanel = document.getElementById('add-genie-panel-upload');
    var gBtn = document.getElementById('add-genie-mode-genie');
    var uBtn = document.getElementById('add-genie-mode-upload');
    if (mode === 'upload') {
      gPanel.style.display = 'none';
      uPanel.style.display = '';
      gBtn.style.background = 'none';
      gBtn.style.color = '#6e7681';
      uBtn.style.background = '#161b22';
      uBtn.style.color = '#c9d1d9';
    } else {
      uPanel.style.display = 'none';
      gPanel.style.display = '';
      uBtn.style.background = 'none';
      uBtn.style.color = '#6e7681';
      gBtn.style.background = '#161b22';
      gBtn.style.color = '#c9d1d9';
    }
    document.getElementById('add-genie-error').style.display = 'none';
  }

  function makeGenieRowInput(value, removable) {
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;align-items:center;';
    var inp = document.createElement('input');
    inp.type = 'text';
    inp.autocomplete = 'off';
    inp.spellcheck = false;
    inp.placeholder = '8-digit Genie ID';
    inp.maxLength = 8;
    inp.value = value || '';
    inp.style.cssText = 'flex:1;padding:10px 14px;background:#0a0e14;border:1px solid #1e2736;border-radius:8px;color:#c9d1d9;font-size:14px;outline:none;box-sizing:border-box;';
    inp.addEventListener('keydown', function(e) { e.stopPropagation(); });
    var removeBtn = document.createElement('button');
    removeBtn.textContent = '×';
    removeBtn.style.cssText = 'background:none;border:none;color:#6e7681;font-size:18px;cursor:pointer;line-height:1;padding:0 4px;flex-shrink:0;';
    removeBtn.style.visibility = removable ? 'visible' : 'hidden';
    removeBtn.disabled = !removable;
    removeBtn.addEventListener('click', function() {
      row.remove();
      // show remove btn on first row if only one remains
      var rows = document.getElementById('add-genie-rows');
      if (rows && rows.children.length === 1) {
        var firstRemove = rows.children[0].querySelector('button');
        if (firstRemove) { firstRemove.style.visibility = 'hidden'; firstRemove.disabled = true; }
      }
    });
    row.appendChild(inp);
    row.appendChild(removeBtn);
    return row;
  }

  function addGenieRow(value) {
    var rows = document.getElementById('add-genie-rows');
    if (!rows) return;
    // If we're adding a second row, make the first one's remove button visible
    if (rows.children.length === 1) {
      var firstRemove = rows.children[0].querySelector('button');
      if (firstRemove) { firstRemove.style.visibility = 'visible'; firstRemove.disabled = false; }
    }
    var row = makeGenieRowInput(value || '', true);
    rows.appendChild(row);
    row.querySelector('input').focus();
  }

  function openAddGenieModal() {
    if (!buffer[0]) return;
    var rows = document.getElementById('add-genie-rows');
    rows.innerHTML = '';
    var originalId = buffer[0].recordingId || '';
    rows.appendChild(makeGenieRowInput(originalId, false));
    document.getElementById('add-genie-comment').value = '';
    document.getElementById('add-genie-file').value = '';
    document.getElementById('add-genie-dropzone-label').textContent = 'Drop MP3 here or click to browse';
    document.getElementById('add-genie-dropzone').style.borderColor = '#1e2736';
    document.getElementById('add-genie-dropzone').style.color = '#6e7681';
    document.getElementById('add-genie-snip-start').value = '';
    document.getElementById('add-genie-snip-end').value = '';
    document.getElementById('add-genie-error').style.display = 'none';
    document.getElementById('add-genie-submit').disabled = false;
    document.getElementById('add-genie-submit').textContent = 'Submit';
    setAddGenieMode('genie');
    document.getElementById('add-genie-overlay').style.display = 'flex';
    // Focus the first input if empty, otherwise add a blank row ready for the 2nd ID
    var firstInput = rows.querySelector('input');
    if (originalId) {
      addGenieRow('');
    } else {
      firstInput.focus();
    }
  }
  function closeAddGenieModal() {
    document.getElementById('add-genie-overlay').style.display = 'none';
  }
  function parseMmSs(val) {
    if (!val) return null;
    var parts = val.trim().split(':');
    if (parts.length === 2) {
      var m = parseInt(parts[0], 10);
      var s = parseFloat(parts[1]);
      if (!isNaN(m) && !isNaN(s)) return Math.round((m * 60 + s) * 1000);
    }
    var s2 = parseFloat(val);
    if (!isNaN(s2)) return Math.round(s2 * 1000);
    return null;
  }

  function afterGenieSuccess(currentItem) {
    return fetch('/judge/api/dismiss-finding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ findingId: currentItem.findingId }),
    }).catch(function(){}).then(function() {
      closeAddGenieModal();
      toast('Re-audit submitted — removed from judge queue', 'pos');
      loadNext();
    });
  }

  function submitAddGenie() {
    var currentItem = buffer[0];
    if (!currentItem) return;
    var btn = document.getElementById('add-genie-submit');
    var errEl = document.getElementById('add-genie-error');
    errEl.style.display = 'none';
    var comment = document.getElementById('add-genie-comment').value.trim();

    if (addGenieMode === 'upload') {
      var fileInput = document.getElementById('add-genie-file');
      var file = fileInput.files && fileInput.files[0];
      if (!file) {
        errEl.textContent = 'Please select an MP3 file to upload.';
        errEl.style.display = '';
        return;
      }
      var snipStart = parseMmSs(document.getElementById('add-genie-snip-start').value);
      var snipEnd = parseMmSs(document.getElementById('add-genie-snip-end').value);
      var fd = new FormData();
      fd.append('findingId', currentItem.findingId);
      fd.append('file', file);
      if (snipStart !== null) fd.append('snipStart', String(snipStart));
      if (snipEnd !== null) fd.append('snipEnd', String(snipEnd));
      if (comment) fd.append('comment', comment);
      btn.disabled = true;
      btn.textContent = 'Uploading...';
      fetch('/audit/appeal/upload-recording', { method: 'POST', body: fd })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d.error) {
            errEl.textContent = d.error;
            errEl.style.display = '';
            btn.disabled = false;
            btn.textContent = 'Submit';
          } else {
            afterGenieSuccess(currentItem);
          }
        }).catch(function(err) {
          errEl.textContent = err.message || 'Upload failed';
          errEl.style.display = '';
          btn.disabled = false;
          btn.textContent = 'Submit';
        });
      return;
    }

    var inputs = document.getElementById('add-genie-rows').querySelectorAll('input');
    var ids = [];
    inputs.forEach(function(inp) { var v = inp.value.trim(); if (v) ids.push(v); });
    if (ids.length === 0) {
      errEl.textContent = 'Please enter at least one Genie ID.';
      errEl.style.display = '';
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Submitting...';
    var payload = { findingId: currentItem.findingId, recordingIds: ids };
    if (comment) payload.comment = comment;
    fetch('/audit/appeal/different-recording', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(function(r) { return r.json(); }).then(function(d) {
      if (d.error) {
        errEl.textContent = d.error;
        errEl.style.display = '';
        btn.disabled = false;
        btn.textContent = 'Submit';
      } else {
        afterGenieSuccess(currentItem);
      }
    }).catch(function(err) {
      errEl.textContent = err.message || 'Request failed';
      errEl.style.display = '';
      btn.disabled = false;
      btn.textContent = 'Submit';
    });
  }
  document.getElementById('add-genie-overlay').addEventListener('click', function(e) {
    if (e.target === this) closeAddGenieModal();
  });
  document.getElementById('add-genie-comment').addEventListener('keydown', function(e) {
    e.stopPropagation();
    if (e.key === 'Enter') submitAddGenie();
  });
  ['add-genie-snip-start', 'add-genie-snip-end'].forEach(function(id) {
    document.getElementById(id).addEventListener('keydown', function(e) { e.stopPropagation(); });
  });
  (function() {
    var dz = document.getElementById('add-genie-dropzone');
    var fi = document.getElementById('add-genie-file');
    function setDropFile(file) {
      if (!file) return;
      document.getElementById('add-genie-dropzone-label').textContent = file.name;
      dz.style.borderColor = '#14b8a6';
      dz.style.color = '#c9d1d9';
    }
    fi.addEventListener('change', function() { setDropFile(fi.files[0]); });
    dz.addEventListener('dragover', function(e) { e.preventDefault(); dz.style.borderColor = '#14b8a6'; dz.style.background = 'rgba(20,184,166,0.05)'; });
    dz.addEventListener('dragleave', function(e) { if (!dz.contains(e.relatedTarget)) { dz.style.borderColor = '#1e2736'; dz.style.background = '#0a0e14'; } });
    dz.addEventListener('drop', function(e) {
      e.preventDefault(); dz.style.borderColor = '#1e2736'; dz.style.background = '#0a0e14';
      var file = e.dataTransfer.files[0];
      if (!file) return;
      var dt = new DataTransfer(); dt.items.add(file); fi.files = dt.files;
      setDropFile(file);
    });
  })();

  // -- Dismiss Appeal (judge only) --
  function openDismissModal() {
    if (!buffer[0]) return;
    document.getElementById('dismiss-reason').value = '';
    document.getElementById('dismiss-error').style.display = 'none';
    var btn = document.getElementById('dismiss-submit');
    btn.disabled = false;
    btn.textContent = 'Confirm Dismiss';
    document.getElementById('dismiss-appeal-overlay').style.display = 'flex';
    setTimeout(function() { document.getElementById('dismiss-reason').focus(); }, 50);
  }
  function closeDismissModal() {
    document.getElementById('dismiss-appeal-overlay').style.display = 'none';
  }
  function submitDismissAppeal() {
    var currentItem = buffer[0];
    if (!currentItem) return;
    var reason = document.getElementById('dismiss-reason').value.trim();
    var errEl = document.getElementById('dismiss-error');
    if (!reason) {
      errEl.textContent = 'Please enter a reason for dismissal.';
      errEl.style.display = '';
      return;
    }
    var btn = document.getElementById('dismiss-submit');
    btn.disabled = true;
    btn.textContent = 'Dismissing...';
    errEl.style.display = 'none';
    fetch('/judge/api/dismiss-appeal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ findingId: currentItem.findingId, reason: reason }),
    }).then(function(r) { return r.json(); }).then(function(d) {
      if (d.error) {
        errEl.textContent = d.error;
        errEl.style.display = '';
        btn.disabled = false;
        btn.textContent = 'Confirm Dismiss';
      } else {
        closeDismissModal();
        toast('Appeal dismissed — removed from queue', 'pos');
        loadNext();
      }
    }).catch(function(err) {
      errEl.textContent = err.message || 'Dismiss failed';
      errEl.style.display = '';
      btn.disabled = false;
      btn.textContent = 'Confirm Dismiss';
    });
  }
  document.getElementById('dismiss-appeal-overlay').addEventListener('click', function(e) {
    if (e.target === this) closeDismissModal();
  });
  document.getElementById('dismiss-reason').addEventListener('keydown', function(e) {
    e.stopPropagation();
  });
  ` : ''}

  // -- Init: try resuming session (or preview mode if ?id=X in URL) --
  (function() {
    function hideOverlay() {
      var ov = document.getElementById('init-overlay');
      if (ov) { ov.style.opacity = '0'; setTimeout(function() { ov.remove(); }, 420); }
    }
    var previewId = new URLSearchParams(window.location.search).get('id');
    var initUrl = previewId ? '/preview?id=' + encodeURIComponent(previewId) : nextUrl();
    api(initUrl).then(function(data) {
      reviewer = data.reviewer || '${mode}';
      document.getElementById('reviewer-tag').innerHTML = '<strong>' + reviewer + '</strong>';
      if (data.preview) {
        // Preview mode: show banner, hide decide buttons
        var tag = document.getElementById('reviewer-tag');
        if (tag) tag.innerHTML += ' <span style="background:rgba(255,200,50,0.2);color:var(--yellow);font-size:9px;padding:2px 6px;border-radius:4px;font-weight:700;letter-spacing:0.5px;">PREVIEW</span>';
      }
      loadGameState();
      if (!data.preview) {
        api('/stats').then(function(stats) {
          totalItems = stats.pending + stats.decided;
          totalDecided = stats.decided;
          updateProgress(stats.pending);
        }).catch(function(){});
      }
      applyNextData(data);
      if (buffer.length > 0) {
        showReview();
      } else {
        showEmpty();
      }
      hideOverlay();
    }).catch(function() {
      hideOverlay();
      window.location.href = '/login';
    });
  })();
})();
</script>

<!-- Chat Drawer -->
<div id="chat-drawer">
  <div class="chat-header">
    <button class="chat-back" id="chat-back-btn">&larr;</button>
    <span id="chat-title">Messages</span>
    <button id="chat-close-btn">&times;</button>
  </div>
  <div id="chat-user-list"></div>
  <div id="chat-messages"></div>
  <div id="chat-input-area">
    <input type="text" id="chat-input" placeholder="Type a message..." autocomplete="off">
    <button id="chat-send">Send</button>
  </div>
</div>

<script>
(function() {
  var drawer = document.getElementById('chat-drawer');
  var toggle = document.getElementById('chat-toggle');
  var closeBtn = document.getElementById('chat-close-btn');
  var backBtn = document.getElementById('chat-back-btn');
  var userList = document.getElementById('chat-user-list');
  var messagesEl = document.getElementById('chat-messages');
  var inputArea = document.getElementById('chat-input-area');
  var chatInput = document.getElementById('chat-input');
  var sendBtn = document.getElementById('chat-send');
  var chatTitle = document.getElementById('chat-title');
  var chatBadge = document.getElementById('chat-badge');
  var currentPeer = null;
  var pollTimer = null;

  function initials(email) {
    return email.split('@')[0].slice(0,2).toUpperCase();
  }
  function timeAgo(ts) {
    var d = (Date.now() - ts) / 1000;
    if (d < 60) return 'now';
    if (d < 3600) return Math.floor(d/60) + 'm';
    if (d < 86400) return Math.floor(d/3600) + 'h';
    return Math.floor(d/86400) + 'd';
  }

  toggle.addEventListener('click', function() {
    if (drawer.classList.contains('open')) {
      closeDrawer();
    } else {
      drawer.classList.add('open');
      showUserList();
    }
  });
  closeBtn.addEventListener('click', closeDrawer);
  backBtn.addEventListener('click', function() { showUserList(); });

  function closeDrawer() {
    drawer.classList.remove('open');
    currentPeer = null;
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  async function showUserList() {
    currentPeer = null;
    backBtn.classList.remove('show');
    chatTitle.textContent = 'Messages';
    userList.style.display = '';
    messagesEl.classList.remove('open');
    inputArea.classList.remove('open');
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }

    try {
      var [convRes, usersRes] = await Promise.all([
        fetch('/api/messages/conversations'),
        fetch('/api/users')
      ]);
      var conversations = await convRes.json();
      var allUsers = await usersRes.json();

      var html = '';
      var shown = new Set();

      // Existing conversations first
      for (var c of conversations) {
        shown.add(c.email);
        html += '<div class="chat-user-item" data-email="' + c.email + '">' +
          '<div class="chat-user-avatar">' + initials(c.email) + '</div>' +
          '<div class="chat-user-info"><div class="chat-user-name">' + c.email.split('@')[0] + '</div>' +
          '<div class="chat-user-preview">' + (c.lastMessage ? c.lastMessage.body.slice(0,40) : '') + '</div></div>' +
          (c.unread > 0 ? '<div class="chat-user-unread">' + c.unread + '</div>' : '') +
          '</div>';
      }

      // Other org users
      for (var u of allUsers) {
        if (!shown.has(u.email)) {
          html += '<div class="chat-user-item" data-email="' + u.email + '">' +
            '<div class="chat-user-avatar">' + initials(u.email) + '</div>' +
            '<div class="chat-user-info"><div class="chat-user-name">' + u.email.split('@')[0] + '</div>' +
            '<div class="chat-user-preview">' + u.role + '</div></div></div>';
        }
      }

      userList.innerHTML = html || '<div style="text-align:center;color:#484f58;padding:40px;font-size:13px">No users yet</div>';
      userList.querySelectorAll('.chat-user-item').forEach(function(el) {
        el.addEventListener('click', function() { openConversation(el.dataset.email); });
      });
    } catch(e) {
      userList.innerHTML = '<div style="text-align:center;color:#484f58;padding:40px;font-size:13px">Failed to load</div>';
    }
  }

  async function openConversation(email) {
    currentPeer = email;
    backBtn.classList.add('show');
    chatTitle.textContent = email.split('@')[0];
    userList.style.display = 'none';
    messagesEl.classList.add('open');
    inputArea.classList.add('open');
    chatInput.focus();
    await loadMessages(email);
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(function() { if (currentPeer === email) loadMessages(email); }, 3000);
  }

  async function loadMessages(email) {
    try {
      var res = await fetch('/api/messages/' + encodeURIComponent(email));
      var messages = await res.json();
      messages.reverse();
      var html = '';
      for (var m of messages) {
        var cls = m.from === email ? 'received' : 'sent';
        html += '<div class="chat-msg ' + cls + '">' + escapeHtml(m.body) +
          '<div class="chat-msg-time">' + timeAgo(m.ts) + '</div></div>';
      }
      messagesEl.innerHTML = html || '<div style="text-align:center;color:#484f58;padding:40px;font-size:13px">No messages yet</div>';
      messagesEl.scrollTop = messagesEl.scrollHeight;
    } catch(e) { /* ignore */ }
  }

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  async function sendMsg() {
    if (!currentPeer || !chatInput.value.trim()) return;
    var body = chatInput.value.trim();
    chatInput.value = '';
    try {
      await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: currentPeer, body: body })
      });
      await loadMessages(currentPeer);
    } catch(e) { /* ignore */ }
  }

  sendBtn.addEventListener('click', sendMsg);
  chatInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
    e.stopPropagation(); // prevent queue hotkeys from firing
  });
  chatInput.addEventListener('keyup', function(e) { e.stopPropagation(); });

  // Poll unread count for badge
  async function pollUnread() {
    try {
      var res = await fetch('/api/messages/unread');
      var data = await res.json();
      if (data.count > 0) {
        chatBadge.textContent = data.count;
        chatBadge.style.display = 'flex';
      } else {
        chatBadge.style.display = 'none';
      }
    } catch(e) { /* ignore */ }
  }
  pollUnread();
  setInterval(pollUnread, 10000);
})();
</script>
</body>
</html>`;
}
