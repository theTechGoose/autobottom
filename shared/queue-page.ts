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
      </div>
      <div class="cs-section">
        <div class="cs-group-label">Playback</div>
        <div class="cs-row"><kbd>P</kbd><span>Play / Pause</span></div>
        <div class="cs-row"><kbd>&larr;</kbd> <kbd>&rarr;</kbd><span>Seek (accel)</span></div>
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
      </div>
      <div class="cs-section">
        <div class="cs-group-label">Playback</div>
        <div class="cs-row"><kbd>P</kbd><span>Play / Pause</span></div>
        <div class="cs-row"><kbd>&larr;</kbd> <kbd>&rarr;</kbd><span>Seek (accel)</span></div>
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
        appealCallout.innerHTML = '<div class="appeal-callout-label">Agent Comment</div>' + currentItem.appealComment.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\\n/g, '<br>');
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
  .t-agent { border-left-color: ${agentBorder}; color: ${agentColor}; }
  .t-customer { border-left-color: ${custBorder}; color: ${custColor}; }
  .t-system { border-left-color: #2d333b; color: #484f58; }
  .t-line.t-highlight { background: ${highlightBg}; }
  .t-line.t-evidence { background: rgba(250,176,5,0.1); border-left-color: #fab005 !important; }
  .t-line.t-evidence .t-speaker { color: #fab005 !important; }
  .t-speaker { font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; margin-right: 8px; }
  .t-agent .t-speaker { color: ${agentSpeaker}; }
  .t-customer .t-speaker { color: ${custSpeaker}; }
  .t-system .t-speaker { color: #484f58; }

  /* ===== Bottom bar ===== */
  #bottom-bar {
    grid-column: 1 / -1; grid-row: 3;
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 24px; background: #0f1219; border-top: 1px solid #1a1f2b;
    height: 44px;
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
  .ap { display: flex; align-items: center; gap: 6px; }
  .ap-play {
    width: 22px; height: 22px; border-radius: 50%; border: none; cursor: pointer;
    background: ${btnAccent}; color: #fff; display: flex; align-items: center; justify-content: center;
    transition: all 0.15s; flex-shrink: 0; padding: 0;
  }
  .ap-play:hover { background: ${btnHover}; box-shadow: 0 0 8px ${btnShadow}; }
  .ap-play svg { width: 9px; height: 9px; fill: #fff; }
  .ap-track { width: 140px; height: 4px; background: #1a1f2b; border-radius: 2px; cursor: pointer; position: relative; transition: height 0.15s; }
  .ap-track:hover { height: 6px; }
  .ap-track:hover .ap-thumb { opacity: 1; }
  .ap-fill { height: 100%; background: ${btnHover}; border-radius: 2px; width: 0%; pointer-events: none; transition: width 0.1s; position: relative; }
  .ap-thumb { position: absolute; right: -4px; top: 50%; transform: translateY(-50%); width: 8px; height: 8px; border-radius: 50%; background: ${accentLight}; opacity: 0; transition: opacity 0.15s; pointer-events: none; }
  .ap-time { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 9px; color: #3d4452; white-space: nowrap; }
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
</head>
<body>

<!-- Queue screen -->
<div id="review-screen">
  <div id="progress-bar-container"><div id="progress-bar"></div></div>

  <!-- Left: Verdict panel -->
  <div id="verdict-panel">
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

      <div id="meta-row">
        <div class="meta-chip">Audit <strong id="m-finding"></strong></div>
        <div class="meta-chip">Q<strong id="m-qindex"></strong></div>
        <div class="meta-chip">Left <strong id="m-remaining"></strong></div>
        <div class="meta-chip last-item" id="m-last" style="display:none"><strong>${lastItemLabel}</strong></div>
      </div>
    </div>
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
      <audio id="rec-audio" preload="none" style="display:none"></audio>
      <button class="ap-play" id="ap-play" title="Play recording">
        <span id="ap-icon-play">${icons.play16}</span>
        <span id="ap-icon-pause" style="display:none">${icons.pause16}</span>
      </button>
      <button class="ap-seek" id="ap-back" title="Back 5s (Left arrow)">&larr;5s</button>
      <div class="ap-track" id="ap-track"><div class="ap-fill" id="ap-fill"><div class="ap-thumb"></div></div></div>
      <button class="ap-seek" id="ap-fwd" title="Forward 5s (Right arrow)">5s&rarr;</button>
      <span class="ap-time" id="ap-time">0:00</span>
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
  var currentItem = null;
  var peekItem = null;
  var currentTranscript = null;
  var reviewer = null;
  var busy = false;
  var currentAuditRemaining = 0;
  var pendingDecision = null;
  var pendingReason = null;
  var REASON_LABELS = { error: 'Error', logic: 'Logic', fragment: 'Fragment', transcript: 'Transcript' };
  var transcriptCache = {};

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

  // -- Queue --
  function loadNext() {
    return api('/next').then(function(data) {
      if (!data.current) {
        showEmpty();
        return;
      }
      currentItem = data.current;
      peekItem = data.peek;
      currentTranscript = data.transcript;
      currentAuditRemaining = data.auditRemaining || 0;
      if (currentTranscript && currentItem) {
        transcriptCache[currentItem.findingId] = currentTranscript;
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
    if (!currentItem) return;
    if (searchOpen) closeSearch();
    document.getElementById('q-header').textContent = currentItem.header;
    document.getElementById('q-populated').textContent = currentItem.populated;
    document.getElementById('q-defense').textContent = currentItem.defense || 'No defense provided';
    document.getElementById('thinking-text').textContent = currentItem.thinking || 'No reasoning provided';
    document.getElementById('m-finding').textContent = currentItem.findingId;
    document.getElementById('m-qindex').textContent = String(currentItem.questionIndex);

    ${verdictBadgeRenderJs}

    var remaining = peekItem ? '...' : '0';
    document.getElementById('m-remaining').textContent = remaining;

    document.getElementById('m-last').style.display = currentAuditRemaining === 1 ? '' : 'none';

    document.getElementById('thinking-content').classList.remove('open');
    document.querySelector('#thinking-toggle .arrow').classList.remove('open');

    loadRecording(currentItem.findingId);
    renderTranscript();
  }

  // -- Thinking toggle --
  document.getElementById('thinking-toggle').addEventListener('click', toggleThinking);
  function toggleThinking() {
    var content = document.getElementById('thinking-content');
    var arrow = document.querySelector('#thinking-toggle .arrow');
    content.classList.toggle('open');
    arrow.classList.toggle('open');
  }

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

  function renderTranscript() {
    var body = document.getElementById('transcript-body');
    body.innerHTML = '';
    if (!currentTranscript || (!currentTranscript.diarized && !currentTranscript.raw)) {
      body.innerHTML = '<p style="color:#3d4452;padding:20px">No transcript available</p>';
      return;
    }
    var text = currentTranscript.diarized || currentTranscript.raw;
    var defense = (currentItem && currentItem.defense || '').toLowerCase();
    var thinking = (currentItem && currentItem.thinking || '').toLowerCase();
    var evidenceSnippets = extractEvidenceSnippets(currentItem && currentItem.defense, currentItem && currentItem.thinking);
    var lines = text.split('\\n');
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li];
      if (!line.trim()) continue;
      var div = document.createElement('div');
      div.className = 't-line';

      var match = line.match(/^\\[?(AGENT|CUSTOMER|SYSTEM|Agent|Customer|System)\\]?[:\\s]*(.*)/i);
      if (match) {
        var speaker = match[1].toUpperCase();
        var content = match[2] || '';
        div.classList.add(speaker === 'AGENT' ? 't-agent' : speaker === 'CUSTOMER' ? 't-customer' : 't-system');
        var label = document.createElement('span');
        label.className = 't-speaker';
        label.textContent = speaker;
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
  function decide(decision, reason) {
    if (!currentItem || busy) return;

    if (currentAuditRemaining === 1) {
      pendingDecision = decision;
      pendingReason = reason || null;
      showConfirmModal();
      return;
    }

    executeDecision(decision, reason);
  }

  function executeDecision(decision, reason) {
    if (!currentItem || busy) return;
    busy = true;
    var item = currentItem;

    trackDecision();
    tickCombo();
    sessionReviews++;
    updateSessionCount();
    awardXp(decision === POSITIVE_DECISION ? 10 : 15);
    updateStreak();

    var didSwap = false;
    if (peekItem) {
      didSwap = true;
      currentItem = peekItem;
      peekItem = null;
      if (transcriptCache[currentItem.findingId]) {
        currentTranscript = transcriptCache[currentItem.findingId];
      }
      animateTransition(function() { renderCurrent(); });
    }

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

    fetch(API + '/decide', {
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify(bodyObj),
    }).then(function(res) {
      return res.json().then(function(data) {
        if (res.status === 409) { busy = false; return; }
        if (!res.ok) throw new Error(data.error || 'Request failed');

        if (data.auditComplete) {
          toast('${completeMsg}', 'complete');
        }

        // Badge toasts
        if (data.newBadges && data.newBadges.length) {
          for (var bi = 0; bi < data.newBadges.length; bi++) {
            (function(badge, delay) {
              setTimeout(function() { badgeToast(badge); }, delay);
            })(data.newBadges[bi], bi * 600);
          }
        }

        var remaining = data.next && data.next.remaining != null ? data.next.remaining : 0;
        updateProgress(remaining);

        if (data.next && data.next.current) {
          currentAuditRemaining = data.next.auditRemaining || 0;
          if (didSwap) {
            peekItem = data.next.peek;
          } else {
            currentItem = data.next.current;
            peekItem = data.next.peek;
            currentTranscript = data.next.transcript;
            if (currentTranscript && currentItem) {
              transcriptCache[currentItem.findingId] = currentTranscript;
            }
            renderCurrent();
          }
          if (data.next.transcript && data.next.current) {
            transcriptCache[data.next.current.findingId] = data.next.transcript;
          }
          document.getElementById('m-remaining').textContent = String(remaining);
        } else if (!didSwap) {
          showEmpty();
        } else {
          document.getElementById('m-remaining').textContent = '0';
          peekItem = null;
        }
        busy = false;
      });
    }).catch(function(err) {
      toast(err.message, 'error');
      busy = false;
    });
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
    api('/back', { method: 'POST', body: '{}' }).then(function(data) {
      animateTransition(function() {
        currentItem = data.current;
        currentTranscript = data.transcript;
        peekItem = data.peek;
        currentAuditRemaining = data.auditRemaining || 0;
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
      busy = false;
    }).catch(function(err) {
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
    // Estimate audio position: lineIndex / totalLines * duration
    var lines = document.querySelectorAll('#transcript-body .t-line');
    var idx = -1;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i] === el) { idx = i; break; }
    }
    if (idx < 0 || !recAudio.duration) return;
    var pct = idx / Math.max(1, lines.length - 1);
    recAudio.currentTime = pct * recAudio.duration;
    if (recAudio.paused) recAudio.play();
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
    recAudio.currentTime = dir > 0
      ? Math.min(recAudio.duration || 0, recAudio.currentTime + amount)
      : Math.max(0, recAudio.currentTime - amount);

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
  document.getElementById('help-hint').addEventListener('click', toggleCheatSheet);

  // -- Keyboard --
  document.addEventListener('keydown', function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (document.getElementById('confirm-overlay').classList.contains('open')) return;

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
      case 'p': if (recAudio.paused) recAudio.play(); else recAudio.pause(); break;
      case 'arrowleft': e.preventDefault(); skipSeek(-1); break;
      case 'arrowright': e.preventDefault(); skipSeek(1); break;
    }
  });

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
  (function() {
    api('/next').then(function(data) {
      reviewer = data.reviewer || '${mode}';
      document.getElementById('reviewer-tag').innerHTML = '<strong>' + reviewer + '</strong>';
      loadGameState();
      api('/stats').then(function(stats) {
        totalItems = stats.pending + stats.decided;
        totalDecided = stats.decided;
        updateProgress(stats.pending);
      }).catch(function(){});
      if (data.current) {
        currentItem = data.current;
        peekItem = data.peek;
        currentTranscript = data.transcript;
        if (currentTranscript && currentItem) transcriptCache[currentItem.findingId] = currentTranscript;
        showReview();
      } else {
        showEmpty();
      }
    }).catch(function() {
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
