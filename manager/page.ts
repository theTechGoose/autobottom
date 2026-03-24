/** Inline HTML/CSS/JS for the manager portal UI. */
import * as icons from "../shared/icons.ts";
import { getPrefabEventsJson } from "../shared/badges.ts";

export function getManagerPage(): string {
  const prefabEventsJson = getPrefabEventsJson();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Auto-Bot Manager</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --bg: #0a0e14; --bg-raised: #12161e; --bg-surface: #161c28;
    --border: #1e2736; --border-hover: #2d333b;
    --text: #c9d1d9; --text-muted: #6e7681; --text-dim: #484f58; --text-bright: #e6edf3;
    --accent: #bc8cff; --accent-dim: #8b5cf6; --accent-bg: rgba(139,92,246,0.12);
    --blue: #58a6ff; --green: #3fb950; --red: #f85149; --yellow: #d29922;
    --blue-bg: rgba(88,166,255,0.10); --green-bg: rgba(63,185,80,0.10); --red-bg: rgba(248,81,73,0.10); --yellow-bg: rgba(210,153,34,0.10);
    --mono: 'SF Mono', 'Fira Code', monospace;
    --sidebar-w: 280px;
  }
  body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; min-height: 100vh; }

  /* ===== Layout ===== */
  .layout { display: flex; min-height: 100vh; }
  .sidebar {
    width: var(--sidebar-w); min-width: var(--sidebar-w); background: var(--bg-raised);
    border-right: 1px solid var(--border); display: flex; flex-direction: column;
    position: fixed; top: 0; left: 0; bottom: 0; z-index: 10;
    overflow-y: auto; overflow-x: hidden;
  }
  .sidebar::-webkit-scrollbar { width: 3px; }
  .sidebar::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
  .sb-brand { padding: 20px 18px 16px; border-bottom: 1px solid var(--border); }
  .sb-brand h1 { font-size: 14px; font-weight: 700; color: var(--text-bright); letter-spacing: -0.3px; }
  .sb-brand .sb-sub { font-size: 10px; color: var(--text-dim); margin-top: 4px; }
  .sb-section { padding: 14px 14px 6px; }
  .sb-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: var(--text-dim); margin-bottom: 8px; padding: 0 4px; }
  .sb-link { display: flex; align-items: center; gap: 8px; padding: 10px 12px; cursor: pointer; user-select: none; border-radius: 8px; margin-bottom: 8px; background: var(--bg); border: 1px solid var(--border); transition: border-color 0.15s; text-decoration: none; color: inherit; }
  .sb-link:hover { border-color: var(--border-hover); }
  .sb-link.active { border-color: var(--accent-dim); background: var(--accent-bg); }
  .sb-link .icon { width: 24px; height: 24px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 11px; flex-shrink: 0; }
  .sb-link .icon.accent { background: var(--accent-bg); color: var(--accent); }
  .sb-link .icon.green { background: var(--green-bg); color: var(--green); }
  .sb-link .title { font-size: 12px; font-weight: 600; color: var(--text-bright); flex: 1; }
  .sb-link .arrow { font-size: 10px; color: var(--text-dim); }
  .sb-footer { margin-top: auto; border-top: 1px solid var(--border); }
  .sb-footer .sb-user { padding: 14px 18px 8px; display: flex; align-items: center; gap: 8px; }
  .sb-footer .sb-avatar { width: 28px; height: 28px; border-radius: 50%; background: var(--accent-bg); color: var(--accent); display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0; }
  .sb-footer .sb-email { font-size: 11px; color: var(--text-bright); font-weight: 600; word-break: break-all; line-height: 1.3; }
  .sb-footer .sb-role { font-size: 9px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; }
  .sb-footer .sb-settings { padding: 6px 14px 14px; }
  .sb-level { display: flex; align-items: center; gap: 8px; padding: 4px 18px 10px; }
  .main { margin-left: var(--sidebar-w); flex: 1; padding: 24px 32px; }

  .screen { display: none; }
  .screen.active { display: block; }

  /* ===== Summary cards ===== */
  .stat-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 20px; }
  .stat-card {
    background: var(--bg-raised); border: 1px solid var(--border); border-radius: 12px;
    padding: 18px 20px; transition: border-color 0.2s;
  }
  .stat-card:hover { border-color: var(--border-hover); }
  .stat-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: var(--text-dim); margin-bottom: 6px; }
  .stat-value { font-size: 28px; font-weight: 700; color: var(--text-bright); font-variant-numeric: tabular-nums; }
  .stat-card.accent-purple .stat-value { color: var(--accent); }
  .stat-card.accent-blue .stat-value { color: var(--blue); }
  .stat-card.accent-cyan .stat-value { color: #79c0ff; }
  .stat-card.accent-yellow .stat-value { color: var(--yellow); }

  /* ===== Queue table ===== */
  .toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
  .toolbar-left { display: flex; gap: 8px; align-items: center; }
  .filter-btn {
    padding: 5px 14px; border-radius: 8px; font-size: 12px; font-weight: 600;
    color: var(--text-muted); cursor: pointer; border: 1px solid var(--border); background: none;
    transition: all 0.15s;
  }
  .filter-btn:hover { background: var(--bg-raised); color: #8b949e; }
  .filter-btn.active { background: var(--accent-bg); color: var(--accent); border-color: rgba(139,92,246,0.3); }
  .backfill-btn {
    padding: 5px 14px; border-radius: 8px; font-size: 12px; font-weight: 600;
    color: var(--blue); cursor: pointer; border: 1px solid rgba(31,111,235,0.3); background: none;
    transition: all 0.15s;
  }
  .backfill-btn:hover { background: rgba(31,111,235,0.1); }

  .table-panel {
    background: var(--bg-raised); border: 1px solid var(--border); border-radius: 12px;
    padding: 0; overflow: hidden;
  }
  table { width: 100%; border-collapse: collapse; }
  th {
    text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 1px; color: var(--text-dim); padding: 12px 16px; border-bottom: 1px solid #1a1f2b;
    background: #0f1219;
  }
  td { font-size: 13px; padding: 12px 16px; border-bottom: 1px solid var(--bg-raised); color: #8b949e; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: rgba(139,92,246,0.03); }
  .mono { font-family: var(--mono); font-size: 12px; color: var(--text); }
  .empty-row td { text-align: center; color: #3d4452; font-style: italic; padding: 40px; }

  .status-badge {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.5px;
  }
  .status-badge.pending { background: var(--yellow-bg); color: var(--yellow); }
  .status-badge.pending::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: var(--yellow); }
  .status-badge.addressed { background: var(--blue-bg); color: var(--blue); }
  .status-badge.addressed::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: var(--blue); }

  .fail-ratio { font-weight: 700; }
  .fail-ratio.bad { color: var(--yellow); }
  .fail-ratio.moderate { color: var(--accent); }

  .view-btn {
    padding: 4px 12px; border-radius: 6px; font-size: 11px; font-weight: 600;
    color: var(--blue); cursor: pointer; border: 1px solid rgba(31,111,235,0.3); background: none;
    transition: all 0.15s;
  }
  .view-btn:hover { background: rgba(31,111,235,0.1); }

  /* ===== Detail screen ===== */
  .detail-header { display: flex; align-items: center; gap: 16px; margin-bottom: 20px; }
  .back-btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 6px 14px; border-radius: 8px; font-size: 12px; font-weight: 600;
    color: var(--text-muted); cursor: pointer; border: 1px solid var(--border); background: none;
    transition: all 0.15s;
  }
  .back-btn:hover { background: var(--bg-raised); color: #8b949e; }
  .detail-title { font-size: 18px; font-weight: 700; color: var(--text-bright); }
  .detail-meta { display: flex; gap: 8px; flex-wrap: wrap; margin-left: auto; }
  .meta-chip {
    display: inline-flex; align-items: center; gap: 4px;
    background: var(--bg-raised); border: 1px solid #1a1f2b; border-radius: 6px;
    padding: 4px 10px; font-size: 11px; color: var(--text-muted); white-space: nowrap;
  }
  .meta-chip strong { color: var(--text); font-weight: 600; }

  /* Score bar */
  .score-bar-wrap { margin-bottom: 20px; }
  .score-bar-label { font-size: 11px; color: var(--text-muted); margin-bottom: 6px; display: flex; justify-content: space-between; }
  .score-bar { height: 8px; background: #1a1f2b; border-radius: 4px; overflow: hidden; display: flex; }
  .score-bar .pass { background: var(--blue); transition: width 0.4s; }
  .score-bar .fail { background: var(--yellow); transition: width 0.4s; }
  .score-bar .flip { background: var(--accent); transition: width 0.4s; }

  /* Failed question cards */
  .q-cards { display: flex; flex-direction: column; gap: 12px; margin-bottom: 24px; }
  .q-card {
    background: var(--bg-raised); border: 1px solid var(--border); border-radius: 12px;
    padding: 18px 20px; transition: border-color 0.2s;
  }
  .q-card:hover { border-color: var(--border-hover); }
  .q-card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .q-card-title { font-size: 15px; font-weight: 700; color: var(--text-bright); }
  .q-card-badge {
    font-size: 10px; font-weight: 700; padding: 3px 10px; border-radius: 20px;
    text-transform: uppercase; letter-spacing: 0.5px;
  }
  .q-card-badge.confirmed { background: var(--yellow-bg); color: var(--yellow); }
  .q-card-badge.flipped { background: var(--accent-bg); color: var(--accent); }

  .q-card-section { margin-bottom: 10px; }
  .q-card-label {
    font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;
    color: var(--blue); margin-bottom: 4px;
  }
  .q-card-text {
    font-size: 13px; line-height: 1.6; color: #b0b8c4;
    padding: 10px 14px; background: #0f1219; border-radius: 8px; border: 1px solid #1a1f2b;
  }
  .q-card-reviewer { font-size: 11px; color: var(--text-dim); margin-top: 6px; }
  .q-card-reviewer strong { color: var(--text-muted); }

  .q-card-snippet {
    font-size: 12px; line-height: 1.6; color: #8b949e;
    padding: 8px 12px; background: rgba(250,176,5,0.05); border-radius: 8px;
    border: 1px solid rgba(250,176,5,0.15); font-style: italic;
  }

  /* Transcript */
  .transcript-section { margin-bottom: 24px; }
  .section-title {
    font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;
    color: var(--text-muted); margin-bottom: 12px; display: flex; align-items: center; gap: 8px;
  }
  .section-title .toggle-icon { cursor: pointer; font-size: 10px; color: var(--text-dim); transition: transform 0.2s; }
  .section-title .toggle-icon.open { transform: rotate(90deg); }
  .transcript-body {
    background: var(--bg-raised); border: 1px solid var(--border); border-radius: 12px;
    padding: 16px 20px; max-height: 500px; overflow-y: auto;
    scrollbar-width: thin; scrollbar-color: var(--border) transparent;
  }
  .transcript-body::-webkit-scrollbar { width: 4px; }
  .transcript-body::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
  .t-line {
    font-size: 13px; line-height: 1.7; margin-bottom: 6px; padding: 4px 10px 4px 12px;
    border-left: 3px solid transparent; color: var(--text-muted); border-radius: 0 6px 6px 0;
  }
  .t-agent { border-left-color: #1f6feb; color: #79b8ff; }
  .t-customer { border-left-color: #8b5cf6; color: #d2b3ff; }
  .t-system { border-left-color: #2d333b; color: var(--text-dim); }
  .t-speaker { font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; margin-right: 8px; }
  .t-agent .t-speaker { color: #1f6feb; }
  .t-customer .t-speaker { color: #8b5cf6; }

  /* CRM record grid */
  .record-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px;
    background: var(--bg-raised); border: 1px solid var(--border); border-radius: 12px; padding: 16px 20px;
    margin-bottom: 24px;
  }
  .record-field { font-size: 12px; }
  .record-field .rf-label { color: var(--text-dim); font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; }
  .record-field .rf-value { color: var(--text); margin-top: 2px; word-break: break-all; }

  /* Remediation form */
  .remediation-panel {
    background: var(--bg-raised); border: 1px solid var(--border); border-radius: 12px; padding: 20px;
  }
  .remediation-panel h3 { font-size: 14px; font-weight: 700; color: var(--text-bright); margin-bottom: 12px; }
  .remediation-panel textarea {
    width: 100%; height: 120px; padding: 12px 14px; background: var(--bg);
    border: 1px solid var(--border); border-radius: 10px; color: var(--text); font-size: 14px;
    resize: vertical; font-family: inherit; transition: border-color 0.15s, box-shadow 0.15s;
  }
  .remediation-panel textarea:focus { outline: none; border-color: var(--accent-dim); box-shadow: 0 0 0 3px rgba(139,92,246,0.15); }
  .rem-footer { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; }
  .rem-counter { font-size: 11px; color: var(--text-dim); }
  .rem-counter.short { color: var(--red); }
  .rem-submit {
    padding: 9px 24px; background: linear-gradient(135deg, #1f6feb, #8b5cf6); border: none;
    border-radius: 10px; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;
    transition: transform 0.1s, box-shadow 0.15s;
  }
  .rem-submit:hover { transform: translateY(-1px); box-shadow: 0 4px 16px rgba(139,92,246,0.3); }
  .rem-submit:disabled { opacity: 0.5; cursor: not-allowed; transform: none !important; box-shadow: none !important; }

  /* Remediation display (already addressed) */
  .remediation-display {
    background: rgba(88,166,255,0.06); border: 1px solid rgba(88,166,255,0.2); border-radius: 12px; padding: 20px;
  }
  .remediation-display h3 { font-size: 14px; font-weight: 700; color: var(--blue); margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
  .remediation-display .rem-notes { font-size: 14px; line-height: 1.6; color: #b0b8c4; margin-bottom: 10px; white-space: pre-wrap; }
  .remediation-display .rem-meta { font-size: 11px; color: var(--text-dim); }
  .remediation-display .rem-meta strong { color: var(--text-muted); }

  /* ===== Stats screen ===== */
  .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 20px; }
  .panel {
    background: var(--bg-raised); border: 1px solid var(--border); border-radius: 12px; padding: 18px 20px;
  }
  .panel-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted); margin-bottom: 14px; }

  .aging-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .aging-bucket { text-align: center; padding: 12px; background: #0f1219; border-radius: 8px; }
  .aging-bucket .ab-val { font-size: 24px; font-weight: 700; color: var(--text-bright); font-variant-numeric: tabular-nums; }
  .aging-bucket .ab-label { font-size: 10px; color: var(--text-muted); margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  .aging-bucket.warn .ab-val { color: var(--yellow); }
  .aging-bucket.danger .ab-val { color: var(--accent); }

  .trend-row { display: flex; align-items: flex-end; gap: 6px; height: 120px; padding: 10px 0; }
  .trend-bar-group { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; height: 100%; justify-content: flex-end; }
  .trend-bars { display: flex; gap: 2px; align-items: flex-end; width: 100%; justify-content: center; }
  .trend-bar { width: 14px; border-radius: 3px 3px 0 0; min-height: 2px; transition: height 0.3s; }
  .trend-bar.added { background: var(--accent); }
  .trend-bar.resolved { background: var(--blue); }
  .trend-label { font-size: 9px; color: var(--text-dim); text-align: center; margin-top: 4px; }

  .stats-table { width: 100%; }
  .stats-table th { background: transparent; }

  /* ===== Users screen ===== */
  .role-badge {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 3px 10px; border-radius: 20px; font-size: 10px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.5px;
  }
  .role-badge.user { background: var(--blue-bg); color: var(--blue); }
  .role-badge.reviewer { background: var(--accent-bg); color: var(--accent); }

  /* Modal */
  .modal-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.6);
    backdrop-filter: blur(4px); z-index: 1000; display: none;
    align-items: center; justify-content: center;
  }
  .modal-overlay.visible { display: flex; }
  .modal {
    background: var(--bg-raised); border: 1px solid var(--border); border-radius: 12px;
    width: 400px; max-width: 90vw; padding: 24px;
  }
  .modal-title { font-size: 15px; font-weight: 700; color: var(--text-bright); margin-bottom: 16px; }
  .modal-field { margin-bottom: 14px; }
  .modal-label {
    display: block; font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.8px; color: var(--text-dim); margin-bottom: 5px;
  }
  .modal-input {
    width: 100%; padding: 9px 12px; background: var(--bg); border: 1px solid var(--border);
    border-radius: 8px; color: var(--text); font-size: 13px; font-family: inherit;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .modal-input:focus { outline: none; border-color: var(--accent-dim); box-shadow: 0 0 0 3px rgba(139,92,246,0.15); }
  .modal-input::placeholder { color: #3d4452; }
  .modal-select {
    width: 100%; padding: 9px 12px; background: var(--bg); border: 1px solid var(--border);
    border-radius: 8px; color: var(--text); font-size: 13px; font-family: inherit;
    cursor: pointer; appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M3 5l3 3 3-3' stroke='%236e7681' fill='none' stroke-width='1.5'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 12px center;
  }
  .modal-select:focus { outline: none; border-color: var(--accent-dim); box-shadow: 0 0 0 3px rgba(139,92,246,0.15); }
  .modal-footer {
    display: flex; gap: 8px; justify-content: flex-end; margin-top: 18px;
    padding-top: 14px; border-top: 1px solid #1a1f2b;
  }
  .modal-cancel {
    padding: 7px 18px; border: 1px solid var(--border); border-radius: 8px;
    background: none; color: var(--text-muted); font-size: 12px; font-weight: 600; cursor: pointer;
    transition: all 0.15s;
  }
  .modal-cancel:hover { background: var(--bg-raised); color: #8b949e; }
  .modal-confirm {
    padding: 7px 18px; border: none; border-radius: 8px;
    background: linear-gradient(135deg, #1f6feb, #8b5cf6); color: #fff;
    font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.15s;
  }
  .modal-confirm:hover { transform: translateY(-1px); box-shadow: 0 4px 16px rgba(139,92,246,0.3); }
  .modal-confirm:disabled { opacity: 0.5; cursor: not-allowed; transform: none !important; box-shadow: none !important; }

  /* Delete confirm modal */
  .modal-danger { color: var(--red); }
  .modal-danger-btn {
    padding: 7px 18px; border: none; border-radius: 8px;
    background: linear-gradient(135deg, #da3633, #f85149); color: #fff;
    font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.15s;
  }
  .modal-danger-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 16px rgba(248,81,73,0.3); }

  /* ===== Gamification: Level badge + XP bar ===== */
  .level-badge {
    font-size: 11px; font-weight: 800; color: var(--accent); background: var(--accent-bg);
    padding: 3px 8px; border-radius: 6px; letter-spacing: 0.3px;
  }
  .xp-bar-wrap {
    width: 60px; height: 6px; background: #1a1f2b; border-radius: 3px; overflow: hidden; flex: 1;
  }
  .xp-bar-fill {
    height: 100%; background: linear-gradient(90deg, #8b5cf6, #bc8cff);
    border-radius: 3px; transition: width 0.4s ease; width: 0%;
  }

  /* XP toast */
  .xp-toast {
    position: fixed; top: 70px; right: 24px; z-index: 1001;
    font-size: 18px; font-weight: 800; color: var(--accent);
    text-shadow: 0 0 12px rgba(139,92,246,0.5);
    animation: xpFloat 1.5s ease forwards;
    pointer-events: none;
  }
  @keyframes xpFloat {
    0% { opacity: 1; transform: translateY(0); }
    100% { opacity: 0; transform: translateY(-40px); }
  }

  /* Badge toast */
  .badge-toast {
    padding: 10px 20px; border-radius: 10px; font-size: 13px; font-weight: 600;
    background: rgba(18,22,30,0.95); border: 2px solid #ffd700;
    box-shadow: 0 0 20px rgba(255,215,0,0.3), 0 8px 32px rgba(0,0,0,0.5);
    animation: tIn 0.2s ease, tOut 0.3s ease 3s forwards;
    display: flex; align-items: center; gap: 10px; color: var(--text-bright);
  }
  .badge-toast .badge-icon { font-size: 22px; }
  .badge-toast .badge-info { display: flex; flex-direction: column; gap: 2px; }
  .badge-toast .badge-name { font-weight: 700; color: #ffd700; }
  .badge-toast .badge-tier { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted); }

  /* Badge showcase grid in stats */
  .badge-showcase { display: flex; flex-wrap: wrap; gap: 10px; }
  .badge-item {
    display: flex; align-items: center; gap: 8px; padding: 8px 14px;
    background: #0f1219; border: 1px solid var(--border); border-radius: 10px;
    font-size: 12px;
  }
  .badge-item .bi-icon { font-size: 18px; }
  .badge-item .bi-name { font-weight: 600; color: var(--text-bright); }
  .badge-item .bi-tier { font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; margin-left: 4px; }
  .badge-item.locked { opacity: 0.35; }
  .badge-item.locked .bi-icon { filter: grayscale(1); }

  /* Streak display */
  .streak-display {
    display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; color: var(--yellow);
  }

  /* ===== Toasts ===== */
  #toast-container { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); z-index: 1000; display: flex; flex-direction: column-reverse; gap: 6px; align-items: center; pointer-events: none; }
  .toast {
    padding: 8px 20px; border-radius: 10px; font-size: 13px; font-weight: 600;
    backdrop-filter: blur(16px); box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    animation: tIn 0.2s ease, tOut 0.3s ease 2s forwards;
    display: flex; align-items: center; gap: 8px;
  }
  .toast .dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .toast.success { background: rgba(18,22,30,0.95); color: var(--blue); border: 1px solid rgba(88,166,255,0.2); }
  .toast.success .dot { background: var(--blue); }
  .toast.error { background: rgba(18,22,30,0.95); color: var(--yellow); border: 1px solid rgba(210,153,34,0.2); }
  .toast.error .dot { background: var(--yellow); }
  .toast.info { background: rgba(18,22,30,0.95); color: #8b949e; border: 1px solid var(--border); }
  .toast.info .dot { background: var(--blue); }
  @keyframes tIn { from { opacity: 0; transform: translateY(8px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
  @keyframes tOut { from { opacity: 1; } to { opacity: 0; transform: translateY(-6px); } }

  /* Event toggle cards */
  .events-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 12px; padding: 4px 0;
  }
  .event-card {
    display: flex; align-items: center; gap: 14px;
    padding: 16px; background: var(--bg-raised); border: 1px solid var(--border);
    border-radius: 12px; transition: border-color 0.2s;
  }
  .event-card.enabled { border-color: rgba(139,92,246,0.4); }
  .event-card-icon { font-size: 24px; flex-shrink: 0; }
  .event-card-body { flex: 1; min-width: 0; }
  .event-card-label { font-size: 13px; font-weight: 700; color: var(--text-bright); }
  .event-card-desc { font-size: 11px; color: var(--text-muted); margin-top: 2px; line-height: 1.4; }
  .toggle-wrap {
    position: relative; width: 40px; height: 22px; flex-shrink: 0;
  }
  .toggle-wrap input { opacity: 0; width: 0; height: 0; }
  .toggle-slider {
    position: absolute; inset: 0; background: #1a1f2b; border-radius: 11px;
    cursor: pointer; transition: background 0.2s;
  }
  .toggle-slider::after {
    content: ''; position: absolute; width: 16px; height: 16px;
    left: 3px; top: 3px; background: var(--text-dim); border-radius: 50%;
    transition: transform 0.2s, background 0.2s;
  }
  .toggle-wrap input:checked + .toggle-slider { background: rgba(139,92,246,0.3); }
  .toggle-wrap input:checked + .toggle-slider::after { transform: translateX(18px); background: var(--accent-dim); }

  /* Broadcast toast */
  .broadcast-toast{position:fixed;top:20px;right:20px;background:rgba(22,28,40,0.95);border:1px solid rgba(168,85,247,0.25);border-radius:12px;padding:14px 20px;color:var(--text-bright);font-size:13px;font-weight:600;z-index:9000;transform:translateX(120%);transition:transform 0.4s ease;backdrop-filter:blur(12px);max-width:360px;box-shadow:0 8px 32px rgba(0,0,0,0.4);}
  .broadcast-toast.show{transform:translateX(0);}

  @media (max-width: 900px) {
    .sidebar { display: none; }
    .main { margin-left: 0; }
    .stat-row { grid-template-columns: repeat(2, 1fr); }
    .stats-grid { grid-template-columns: 1fr; }
    .aging-grid { grid-template-columns: repeat(2, 1fr); }
    .detail-header { flex-wrap: wrap; }
    .detail-meta { margin-left: 0; }
  }
  @media (max-width: 600px) {
    .stat-row { grid-template-columns: 1fr; }
  }
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
  <div style="color:#3fb950;font-size:13px;font-weight:600;letter-spacing:0.5px;">Loading dashboard...</div>
</div>

<div class="layout" id="app" style="display:none">
  <aside class="sidebar">
    <div class="sb-brand">
      <h1>Auto-Bot</h1>
      <div class="sb-sub">Manager Portal</div>
    </div>
    <div class="sb-section">
      <div class="sb-label">Navigation</div>
      <a href="/manager/audits" class="sb-link">
        <div class="icon accent">${icons.fileText}</div>
        <span class="title">Audit History</span>
        <span class="arrow">${icons.chevronRight}</span>
      </a>
      <div class="sb-link" data-screen="queue">
        <div class="icon accent">${icons.clipboardList}</div>
        <span class="title">Queue</span>
        <span class="arrow">${icons.chevronRight}</span>
      </div>
      <div class="sb-link" data-screen="stats">
        <div class="icon accent">${icons.barChart}</div>
        <span class="title">Stats</span>
        <span class="arrow">${icons.chevronRight}</span>
      </div>
      <div class="sb-link" data-screen="users">
        <div class="icon accent">${icons.users}</div>
        <span class="title">Users</span>
        <span class="arrow">${icons.chevronRight}</span>
      </div>
      <div class="sb-link" data-screen="events">
        <div class="icon accent">${icons.webhook}</div>
        <span class="title">Events</span>
        <span class="arrow">${icons.chevronRight}</span>
      </div>
    </div>
    <div class="sb-section">
      <div class="sb-label">More</div>
      <a href="/chat" class="sb-link">
        <div class="icon" style="background:rgba(57,208,216,0.10);color:#39d0d8;">${icons.messageCircle24}</div>
        <span class="title">Chat</span>
        <span class="arrow">${icons.chevronRight}</span>
      </a>
      <a href="/gamification" class="sb-link">
        <div class="icon" style="background:rgba(63,185,80,0.10);color:#3fb950;">${icons.trophy}</div>
        <span class="title">Gamification</span>
        <span class="arrow">${icons.chevronRight}</span>
      </a>
      <a href="/store" class="sb-link">
        <div class="icon" style="background:rgba(236,72,153,0.10);color:#ec4899;">${icons.shoppingBag}</div>
        <span class="title">Store</span>
        <span class="arrow">${icons.chevronRight}</span>
      </a>
    </div>
    <div class="sb-footer">
      <div class="sb-user">
        <div class="sb-avatar" id="user-avatar"></div>
        <div>
          <div class="sb-email" id="nav-username"></div>
          <div class="sb-role">Manager</div>
        </div>
      </div>
      <div class="sb-level" id="nav-level" style="display:none">
        <span class="level-badge" id="level-badge">Lv.0</span>
        <span class="xp-bar-wrap"><span class="xp-bar-fill" id="xp-bar-fill"></span></span>
      </div>
      <div class="sb-settings">
        <div class="sb-link" id="logout-btn">
          <div class="icon" style="background:var(--red-bg);color:var(--red);">${icons.logIn}</div>
          <span class="title">Logout</span>
        </div>
      </div>
    </div>
  </aside>

  <main class="main">

  <!-- Queue Screen -->
  <div class="screen active" id="screen-queue">
    <div class="stat-row" id="summary-cards">
      <div class="stat-card accent-purple">
        <div class="stat-label">Outstanding</div>
        <div class="stat-value" id="s-outstanding">--</div>
      </div>
      <div class="stat-card accent-blue">
        <div class="stat-label">Addressed This Week</div>
        <div class="stat-value" id="s-addressed">--</div>
      </div>
      <div class="stat-card accent-cyan">
        <div class="stat-label">Total Audits</div>
        <div class="stat-value" id="s-total">--</div>
      </div>
      <div class="stat-card accent-yellow">
        <div class="stat-label">Avg Resolution</div>
        <div class="stat-value" id="s-avg-res">--</div>
      </div>
    </div>

    <div class="toolbar">
      <div class="toolbar-left">
        <button class="filter-btn active" data-filter="all">All</button>
        <button class="filter-btn" data-filter="pending">Pending</button>
        <button class="filter-btn" data-filter="addressed">Addressed</button>
      </div>
      <button class="backfill-btn" id="backfill-btn">Backfill Queue</button>
    </div>

    <div class="table-panel">
      <table>
        <thead>
          <tr>
            <th>Agent</th>
            <th>Record</th>
            <th>Failed / Total</th>
            <th>Date</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody id="queue-body">
          <tr class="empty-row"><td colspan="6">Loading...</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- Detail Screen -->
  <div class="screen" id="screen-detail">
    <div class="detail-header">
      <button class="back-btn" id="detail-back">&larr; Back</button>
      <span class="detail-title" id="detail-title">Finding Detail</span>
      <div class="detail-meta" id="detail-meta"></div>
    </div>

    <div class="score-bar-wrap">
      <div class="score-bar-label">
        <span id="score-label-pass">-- passed</span>
        <span id="score-label-fail">-- failed</span>
      </div>
      <div class="score-bar" id="score-bar"></div>
    </div>

    <div class="section-title">Failed Questions</div>
    <div class="q-cards" id="q-cards"></div>

    <div class="transcript-section">
      <div class="section-title">
        Transcript
        <span class="toggle-icon" id="transcript-toggle">${icons.chevronRight}</span>
      </div>
      <div class="transcript-body" id="transcript-body" style="display:none"></div>
    </div>

    <div class="section-title">CRM Record</div>
    <div class="record-grid" id="record-grid"></div>

    <div id="remediation-container"></div>
  </div>

  <!-- Stats Screen -->
  <div class="screen" id="screen-stats">
    <div class="stat-row" id="stats-summary"></div>

    <div class="stats-grid">
      <div class="panel">
        <div class="panel-title">Outstanding Aging</div>
        <div class="aging-grid" id="aging-grid"></div>
      </div>
      <div class="panel">
        <div class="panel-title">Weekly Trend (8 weeks)</div>
        <div class="trend-row" id="trend-chart"></div>
        <div style="display:flex;gap:16px;margin-top:8px;justify-content:center">
          <span style="font-size:10px;color:var(--accent);display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:2px;background:var(--accent);display:inline-block"></span>Added</span>
          <span style="font-size:10px;color:var(--blue);display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:2px;background:var(--blue);display:inline-block"></span>Resolved</span>
        </div>
      </div>
    </div>

    <div class="stats-grid">
      <div class="panel">
        <div class="panel-title">Most Commonly Failed Questions</div>
        <table class="stats-table">
          <thead><tr><th>Question</th><th style="text-align:right">Count</th></tr></thead>
          <tbody id="stats-questions"></tbody>
        </table>
      </div>
      <div class="panel">
        <div class="panel-title">Per-Agent Failure Rates</div>
        <table class="stats-table">
          <thead><tr><th>Agent</th><th style="text-align:right">Audits</th><th style="text-align:right">Total Failures</th></tr></thead>
          <tbody id="stats-agents"></tbody>
        </table>
      </div>
    </div>

    <div class="panel" style="margin-top:14px">
      <div class="panel-title" style="display:flex;align-items:center;justify-content:space-between">
        <span>Badges</span>
        <span id="badge-counter" style="font-size:11px;color:var(--text-muted);font-weight:400"></span>
      </div>
      <div class="badge-showcase" id="badge-showcase"></div>
    </div>
  </div>

  <!-- Users Screen -->
  <div class="screen" id="screen-users">
    <div class="toolbar">
      <div class="toolbar-left">
        <span style="font-size:14px;font-weight:700;color:var(--text-bright)">My Users</span>
        <span id="user-count" style="font-size:11px;color:var(--text-muted);padding:3px 10px;background:var(--accent-bg);border-radius:10px;font-weight:600">0</span>
      </div>
      <button class="backfill-btn" id="add-user-btn">+ Add User</button>
    </div>
    <div class="table-panel">
      <table>
        <thead>
          <tr>
            <th>Email</th>
            <th>Role</th>
            <th>Created</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody id="users-body">
          <tr class="empty-row"><td colspan="4">No users assigned</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- Events Screen -->
  <div class="screen" id="screen-events">
    <div class="toolbar">
      <div class="toolbar-left">
        <span style="font-size:14px;font-weight:700;color:var(--text-bright)">Event Broadcasts</span>
        <span id="events-enabled-count" style="font-size:11px;color:var(--text-muted);padding:3px 10px;background:var(--accent-bg);border-radius:10px;font-weight:600">0 active</span>
      </div>
    </div>
    <p style="font-size:12px;color:var(--text-muted);line-height:1.5;margin-bottom:14px">
      Toggle which events broadcast to your department. When an event fires, all users see a toast notification.
      Users with animations equipped for that event type will trigger the animation on everyone's screen.
    </p>
    <div class="events-grid" id="events-grid"></div>
  </div>

  </main>
</div>

<!-- Add User Modal -->
<div id="user-modal-overlay" class="modal-overlay">
  <div class="modal">
    <div class="modal-title">Add User</div>
    <div class="modal-field">
      <label class="modal-label">Email</label>
      <input type="email" id="user-email" class="modal-input" placeholder="user@example.com">
    </div>
    <div class="modal-field">
      <label class="modal-label">Password</label>
      <div style="position:relative;display:flex;align-items:center;">
        <input type="password" id="user-password" class="modal-input" placeholder="Password" style="flex:1;padding-right:36px;">
        <button type="button" id="pw-toggle" onclick="(function(){var i=document.getElementById('user-password');var b=document.getElementById('pw-toggle');i.type=i.type==='password'?'text':'password';b.textContent=i.type==='password'?'👁':'🙈';})()" style="position:absolute;right:8px;background:none;border:none;cursor:pointer;font-size:14px;color:#6e7681;padding:0;line-height:1;" tabindex="-1">👁</button>
      </div>
    </div>
    <div class="modal-field">
      <label class="modal-label">Role</label>
      <select id="user-role" class="modal-select">
        <option value="user">Agent</option>
        <option value="reviewer">Reviewer</option>
      </select>
    </div>
    <div class="modal-footer">
      <button id="user-modal-cancel" class="modal-cancel">Cancel</button>
      <button id="user-modal-save" class="modal-confirm">Add User</button>
    </div>
  </div>
</div>

<!-- Delete Confirm Modal -->
<div id="delete-modal-overlay" class="modal-overlay">
  <div class="modal">
    <div class="modal-title modal-danger">Remove User</div>
    <p style="font-size:13px;color:#8b949e;line-height:1.6;margin-bottom:4px">
      Are you sure you want to remove <strong id="delete-target" style="color:var(--text-bright)"></strong>?
    </p>
    <p style="font-size:12px;color:var(--text-dim);line-height:1.5">This will revoke their access immediately.</p>
    <div class="modal-footer">
      <button id="delete-modal-cancel" class="modal-cancel">Cancel</button>
      <button id="delete-modal-confirm" class="modal-danger-btn">Remove</button>
    </div>
  </div>
</div>

<div id="toast-container"></div>

<script>
(function() {
  var API = '/manager/api';
  var username = null;
  var currentFilter = 'all';
  var queueData = [];
  var gameState = null;

  // Level thresholds (same as shared/badges.ts LEVEL_THRESHOLDS)
  var LEVEL_THRESHOLDS = [0, 100, 300, 600, 1000, 1500, 2200, 3200, 4500, 6500];

  // Manager badge catalog (static, matches shared/badges.ts)
  var MGR_BADGES = [
    { id: 'mgr_first_fix', name: 'First Response', tier: 'common', icon: '\\u{1F527}', description: 'Submit your first remediation' },
    { id: 'mgr_fifty', name: 'Firefighter', tier: 'uncommon', icon: '\\u{1F692}', description: 'Remediate 50 items' },
    { id: 'mgr_two_hundred', name: 'Zero Tolerance', tier: 'rare', icon: '\\u{1F3AF}', description: 'Remediate 200 items' },
    { id: 'mgr_fast_24h', name: 'Rapid Response', tier: 'uncommon', icon: '\\u{23F1}', description: 'Remediate 10 items within 24h' },
    { id: 'mgr_fast_1h', name: 'Lightning Manager', tier: 'rare', icon: '\\u{26A1}', description: 'Remediate 5 items within 1h' },
    { id: 'mgr_clear_queue', name: 'Queue Slayer', tier: 'rare', icon: '\\u{1F5E1}', description: 'Clear entire queue to zero' },
    { id: 'mgr_streak_5', name: 'Consistent Manager', tier: 'uncommon', icon: '\\u{1F4C5}', description: '5-day remediation streak' },
    { id: 'mgr_streak_20', name: 'Relentless', tier: 'rare', icon: '\\u{1F525}', description: '20-day remediation streak' },
    { id: 'mgr_mentor', name: 'Team Builder', tier: 'epic', icon: '\\u{1F31F}', description: 'All agents above 80% pass rate' },
  ];

  var TIER_COLORS = { common: '#6b7280', uncommon: '#22c55e', rare: '#3b82f6', epic: '#a855f7', legendary: '#f59e0b' };

  var $app = document.getElementById('app');

  // -- Toast --
  function toast(msg, type) {
    var el = document.createElement('div');
    el.className = 'toast ' + (type || 'info');
    el.innerHTML = '<span class="dot"></span>' + escHtml(msg);
    document.getElementById('toast-container').appendChild(el);
    setTimeout(function() { el.remove(); }, 2400);
  }

  function escHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function xpToast(amount) {
    var el = document.createElement('div');
    el.className = 'xp-toast';
    el.textContent = '+' + amount + ' XP';
    document.body.appendChild(el);
    setTimeout(function() { el.remove(); }, 1600);
  }

  function badgeToast(badge) {
    var el = document.createElement('div');
    el.className = 'badge-toast';
    el.innerHTML =
      '<span class="badge-icon">' + (badge.icon || '') + '</span>' +
      '<div class="badge-info">' +
      '<span class="badge-name">' + escHtml(badge.name) + '</span>' +
      '<span class="badge-tier" style="color:' + (TIER_COLORS[badge.tier] || '#6e7681') + '">' + escHtml(badge.tier) + '</span>' +
      '</div>';
    document.getElementById('toast-container').appendChild(el);
    setTimeout(function() { el.remove(); }, 3500);
  }

  function updateLevelDisplay(gs) {
    if (!gs) return;
    var levelEl = document.getElementById('nav-level');
    levelEl.style.display = 'flex';
    document.getElementById('level-badge').textContent = 'Lv.' + (gs.level || 0);

    // Calculate XP progress to next level
    var currentThreshold = LEVEL_THRESHOLDS[gs.level] || 0;
    var nextThreshold = LEVEL_THRESHOLDS[gs.level + 1] || LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1];
    var progress = nextThreshold > currentThreshold
      ? Math.min(100, ((gs.totalXp - currentThreshold) / (nextThreshold - currentThreshold)) * 100)
      : 100;
    document.getElementById('xp-bar-fill').style.width = progress + '%';
  }

  function renderBadgeShowcase(earnedIds) {
    var container = document.getElementById('badge-showcase');
    if (!container) return;
    var earnedSet = {};
    for (var i = 0; i < (earnedIds || []).length; i++) earnedSet[earnedIds[i]] = true;

    var earned = 0;
    var html = '';
    for (var j = 0; j < MGR_BADGES.length; j++) {
      var b = MGR_BADGES[j];
      var isEarned = !!earnedSet[b.id];
      if (isEarned) earned++;
      var tierColor = TIER_COLORS[b.tier] || '#6e7681';
      html +=
        '<div class="badge-item' + (isEarned ? '' : ' locked') + '" title="' + escHtml(b.description) + '"' +
        (isEarned ? ' style="border-color:' + tierColor + '"' : '') + '>' +
        '<span class="bi-icon">' + b.icon + '</span>' +
        '<span class="bi-name">' + escHtml(b.name) + '</span>' +
        '<span class="bi-tier" style="color:' + tierColor + '">' + escHtml(b.tier) + '</span>' +
        '</div>';
    }
    container.innerHTML = html;
    var counter = document.getElementById('badge-counter');
    if (counter) counter.textContent = earned + ' / ' + MGR_BADGES.length;
  }

  // -- API --
  async function api(path, opts) {
    opts = opts || {};
    var res = await fetch(API + path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  // -- Screen navigation --
  function showScreen(name) {
    document.querySelectorAll('.screen').forEach(function(s) { s.classList.remove('active'); });
    document.getElementById('screen-' + name).classList.add('active');
    document.querySelectorAll('.sb-link[data-screen]').forEach(function(l) {
      l.classList.toggle('active', l.dataset.screen === name);
    });
  }

  document.querySelectorAll('.sb-link[data-screen]').forEach(function(link) {
    link.addEventListener('click', function() {
      var screen = this.dataset.screen;
      showScreen(screen);
      if (screen === 'queue') loadQueue();
      if (screen === 'stats') loadStats();
      if (screen === 'users') loadUsers();
      if (screen === 'events') loadEvents();
    });
  });

  function enterApp() {
    $app.style.display = '';
    document.getElementById('nav-username').textContent = username;
    document.getElementById('user-avatar').textContent = (username || '?')[0].toUpperCase();
    loadQueue();
    loadGameState();
  }

  async function loadGameState() {
    try {
      gameState = await api('/game-state');
      updateLevelDisplay(gameState);
      renderBadgeShowcase(gameState.badges);
    } catch (e) {
      // Non-critical, silently fail
    }
  }

  // -- Logout --
  document.getElementById('logout-btn').addEventListener('click', async function() {
    try { await fetch('/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' } }); } catch(e) {}
    window.location.href = '/login';
  });

  // -- Queue --
  async function loadQueue() {
    try {
      var items = await api('/queue');
      queueData = items;
      renderQueue();

      var stats = await api('/stats');
      document.getElementById('s-outstanding').textContent = fmt(stats.outstanding);
      document.getElementById('s-addressed').textContent = fmt(stats.addressedThisWeek);
      document.getElementById('s-total').textContent = fmt(stats.total);
      document.getElementById('s-avg-res').textContent = formatDuration(stats.avgResolutionMs);
    } catch (err) {
      if (err.message === 'unauthorized') {
        window.location.href = '/login';
        return;
      }
      toast(err.message, 'error');
    }
  }

  function renderQueue() {
    var filtered = queueData;
    if (currentFilter !== 'all') {
      filtered = queueData.filter(function(i) { return i.status === currentFilter; });
    }

    var tbody = document.getElementById('queue-body');
    if (filtered.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="6">No items' + (currentFilter !== 'all' ? ' matching filter' : '') + '</td></tr>';
      return;
    }

    // Sort: pending first, then by completedAt desc
    filtered.sort(function(a, b) {
      if (a.status !== b.status) return a.status === 'pending' ? -1 : 1;
      return b.completedAt - a.completedAt;
    });

    tbody.innerHTML = '';
    for (var i = 0; i < filtered.length; i++) {
      var item = filtered[i];
      var tr = document.createElement('tr');
      var ratio = item.failedCount + '/' + item.totalQuestions;
      var ratioClass = item.failedCount > item.totalQuestions / 2 ? 'bad' : 'moderate';
      var dateStr = item.completedAt ? new Date(item.completedAt).toLocaleDateString('en-US', { timeZone: 'America/New_York' }) : '--';

      tr.innerHTML =
        '<td>' + escHtml(item.voName || item.owner || '--') + '</td>' +
        '<td class="mono">' + escHtml(item.recordId || item.findingId.slice(0, 12)) + '</td>' +
        '<td><span class="fail-ratio ' + ratioClass + '">' + ratio + '</span></td>' +
        '<td style="color:var(--text-muted);font-size:12px">' + dateStr + '</td>' +
        '<td><span class="status-badge ' + item.status + '">' + item.status + '</span></td>' +
        '<td><button class="view-btn" data-id="' + escHtml(item.findingId) + '">View</button></td>';
      tbody.appendChild(tr);
    }

    // Bind view buttons
    tbody.querySelectorAll('.view-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        loadDetail(this.dataset.id);
      });
    });
  }

  // -- Filters --
  document.querySelectorAll('.filter-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      currentFilter = this.dataset.filter;
      document.querySelectorAll('.filter-btn').forEach(function(b) { b.classList.remove('active'); });
      this.classList.add('active');
      renderQueue();
    });
  });

  // -- Backfill --
  document.getElementById('backfill-btn').addEventListener('click', async function() {
    var btn = this;
    btn.disabled = true;
    btn.textContent = 'Backfilling...';
    try {
      var result = await api('/backfill', { method: 'POST' });
      toast('Backfilled ' + (result.added || 0) + ' items', 'success');
      loadQueue();
    } catch (err) {
      toast(err.message, 'error');
    }
    btn.disabled = false;
    btn.textContent = 'Backfill Queue';
  });

  // -- Detail --
  async function loadDetail(findingId) {
    showScreen('detail');

    // Clear active state on sidebar links in detail mode
    document.querySelectorAll('.sb-link[data-screen]').forEach(function(l) { l.classList.remove('active'); });

    try {
      var data = await api('/finding?id=' + encodeURIComponent(findingId));
      renderDetail(data);
    } catch (err) {
      toast(err.message, 'error');
      showScreen('queue');
    }
  }

  function renderDetail(data) {
    var f = data.finding;
    var qs = data.questions || [];
    var tx = data.transcript;
    var rem = data.remediation;
    var qi = data.queueItem;

    // Header
    document.getElementById('detail-title').textContent = 'Audit: ' + (f.owner || 'Unknown');
    var metaHtml =
      '<div class="meta-chip">Finding <strong>' + escHtml(f.id || '') + '</strong></div>' +
      '<div class="meta-chip">Recording <strong>' + escHtml(f.recordingId || '--') + '</strong></div>';
    if (f.recordId) metaHtml += '<div class="meta-chip">Record <strong>' + escHtml(f.recordId) + '</strong></div>';
    document.getElementById('detail-meta').innerHTML = metaHtml;

    // Score bar
    var passed = 0, failed = 0, flipped = 0;
    for (var i = 0; i < qs.length; i++) {
      var q = qs[i];
      if (q.answer === 'No' && q.reviewDecision === 'confirm') failed++;
      else if (q.answer === 'No' && q.reviewDecision === 'flip') flipped++;
      else passed++;
    }
    var total = qs.length || 1;
    document.getElementById('score-label-pass').textContent = passed + ' passed' + (flipped ? ', ' + flipped + ' flipped' : '');
    document.getElementById('score-label-fail').textContent = failed + ' confirmed fail';
    document.getElementById('score-bar').innerHTML =
      '<div class="pass" style="width:' + (passed / total * 100) + '%"></div>' +
      '<div class="flip" style="width:' + (flipped / total * 100) + '%"></div>' +
      '<div class="fail" style="width:' + (failed / total * 100) + '%"></div>';

    // Failed question cards (only show No answers)
    var cards = document.getElementById('q-cards');
    cards.innerHTML = '';
    var failedQs = qs.filter(function(q) { return q.answer === 'No'; });
    if (failedQs.length === 0) {
      cards.innerHTML = '<div style="color:#3d4452;font-style:italic;padding:12px">No failed questions</div>';
    }
    for (var j = 0; j < failedQs.length; j++) {
      var fq = failedQs[j];
      var isConfirmed = fq.reviewDecision === 'confirm';
      var badgeClass = isConfirmed ? 'confirmed' : 'flipped';
      var badgeText = isConfirmed ? 'Confirmed Fail' : 'Flipped to Pass';

      var cardHtml =
        '<div class="q-card">' +
        '<div class="q-card-head">' +
        '<span class="q-card-title">Q' + fq.index + ': ' + escHtml(fq.header || '') + '</span>' +
        '<span class="q-card-badge ' + badgeClass + '">' + badgeText + '</span>' +
        '</div>';

      if (fq.defense) {
        cardHtml += '<div class="q-card-section"><div class="q-card-label">Defense</div>' +
          '<div class="q-card-text">' + escHtml(fq.defense) + '</div></div>';
      }
      if (fq.thinking) {
        cardHtml += '<div class="q-card-section"><div class="q-card-label">Reasoning</div>' +
          '<div class="q-card-text" style="font-style:italic">' + escHtml(fq.thinking) + '</div></div>';
      }
      if (fq.snippet) {
        cardHtml += '<div class="q-card-section"><div class="q-card-label">Transcript Snippet</div>' +
          '<div class="q-card-snippet">' + escHtml(fq.snippet) + '</div></div>';
      }
      if (fq.reviewer) {
        cardHtml += '<div class="q-card-reviewer">Reviewed by <strong>' + escHtml(fq.reviewer) + '</strong></div>';
      }
      cardHtml += '</div>';
      cards.innerHTML += cardHtml;
    }

    // Transcript
    var tbody2 = document.getElementById('transcript-body');
    tbody2.style.display = 'none';
    document.getElementById('transcript-toggle').classList.remove('open');

    tbody2.innerHTML = '';
    if (tx && (tx.diarized || tx.raw)) {
      var text = tx.diarized || tx.raw;
      var lines = text.split('\\n');
      for (var k = 0; k < lines.length; k++) {
        if (!lines[k].trim()) continue;
        var div = document.createElement('div');
        div.className = 't-line';
        var m = lines[k].match(/^\\[?(AGENT|CUSTOMER|SYSTEM|Agent|Customer|System)\\]?[:\\s]*(.*)/i);
        if (m) {
          var speaker = m[1].toUpperCase();
          div.classList.add(speaker === 'AGENT' ? 't-agent' : speaker === 'CUSTOMER' ? 't-customer' : 't-system');
          var label = document.createElement('span');
          label.className = 't-speaker';
          label.textContent = speaker;
          div.appendChild(label);
          div.appendChild(document.createTextNode(m[2] || ''));
        } else {
          div.textContent = lines[k];
        }
        tbody2.appendChild(div);
      }
    } else {
      tbody2.innerHTML = '<div style="color:#3d4452;font-style:italic;padding:12px">No transcript available</div>';
    }

    // CRM Record grid
    var recordGrid = document.getElementById('record-grid');
    recordGrid.innerHTML = '';
    if (f.record && typeof f.record === 'object') {
      var keys = Object.keys(f.record).slice(0, 20);
      for (var r = 0; r < keys.length; r++) {
        var key = keys[r];
        var val = f.record[key];
        if (val === null || val === undefined || val === '') continue;
        if (typeof val === 'object') val = JSON.stringify(val);
        var fieldDiv = document.createElement('div');
        fieldDiv.className = 'record-field';
        fieldDiv.innerHTML = '<div class="rf-label">' + escHtml(key) + '</div><div class="rf-value">' + escHtml(String(val)) + '</div>';
        recordGrid.appendChild(fieldDiv);
      }
    }

    // Remediation
    var remContainer = document.getElementById('remediation-container');
    if (rem) {
      var dateStr = new Date(rem.addressedAt).toLocaleString('en-US', { timeZone: 'America/New_York' });
      remContainer.innerHTML =
        '<div class="remediation-display">' +
        '<h3><span style="font-size:16px">${icons.check}</span> Addressed</h3>' +
        '<div class="rem-notes">' + escHtml(rem.notes) + '</div>' +
        '<div class="rem-meta">By <strong>' + escHtml(rem.addressedBy) + '</strong> on ' + dateStr + '</div>' +
        '</div>';
    } else if (qi && qi.status === 'pending') {
      remContainer.innerHTML =
        '<div class="remediation-panel">' +
        '<h3>Remediation Notes</h3>' +
        '<textarea id="rem-notes" placeholder="Describe the action taken to address these audit failures (min 20 characters)..."></textarea>' +
        '<div class="rem-footer">' +
        '<span class="rem-counter short" id="rem-counter">0 / 20 min</span>' +
        '<button class="rem-submit" id="rem-submit" disabled>Submit Remediation</button>' +
        '</div></div>';

      var notesInput = document.getElementById('rem-notes');
      var counter = document.getElementById('rem-counter');
      var submitBtn = document.getElementById('rem-submit');
      var fid = f.id;

      notesInput.addEventListener('input', function() {
        var len = this.value.trim().length;
        counter.textContent = len + ' / 20 min';
        counter.className = 'rem-counter' + (len < 20 ? ' short' : '');
        submitBtn.disabled = len < 20;
      });

      submitBtn.addEventListener('click', async function() {
        var notes = notesInput.value.trim();
        if (notes.length < 20) return;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';
        try {
          var result = await api('/remediate', { method: 'POST', body: JSON.stringify({ findingId: fid, notes: notes }) });
          toast('Remediation submitted', 'success');
          // Show XP toast
          if (result.xpGained) xpToast(result.xpGained);
          // Show badge toasts
          if (result.newBadges && result.newBadges.length) {
            for (var b = 0; b < result.newBadges.length; b++) {
              setTimeout(badgeToast.bind(null, result.newBadges[b]), b * 600);
            }
          }
          // Refresh game state display
          loadGameState();
          loadDetail(fid);
          loadQueue();
        } catch (err) {
          toast(err.message, 'error');
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit Remediation';
        }
      });
    } else {
      remContainer.innerHTML = '';
    }
  }

  // Transcript toggle
  document.getElementById('transcript-toggle').addEventListener('click', function() {
    var body = document.getElementById('transcript-body');
    var isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : 'block';
    this.classList.toggle('open', !isOpen);
  });

  // Back button
  document.getElementById('detail-back').addEventListener('click', function() {
    showScreen('queue');
    loadQueue();
  });

  // -- Stats --
  async function loadStats() {
    try {
      var stats = await api('/stats');
      renderStats(stats);
      loadGameState();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function renderStats(stats) {
    // Summary row
    var summaryHtml =
      '<div class="stat-card accent-purple"><div class="stat-label">Outstanding</div><div class="stat-value">' + fmt(stats.outstanding) + '</div></div>' +
      '<div class="stat-card accent-blue"><div class="stat-label">Addressed This Week</div><div class="stat-value">' + fmt(stats.addressedThisWeek) + '</div></div>' +
      '<div class="stat-card accent-cyan"><div class="stat-label">Total</div><div class="stat-value">' + fmt(stats.total) + '</div></div>' +
      '<div class="stat-card accent-yellow"><div class="stat-label">Avg Resolution</div><div class="stat-value">' + formatDuration(stats.avgResolutionMs) + '</div></div>';
    document.getElementById('stats-summary').innerHTML = summaryHtml;
    document.getElementById('stats-summary').className = 'stat-row';

    // Aging
    var aging = stats.aging || {};
    var agingHtml =
      '<div class="aging-bucket"><div class="ab-val">' + fmt(aging.lt24h) + '</div><div class="ab-label">&lt; 24h</div></div>' +
      '<div class="aging-bucket warn"><div class="ab-val">' + fmt(aging.lt72h) + '</div><div class="ab-label">1-3 days</div></div>' +
      '<div class="aging-bucket warn"><div class="ab-val">' + fmt(aging.lt1w) + '</div><div class="ab-label">3-7 days</div></div>' +
      '<div class="aging-bucket danger"><div class="ab-val">' + fmt(aging.gt1w) + '</div><div class="ab-label">&gt; 1 week</div></div>';
    document.getElementById('aging-grid').innerHTML = agingHtml;

    // Weekly trend
    var trend = stats.weeklyTrend || [];
    var maxVal = 1;
    for (var i = 0; i < trend.length; i++) {
      maxVal = Math.max(maxVal, trend[i].added, trend[i].resolved);
    }
    var trendHtml = '';
    for (var j = 0; j < trend.length; j++) {
      var w = trend[j];
      var aH = Math.max(2, (w.added / maxVal) * 90);
      var rH = Math.max(2, (w.resolved / maxVal) * 90);
      var label = w.weekStart ? w.weekStart.slice(5) : '';
      trendHtml +=
        '<div class="trend-bar-group">' +
        '<div class="trend-bars">' +
        '<div class="trend-bar added" style="height:' + aH + 'px" title="Added: ' + w.added + '"></div>' +
        '<div class="trend-bar resolved" style="height:' + rH + 'px" title="Resolved: ' + w.resolved + '"></div>' +
        '</div>' +
        '<div class="trend-label">' + label + '</div>' +
        '</div>';
    }
    document.getElementById('trend-chart').innerHTML = trendHtml;

    // Top failed questions
    var qTbody = document.getElementById('stats-questions');
    var topQs = stats.topFailedQuestions || [];
    if (topQs.length === 0) {
      qTbody.innerHTML = '<tr class="empty-row"><td colspan="2">No data</td></tr>';
    } else {
      qTbody.innerHTML = '';
      for (var k = 0; k < topQs.length; k++) {
        var tr = document.createElement('tr');
        tr.innerHTML = '<td>' + escHtml(topQs[k].header) + '</td><td style="text-align:right;font-weight:700;color:var(--yellow)">' + topQs[k].count + '</td>';
        qTbody.appendChild(tr);
      }
    }

    // Agent rates
    var aTbody = document.getElementById('stats-agents');
    var agents = stats.agentRates || [];
    if (agents.length === 0) {
      aTbody.innerHTML = '<tr class="empty-row"><td colspan="3">No data</td></tr>';
    } else {
      aTbody.innerHTML = '';
      for (var l = 0; l < agents.length; l++) {
        var tr2 = document.createElement('tr');
        tr2.innerHTML = '<td>' + escHtml(agents[l].agent) + '</td><td style="text-align:right">' + agents[l].audits + '</td><td style="text-align:right;font-weight:700;color:var(--yellow)">' + agents[l].totalFailures + '</td>';
        aTbody.appendChild(tr2);
      }
    }
  }

  // -- Helpers --
  function fmt(n) {
    if (n == null) return '--';
    return Number(n).toLocaleString();
  }

  function formatDuration(ms) {
    if (!ms || ms <= 0) return '--';
    var hours = ms / (1000 * 60 * 60);
    if (hours < 1) return Math.round(ms / (1000 * 60)) + 'm';
    if (hours < 48) return Math.round(hours) + 'h';
    return Math.round(hours / 24) + 'd';
  }

  // -- Users --
  async function loadUsers() {
    try {
      var users = await api('/agents');
      var tbody = document.getElementById('users-body');
      document.getElementById('user-count').textContent = users.length;
      if (users.length === 0) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="4">No users assigned</td></tr>';
        return;
      }
      tbody.innerHTML = '';
      for (var i = 0; i < users.length; i++) {
        var u = users[i];
        var dateStr = u.createdAt ? new Date(u.createdAt).toLocaleDateString('en-US', { timeZone: 'America/New_York' }) : '--';
        var roleName = u.role === 'reviewer' ? 'Reviewer' : 'Agent';
        var tr = document.createElement('tr');
        tr.innerHTML =
          '<td style="color:var(--text-bright);font-weight:600">' + escHtml(u.email) + '</td>' +
          '<td><span class="role-badge ' + escHtml(u.role || 'user') + '">' + roleName + '</span></td>' +
          '<td style="color:var(--text-muted);font-size:12px">' + dateStr + '</td>' +
          '<td><button class="view-btn remove-user-btn" data-email="' + escHtml(u.email) + '" style="color:var(--red);border-color:rgba(248,81,73,0.3)">Remove</button></td>';
        tbody.appendChild(tr);
      }
      tbody.querySelectorAll('.remove-user-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          pendingDeleteEmail = this.dataset.email;
          document.getElementById('delete-target').textContent = pendingDeleteEmail;
          document.getElementById('delete-modal-overlay').classList.add('visible');
        });
      });
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // -- Add User Modal --
  document.getElementById('add-user-btn').addEventListener('click', function() {
    document.getElementById('user-modal-overlay').classList.add('visible');
    document.getElementById('user-email').focus();
  });

  document.getElementById('user-modal-cancel').addEventListener('click', function() {
    document.getElementById('user-modal-overlay').classList.remove('visible');
  });

  document.getElementById('user-modal-overlay').addEventListener('click', function(e) {
    if (e.target === this) this.classList.remove('visible');
  });

  document.getElementById('user-modal-save').addEventListener('click', async function() {
    var email = document.getElementById('user-email').value.trim();
    var password = document.getElementById('user-password').value;
    var role = document.getElementById('user-role').value;
    if (!email || !password) { toast('Email and password required', 'error'); return; }
    var btn = this;
    btn.disabled = true;
    btn.textContent = 'Adding...';
    try {
      await api('/agents', { method: 'POST', body: JSON.stringify({ email: email, password: password, role: role }) });
      var roleName = role === 'reviewer' ? 'Reviewer' : 'Agent';
      toast(roleName + ' added', 'success');
      document.getElementById('user-email').value = '';
      document.getElementById('user-password').value = '';
      document.getElementById('user-role').value = 'user';
      document.getElementById('user-modal-overlay').classList.remove('visible');
      loadUsers();
    } catch (err) {
      toast(err.message, 'error');
    }
    btn.disabled = false;
    btn.textContent = 'Add User';
  });

  // -- Delete Confirm Modal --
  var pendingDeleteEmail = null;

  document.getElementById('delete-modal-cancel').addEventListener('click', function() {
    pendingDeleteEmail = null;
    document.getElementById('delete-modal-overlay').classList.remove('visible');
  });

  document.getElementById('delete-modal-overlay').addEventListener('click', function(e) {
    if (e.target === this) {
      pendingDeleteEmail = null;
      this.classList.remove('visible');
    }
  });

  document.getElementById('delete-modal-confirm').addEventListener('click', async function() {
    if (!pendingDeleteEmail) return;
    var btn = this;
    btn.disabled = true;
    btn.textContent = 'Removing...';
    try {
      await api('/agents/delete', { method: 'POST', body: JSON.stringify({ email: pendingDeleteEmail }) });
      toast('User removed', 'success');
      loadUsers();
    } catch (err) {
      toast(err.message, 'error');
    }
    btn.disabled = false;
    btn.textContent = 'Remove';
    pendingDeleteEmail = null;
    document.getElementById('delete-modal-overlay').classList.remove('visible');
  });

  // -- Events --
  var PREFAB_EVENTS = ${prefabEventsJson};
  var eventSubs = {};

  async function loadEvents() {
    try {
      var data = await api('/prefab-subscriptions');
      eventSubs = data.subscriptions || {};
    } catch (err) {
      eventSubs = {};
    }
    renderEvents();
  }

  function renderEvents() {
    var grid = document.getElementById('events-grid');
    var html = '';
    var enabledCount = 0;
    for (var i = 0; i < PREFAB_EVENTS.length; i++) {
      var ev = PREFAB_EVENTS[i];
      var enabled = !!eventSubs[ev.type];
      if (enabled) enabledCount++;
      html += '<div class="event-card' + (enabled ? ' enabled' : '') + '">' +
        '<div class="event-card-icon">' + ev.icon + '</div>' +
        '<div class="event-card-body">' +
          '<div class="event-card-label">' + escHtml(ev.label) + '</div>' +
          '<div class="event-card-desc">' + escHtml(ev.description) + '</div>' +
        '</div>' +
        '<label class="toggle-wrap">' +
          '<input type="checkbox" data-event-type="' + escHtml(ev.type) + '"' + (enabled ? ' checked' : '') + '>' +
          '<span class="toggle-slider"></span>' +
        '</label>' +
      '</div>';
    }
    grid.innerHTML = html;
    document.getElementById('events-enabled-count').textContent = enabledCount + ' active';

    grid.querySelectorAll('input[type="checkbox"]').forEach(function(cb) {
      cb.addEventListener('change', function() {
        var evType = this.dataset.eventType;
        eventSubs[evType] = this.checked;
        this.closest('.event-card').classList.toggle('enabled', this.checked);
        var count = 0;
        for (var k in eventSubs) { if (eventSubs[k]) count++; }
        document.getElementById('events-enabled-count').textContent = count + ' active';
        saveEventSubs();
      });
    });
  }

  async function saveEventSubs() {
    try {
      await api('/prefab-subscriptions', {
        method: 'POST',
        body: JSON.stringify({ subscriptions: eventSubs }),
      });
    } catch (err) {
      toast('Failed to save event settings', 'error');
    }
  }

  // -- Broadcast events (SSE) --
  (function() {
    var bEs = new EventSource("/api/events");
    bEs.addEventListener("prefab-broadcast", function(e) {
      if (window.__TAURI__) return; // bridge.js handles broadcasts in Tauri overlay
      try {
        var data = JSON.parse(e.data);
        showBroadcastToast(data);
        if (data.animationId) playAnimation(data.animationId);
      } catch {}
    });
    bEs.onerror = function() { bEs.close(); setTimeout(function() { bEs = new EventSource("/api/events"); }, 5000); };
  })();

  function showBroadcastToast(data) {
    var el = document.getElementById("broadcast-toast");
    if (!el) { el = document.createElement("div"); el.id = "broadcast-toast"; el.className = "broadcast-toast"; document.body.appendChild(el); }
    el.innerHTML = '<span style="font-size:18px;margin-right:8px;">' + (data.type === "perfect_score" ? "\\u{1F4AF}" : data.type === "level_up" ? "\\u{2B06}" : data.type === "badge_earned" ? "\\u{1F3C5}" : data.type === "queue_cleared" ? "\\u{1F5E1}" : "\\u{1F514}") + '</span>'
      + '<span>' + (data.message || data.displayName + " triggered " + data.type) + '</span>';
    el.classList.add("show");
    setTimeout(function() { el.classList.remove("show"); }, 5000);
  }

  function playAnimation(animId) {
    var canvas = document.createElement("canvas");
    canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;z-index:8000;pointer-events:none;";
    document.body.appendChild(canvas);
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    var ctx = canvas.getContext("2d");
    var particles = [];
    for (var i = 0; i < 50; i++) particles.push({ x: Math.random() * canvas.width, y: Math.random() * canvas.height * 0.5, vx: (Math.random()-0.5)*4, vy: -Math.random()*6-2, size: Math.random()*6+2, color: "hsl("+Math.floor(Math.random()*360)+",80%,65%)", angle: Math.random()*Math.PI*2 });
    var frame = 0;
    function tick() {
      if (frame >= 120) { canvas.remove(); return; }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      var fade = Math.max(0, 1 - frame/120);
      particles.forEach(function(p) { p.x += p.vx; p.y += (p.vy += 0.15); p.angle += 0.1; ctx.globalAlpha = fade; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle); ctx.fillStyle = p.color; ctx.fillRect(-p.size, -p.size*0.4, p.size*2, p.size*0.8); ctx.restore(); });
      ctx.globalAlpha = 1;
      frame++;
      requestAnimationFrame(tick);
    }
    tick();
  }

  // -- Init: try resuming session --
  (async function() {
    function hideOverlay() {
      var ov = document.getElementById('init-overlay');
      if (ov) { ov.style.opacity = '0'; setTimeout(function() { ov.remove(); }, 420); }
    }
    try {
      var data = await api('/me');
      username = data.username;
      enterApp();
      hideOverlay();
    } catch (e) {
      hideOverlay();
      window.location.href = '/login';
    }
  })();
})();
</script>
</body>
</html>`;
}
