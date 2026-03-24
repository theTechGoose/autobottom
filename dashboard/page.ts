/** Inline HTML/CSS/JS for the admin dashboard. */
import * as icons from "../shared/icons.ts";

export function getDashboardPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Auto-Bot Dashboard</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --bg: #0b0f15; --bg-raised: #111620; --bg-surface: #161c28;
    --border: #1c2333; --border-hover: #2a3346;
    --text: #c9d1d9; --text-muted: #6e7681; --text-dim: #484f58; --text-bright: #e6edf3;
    --blue: #58a6ff; --green: #3fb950; --red: #f85149; --yellow: #d29922; --purple: #bc8cff; --cyan: #39d0d8;
    --blue-bg: rgba(31,111,235,0.10); --green-bg: rgba(63,185,80,0.10);
    --red-bg: rgba(248,81,73,0.10); --yellow-bg: rgba(210,153,34,0.10); --purple-bg: rgba(139,92,246,0.10); --cyan-bg: rgba(57,208,216,0.10);
    --mono: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
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
  .sb-brand .sb-status { display: flex; align-items: center; gap: 6px; margin-top: 5px; font-size: 10px; color: var(--text-dim); }
  .sb-brand .dot { width: 5px; height: 5px; border-radius: 50%; background: var(--green); flex-shrink: 0; }
  .sb-brand .dot.loading { background: var(--yellow); animation: pulse 1s infinite; }
  .sb-brand .dot.error { background: var(--red); }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }

  .sb-section { padding: 14px 14px 6px; }
  .sb-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: var(--text-dim); margin-bottom: 8px; padding: 0 4px; }
  .sb-rv-wrap { position: relative; }
  .sb-rv-btn .icon.rv { background: linear-gradient(135deg, var(--purple-bg), var(--blue-bg)); color: var(--purple); }
  .sb-rv-flyout { position: fixed; opacity: 0; pointer-events: none; transition: opacity 0.2s ease, transform 0.2s ease; transform: translateY(-50%) translateX(-8px); z-index: 9999; }
  .sb-rv-flyout.open { opacity: 1; pointer-events: auto; }
  .sb-rv-panel { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 8px; min-width: 200px; box-shadow: 0 12px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03); backdrop-filter: blur(12px); }
  .sb-rv-panel .rv-title { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: var(--text-dim); padding: 4px 8px 8px; }
  .sb-rv-panel a { display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 8px; text-decoration: none; color: var(--text); font-size: 12px; font-weight: 500; transition: all 0.15s ease; }
  .sb-rv-panel a:hover { background: var(--hover); color: var(--text-bright); transform: translateX(2px); }
  .sb-rv-panel .rm-icon { width: 30px; height: 30px; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .sb-rv-panel .rm-icon svg { width: 15px; height: 15px; }

  .sb-link .icon.users { background: var(--purple-bg); color: var(--purple); }
  .sb-link .icon.pipeline { background: var(--yellow-bg); color: var(--yellow); }
  .sb-link .icon.dev { background: var(--red-bg); color: var(--red); }

  /* Sidebar form */
  .sf { margin-bottom: 8px; }
  .sf-label { display: block; font-size: 9px; color: var(--text-muted); margin-bottom: 3px; text-transform: uppercase; letter-spacing: 0.8px; font-weight: 600; }
  .sf-input { width: 100%; padding: 6px 9px; background: var(--bg-raised); border: 1px solid var(--border); border-radius: 5px; color: var(--text); font-size: 11px; font-family: var(--mono); transition: border-color 0.15s; }
  .sf-input:focus { outline: none; border-color: var(--blue); }
  textarea.sf-input { height: 48px; resize: vertical; }
  .sf-input.num { width: 56px; text-align: center; font-weight: 600; }

  .sf-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
  .sf-row .sf-label { margin-bottom: 0; min-width: 50px; flex-shrink: 0; }
  .sf-unit { font-size: 9px; color: var(--text-dim); }

  .sf-btn { display: inline-flex; align-items: center; justify-content: center; padding: 5px 12px; border: none; border-radius: 5px; font-size: 10px; font-weight: 600; cursor: pointer; transition: all 0.15s; }
  .sf-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .sf-btn.primary { background: var(--blue); color: #fff; }
  .sf-btn.primary:hover:not(:disabled) { background: #388bfd; }
  .sf-btn.ghost { background: transparent; color: var(--text-muted); border: 1px solid var(--border); }
  .sf-btn.ghost:hover:not(:disabled) { background: var(--bg-surface); }
  .sf-btn.danger { background: transparent; color: var(--red); border: 1px solid rgba(248,81,73,0.2); }
  .sf-btn.danger:hover:not(:disabled) { background: var(--red-bg); }
  .sf-actions { display: flex; gap: 5px; margin-top: 2px; }
  .sf-sep { height: 1px; background: var(--border); margin: 8px 0; }

  .role-pills { display: flex; gap: 3px; }
  .role-pill { padding: 3px 9px; border: 1px solid var(--border); border-radius: 12px; background: transparent; color: var(--text-dim); font-size: 10px; font-weight: 600; cursor: pointer; transition: all 0.12s; }
  .role-pill:hover { border-color: var(--border-hover); color: var(--text-muted); }
  .role-pill.active { background: var(--purple-bg); border-color: rgba(139,92,246,0.3); color: var(--purple); }

  /* Webhook link in sidebar */
  .sb-link { display: flex; align-items: center; gap: 8px; padding: 10px 12px; cursor: pointer; user-select: none; border-radius: 8px; margin-bottom: 8px; background: var(--bg); border: 1px solid var(--border); transition: border-color 0.15s; }
  .sb-link:hover { border-color: var(--border-hover); }
  .sb-link .icon { width: 24px; height: 24px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 11px; flex-shrink: 0; background: var(--blue-bg); color: var(--blue); }
  .sb-link .title { font-size: 12px; font-weight: 600; color: var(--text-bright); flex: 1; }
  .sb-link .arrow { font-size: 10px; color: var(--text-dim); }

  .sb-footer { margin-top: auto; border-top: 1px solid var(--border); }
  .sb-footer .sb-user { padding: 14px 18px 8px; display: flex; align-items: center; gap: 8px; }
  .sb-footer .sb-avatar { width: 28px; height: 28px; border-radius: 50%; background: var(--blue-bg); color: var(--blue); display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0; }
  .sb-footer .sb-email { font-size: 11px; color: var(--text-bright); font-weight: 600; word-break: break-all; line-height: 1.3; }
  .sb-footer .sb-role { font-size: 9px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; }
  .sb-footer .sb-settings { padding: 6px 14px 14px; }

  /* ===== Modal ===== */
  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); backdrop-filter: blur(8px); z-index: 100; display: none; align-items: center; justify-content: center; }
  .modal-overlay.open { display: flex; }
  .modal { background: var(--bg-raised); border: 1px solid var(--border); border-radius: 16px; width: 500px; max-width: 92vw; padding: 28px 32px 24px; animation: modalIn 0.18s ease; box-shadow: 0 16px 48px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.03) inset; }
  @keyframes modalIn { from { opacity: 0; transform: scale(0.96) translateY(8px); } to { opacity: 1; transform: none; } }
  .modal-title { font-size: 17px; font-weight: 700; color: var(--text-bright); margin-bottom: 4px; letter-spacing: -0.2px; }
  .modal-sub { font-size: 12px; color: var(--text-dim); margin-bottom: 20px; line-height: 1.4; }
  .modal .sf-input { font-size: 13px; padding: 10px 14px; }
  .modal textarea.sf-input { height: 88px; }
  .modal .sf { margin-bottom: 16px; }
  .modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 24px; padding-top: 18px; border-top: 1px solid var(--border); }
  .modal-actions .sf-btn { padding: 10px 24px; font-size: 13px; border-radius: 8px; }

  /* Modal form overrides */
  .modal .sf-label { font-size: 11px; margin-bottom: 6px; letter-spacing: 0.8px; }
  .modal .sf-input { padding: 11px 14px; font-size: 13px; border-radius: 8px; background: var(--bg); }
  .modal .sf-input:hover { border-color: var(--border-hover); }
  .modal .sf-input.num { width: 90px; padding: 10px 12px; font-size: 14px; font-weight: 700; }
  .modal .sf-row { margin-bottom: 12px; gap: 12px; }
  .modal .sf-row .sf-label { font-size: 11px; min-width: 72px; }
  .modal .sf-unit { font-size: 11px; }
  .modal .sf-sep { margin: 16px 0; }
  .modal .role-pills { gap: 6px; }
  .modal .role-pill { padding: 6px 16px; font-size: 11px; border-radius: 16px; }

  .modal-group { margin-bottom: 16px; }
  .modal-group-title { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: var(--text-dim); margin-bottom: 10px; }

  /* ===== Pipeline Modal ===== */
  .pipeline-modal { width: 480px; padding: 0; overflow: hidden; }
  .pm-header { display: flex; align-items: center; gap: 14px; padding: 24px 28px 20px; }
  .pm-icon { width: 40px; height: 40px; border-radius: 10px; background: var(--yellow-bg); color: var(--yellow); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .pm-header .modal-title { margin-bottom: 2px; }
  .pm-header .modal-sub { margin-bottom: 0; }

  .pm-section { padding: 0 28px; }
  .pm-section-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: var(--text-dim); margin-bottom: 14px; }
  .pm-divider { height: 1px; background: var(--border); margin: 20px 28px; }

  .pm-field { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: var(--bg); border: 1px solid var(--border); border-radius: 10px; margin-bottom: 10px; transition: border-color 0.15s; }
  .pm-field:hover { border-color: var(--border-hover); }
  .pm-field-info { flex: 1; min-width: 0; }
  .pm-field-name { font-size: 13px; font-weight: 600; color: var(--text-bright); margin-bottom: 2px; }
  .pm-field-desc { font-size: 11px; color: var(--text-muted); }

  .pm-stepper { display: flex; align-items: center; gap: 0; flex-shrink: 0; margin-left: 16px; }
  .pm-step-btn { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--border); background: var(--bg-raised); color: var(--text-muted); font-size: 16px; cursor: pointer; transition: all 0.12s; line-height: 1; user-select: none; }
  .pm-step-btn:first-child { border-radius: 8px 0 0 8px; border-right: none; }
  .pm-step-btn:last-of-type { border-radius: 0 8px 8px 0; border-left: none; }
  .pm-step-btn:hover { background: var(--bg-surface); color: var(--text-bright); border-color: var(--border-hover); }
  .pm-step-btn:hover + .pm-step-value { border-color: var(--border-hover); }
  .pm-step-btn:active { background: var(--blue-bg); color: var(--blue); }

  .pm-step-value { width: 52px; height: 32px; text-align: center; border: 1px solid var(--border); background: var(--bg-surface); color: var(--text-bright); font-size: 14px; font-weight: 700; font-family: var(--mono); transition: border-color 0.15s; -moz-appearance: textfield; }
  .pm-step-value::-webkit-inner-spin-button, .pm-step-value::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  .pm-step-value:focus { outline: none; border-color: var(--blue); box-shadow: 0 0 0 2px rgba(88,166,255,0.15); }
  .pm-step-value::placeholder { color: var(--text-dim); font-weight: 400; }

  .pm-unit { font-size: 11px; color: var(--text-muted); margin-left: 8px; font-weight: 500; }

  .pipeline-modal .modal-actions { padding: 16px 28px 24px; margin-top: 20px; border-top: 1px solid var(--border); }

  /* User management */
  .um-tab.active { background: var(--bg-surface); color: var(--text-bright); border-color: var(--border-hover); }
  .um-role { display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; cursor: pointer; transition: all 0.12s; text-align: left; color: var(--text); }
  .um-role:hover { border-color: var(--border-hover); background: var(--bg-surface); }
  .um-role.active { border-color: rgba(88,166,255,0.4); background: var(--blue-bg); }
  .um-role-icon { width: 32px; height: 32px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0; }
  .um-role-info { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .um-role-name { font-size: 11px; font-weight: 700; color: var(--text-bright); }
  .um-role-desc { font-size: 9px; color: var(--text-dim); line-height: 1.3; }
  .um-user-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 6px; transition: background 0.1s; }
  .um-user-row:hover { background: var(--bg-surface); }
  .um-user-row + .um-user-row { border-top: 1px solid var(--border); }
  .um-user-avatar { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; flex-shrink: 0; }
  .um-user-info { flex: 1; min-width: 0; }
  .um-user-email { font-size: 11px; font-weight: 600; color: var(--text-bright); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .um-user-meta { font-size: 9px; color: var(--text-dim); }
  .um-badge { font-size: 9px; font-weight: 600; padding: 2px 8px; border-radius: 10px; text-transform: uppercase; letter-spacing: 0.5px; flex-shrink: 0; }
  .um-badge.admin { background: var(--blue-bg); color: var(--blue); }
  .um-badge.judge { background: var(--purple-bg); color: var(--purple); }
  .um-badge.manager { background: var(--yellow-bg); color: var(--yellow); }
  .um-badge.reviewer { background: var(--green-bg); color: var(--green); }
  .um-badge.user { background: var(--cyan-bg); color: var(--cyan); }
  .um-empty { text-align: center; padding: 32px 16px; }
  .um-empty-icon { font-size: 24px; margin-bottom: 8px; opacity: 0.3; }
  .um-empty-text { font-size: 11px; color: var(--text-dim); }

  .dt-action { padding: 16px; border: 1px solid var(--border); border-radius: 10px; margin-bottom: 10px; display: flex; align-items: center; gap: 14px; transition: border-color 0.15s; }
  .dt-action:hover { border-color: var(--border-hover); }
  .dt-action .dt-icon { width: 36px; height: 36px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 15px; flex-shrink: 0; }
  .dt-action .dt-info { flex: 1; }
  .dt-action .dt-name { font-size: 12px; font-weight: 600; color: var(--text-bright); margin-bottom: 2px; }
  .dt-action .dt-desc { font-size: 10px; color: var(--text-dim); }
  .dt-action .sf-btn { flex-shrink: 0; padding: 7px 18px; font-size: 11px; border-radius: 8px; }
  .dt-action.seed .dt-icon { background: var(--blue-bg); color: var(--blue); }
  .dt-action.wipe .dt-icon { background: var(--red-bg); color: var(--red); }
  .wh-tabs { display: flex; gap: 6px; margin-bottom: 16px; }
  .wh-tab { padding: 7px 16px; border: 1px solid var(--border); border-radius: 20px; background: transparent; color: var(--text-dim); font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.15s; }
  .wh-tab:hover { border-color: var(--border-hover); color: var(--text); background: var(--bg-surface); }
  .wh-tab.active { background: var(--blue-bg); border-color: rgba(88,166,255,0.35); color: var(--blue); }
  .sf-btn.secondary { background: transparent; color: var(--text-muted); border: 1px solid var(--border); transition: all 0.15s; }
  .sf-btn.secondary:hover { background: var(--bg-surface); color: var(--text); border-color: var(--border-hover); }

  /* ===== Email Reports Modal ===== */
  .er-modal { width: 780px; max-height: 88vh; overflow-y: auto; }
  .er-list-hdr { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
  .er-list-hdr .modal-title { margin-bottom: 0; }
  .er-back { background: none; border: none; color: var(--text-muted); font-size: 18px; cursor: pointer; padding: 0 8px 0 0; line-height: 1; }
  .er-back:hover { color: var(--text-bright); }
  .er-edit-hdr { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
  .er-edit-hdr-left { display: flex; align-items: center; }
  .er-edit-actions { display: flex; gap: 6px; align-items: center; }
  .er-table { width: 100%; border-collapse: collapse; }
  .er-table th { text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--text-dim); padding: 6px 10px; border-bottom: 1px solid var(--border); }
  .er-table td { font-size: 13px; padding: 10px 10px; border-bottom: 1px solid rgba(28,35,51,0.4); color: var(--text); vertical-align: middle; }
  .er-table tr[data-idx] { cursor: pointer; }
  .er-table tr[data-idx]:hover td { background: var(--bg-surface); }
  .er-table tr.er-disabled td { opacity: 0.4; }
  .er-table tr:last-child td { border-bottom: none; }
  .er-empty { text-align: center; color: var(--text-dim); font-style: italic; padding: 32px; font-size: 11px; }
  .er-badge { display: inline-flex; align-items: center; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; padding: 2px 7px; border-radius: 10px; margin-left: 6px; }
  .er-badge.disabled { background: rgba(72,79,88,0.25); color: var(--text-dim); }
  .er-row-actions { display: flex; gap: 4px; align-items: center; }
  .er-icon-btn { background: none; border: none; color: var(--text-dim); cursor: pointer; padding: 4px 7px; border-radius: 5px; transition: all 0.12s; font-size: 11px; font-weight: 600; }
  .er-icon-btn:hover { color: var(--text); background: var(--bg-surface); }
  .er-icon-btn.danger:hover { color: var(--red); background: var(--red-bg); }
  .er-chip-wrap { display: flex; flex-wrap: wrap; gap: 5px; padding: 7px 10px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; min-height: 40px; align-items: flex-start; cursor: text; transition: border-color 0.15s; }
  .er-chip-wrap:focus-within { border-color: var(--blue); }
  .er-chip { display: inline-flex; align-items: center; gap: 4px; background: var(--blue-bg); border: 1px solid rgba(88,166,255,0.25); color: var(--blue); font-size: 11px; padding: 2px 8px 2px 10px; border-radius: 12px; max-width: 240px; }
  .er-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .er-chip-x { background: none; border: none; color: var(--blue); cursor: pointer; font-size: 14px; line-height: 1; padding: 0; opacity: 0.55; flex-shrink: 0; }
  .er-chip-x:hover { opacity: 1; }
  .er-chip-field { border: none; outline: none; background: transparent; color: var(--text); font-size: 12px; min-width: 140px; flex: 1; padding: 2px 0; }
  .er-rule-row { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
  .er-rule-sel { padding: 5px 8px; background: var(--bg); border: 1px solid var(--border); border-radius: 7px; color: var(--text); font-size: 11px; cursor: pointer; }
  .er-rule-sel:focus { outline: none; border-color: var(--blue); }
  .er-rule-val { flex: 1; padding: 5px 9px; background: var(--bg); border: 1px solid var(--border); border-radius: 7px; color: var(--text); font-size: 11px; }
  .er-rule-val:focus { outline: none; border-color: var(--blue); }
  .er-add-rule { background: none; border: 1px dashed var(--border); border-radius: 7px; color: var(--text-dim); font-size: 11px; padding: 5px 12px; cursor: pointer; transition: all 0.12s; width: 100%; text-align: left; margin-top: 2px; }
  .er-add-rule:hover { border-color: var(--border-hover); color: var(--text-muted); }
  .er-filter-block { border: 1px solid var(--border); border-left: 3px solid var(--yellow); border-radius: 8px; padding: 14px 16px; margin-bottom: 14px; background: rgba(210,153,34,0.04); }
  .er-filter-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: var(--yellow); margin-bottom: 4px; }
  .er-filter-hint { font-size: 11px; color: var(--text-dim); margin-bottom: 10px; line-height: 1.5; }
  .er-section-card { border: 1px solid var(--border); border-radius: 8px; margin-bottom: 8px; overflow: hidden; }
  .er-section-head { display: flex; align-items: center; gap: 8px; padding: 10px 14px; cursor: pointer; background: var(--bg-raised); user-select: none; transition: background 0.1s; }
  .er-section-head:hover { background: var(--bg-surface); }
  .er-section-chevron { color: var(--text-dim); font-size: 11px; transition: transform 0.15s; flex-shrink: 0; display: inline-block; }
  .er-section-card.open .er-section-chevron { transform: rotate(90deg); }
  .er-section-title { font-size: 12px; font-weight: 600; color: var(--text); flex: 1; }
  .er-section-body { display: none; padding: 14px 16px; border-top: 1px solid var(--border); background: var(--bg); }
  .er-section-card.open .er-section-body { display: block; }
  .er-sub-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--text-dim); margin-bottom: 6px; margin-top: 12px; }
  .er-col-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; }
  .er-col-check { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-muted); cursor: pointer; padding: 5px 7px; border-radius: 5px; border: 1px solid transparent; transition: all 0.12s; }
  .er-col-check:hover { background: var(--bg-surface); border-color: var(--border); color: var(--text); }
  .er-col-check input { accent-color: var(--blue); width: 13px; height: 13px; flex-shrink: 0; }
  .er-col-check input:checked ~ span { color: var(--text); }
  .er-sched-block { border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; margin-top: 8px; background: var(--bg-raised); }
  .er-sched-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: var(--text-muted); margin-bottom: 10px; }
  .er-sched-tabs { display: flex; gap: 0; margin-bottom: 14px; border-radius: 8px; border: 1px solid var(--border); overflow: hidden; }
  .er-sched-tab { flex: 1; padding: 7px 14px; background: transparent; border: none; color: var(--text-dim); font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.12s; }
  .er-sched-tab:hover { color: var(--text); background: var(--bg-surface); }
  .er-sched-tab.active { background: var(--bg-surface); color: var(--text-bright); box-shadow: inset 0 -2px 0 var(--blue); }
  .er-sched-row { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; }
  .er-sched-col { display: flex; flex-direction: column; gap: 4px; }
  .er-sched-col-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--text-dim); }
  .er-sched-sel { padding: 7px 10px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 12px; font-weight: 500; cursor: pointer; min-width: 130px; }
  .er-sched-sel:focus { outline: none; border-color: var(--blue); }
  .er-sched-preview { font-size: 11px; color: var(--text-dim); margin-top: 10px; font-style: italic; }
  .er-status-row { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
  .er-toggle { position: relative; display: inline-block; width: 34px; height: 18px; flex-shrink: 0; }
  .er-toggle input { opacity: 0; width: 0; height: 0; position: absolute; }
  .er-toggle-slider { position: absolute; inset: 0; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 18px; cursor: pointer; transition: 0.2s; }
  .er-toggle-slider:before { content: ''; position: absolute; width: 12px; height: 12px; left: 2px; top: 2px; background: var(--text-dim); border-radius: 50%; transition: 0.2s; }
  .er-toggle input:checked + .er-toggle-slider { background: var(--green-bg); border-color: var(--green); }
  .er-toggle input:checked + .er-toggle-slider:before { transform: translateX(16px); background: var(--green); }
  .er-toggle-label { font-size: 12px; color: var(--text-muted); }

  /* ===== Main Content ===== */
  .main { flex: 1; margin-left: var(--sidebar-w); padding: 22px 24px; }

  .stat-row { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; margin-bottom: 16px; }
  .stat-card { background: var(--bg-raised); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; transition: border-color 0.15s; }
  .stat-card:hover { border-color: var(--border-hover); }
  .stat-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: var(--text-muted); margin-bottom: 3px; }
  .stat-value { font-size: 28px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .stat-card.blue .stat-value { color: var(--blue); }
  .stat-card.green .stat-value { color: var(--green); }
  .stat-card.red .stat-value { color: var(--red); }
  .stat-card.yellow .stat-value { color: var(--yellow); }

  /* Charts row */
  .charts { display: grid; grid-template-columns: 2fr 1fr; gap: 10px; margin-bottom: 16px; }
  .chart-panel { background: var(--bg-raised); border: 1px solid var(--border); border-radius: 10px; padding: 16px 16px 12px; }
  .chart-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted); margin-bottom: 10px; }
  .chart-wrap { position: relative; }
  .chart-wrap canvas { width: 100%; height: 140px; display: block; }

  /* Donut */
  .donut-wrap { display: flex; align-items: center; gap: 20px; padding: 8px 0; }
  .donut-canvas { width: 100px; height: 100px; }
  .donut-legend { display: flex; flex-direction: column; gap: 8px; }
  .donut-item { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .donut-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .donut-val { font-weight: 700; color: var(--text-bright); font-variant-numeric: tabular-nums; margin-left: auto; }

  /* Panels */
  .panels { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; }
  .panel { background: var(--bg-raised); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }
  .panel-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted); margin-bottom: 10px; }

  .rq-row { display: flex; gap: 20px; align-items: center; }
  .rq-stat { text-align: center; }
  .rq-stat .rv { font-size: 24px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .rq-stat .rl { font-size: 9px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.8px; margin-top: 2px; }
  .rq-stat.pending .rv { color: var(--yellow); }
  .rq-stat.decided .rv { color: var(--green); }
  .rq-div { width: 1px; height: 32px; background: var(--border); }

  .tk-total { font-size: 16px; font-weight: 700; color: var(--text-bright); margin-bottom: 8px; font-variant-numeric: tabular-nums; }
  .tk-total small { font-size: 10px; color: var(--text-dim); font-weight: 400; }
  .fn-list { display: flex; flex-direction: column; gap: 3px; max-height: 120px; overflow-y: auto; }
  .fn-row { display: flex; justify-content: space-between; align-items: center; padding: 3px 7px; background: var(--bg); border-radius: 4px; font-size: 10px; }
  .fn-name { color: var(--text-muted); font-family: var(--mono); }
  .fn-tokens { color: var(--text); font-weight: 600; font-variant-numeric: tabular-nums; }
  .fn-calls { color: var(--text-dim); font-size: 9px; margin-left: 5px; }

  /* Tables */
  .tbl { background: var(--bg-raised); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; margin-bottom: 12px; }
  .tbl-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted); margin-bottom: 8px; }
table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted); padding: 4px 8px; border-bottom: 1px solid var(--border); }
  td { font-size: 11px; padding: 6px 8px; border-bottom: 1px solid rgba(28,35,51,0.4); color: var(--text-muted); }
  tr:last-child td { border-bottom: none; }
  .mono { font-family: var(--mono); font-size: 10px; color: var(--text); }
  .step-badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; background: var(--blue-bg); color: var(--blue); }
  .error-msg { color: var(--red); font-size: 10px; max-width: 350px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .time-ago { color: var(--text-dim); font-size: 10px; font-variant-numeric: tabular-nums; }
  .duration { color: var(--yellow); font-variant-numeric: tabular-nums; }
  .tbl-link { color: var(--blue); font-size: 10px; text-decoration: none; font-weight: 600; }
  .tbl-link:hover { text-decoration: underline; }
  .empty-row td { text-align: center; color: var(--text-dim); font-style: italic; padding: 14px; font-size: 11px; }

  /* Toast */
  .t-wrap { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); z-index: 200; display: flex; flex-direction: column-reverse; gap: 6px; align-items: center; pointer-events: none; }
  .t-toast { padding: 7px 16px; border-radius: 8px; font-size: 11px; font-weight: 600; backdrop-filter: blur(12px); box-shadow: 0 4px 20px rgba(0,0,0,0.5); animation: tIn 0.2s ease, tOut 0.3s ease 2s forwards; display: flex; align-items: center; gap: 6px; }
  .t-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
  .t-toast.success { background: rgba(17,22,32,0.95); color: var(--green); border: 1px solid rgba(63,185,80,0.15); }
  .t-toast.success .t-dot { background: var(--green); }
  .t-toast.error { background: rgba(17,22,32,0.95); color: var(--red); border: 1px solid rgba(248,81,73,0.15); }
  .t-toast.error .t-dot { background: var(--red); }
  .t-toast.info { background: rgba(17,22,32,0.95); color: var(--text-muted); border: 1px solid var(--border); }
  .t-toast.info .t-dot { background: var(--blue); }
  @keyframes tIn { from { opacity:0; transform: translateY(6px) scale(0.97); } to { opacity:1; transform: none; } }
  @keyframes tOut { from { opacity:1 } to { opacity:0; transform: translateY(-4px); } }

  @media (max-width: 1000px) {
    .sidebar { position: relative; width: 100%; min-width: 100%; border-right: none; border-bottom: 1px solid var(--border); }
    .layout { flex-direction: column; }
    .main { margin-left: 0; }
    .stat-row { grid-template-columns: repeat(3, 1fr); }
    .charts { grid-template-columns: 1fr; }
    .panels { grid-template-columns: 1fr; }
  }
  @media (max-width: 500px) { .stat-row { grid-template-columns: 1fr; } }
</style>
</head>
<body>

<div class="layout">
  <aside class="sidebar">
    <div class="sb-brand">
      <h1>Auto-Bot</h1>
      <div class="sb-status">
        <span class="dot loading" id="status-dot"></span>
        <span>Refresh in <strong id="countdown">30</strong>s</span>
      </div>
    </div>

    <div class="sb-section">
      <div class="sb-label">Navigation</div>
      <a href="/chat" class="sb-link">
        <div class="icon" style="background:rgba(57,208,216,0.10);color:#39d0d8;">${icons.messageCircle24}</div>
        <span class="title">Chat</span>
        <span class="arrow">${icons.chevronRight}</span>
      </a>
    </div>

    <div class="sb-section">
      <div class="sb-label">Configuration</div>

      <!-- Webhook (opens modal) -->
      <div class="sb-link" id="webhook-open">
        <div class="icon">${icons.webhook}</div>
        <span class="title">Webhook</span>
        <span class="arrow">${icons.chevronRight}</span>
      </div>

      <!-- Email Reports (opens modal) -->
      <div class="sb-link" id="email-reports-open">
        <div class="icon">${icons.mail}</div>
        <span class="title">Email Reports</span>
        <span class="arrow">${icons.chevronRight}</span>
      </div>

      <!-- Email Templates (opens modal) -->
      <div class="sb-link" id="email-templates-open">
        <div class="icon" style="background:var(--cyan-bg);color:var(--cyan);">${icons.mail}</div>
        <span class="title">Email Templates</span>
        <span class="arrow">${icons.chevronRight}</span>
      </div>

      <!-- Chargebacks & Omissions (opens modal) -->
      <div class="sb-link" id="chargebacks-open">
        <div class="icon" style="background:var(--yellow-bg);color:var(--yellow);">${icons.clipboardList}</div>
        <span class="title">Chargebacks &amp; Omissions</span>
        <span class="arrow">${icons.chevronRight}</span>
      </div>

      <!-- Purge Audit Data (opens modal) -->
      <div class="sb-link" id="purge-open">
        <div class="icon" style="background:var(--red-bg);color:var(--red);">${icons.trash}</div>
        <span class="title">Purge Audit Data</span>
        <span class="arrow">${icons.chevronRight}</span>
      </div>

      <!-- Bad Words (opens modal) -->
      <div class="sb-link" id="bad-words-open">
        <div class="icon" style="background:var(--red-bg);color:var(--red);">${icons.alertTriangle}</div>
        <span class="title">Bad Words</span>
        <span class="arrow">${icons.chevronRight}</span>
      </div>

      <!-- Offices (opens modal) -->
      <div class="sb-link" id="office-bypass-open">
        <div class="icon" style="background:var(--yellow-bg);color:var(--yellow);">${icons.clipboardList}</div>
        <span class="title">Offices</span>
        <span class="arrow">${icons.chevronRight}</span>
      </div>

      <!-- Users (opens modal) -->
      <div class="sb-link" id="users-open">
        <div class="icon users">${icons.users}</div>
        <span class="title">Users</span>
        <span class="arrow">${icons.chevronRight}</span>
      </div>

      <!-- Pipeline (opens modal) -->
      <div class="sb-link" id="pipeline-open">
        <div class="icon pipeline">${icons.settings}</div>
        <span class="title">Pipeline</span>
        <span class="arrow">${icons.chevronRight}</span>
      </div>

      <!-- Gamification (standalone page) -->
      <a class="sb-link" href="/gamification" style="text-decoration:none;color:inherit;">
        <div class="icon" style="background:var(--green-bg);color:var(--green);">${icons.trophy}</div>
        <span class="title">Gamification</span>
        <span class="arrow">${icons.chevronRight}</span>
      </a>

      <!-- Badge Editor (standalone page) -->
      <a class="sb-link" href="/admin/badge-editor" style="text-decoration:none;color:inherit;">
        <div class="icon" style="background:var(--cyan-bg);color:var(--cyan);">${icons.shoppingBag}</div>
        <span class="title">Badge Editor</span>
        <span class="arrow">${icons.chevronRight}</span>
      </a>
    </div>

    <div class="sb-section">
      <div class="sb-label">Impersonate</div>
      <div class="sb-link" id="impersonate-user-open">
        <div class="icon" style="background:var(--yellow-bg);color:var(--yellow);">${icons.userCog}</div>
        <span class="title">Specific User</span>
        <span class="arrow">${icons.chevronRight}</span>
      </div>
      <div class="sb-rv-wrap" id="rv-wrap">
        <div class="sb-link">
          <div class="icon rv">${icons.users}</div>
          <span class="title">Role Views</span>
          <span class="arrow">${icons.chevronRight}</span>
        </div>
        <div class="sb-rv-flyout" id="rv-flyout">
          <div class="sb-rv-panel">
            <div class="rv-title">View as role</div>
            <a href="/judge/dashboard">
              <div class="rm-icon" style="background:var(--yellow-bg);color:var(--yellow);">${icons.scale}</div>
              Judge Dashboard
            </a>
            <a href="/review/dashboard">
              <div class="rm-icon" style="background:var(--purple-bg);color:var(--purple);">${icons.playCircle}</div>
              Review Dashboard
            </a>
            <a href="/manager">
              <div class="rm-icon" style="background:var(--cyan-bg);color:var(--cyan);">${icons.clipboardList}</div>
              Manager Portal
            </a>
            <a href="/agent">
              <div class="rm-icon" style="background:rgba(249,115,22,0.10);color:#f97316;">${icons.barChart}</div>
              Agent Dashboard
            </a>
          </div>
        </div>
      </div>
    </div>

    <div class="sb-section">
      <!-- Dev Tools (opens modal, shown when ?local) -->
      <div class="sb-link" id="devtools-open" style="display:none">
        <div class="icon dev">${icons.alertTriangle}</div>
        <span class="title">Dev Tools</span>
        <span class="arrow">${icons.chevronRight}</span>
      </div>
      <a class="sb-link" id="super-admin-link" href="/super-admin" style="display:none;text-decoration:none;color:inherit;">
        <div class="icon" style="background:rgba(248,81,73,0.1);color:#f85149;">${icons.shield}</div>
        <span class="title">Super Admin</span>
        <span class="arrow">${icons.chevronRight}</span>
      </a>
    </div>

    <div class="sb-footer">
      <div class="sb-user">
        <div class="sb-avatar" id="user-avatar"></div>
        <div>
          <div class="sb-email" id="user-email"></div>
          <div class="sb-role">Admin</div>
        </div>
      </div>
      <div class="sb-settings">
        <div class="sb-link" onclick="fetch('/logout',{method:'POST'}).then(function(){window.location.href='/login'})">
          <div class="icon" style="background:var(--red-bg);color:var(--red);">${icons.logIn}</div>
          <span class="title">Logout</span>
        </div>
      </div>
    </div>
  </aside>

  <!-- Loading overlay -->
  <div id="init-overlay" style="position:fixed;inset:0;z-index:9999;background:#0d1117;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;transition:opacity 0.4s;">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none" style="width:52px;height:52px;animation:bot-pulse 1.4s ease-in-out infinite;">
      <rect x="4" y="9" width="24" height="19" rx="4" fill="#0d1117"/>
      <rect x="4" y="9" width="24" height="19" rx="4" fill="none" stroke="#3fb950" stroke-width="1.5"/>
      <rect x="14.5" y="4" width="3" height="6" rx="1" fill="#3fb950"/>
      <circle cx="16" cy="3.5" r="2.5" fill="#3fb950"/>
      <rect x="7.5" y="14" width="6" height="5" rx="1.5" fill="#3fb950"/>
      <rect x="9" y="15" width="2" height="1.5" rx="0.5" fill="#7ee787" opacity="0.7"/>
      <rect x="18.5" y="14" width="6" height="5" rx="1.5" fill="#3fb950"/>
      <rect x="20" y="15" width="2" height="1.5" rx="0.5" fill="#7ee787" opacity="0.7"/>
      <rect x="9" y="23" width="3.5" height="2" rx="1" fill="#3fb950" opacity="0.65"/>
      <rect x="14.25" y="23" width="3.5" height="2" rx="1" fill="#3fb950" opacity="0.65"/>
      <rect x="19.5" y="23" width="3.5" height="2" rx="1" fill="#3fb950" opacity="0.65"/>
      <circle cx="3.5" cy="17.5" r="1.5" fill="#3fb950" opacity="0.55"/>
      <circle cx="28.5" cy="17.5" r="1.5" fill="#3fb950" opacity="0.55"/>
    </svg>
    <div style="color:#3fb950;font-size:13px;font-weight:600;letter-spacing:0.5px;">Loading dashboard...</div>
  </div>
  <style>@keyframes bot-pulse { 0%,100%{opacity:0.5;transform:scale(0.95)} 50%{opacity:1;transform:scale(1.05)} }</style>

  <main class="main">
    <div class="stat-row">
      <div class="stat-card yellow">
        <div class="stat-label">In Pipeline</div>
        <div class="stat-value" id="s-pipe">--</div>
      </div>
      <div class="stat-card blue">
        <div class="stat-label">Active</div>
        <div class="stat-value" id="s-active">--</div>
      </div>
      <div class="stat-card green">
        <div class="stat-label">Completed (24h)</div>
        <div class="stat-value" id="s-completed">--</div>
      </div>
      <div class="stat-card red">
        <div class="stat-label">Errors (24h)</div>
        <div class="stat-value" id="s-errors">--</div>
      </div>
      <div class="stat-card yellow">
        <div class="stat-label">Retries (24h)</div>
        <div class="stat-value" id="s-retries">--</div>
      </div>
    </div>

    <!-- Charts -->
    <div class="charts">
      <div class="chart-panel">
        <div class="chart-title">Pipeline Activity (24h)</div>
        <div class="chart-wrap"><canvas id="chart-activity" height="140"></canvas></div>
      </div>
      <div class="chart-panel">
        <div class="chart-title">Review Progress</div>
        <div class="donut-wrap">
          <canvas class="donut-canvas" id="chart-donut" width="100" height="100"></canvas>
          <div class="donut-legend" id="donut-legend"></div>
        </div>
      </div>
    </div>

    <div class="panels">
      <div class="panel">
        <div class="panel-title" style="display:flex;align-items:center;justify-content:space-between;">
          <span>Review Queue</span>
          <button class="sf-btn danger" id="clear-review-btn" style="font-size:9px;padding:3px 10px;">Clear Queue</button>
        </div>
        <div style="width:100%;border-collapse:collapse;display:table;font-size:11px;margin-top:6px;">
          <div style="display:table-row;color:var(--text-dim);font-weight:700;text-transform:uppercase;letter-spacing:.8px;font-size:9px;">
            <div style="display:table-cell;padding:2px 0 6px;"></div>
            <div style="display:table-cell;padding:2px 8px 6px;text-align:right;">Pending</div>
            <div style="display:table-cell;padding:2px 0 6px;text-align:right;">Decided</div>
          </div>
          <div style="display:table-row;">
            <div style="display:table-cell;padding:4px 0;color:var(--text-dim);font-size:10px;white-space:nowrap;">Internal</div>
            <div style="display:table-cell;padding:4px 8px;text-align:right;font-size:16px;font-weight:700;color:var(--yellow);" id="r-dl-pending">--</div>
            <div style="display:table-cell;padding:4px 0;text-align:right;font-size:16px;font-weight:700;color:var(--green);" id="r-dl-decided">--</div>
          </div>
          <div style="display:table-row;">
            <div style="display:table-cell;padding:4px 0;color:var(--text-dim);font-size:10px;white-space:nowrap;">Partner</div>
            <div style="display:table-cell;padding:4px 8px;text-align:right;font-size:16px;font-weight:700;color:var(--yellow);" id="r-pkg-pending">--</div>
            <div style="display:table-cell;padding:4px 0;text-align:right;font-size:16px;font-weight:700;color:var(--green);" id="r-pkg-decided">--</div>
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-title">Token Usage (1h)</div>
        <div class="tk-total" id="t-total">-- <small>tokens</small></div>
        <div class="fn-list" id="t-functions"></div>
      </div>
    </div>

    <!-- Search -->
    <div class="tbl" style="margin-bottom:16px;">
      <div class="tbl-title">Find Audit</div>
      <div style="display:flex;gap:8px;padding:0 0 2px;">
        <input id="search-input" class="sf-input" type="text" placeholder="Finding ID..." style="flex:1;font-family:var(--mono);font-size:12px;">
        <button class="sf-btn primary" id="search-btn" style="padding:6px 16px;font-size:11px;">View Report</button>
      </div>
    </div>

    <!-- Test by RID -->
    <div class="tbl" style="margin-bottom:16px;">
      <div class="tbl-title">Test Audit by RID</div>
      <div style="display:flex;gap:8px;padding:0 0 2px;align-items:center;">
        <input id="rid-input" class="sf-input" type="text" placeholder="Record ID..." style="flex:1;font-family:var(--mono);font-size:12px;">
        <select id="rid-type" class="sf-input" style="width:130px;font-size:12px;padding:6px 8px;">
          <option value="dateleg">Internal</option>
          <option value="package">Partner</option>
        </select>
        <button class="sf-btn secondary" id="bulk-open-btn" style="padding:6px 14px;font-size:11px;white-space:nowrap;">Bulk</button>
        <button class="sf-btn primary" id="rid-btn" style="padding:6px 16px;font-size:11px;white-space:nowrap;">Start Audit</button>
      </div>
      <div id="rid-result" style="font-size:10px;margin-top:6px;min-height:14px;"></div>
    </div>

    <div class="tbl">
      <div class="tbl-title" style="display:flex;align-items:center;justify-content:space-between;">
        <span>Active Audits</span>
        <div style="display:flex;gap:6px;">
          <button class="sf-btn" id="resume-queues-btn" style="font-size:9px;padding:3px 10px;">Resume Queues</button>
          <button class="sf-btn danger" id="terminate-all-btn" style="font-size:9px;padding:3px 10px;">Terminate Running</button>
          <button class="sf-btn danger" id="clear-queue-btn" style="font-size:9px;padding:3px 10px;">Clear Queue</button>
        </div>
      </div>
      <table><thead><tr><th>Finding ID</th><th>QB Record</th><th>Step</th><th>Started</th><th>Duration</th><th></th></tr></thead>
      <tbody id="tb-active"><tr class="empty-row"><td colspan="6">No active audits</td></tr></tbody></table>
    </div>

    <div class="tbl">
      <div class="tbl-title" style="display:flex;align-items:center;justify-content:space-between;">
        <span>Recent Errors (24h)</span>
        <button class="sf-btn danger" id="clear-errors-btn" style="font-size:9px;padding:3px 10px;">Clear Errors</button>
      </div>
      <table><thead><tr><th>Finding ID</th><th>Logs</th><th>Step</th><th>Error</th><th>When</th></tr></thead>
      <tbody id="tb-errors"><tr class="empty-row"><td colspan="5">No errors</td></tr></tbody></table>
    </div>

    <div class="tbl">
      <div class="tbl-title" style="display:flex;align-items:center;justify-content:space-between;">
        <span>Recently Completed (24h)</span>
        <a href="/admin/audits" target="_blank" style="font-size:10px;color:var(--blue);text-decoration:none;font-weight:600;padding:3px 10px;border:1px solid rgba(88,166,255,0.25);border-radius:5px;background:rgba(88,166,255,0.08);">View All →</a>
      </div>
      <table><thead><tr><th>Finding ID</th><th>Logs</th><th>QB Record</th><th>Score</th><th>Started</th><th>Finished</th><th>Duration</th><th></th></tr></thead>
      <tbody id="tb-recent"><tr class="empty-row"><td colspan="8">No completed audits</td></tr></tbody></table>
    </div>
  </main>
</div>

<!-- Webhook Modal -->
<div class="modal-overlay" id="webhook-modal">
  <div class="modal">
    <div class="modal-title">Webhook Configuration</div>
    <div class="wh-tabs" id="wh-tabs">
      <button class="wh-tab active" data-kind="terminate">Audit Complete</button>
      <button class="wh-tab" data-kind="appeal">Appeal Filed</button>
      <button class="wh-tab" data-kind="manager">Manager Review</button>
      <button class="wh-tab" data-kind="judge-finish">Judge Finish</button>
      <button class="wh-tab" data-kind="re-audit-receipt">Re-Audit Receipt</button>
    </div>
    <div class="modal-sub" id="wh-sub">Called when an audit review is completed</div>
    <div class="sf">
      <label class="sf-label">External Webhook URL <span style="color:var(--text-dim);font-weight:400;">(optional — for external integrations only)</span></label>
      <input type="text" class="sf-input" id="a-posturl" placeholder="https://example.com/webhook">
    </div>
    <div class="sf">
      <label class="sf-label">Headers (JSON)</label>
      <textarea class="sf-input" id="a-headers" placeholder='{"Authorization": "Bearer ..."}'></textarea>
    </div>
    <div class="sf">
      <label class="sf-label">Test Email <span style="color:var(--text-dim);font-weight:400;">(overrides all recipients when set — leave blank for live)</span></label>
      <input type="text" class="sf-input" id="a-test-email" placeholder="yourname@example.com">
    </div>
    <div class="sf">
      <label class="sf-label">BCC <span style="color:var(--text-dim);font-weight:400;">(comma-separated — skipped when test email is set)</span></label>
      <input type="text" class="sf-input" id="a-bcc" placeholder="email1@example.com,email2@example.com">
    </div>
    <div class="sf" id="wh-template-row" style="display:none;">
      <label class="sf-label">Email Template <span style="color:var(--text-dim);font-weight:400;">(used for direct emails on this event)</span></label>
      <select class="sf-input" id="a-template-id">
        <option value="">— No template (email disabled) —</option>
      </select>
    </div>
    <div id="wh-default-url-row" style="display:none;margin-top:10px;padding:10px 14px;background:var(--bg);border:1px solid var(--border);border-radius:8px;">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:6px;">Default Email Endpoint (auto-configured)</div>
      <div style="display:flex;align-items:center;gap:8px;">
        <code id="wh-default-url-text" style="font-size:10px;color:var(--cyan);word-break:break-all;flex:1;line-height:1.5;"></code>
        <button class="sf-btn ghost" id="wh-default-url-copy" style="font-size:10px;white-space:nowrap;flex-shrink:0;">Copy</button>
      </div>
    </div>
    <div class="modal-actions">
      <button class="sf-btn secondary" id="webhook-cancel">Cancel</button>
      <button class="sf-btn primary" id="a-settings-save">Save</button>
    </div>
  </div>
</div>

<!-- Email Reports Modal -->
<div class="modal-overlay" id="email-reports-modal">
  <div class="modal er-modal">
    <div id="er-content"></div>
  </div>
</div>

<!-- Chargebacks & Omissions / Wire Deductions Modal -->
<div class="modal-overlay" id="chargebacks-modal">
  <div class="modal" style="width:92vw;max-width:92vw;height:88vh;display:flex;flex-direction:column;padding:0;overflow:hidden;border-radius:14px;">
    <!-- Tab bar -->
    <div style="display:flex;align-items:center;gap:0;padding:0 24px;border-bottom:1px solid var(--border);flex-shrink:0;background:var(--bg-surface);">
      <button id="rpt-tab-cb" onclick="rptSwitchTab('cb')" style="font-size:11px;font-weight:600;padding:12px 16px;border:none;background:none;cursor:pointer;color:var(--blue);border-bottom:2px solid var(--blue);margin-bottom:-1px;">Chargebacks &amp; Omissions</button>
      <button id="rpt-tab-wire" onclick="rptSwitchTab('wire')" style="font-size:11px;font-weight:600;padding:12px 16px;border:none;background:none;cursor:pointer;color:var(--text-dim);border-bottom:2px solid transparent;margin-bottom:-1px;">Wire Deductions</button>
    </div>
    <!-- Controls -->
    <div style="display:flex;align-items:center;gap:10px;padding:12px 24px;border-bottom:1px solid var(--border);flex-shrink:0;">
      <label style="font-size:11px;color:var(--text-dim);font-weight:600;">From</label>
      <input type="date" id="cb-date-from" class="sf-input" style="font-size:11px;padding:5px 8px;cursor:pointer;" onclick="this.showPicker()">
      <label style="font-size:11px;color:var(--text-dim);font-weight:600;">To</label>
      <input type="date" id="cb-date-to" class="sf-input" style="font-size:11px;padding:5px 8px;cursor:pointer;" onclick="this.showPicker()">
      <button class="sf-btn primary" id="cb-fetch-btn" style="font-size:11px;">Pull Report</button>
      <select id="cb-format" class="sf-input" style="font-size:11px;padding:5px 8px;width:70px;">
        <option value="csv">CSV</option>
        <option value="xlsx">XLSX</option>
      </select>
      <button class="sf-btn ghost" id="cb-download-btn" style="font-size:11px;" disabled>Download</button>
      <button class="sf-btn ghost" id="cb-post-btn" style="font-size:11px;" disabled>Post to Sheet</button>
      <button class="sf-btn ghost" id="chargebacks-cancel" style="font-size:11px;margin-left:auto;">Close</button>
    </div>
    <!-- Body -->
    <div style="flex:1;overflow-y:auto;padding:20px 24px;" id="cb-body">
      <!-- Chargebacks & Omissions panel -->
      <div id="rpt-panel-cb">
        <div id="cb-empty" style="color:var(--text-dim);font-size:12px;text-align:center;padding:60px 0;">Select a date range and pull the report.</div>
        <div id="cb-chargebacks-block" style="display:none;margin-bottom:32px;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--red);margin-bottom:10px;" id="cb-cb-heading">Chargebacks (0)</div>
          <table style="width:100%;border-collapse:collapse;font-size:11px;">
            <thead><tr style="border-bottom:1px solid var(--border);">
              <th style="text-align:left;padding:6px 10px;color:var(--text-dim);font-weight:600;">Date</th>
              <th style="text-align:left;padding:6px 10px;color:var(--text-dim);font-weight:600;">Team Member</th>
              <th style="text-align:left;padding:6px 10px;color:var(--text-dim);font-weight:600;">Revenue</th>
              <th style="text-align:left;padding:6px 10px;color:var(--text-dim);font-weight:600;">CRM Link</th>
              <th style="text-align:left;padding:6px 10px;color:var(--text-dim);font-weight:600;">Type</th>
              <th style="text-align:left;padding:6px 10px;color:var(--text-dim);font-weight:600;">Failed Questions</th>
            </tr></thead>
            <tbody id="cb-cb-body"></tbody>
          </table>
        </div>
        <div id="cb-omissions-block" style="display:none;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--yellow);margin-bottom:10px;" id="cb-om-heading">Omissions (0)</div>
          <table style="width:100%;border-collapse:collapse;font-size:11px;">
            <thead><tr style="border-bottom:1px solid var(--border);">
              <th style="text-align:left;padding:6px 10px;color:var(--text-dim);font-weight:600;">Date</th>
              <th style="text-align:left;padding:6px 10px;color:var(--text-dim);font-weight:600;">Team Member</th>
              <th style="text-align:left;padding:6px 10px;color:var(--text-dim);font-weight:600;">Revenue</th>
              <th style="text-align:left;padding:6px 10px;color:var(--text-dim);font-weight:600;">CRM Link</th>
              <th style="text-align:left;padding:6px 10px;color:var(--text-dim);font-weight:600;">Type</th>
              <th style="text-align:left;padding:6px 10px;color:var(--text-dim);font-weight:600;">Failed Questions</th>
            </tr></thead>
            <tbody id="cb-om-body"></tbody>
          </table>
        </div>
      </div>
      <!-- Wire Deductions panel -->
      <div id="rpt-panel-wire" style="display:none;">
        <div id="wire-empty" style="color:var(--text-dim);font-size:12px;text-align:center;padding:60px 0;">Select a date range and pull the report.</div>
        <div id="wire-block" style="display:none;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--cyan);margin-bottom:10px;" id="wire-heading">Wire Deductions (0)</div>
          <table style="width:100%;border-collapse:collapse;font-size:11px;">
            <thead><tr style="border-bottom:1px solid var(--border);">
              <th style="text-align:left;padding:6px 10px;color:var(--text-dim);font-weight:600;">Date</th>
              <th style="text-align:left;padding:6px 10px;color:var(--text-dim);font-weight:600;">Score</th>
              <th style="text-align:left;padding:6px 10px;color:var(--text-dim);font-weight:600;">Questions</th>
              <th style="text-align:left;padding:6px 10px;color:var(--text-dim);font-weight:600;">Passed</th>
              <th style="text-align:left;padding:6px 10px;color:var(--text-dim);font-weight:600;">CRM Link</th>
              <th style="text-align:left;padding:6px 10px;color:var(--text-dim);font-weight:600;">Audit Link</th>
              <th style="text-align:left;padding:6px 10px;color:var(--text-dim);font-weight:600;">Office</th>
              <th style="text-align:left;padding:6px 10px;color:var(--text-dim);font-weight:600;">Auditor</th>
              <th style="text-align:left;padding:6px 10px;color:var(--text-dim);font-weight:600;">Guest Name</th>
            </tr></thead>
            <tbody id="wire-body"></tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- Purge Audit Data Modal -->
<div class="modal-overlay" id="purge-modal">
  <div class="modal" style="width:480px;max-width:95vw;">
    <div class="modal-title">Purge Audit Data</div>
    <div class="modal-sub" style="margin-bottom:20px;">Permanently delete all audit history, chargeback &amp; wire deduction records within a date range. Cannot be undone.</div>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
      <label style="font-size:11px;color:var(--text-dim);font-weight:600;white-space:nowrap;">From</label>
      <input type="date" id="purge-date-from" class="sf-input" style="font-size:11px;padding:5px 8px;cursor:pointer;" onclick="this.showPicker()">
      <label style="font-size:11px;color:var(--text-dim);font-weight:600;white-space:nowrap;">To (inclusive)</label>
      <input type="date" id="purge-date-to" class="sf-input" style="font-size:11px;padding:5px 8px;cursor:pointer;" onclick="this.showPicker()">
    </div>
    <div id="purge-msg" style="font-size:12px;color:var(--text-dim);margin-bottom:16px;min-height:18px;"></div>
    <div class="modal-actions">
      <button class="sf-btn secondary" id="purge-cancel">Cancel</button>
      <button class="sf-btn danger" id="purge-confirm-btn">Purge</button>
    </div>
  </div>
</div>

<!-- Email Templates Modal -->
<div class="modal-overlay" id="email-templates-modal">
  <div class="modal" style="width:90vw;max-width:90vw;height:85vh;display:flex;flex-direction:column;padding:0;overflow:hidden;border-radius:14px;">
    <!-- Header -->
    <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 24px 14px;border-bottom:1px solid var(--border);flex-shrink:0;">
      <div>
        <div class="modal-title" style="margin-bottom:2px;">Email Templates</div>
        <div class="modal-sub" style="margin-bottom:0;">Build and preview audit notification emails</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="sf-btn ghost" id="email-templates-cancel" style="font-size:11px;">Close</button>
      </div>
    </div>
    <!-- Body -->
    <div style="display:flex;flex:1;overflow:hidden;min-height:0;">
      <!-- Template list sidebar -->
      <div style="width:190px;min-width:190px;border-right:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden;">
        <div style="padding:10px 12px;border-bottom:1px solid var(--border);flex-shrink:0;">
          <button class="sf-btn primary" id="et-new-btn" style="width:100%;font-size:11px;">+ New Template</button>
        </div>
        <div id="et-list" style="flex:1;overflow-y:auto;padding:6px;"></div>
      </div>
      <!-- HTML Editor -->
      <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;border-right:1px solid var(--border);min-width:0;">
        <div style="padding:10px 14px;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:center;flex-shrink:0;">
          <input id="et-name" class="sf-input" type="text" placeholder="Template name..." style="width:160px;flex-shrink:0;">
          <input id="et-subject" class="sf-input" type="text" placeholder="Email subject line..." style="flex:1;">
          <button class="sf-btn primary" id="et-save-btn" style="font-size:11px;white-space:nowrap;flex-shrink:0;">Save</button>
          <button class="sf-btn danger" id="et-delete-btn" style="font-size:11px;flex-shrink:0;" disabled>Delete</button>
        </div>
        <div style="padding:5px 12px;background:var(--bg);border-bottom:1px solid var(--border);font-size:10px;color:var(--text-dim);flex-shrink:0;line-height:1.8;">
          <span style="color:var(--text-muted);font-weight:600;">Variables:</span>
          <code style="margin:0 3px;padding:1px 4px;background:var(--bg-surface);border-radius:3px;">{{agentName}}</code>
          <code style="margin:0 3px;padding:1px 4px;background:var(--bg-surface);border-radius:3px;">{{score}}</code>
          <code style="margin:0 3px;padding:1px 4px;background:var(--bg-surface);border-radius:3px;">{{reportUrl}}</code>
          <code style="margin:0 3px;padding:1px 4px;background:var(--bg-surface);border-radius:3px;">{{recordingUrl}}</code>
          <code style="margin:0 3px;padding:1px 4px;background:var(--bg-surface);border-radius:3px;">{{appealUrl}}</code>
          <code style="margin:0 3px;padding:1px 4px;background:var(--bg-surface);border-radius:3px;">{{feedbackText}}</code>
          <code style="margin:0 3px;padding:1px 4px;background:var(--bg-surface);border-radius:3px;">{{recordId}}</code>
          <code style="margin:0 3px;padding:1px 4px;background:var(--bg-surface);border-radius:3px;">{{guestName}}</code>
          <code style="margin:0 3px;padding:1px 4px;background:var(--bg-surface);border-radius:3px;">{{missedQuestions}}</code>
          <code style="margin:0 3px;padding:1px 4px;background:var(--bg-surface);border-radius:3px;">{{missedCount}}</code>
          <code style="margin:0 3px;padding:1px 4px;background:var(--bg-surface);border-radius:3px;">{{totalQuestions}}</code>
          <code style="margin:0 3px;padding:1px 4px;background:var(--bg-surface);border-radius:3px;">{{crmUrl}}</code>
          <code style="margin:0 3px;padding:1px 4px;background:var(--bg-surface);border-radius:3px;">{{scoreVerbiage}}</code>
          <code style="margin:0 3px;padding:1px 4px;background:var(--bg-surface);border-radius:3px;">{{teamMember}}</code>
          <code style="margin:0 3px;padding:1px 4px;background:var(--bg-surface);border-radius:3px;">{{teamMemberFirst}}</code>
        </div>
        <!-- Template ID + Webhook URLs panel (shown after save/load) -->
        <div id="et-webhook-info" style="display:none;padding:8px 12px;background:var(--bg);border-bottom:1px solid var(--border);flex-shrink:0;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;">
            <span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);white-space:nowrap;">Template ID</span>
            <code id="et-id-display" style="font-size:10px;color:var(--cyan);background:var(--cyan-bg);padding:2px 7px;border-radius:4px;font-family:var(--mono);word-break:break-all;flex:1;"></code>
            <button id="et-copy-id" style="font-size:9px;padding:2px 8px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--text-muted);cursor:pointer;white-space:nowrap;">Copy ID</button>
          </div>
          <div style="display:flex;align-items:flex-start;gap:6px;margin-bottom:4px;">
            <span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--green);white-space:nowrap;line-height:1.8;">Live URL</span>
            <code id="et-url-live" style="font-size:9px;color:var(--text-muted);word-break:break-all;flex:1;line-height:1.6;"></code>
            <button id="et-copy-live" style="font-size:9px;padding:2px 8px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--text-muted);cursor:pointer;white-space:nowrap;">Copy</button>
          </div>
          <div style="display:flex;align-items:flex-start;gap:6px;">
            <span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--yellow);white-space:nowrap;line-height:1.8;">Test URL</span>
            <code id="et-url-test" style="font-size:9px;color:var(--text-muted);word-break:break-all;flex:1;line-height:1.6;"></code>
            <button id="et-copy-test" style="font-size:9px;padding:2px 8px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--text-muted);cursor:pointer;white-space:nowrap;">Copy</button>
          </div>
        </div>
        <textarea id="et-html" style="flex:1;resize:none;background:var(--bg);color:var(--text);border:none;outline:none;padding:14px 16px;font-family:var(--mono);font-size:12px;line-height:1.6;" placeholder="Paste or type HTML here..."></textarea>
      </div>
      <!-- Live Preview -->
      <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0;">
        <div style="padding:10px 14px;border-bottom:1px solid var(--border);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);flex-shrink:0;">Live Preview</div>
        <iframe id="et-preview" style="flex:1;border:none;background:#fff;" sandbox="allow-same-origin"></iframe>
      </div>
    </div>
  </div>
</div>

<!-- Bad Words Modal -->
<div class="modal-overlay" id="bad-words-modal">
  <div class="modal" style="width:680px;max-width:95vw;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div>
        <div class="modal-title">Bad Word Detection</div>
        <div class="modal-sub">Alert on prohibited phrases in package transcripts</div>
      </div>
      <button class="sf-btn ghost" id="bad-words-cancel">Close</button>
    </div>

    <!-- Enable toggle -->
    <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--bg);border:1px solid var(--border);border-radius:8px;margin-bottom:16px;">
      <label style="font-size:11px;font-weight:600;color:var(--text-bright);flex:1;">Enable bad word detection for package audits</label>
      <input type="checkbox" id="bw-enabled" style="width:16px;height:16px;cursor:pointer;">
    </div>

    <!-- Tabs -->
    <div style="display:flex;gap:4px;margin-bottom:14px;border-bottom:1px solid var(--border);padding-bottom:0;">
      <button class="bw-tab active" data-tab="emails" style="padding:7px 14px;font-size:11px;font-weight:600;border:none;background:transparent;color:var(--blue);cursor:pointer;border-bottom:2px solid var(--blue);">Recipients</button>
      <button class="bw-tab" data-tab="words" style="padding:7px 14px;font-size:11px;font-weight:600;border:none;background:transparent;color:var(--text-muted);cursor:pointer;border-bottom:2px solid transparent;">Words</button>
      <button class="bw-tab" data-tab="offices" style="padding:7px 14px;font-size:11px;font-weight:600;border:none;background:transparent;color:var(--text-muted);cursor:pointer;border-bottom:2px solid transparent;">Offices</button>
    </div>

    <!-- Tab: Recipients -->
    <div id="bw-tab-emails" class="bw-tab-panel">
      <div class="modal-sub" style="margin-bottom:10px;">Email addresses that receive alerts when bad words are detected.</div>
      <div style="display:flex;gap:6px;margin-bottom:10px;">
        <input id="bw-email-input" class="sf-input" type="email" placeholder="email@example.com" style="flex:1;">
        <button class="sf-btn primary" id="bw-email-add">Add</button>
      </div>
      <div id="bw-email-list" style="display:flex;flex-direction:column;gap:4px;max-height:220px;overflow-y:auto;"></div>
    </div>

    <!-- Tab: Words -->
    <div id="bw-tab-words" class="bw-tab-panel" style="display:none;">
      <div class="modal-sub" style="margin-bottom:10px;">Phrases to search for in transcripts. Case-insensitive. Expand a word to add exclusion rules (e.g. ignore "free" if "toll" precedes it).</div>
      <div style="display:flex;gap:6px;margin-bottom:10px;">
        <input id="bw-word-input" class="sf-input" type="text" placeholder="e.g. resort fees included" style="flex:1;">
        <button class="sf-btn primary" id="bw-word-add">Add</button>
      </div>
      <div id="bw-word-list" style="display:flex;flex-direction:column;gap:4px;max-height:340px;overflow-y:auto;"></div>
    </div>

    <!-- Tab: Offices -->
    <div id="bw-tab-offices" class="bw-tab-panel" style="display:none;">
      <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;margin-bottom:12px;">
        <label style="font-size:11px;font-weight:600;color:var(--text-bright);flex:1;">Check all offices (ignore patterns below)</label>
        <input type="checkbox" id="bw-all-offices" style="width:16px;height:16px;cursor:pointer;">
      </div>
      <div class="modal-sub" style="margin-bottom:10px;">Office name patterns (case-insensitive substring). E.g. <strong>JAY</strong> matches JAY312, JAY222, etc. Only used when "all offices" is off.</div>
      <div style="display:flex;gap:6px;margin-bottom:10px;">
        <input id="bw-office-input" class="sf-input" type="text" placeholder="e.g. JAY" style="flex:1;">
        <button class="sf-btn primary" id="bw-office-add">Add</button>
      </div>
      <div id="bw-office-list" style="display:flex;flex-direction:column;gap:4px;max-height:180px;overflow-y:auto;"></div>
    </div>

    <div class="sf-actions" style="margin-top:16px;justify-content:flex-end;">
      <button class="sf-btn ghost" id="bad-words-cancel2">Cancel</button>
      <button class="sf-btn primary" id="bw-save-btn">Save Changes</button>
    </div>
  </div>
</div>

<!-- Office Bypass Modal -->
<div class="modal-overlay" id="office-bypass-modal">
  <div class="modal" style="width:620px;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
      <div class="modal-title" style="margin-bottom:0;">Offices</div>
      <div style="display:flex;gap:4px;" id="ob-tabs">
        <button class="sf-btn ghost um-tab active" data-tab="offices" style="font-size:10px;padding:4px 10px;">Offices</button>
        <button class="sf-btn ghost um-tab" data-tab="bypass" style="font-size:10px;padding:4px 10px;">Bypass</button>
      </div>
    </div>
    <div class="modal-sub">Manage known offices and configure which ones skip review and audit emails</div>

    <!-- Offices Tab -->
    <div id="ob-offices-tab">
      <div style="display:flex;gap:6px;margin-bottom:12px;">
        <input id="ob-dept-input" class="sf-input" type="text" placeholder="Add office name (e.g. JAY777)" style="flex:1;font-size:12px;">
        <button class="sf-btn primary" id="ob-dept-add-btn" style="font-size:11px;padding:8px 14px;">Add</button>
      </div>
      <div id="ob-dept-list" style="display:flex;flex-wrap:wrap;gap:6px;min-height:40px;max-height:260px;overflow-y:auto;padding:4px 0;"></div>
    </div>

    <!-- Bypass Tab -->
    <div id="ob-bypass-tab" style="display:none;">
      <div class="modal-sub" style="margin-bottom:10px;">Offices matching these patterns skip the review queue and audit emails. Case-insensitive substring match.</div>
      <div style="display:flex;gap:6px;margin-bottom:12px;">
        <input id="ob-input" class="sf-input" type="text" placeholder="e.g. JAY" style="flex:1;font-size:12px;">
        <button class="sf-btn primary" id="ob-add-btn" style="font-size:11px;padding:8px 14px;">Add</button>
      </div>
      <div id="ob-list" style="display:flex;flex-direction:column;gap:6px;min-height:40px;max-height:260px;overflow-y:auto;"></div>
      <div class="modal-actions" style="margin-top:16px;padding-top:12px;">
        <button class="sf-btn ghost" id="office-bypass-cancel2">Cancel</button>
        <button class="sf-btn primary" id="ob-save-btn">Save Bypass</button>
      </div>
    </div>

    <div class="modal-actions" style="margin-top:12px;" id="ob-offices-actions">
      <button class="sf-btn secondary" id="office-bypass-cancel">Close</button>
    </div>
  </div>
</div>

<!-- Users Modal -->
<div class="modal-overlay" id="users-modal">
  <div class="modal" style="width:min(900px,96vw);max-height:92vh;display:flex;flex-direction:column;overflow:hidden;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;flex-shrink:0;">
      <div class="modal-title" style="margin-bottom:0;">Team</div>
      <div style="display:flex;gap:4px;" id="um-tabs">
        <button class="sf-btn ghost um-tab active" data-tab="list" style="font-size:10px;padding:4px 10px;">Members</button>
        <button class="sf-btn ghost um-tab" data-tab="add" style="font-size:10px;padding:4px 10px;">+ Add</button>
        <button class="sf-btn ghost um-tab" data-tab="scopes" style="font-size:10px;padding:4px 10px;">Manager Scopes</button>
      </div>
    </div>
    <div class="modal-sub" style="flex-shrink:0;">Manage your organization's users, roles, and manager access scopes</div>

    <!-- Members List Tab -->
    <div id="um-list-tab" style="overflow-y:auto;flex:1;min-height:0;">
      <div id="um-user-list" style="max-height:400px;overflow-y:auto;margin-bottom:12px;">
        <div style="text-align:center;padding:24px;color:var(--text-dim);font-size:11px;">Loading...</div>
      </div>
    </div>

    <!-- Add User Tab -->
    <div id="um-add-tab" style="display:none;overflow-y:auto;flex:1;min-height:0;">
      <!-- Role Selection -->
      <div class="modal-group">
        <div class="modal-group-title">1. Choose Role</div>
        <div id="a-role-group" style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
          <button class="um-role active" data-role="admin">
            <span class="um-role-icon" style="background:var(--blue-bg);color:var(--blue);">${icons.shield}</span>
            <span class="um-role-info">
              <span class="um-role-name">Admin</span>
              <span class="um-role-desc">Full access. Manages judges & managers.</span>
            </span>
          </button>
          <button class="um-role" data-role="judge">
            <span class="um-role-icon" style="background:var(--purple-bg);color:var(--purple);">${icons.scale}</span>
            <span class="um-role-info">
              <span class="um-role-name">Judge</span>
              <span class="um-role-desc">Reviews appeals. Owns reviewers.</span>
            </span>
          </button>
          <button class="um-role" data-role="manager">
            <span class="um-role-icon" style="background:var(--yellow-bg);color:var(--yellow);">${icons.clipboardList}</span>
            <span class="um-role-info">
              <span class="um-role-name">Manager</span>
              <span class="um-role-desc">Remediates failures. Scoped by dept+shift.</span>
            </span>
          </button>
          <button class="um-role" data-role="reviewer">
            <span class="um-role-icon" style="background:var(--green-bg);color:var(--green);">${icons.pencil}</span>
            <span class="um-role-info">
              <span class="um-role-name">Reviewer</span>
              <span class="um-role-desc">Verifies audit findings.</span>
            </span>
          </button>
          <button class="um-role" data-role="user">
            <span class="um-role-icon" style="background:var(--cyan-bg);color:var(--cyan);">${icons.headset}</span>
            <span class="um-role-info">
              <span class="um-role-name">Agent</span>
              <span class="um-role-desc">Call center agent.</span>
            </span>
          </button>
        </div>
      </div>

      <!-- Supervisor -->
      <div class="modal-group" id="supervisor-group" style="display:none;">
        <div class="modal-group-title">2. Assign To <span id="supervisor-label" style="color:var(--blue);"></span></div>
        <select class="sf-input" id="a-supervisor" style="width:100%;">
          <option value="">-- Select --</option>
        </select>
      </div>

      <!-- Credentials -->
      <div class="modal-group">
        <div class="modal-group-title" id="um-cred-step">2. Credentials</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div class="sf">
            <label class="sf-label">Email</label>
            <input type="text" class="sf-input" id="a-username" placeholder="jsmith@example.com" autocomplete="off">
          </div>
          <div class="sf">
            <label class="sf-label">Password</label>
            <input type="password" class="sf-input" id="a-password" placeholder="&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;">
          </div>
        </div>
      </div>

      <button class="sf-btn primary" id="a-adduser" style="width:100%;padding:10px;font-size:12px;border-radius:8px;">Create&nbsp;<span id="um-btn-role">Admin</span></button>
    </div>

    <!-- Manager Scopes Tab -->
    <div id="um-scopes-tab" style="display:none;flex:1;min-height:0;overflow:hidden;">
      <div style="display:flex;gap:16px;height:440px;">
        <!-- Manager list (left) -->
        <div style="width:220px;flex-shrink:0;border:1px solid var(--border);border-radius:8px;overflow-y:auto;">
          <div style="padding:8px 12px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--bg-raised);z-index:1;">Managers</div>
          <div id="um-scope-manager-list">
            <div style="padding:20px 12px;text-align:center;color:var(--text-dim);font-size:11px;">Loading...</div>
          </div>
        </div>
        <!-- Scope editor (right) -->
        <div style="flex:1;min-width:0;">
          <div id="um-scope-editor-empty" style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--text-dim);font-size:12px;">Select a manager to configure their scope</div>
          <div id="um-scope-editor" style="display:none;height:100%;flex-direction:column;gap:16px;">
            <div style="font-size:13px;font-weight:700;color:var(--text-bright);" id="um-scope-email-label">—</div>
            <div style="font-size:11px;color:var(--text-dim);margin-top:-8px;">Leave a section empty to allow all values in that dimension.</div>

            <div>
              <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:8px;">Departments</div>
              <div id="um-scope-dept-tags" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;min-height:24px;"></div>
              <div style="display:flex;gap:6px;">
                <select class="sf-input" id="um-scope-dept-select" style="flex:1;font-size:12px;padding:7px 10px;">
                  <option value="">-- add department --</option>
                </select>
                <input type="text" class="sf-input" id="um-scope-dept-custom" placeholder="or type custom…" style="flex:1;font-size:12px;padding:7px 10px;">
                <button class="sf-btn secondary" id="um-scope-dept-add" style="font-size:11px;padding:7px 12px;flex-shrink:0;">Add</button>
              </div>
            </div>

            <div>
              <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:8px;">Shifts</div>
              <div id="um-scope-shift-tags" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;min-height:24px;"></div>
              <div style="display:flex;gap:6px;">
                <select class="sf-input" id="um-scope-shift-select" style="flex:1;font-size:12px;padding:7px 10px;">
                  <option value="">-- add shift --</option>
                </select>
                <input type="text" class="sf-input" id="um-scope-shift-custom" placeholder="or type custom…" style="flex:1;font-size:12px;padding:7px 10px;">
                <button class="sf-btn secondary" id="um-scope-shift-add" style="font-size:11px;padding:7px 12px;flex-shrink:0;">Add</button>
              </div>
            </div>

            <div style="margin-top:auto;padding-top:12px;border-top:1px solid var(--border);display:flex;gap:8px;">
              <button class="sf-btn primary" id="um-scope-save-btn" style="font-size:12px;padding:9px 20px;">Save Scope</button>
              <span id="um-scope-saved" style="display:none;font-size:11px;color:var(--green);align-self:center;">Saved!</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="modal-actions" style="margin-top:12px;flex-shrink:0;">
      <button class="sf-btn secondary" id="users-cancel">Close</button>
    </div>
  </div>
</div>

<!-- Impersonate User Modal -->
<div class="modal-overlay" id="impersonate-modal">
  <div class="modal" style="width:480px;">
    <div class="modal-title">Impersonate User</div>
    <div class="modal-sub">Navigate to that user's portal as if you are them. All API calls will use their identity.</div>
    <div style="margin-bottom:16px;">
      <label class="sf-label" style="margin-bottom:6px;display:block;">Select User</label>
      <select class="sf-input" id="imp-user-select" style="width:100%;font-size:13px;">
        <option value="">-- choose a user --</option>
      </select>
    </div>
    <div id="imp-user-info" style="display:none;padding:10px 12px;border-radius:8px;background:var(--bg);border:1px solid var(--border);margin-bottom:16px;font-size:12px;color:var(--text-dim);">
      <span id="imp-user-role-badge" style="font-weight:700;"></span>
      <span id="imp-user-dest" style="margin-left:8px;"></span>
    </div>
    <div class="modal-actions" style="margin-top:0;">
      <button class="sf-btn secondary" id="imp-cancel">Cancel</button>
      <button class="sf-btn primary" id="imp-go-btn" disabled>Go →</button>
    </div>
  </div>
</div>

<!-- Pipeline Modal -->
<div class="modal-overlay" id="pipeline-modal">
  <div class="modal pipeline-modal">
    <div class="pm-header">
      <div class="pm-icon">${icons.settings20}</div>
      <div>
        <div class="modal-title">Pipeline Settings</div>
        <div class="modal-sub">Control concurrency and failure recovery</div>
      </div>
    </div>

    <div class="pm-section">
      <div class="pm-section-label">Concurrency</div>
      <div class="pm-field">
        <div class="pm-field-info">
          <div class="pm-field-name">Parallelism</div>
          <div class="pm-field-desc">Max concurrent audit operations</div>
        </div>
        <div class="pm-stepper">
          <button class="pm-step-btn" data-target="a-parallelism" data-dir="-1" type="button">&minus;</button>
          <input type="number" class="pm-step-value" id="a-parallelism" min="1" max="100" placeholder="--">
          <button class="pm-step-btn" data-target="a-parallelism" data-dir="1" type="button">+</button>
          <span class="pm-unit" style="visibility:hidden;">sec</span>
        </div>
      </div>
    </div>

    <div class="pm-divider"></div>

    <div class="pm-section">
      <div class="pm-section-label" style="display:flex;align-items:center;justify-content:space-between;">
        <span>Queue Status (Live from QStash)</span>
        <button class="sf-btn ghost" id="pm-check-queues" style="font-size:10px;padding:3px 10px;height:auto;">Check</button>
      </div>
      <div id="pm-queue-status" style="font-size:11px;color:var(--text-dim);padding:4px 0;">Click "Check" to verify QStash queue parallelism</div>
    </div>

    <div class="pm-divider"></div>

    <div class="pm-section">
      <div class="pm-section-label">Retry Policy</div>
      <div class="pm-field">
        <div class="pm-field-info">
          <div class="pm-field-name">Max Retries</div>
          <div class="pm-field-desc">Attempts before marking failed</div>
        </div>
        <div class="pm-stepper">
          <button class="pm-step-btn" data-target="a-retries" data-dir="-1" type="button">&minus;</button>
          <input type="number" class="pm-step-value" id="a-retries" min="0" max="50" placeholder="--">
          <button class="pm-step-btn" data-target="a-retries" data-dir="1" type="button">+</button>
          <span class="pm-unit" style="visibility:hidden;">sec</span>
        </div>
      </div>
      <div class="pm-field">
        <div class="pm-field-info">
          <div class="pm-field-name">Delay</div>
          <div class="pm-field-desc">Seconds between retry attempts</div>
        </div>
        <div class="pm-stepper">
          <button class="pm-step-btn" data-target="a-retry-delay" data-dir="-1" type="button">&minus;</button>
          <input type="number" class="pm-step-value" id="a-retry-delay" min="0" max="300" placeholder="--">
          <button class="pm-step-btn" data-target="a-retry-delay" data-dir="1" type="button">+</button>
          <span class="pm-unit">sec</span>
        </div>
      </div>
    </div>

    <div class="modal-actions">
      <button class="sf-btn secondary" id="pipeline-cancel">Cancel</button>
      <button class="sf-btn primary" id="a-pipeline-save">Save</button>
    </div>
  </div>
</div>

<!-- Dev Tools Modal -->

<div class="modal-overlay" id="devtools-modal">
  <div class="modal">
    <div class="modal-title">Dev Tools</div>
    <div class="modal-sub">Local development utilities</div>
    <div class="dt-action seed">
      <div class="dt-icon">${icons.database}</div>
      <div class="dt-info">
        <div class="dt-name">Seed Test Data</div>
        <div class="dt-desc">Populate KV with sample findings for testing</div>
      </div>
      <button class="sf-btn primary" id="a-seed-btn">Seed</button>
    </div>
    <div class="dt-action wipe">
      <div class="dt-icon">${icons.alertTriangle}</div>
      <div class="dt-info">
        <div class="dt-name">Wipe All KV Data</div>
        <div class="dt-desc">Permanently delete every entry -- cannot be undone</div>
      </div>
      <button class="sf-btn danger" id="a-wipe-btn">Wipe</button>
    </div>
    <div class="modal-actions">
      <button class="sf-btn secondary" id="devtools-cancel">Close</button>
    </div>
  </div>
</div>

<!-- Terminate Running Confirmation Modal -->
<div class="modal-overlay" id="terminate-modal">
  <div class="modal" style="width:420px;">
    <div class="modal-title" style="color:var(--red);">Terminate Running Audits</div>
    <div class="modal-sub">This will mark all currently active audits as terminated. In-progress steps will bail on their next check-in.</div>
    <div style="background:var(--red-bg);border:1px solid rgba(248,81,73,0.2);border-radius:8px;padding:12px 14px;font-size:11px;color:var(--text-muted);margin-bottom:4px;">
      <div style="font-weight:600;">The waiting queue is NOT affected — use "Clear Queue" for that.</div>
      <div style="margin-top:6px;">This cannot be undone.</div>
    </div>
    <div class="modal-actions">
      <button class="sf-btn ghost" id="terminate-cancel">Cancel</button>
      <button class="sf-btn danger" id="terminate-confirm" style="padding:10px 24px;font-size:13px;border-radius:8px;background:var(--red);color:#fff;border:none;">Terminate Running</button>
    </div>
  </div>
</div>

<!-- Clear Queue Confirmation Modal -->
<div class="modal-overlay" id="clear-queue-modal">
  <div class="modal" style="width:420px;">
    <div class="modal-title" style="color:var(--red);">Clear Queue</div>
    <div class="modal-sub">This will delete all pending QStash pipeline messages. Currently running audits are not affected.</div>
    <div style="background:var(--red-bg);border:1px solid rgba(248,81,73,0.2);border-radius:8px;padding:12px 14px;font-size:11px;color:var(--text-muted);margin-bottom:4px;">
      <div style="font-weight:600;">This cannot be undone.</div>
    </div>
    <div class="modal-actions">
      <button class="sf-btn ghost" id="clear-queue-cancel">Cancel</button>
      <button class="sf-btn danger" id="clear-queue-confirm" style="padding:10px 24px;font-size:13px;border-radius:8px;background:var(--red);color:#fff;border:none;">Clear Queue</button>
    </div>
  </div>
</div>

<!-- Clear Errors Confirmation Modal -->
<div class="modal-overlay" id="clear-errors-modal">
  <div class="modal" style="width:420px;">
    <div class="modal-title" style="color:var(--red);">Clear Errors</div>
    <div class="modal-sub">This will delete all error records from the past 24 hours. No audits will be affected.</div>
    <div style="background:var(--red-bg);border:1px solid rgba(248,81,73,0.2);border-radius:8px;padding:12px 14px;font-size:11px;color:var(--text-muted);margin-bottom:4px;">
      <div style="font-weight:600;">This cannot be undone.</div>
    </div>
    <div class="modal-actions">
      <button class="sf-btn ghost" id="clear-errors-cancel">Cancel</button>
      <button class="sf-btn danger" id="clear-errors-confirm" style="padding:10px 24px;font-size:13px;border-radius:8px;background:var(--red);color:#fff;border:none;">Clear Errors</button>
    </div>
  </div>
</div>

<!-- Bulk Audit Modal -->
<div class="modal-overlay" id="bulk-modal">
  <div class="modal" style="width:560px;">
    <div class="modal-title">Bulk Audit</div>
    <div class="modal-sub">Paste Record IDs (one per line or comma-separated). Audits fire sequentially with a stagger delay.</div>
    <div class="sf">
      <label class="sf-label">Record IDs</label>
      <textarea class="sf-input" id="bulk-rids" rows="8" style="font-family:var(--mono);font-size:11px;resize:vertical;" placeholder="12345678&#10;87654321&#10;..."></textarea>
    </div>
    <div style="display:flex;gap:12px;align-items:flex-end;margin-top:4px;">
      <div class="sf" style="flex:1;margin-bottom:0;">
        <label class="sf-label">Audit Type</label>
        <select class="sf-input" id="bulk-type" style="font-size:12px;padding:6px 8px;">
          <option value="dateleg">Internal</option>
          <option value="package">Partner</option>
        </select>
      </div>
      <div class="sf" style="width:160px;margin-bottom:0;">
        <label class="sf-label">Stagger (ms) <span style="color:var(--text-dim);font-weight:400;">5000 rec.</span></label>
        <input type="number" class="sf-input" id="bulk-stagger" value="5000" min="0" max="30000" style="font-size:12px;">
      </div>
    </div>
    <div id="bulk-progress" style="display:none;margin-top:12px;padding:10px 14px;background:var(--bg);border:1px solid var(--border);border-radius:8px;font-size:11px;color:var(--text-muted);font-family:var(--mono);line-height:1.6;"></div>
    <div class="modal-actions">
      <button class="sf-btn ghost" id="bulk-cancel">Cancel</button>
      <button class="sf-btn primary" id="bulk-start">Start Bulk Audit</button>
    </div>
  </div>
</div>

<!-- Clear Review Queue Confirmation Modal -->
<div class="modal-overlay" id="clear-review-modal">
  <div class="modal" style="width:420px;">
    <div class="modal-title" style="color:var(--red);">Clear Review Queue</div>
    <div class="modal-sub">This will delete all <strong>pending</strong> review items and their locks. Decided items are kept. This cannot be undone.</div>
    <div style="background:var(--red-bg);border:1px solid rgba(248,81,73,0.2);border-radius:8px;padding:12px 14px;font-size:11px;color:var(--text-muted);margin-bottom:4px;">
      Are you sure you want to clear the review queue?
    </div>
    <div class="modal-actions">
      <button class="sf-btn ghost" id="clear-review-cancel">Cancel</button>
      <button class="sf-btn danger" id="clear-review-confirm" style="padding:10px 24px;font-size:13px;border-radius:8px;background:var(--red);color:#fff;border:none;">Yes, Clear Queue</button>
    </div>
  </div>
</div>

<div class="t-wrap" id="toasts"></div>

<script>
(function() {
  var countdown = 30, lastData = null;

  function fmt(n) { return n == null ? '--' : Number(n).toLocaleString(); }
  function timeAgo(ts) {
    if (!ts) return '--';
    var s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    return Math.floor(s / 3600) + 'h ago';
  }
  function dur(ts) {
    if (!ts) return '--';
    var s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return s + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
    return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
  }
  function toast(msg, type) {
    var el = document.createElement('div');
    el.className = 't-toast ' + (type || 'info');
    el.innerHTML = '<span class="t-dot"></span>' + msg;
    document.getElementById('toasts').appendChild(el);
    setTimeout(function() { el.remove(); }, 2400);
  }
  function btnLoad(b, t) { b.disabled = true; b.textContent = t || 'Saving...'; }
  function btnDone(b, t) { b.disabled = false; b.textContent = t; }
  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  // ===== Charts =====
  function bucketByHour(timestamps) {
    var now = Date.now(), buckets = new Array(24).fill(0);
    for (var i = 0; i < timestamps.length; i++) {
      var hoursAgo = Math.floor((now - timestamps[i]) / 3600000);
      if (hoursAgo >= 0 && hoursAgo < 24) buckets[23 - hoursAgo]++;
    }
    return buckets;
  }

  // Catmull-Rom spline interpolation for smooth curves
  function splinePath(ctx, points) {
    if (points.length < 2) return;
    ctx.moveTo(points[0][0], points[0][1]);
    if (points.length === 2) { ctx.lineTo(points[1][0], points[1][1]); return; }
    for (var i = 0; i < points.length - 1; i++) {
      var p0 = points[i === 0 ? 0 : i - 1];
      var p1 = points[i];
      var p2 = points[i + 1];
      var p3 = points[i + 2 < points.length ? i + 2 : i + 1];
      var cp1x = p1[0] + (p2[0] - p0[0]) / 6;
      var cp1y = p1[1] + (p2[1] - p0[1]) / 6;
      var cp2x = p2[0] - (p3[0] - p1[0]) / 6;
      var cp2y = p2[1] - (p3[1] - p1[1]) / 6;
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2[0], p2[1]);
    }
  }

  function drawActivityChart(completedTs, errorsTs, retriesTs) {
    var canvas = document.getElementById('chart-activity');
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = 140 * dpr;
    var ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    var W = rect.width, H = 140;

    var cB = bucketByHour(completedTs || []);
    var eB = bucketByHour(errorsTs || []);
    var rB = bucketByHour(retriesTs || []);

    var maxVal = 1;
    for (var i = 0; i < 24; i++) {
      if (cB[i] > maxVal) maxVal = cB[i];
      if (eB[i] > maxVal) maxVal = eB[i];
      if (rB[i] > maxVal) maxVal = rB[i];
    }
    maxVal = Math.ceil(maxVal * 1.15); // add 15% headroom

    var pad = { top: 20, bottom: 22, left: 32, right: 12 };
    var cW = W - pad.left - pad.right;
    var cH = H - pad.top - pad.bottom;

    // Y-axis gridlines + labels
    var gridLines = 4;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (var g = 0; g <= gridLines; g++) {
      var gy = pad.top + cH - (g / gridLines) * cH;
      ctx.strokeStyle = 'rgba(28,35,51,0.5)';
      ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(W - pad.right, gy); ctx.stroke();
      ctx.fillStyle = '#6e7681';
      ctx.font = '11px -apple-system, sans-serif';
      ctx.fillText(String(Math.round(maxVal * g / gridLines)), pad.left - 6, gy);
    }

    // X-axis labels
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillStyle = '#6e7681'; ctx.font = '11px -apple-system, sans-serif';
    var labels = ['24h','','','20h','','','16h','','','12h','','','8h','','','4h','','','','','','','','now'];
    for (var i = 0; i < 24; i++) {
      if (labels[i]) {
        var lx = pad.left + (i / 23) * cW;
        ctx.fillText(labels[i], lx, H - 12);
      }
    }

    // Build point arrays
    function toPoints(buckets) {
      var pts = [];
      for (var i = 0; i < 24; i++) {
        pts.push([pad.left + (i / 23) * cW, pad.top + cH - (buckets[i] / maxVal) * cH]);
      }
      return pts;
    }

    // Draw area + line for each series
    var series = [
      { buckets: cB, stroke: 'rgba(63,185,80,0.9)', fill: 'rgba(63,185,80,0.12)', label: 'Completed', dotColor: '#3fb950' },
      { buckets: eB, stroke: 'rgba(248,81,73,0.9)', fill: 'rgba(248,81,73,0.08)', label: 'Errors', dotColor: '#f85149' },
      { buckets: rB, stroke: 'rgba(210,153,34,0.8)', fill: 'rgba(210,153,34,0.06)', label: 'Retries', dotColor: '#d29922' },
    ];

    for (var s = 0; s < series.length; s++) {
      var pts = toPoints(series[s].buckets);
      var hasData = series[s].buckets.some(function(v){ return v > 0; });
      if (!hasData) continue;

      // Gradient fill
      var grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + cH);
      grad.addColorStop(0, series[s].fill);
      grad.addColorStop(1, 'rgba(0,0,0,0)');

      // Area
      ctx.beginPath();
      splinePath(ctx, pts);
      ctx.lineTo(pts[pts.length-1][0], pad.top + cH);
      ctx.lineTo(pts[0][0], pad.top + cH);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Line
      ctx.beginPath();
      splinePath(ctx, pts);
      ctx.strokeStyle = series[s].stroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Dots at non-zero points
      for (var d = 0; d < pts.length; d++) {
        if (series[s].buckets[d] > 0) {
          ctx.beginPath();
          ctx.arc(pts[d][0], pts[d][1], 2.5, 0, Math.PI * 2);
          ctx.fillStyle = series[s].dotColor;
          ctx.fill();
        }
      }
    }

    // Legend (top-right)
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    var lx = W - pad.right;
    for (var j = series.length - 1; j >= 0; j--) {
      ctx.font = '11px -apple-system, sans-serif';
      var tw = ctx.measureText(series[j].label).width;
      ctx.fillStyle = '#8b949e';
      ctx.fillText(series[j].label, lx, 10);
      lx -= tw + 4;
      ctx.fillStyle = series[j].dotColor;
      ctx.beginPath(); ctx.arc(lx, 10, 3, 0, Math.PI * 2); ctx.fill();
      lx -= 14;
    }
  }

  function drawDonut(pending, decided) {
    var canvas = document.getElementById('chart-donut');
    var dpr = window.devicePixelRatio || 1;
    canvas.width = 100 * dpr; canvas.height = 100 * dpr;
    var ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    var cx = 50, cy = 50, R = 40, r = 26;
    var total = (pending || 0) + (decided || 0);

    if (total === 0) {
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.arc(cx, cy, r, 0, Math.PI * 2, true);
      ctx.fillStyle = 'rgba(28,35,51,0.5)'; ctx.fill();
      ctx.fillStyle = '#484f58'; ctx.font = '600 11px -apple-system, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('--', cx, cy);
    } else {
      var pAngle = (pending / total) * Math.PI * 2;
      var start = -Math.PI / 2;

      // Decided (green)
      ctx.beginPath(); ctx.arc(cx, cy, R, start + pAngle, start + Math.PI * 2);
      ctx.arc(cx, cy, r, start + Math.PI * 2, start + pAngle, true);
      ctx.closePath(); ctx.fillStyle = 'rgba(63,185,80,0.7)'; ctx.fill();

      // Pending (yellow)
      ctx.beginPath(); ctx.arc(cx, cy, R, start, start + pAngle);
      ctx.arc(cx, cy, r, start + pAngle, start, true);
      ctx.closePath(); ctx.fillStyle = 'rgba(210,153,34,0.7)'; ctx.fill();

      // Center text
      var pct = Math.round((decided / total) * 100);
      ctx.fillStyle = 'var(--text-bright)'; ctx.font = '700 14px -apple-system, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(pct + '%', cx, cy);
    }

    // Legend
    var legend = document.getElementById('donut-legend');
    legend.innerHTML = '<div class="donut-item"><span class="donut-dot" style="background:var(--yellow)"></span>Pending<span class="donut-val">' + fmt(pending) + '</span></div>'
      + '<div class="donut-item"><span class="donut-dot" style="background:var(--green)"></span>Decided<span class="donut-val">' + fmt(decided) + '</span></div>'
      + '<div class="donut-item" style="color:var(--text-dim);font-size:11px">Total<span class="donut-val" style="color:var(--text-muted)">' + fmt(total) + '</span></div>';
  }

  // ===== Render (per-section) =====
  function renderPipeline(p) {
    if (!lastData) lastData = {};
    lastData.pipeline = p;
    document.getElementById('s-pipe').textContent = fmt(p.inPipe);
    document.getElementById('s-active').textContent = fmt(p.activeCount);
    document.getElementById('s-completed').textContent = fmt(p.completed24h);
    document.getElementById('s-errors').textContent = fmt(p.errors24h);
    document.getElementById('s-retries').textContent = fmt(p.retries24h);
    renderActive(p.active || []);
    renderErrors(p.errors || []);
    drawActivityChart(p.completedTs, p.errorsTs, p.retriesTs);
  }

  function renderReview(r) {
    if (!lastData) lastData = {};
    lastData.review = r;
    document.getElementById('r-dl-pending').textContent = fmt(r.dateLegPending ?? r.pending);
    document.getElementById('r-dl-decided').textContent = fmt(r.dateLegDecided ?? r.decided);
    document.getElementById('r-pkg-pending').textContent = fmt(r.packagePending ?? 0);
    document.getElementById('r-pkg-decided').textContent = fmt(r.packageDecided ?? 0);
    var totalPending = (r.dateLegPending ?? r.pending ?? 0) + (r.packagePending ?? 0);
    var totalDecided = (r.dateLegDecided ?? r.decided ?? 0) + (r.packageDecided ?? 0);
    drawDonut(totalPending, totalDecided);
  }

  function renderTokens(t) {
    document.getElementById('t-total').innerHTML = fmt(t.total_tokens) + ' <small>tokens (' + fmt(t.calls) + ' calls)</small>';
    var fnList = document.getElementById('t-functions');
    fnList.innerHTML = '';
    var byFn = t.by_function || {};
    var fns = Object.keys(byFn).sort(function(a,b) { return byFn[b].total_tokens - byFn[a].total_tokens; });
    for (var i = 0; i < fns.length; i++) {
      var fn = fns[i], v = byFn[fn], row = document.createElement('div');
      row.className = 'fn-row';
      row.innerHTML = '<span class="fn-name">' + fn + '</span><span><span class="fn-tokens">' + fmt(v.total_tokens) + '</span><span class="fn-calls">' + v.calls + ' calls</span></span>';
      fnList.appendChild(row);
    }
    if (!fns.length) fnList.innerHTML = '<div style="color:var(--text-dim);font-style:italic;font-size:10px;padding:4px">No usage this hour</div>';
  }

  // Legacy render kept for 30s refresh compatibility
  function render(data) {
    lastData = data;
    if (data.pipeline) renderPipeline(data.pipeline);
    if (data.review) renderReview(data.review);
    if (data.tokens) renderTokens(data.tokens);
    if (data.recentCompleted) renderRecent(data.recentCompleted);
  }

  function fmtDur(ms) {
    if (!ms || ms < 0) return '--';
    var s = Math.round(ms / 1000);
    if (s < 60) return s + 's';
    var m = Math.floor(s / 60), rem = s % 60;
    return m + 'm ' + (rem > 0 ? rem + 's' : '');
  }

  function renderRecent(items) {
    var tb = document.getElementById('tb-recent');
    if (!items.length) { tb.innerHTML = '<tr class="empty-row"><td colspan="8">No completed audits</td></tr>'; return; }
    var logsOrgProject = null;
    var hm = window.location.hostname.match(/^([^.]+)\.([^.]+)\.deno\.net$/);
    if (hm) logsOrgProject = 'https://console.deno.com/' + hm[2] + '/' + hm[1] + '/observability/logs?query=';
    var logsSuffix = '&start=now%2Fy&end=now';
    var qbDateUrl = 'https://monsterrg.quickbase.com/nav/app/bmhvhc7sk/table/bpb28qsnn/action/dr?rid=';
    var qbPkgUrl  = 'https://monsterrg.quickbase.com/nav/app/bmhvhc7sk/table/bttffb64u/action/dr?rid=';
    tb.innerHTML = '';
    for (var i = 0; i < items.length; i++) {
      var c = items[i], tr = document.createElement('tr');
      var fid = c.findingId || '--';
      var logsHtml = logsOrgProject
        ? '<a href="' + logsOrgProject + encodeURIComponent(fid) + logsSuffix + '" target="_blank" class="tbl-link" style="font-size:10px;">logs</a>'
        : '--';
      var ridHtml = '--';
      if (c.recordId) {
        var qbUrl = (c.isPackage ? qbPkgUrl : qbDateUrl) + encodeURIComponent(c.recordId);
        ridHtml = '<a href="' + qbUrl + '" target="_blank" class="tbl-link">' + c.recordId + '</a>';
      }
      var startedHtml = c.startedAt ? '<span class="time-ago" title="' + new Date(c.startedAt).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) + ' ET">' + timeAgo(c.startedAt) + '</span>' : '--';
      var finishedHtml = '<span class="time-ago" title="' + new Date(c.ts).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) + ' ET">' + timeAgo(c.ts) + '</span>';
      var durHtml = c.durationMs ? '<span style="font-variant-numeric:tabular-nums">' + fmtDur(c.durationMs) + '</span>' : '--';
      var scoreHtml = c.score != null ? '<span style="font-variant-numeric:tabular-nums;font-weight:600;color:' + (c.score === 100 ? 'var(--green)' : c.score >= 80 ? 'var(--cyan)' : 'var(--red)') + '">' + c.score + '%</span>' : '--';
      var reviewedBadge = c.reviewed ? '<span style="display:inline-block;padding:1px 7px;border-radius:10px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;background:rgba(63,185,80,0.12);color:#3fb950;border:1px solid rgba(63,185,80,0.3);">Reviewed</span>' : '';
      tr.innerHTML = '<td class="mono"><a href="/audit/report?id=' + encodeURIComponent(fid) + '" target="_blank" class="tbl-link">' + fid + '</a></td><td>' + logsHtml + '</td><td>' + ridHtml + '</td><td>' + scoreHtml + '</td><td>' + startedHtml + '</td><td>' + finishedHtml + '</td><td>' + durHtml + '</td><td>' + reviewedBadge + '</td>';
      tb.appendChild(tr);
    }
  }

  function renderActive(active) {
    var tb = document.getElementById('tb-active');
    if (!active.length) { tb.innerHTML = '<tr class="empty-row"><td colspan="6">No active audits</td></tr>'; return; }
    tb.innerHTML = '';
    // Derive Deno Deploy observability logs URL from hostname: {project}.{org}.deno.net
    var logsOrgProject = null;
    var hm = window.location.hostname.match(/^([^.]+)\.([^.]+)\.deno\.net$/);
    if (hm) logsOrgProject = 'https://console.deno.com/' + hm[2] + '/' + hm[1] + '/observability/logs?query=';
    var logsSuffix = '&start=now%2Fy&end=now';
    var qbDateUrl = 'https://monsterrg.quickbase.com/nav/app/bmhvhc7sk/table/bpb28qsnn/action/dr?rid=';
    var qbPkgUrl  = 'https://monsterrg.quickbase.com/nav/app/bmhvhc7sk/table/bttffb64u/action/dr?rid=';
    for (var i = 0; i < active.length; i++) {
      var a = active[i], tr = document.createElement('tr');
      var fid = a.findingId || '--';
      var fidHtml = logsOrgProject
        ? '<a href="' + logsOrgProject + encodeURIComponent(fid) + logsSuffix + '" target="_blank" class="tbl-link" style="font-size:10px;font-family:var(--mono)">' + fid + '</a>'
        : '<span class="mono">' + fid + '</span>';
      var ridHtml = '--';
      if (a.recordId) {
        var qbUrl = (a.isPackage ? qbPkgUrl : qbDateUrl) + encodeURIComponent(a.recordId);
        ridHtml = '<a href="' + qbUrl + '" target="_blank" class="tbl-link">' + a.recordId + '</a>';
      }
      var startedCell = a.startedAt ? '<span title="' + new Date(a.startedAt).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) + ' ET">' + timeAgo(a.startedAt) + '</span>' : '--';
      var stepHtml;
      if (a.step === 'genie-retry' && a.genieRetryAt) {
        var secsLeft = Math.max(0, Math.round((a.genieRetryAt - Date.now()) / 1000));
        var minsLeft = Math.floor(secsLeft / 60), s2 = secsLeft % 60;
        var countdown = minsLeft + 'm ' + (s2 < 10 ? '0' : '') + s2 + 's';
        stepHtml = '<span class="step-badge" style="background:rgba(210,153,34,0.15);color:var(--yellow);" title="Attempt ' + (a.genieAttempts||1) + '/2 — retrying in ' + countdown + '">⏳ genie-retry (' + countdown + ')</span>';
      } else {
        stepHtml = '<span class="step-badge">' + (a.step||'--') + '</span>';
      }
      tr.innerHTML = '<td>' + fidHtml + '</td><td>' + ridHtml + '</td><td>' + stepHtml + '</td><td>' + startedCell + '</td><td class="duration">' + dur(a.ts) + '</td><td style="text-align:right;white-space:nowrap;"><button class="retry-btn sf-btn ghost" data-id="' + fid + '" data-idx="' + i + '" style="font-size:9px;padding:2px 8px;">Retry</button> <button class="terminate-btn sf-btn danger" data-id="' + fid + '" data-idx="' + i + '" style="font-size:9px;padding:2px 8px;">Stop</button></td>';
      tb.appendChild(tr);
    }
    tb.querySelectorAll('.retry-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var id = this.getAttribute('data-id');
        var idx = parseInt(this.getAttribute('data-idx'));
        var b = this;
        if (!id || id === '--') { toast('No finding ID — cannot retry', 'error'); return; }
        b.disabled = true; b.textContent = '...';
        fetch('/admin/retry-finding?id=' + encodeURIComponent(id))
          .then(function(r) { return r.json(); })
          .then(function(d) {
            if (d.ok) {
              toast('Re-queued ' + (d.step || 'step') + ' for ' + id, 'success');
              // Reset duration + step for this row so the timer restarts from now
              if (active[idx]) { active[idx].ts = Date.now(); active[idx].step = d.step || active[idx].step; }
              renderActive(active);
            } else { b.disabled = false; b.textContent = 'Retry'; toast(d.error || 'Failed', 'error'); }
          })
          .catch(function() { b.disabled = false; b.textContent = 'Retry'; toast('Request failed', 'error'); });
      });
    });
    tb.querySelectorAll('.terminate-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var id = this.getAttribute('data-id');
        var idx = parseInt(this.getAttribute('data-idx'));
        var b = this;
        if (!id || id === '--') { toast('No finding ID', 'error'); return; }
        b.disabled = true; b.textContent = '...';
        fetch('/admin/terminate-finding?id=' + encodeURIComponent(id), { method: 'POST' })
          .then(function(r) { return r.json(); })
          .then(function(d) {
            if (d.ok) {
              toast('Terminated ' + id, 'success');
              active.splice(idx, 1);
              renderActive(active);
            } else { b.disabled = false; b.textContent = 'Stop'; toast(d.error || 'Failed', 'error'); }
          })
          .catch(function() { b.disabled = false; b.textContent = 'Stop'; toast('Request failed', 'error'); });
      });
    });
  }

  function renderErrors(errors) {
    var tb = document.getElementById('tb-errors');
    if (!errors.length) { tb.innerHTML = '<tr class="empty-row"><td colspan="5">No errors</td></tr>'; return; }
    errors.sort(function(a,b) { return (b.ts||0)-(a.ts||0); });
    tb.innerHTML = '';
    var logsOrgProject = null;
    var hm = window.location.hostname.match(/^([^.]+)\.([^.]+)\.deno\.net$/);
    if (hm) logsOrgProject = 'https://console.deno.com/' + hm[2] + '/' + hm[1] + '/observability/logs?query=';
    var logsSuffix = '&start=now%2Fy&end=now';
    for (var i = 0; i < Math.min(errors.length, 20); i++) {
      var e = errors[i], tr = document.createElement('tr');
      var fid = e.findingId || '--';
      var logsHtml = logsOrgProject
        ? '<a href="' + logsOrgProject + encodeURIComponent(fid) + logsSuffix + '" target="_blank" class="tbl-link" style="font-size:10px;">logs</a>'
        : '--';
      tr.innerHTML = '<td class="mono">' + fid + '</td><td>' + logsHtml + '</td><td><span class="step-badge">' + (e.step||'--') + '</span></td><td class="error-msg" title="' + ((e.error||'').replace(/"/g,'&quot;')) + '">' + (e.error||'--') + '</td><td class="time-ago">' + timeAgo(e.ts) + '</td>';
      tb.appendChild(tr);
    }
  }

  function tickLive() {
    if (!lastData) return;
    var active = (lastData.pipeline||{}).active||[];
    var cells = document.querySelectorAll('#tb-active .duration');
    for (var i = 0; i < cells.length && i < active.length; i++) cells[i].textContent = dur(active[i].ts);
    var errors = (lastData.pipeline||{}).errors||[];
    var ago = document.querySelectorAll('#tb-errors .time-ago');
    for (var i = 0; i < ago.length && i < errors.length; i++) ago[i].textContent = timeAgo(errors[i].ts);
  }

  var _sectionsLoading = 0;
  function fetchSection(name, renderFn) {
    var t0 = Date.now();
    _sectionsLoading++;
    return fetch('/admin/dashboard/section?section=' + name)
      .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function(d) {
        console.log('[dashboard] ' + name + ' loaded in ' + (Date.now() - t0) + 'ms');
        renderFn(d);
      })
      .catch(function(e) { console.error('[dashboard] ' + name + ' failed after ' + (Date.now() - t0) + 'ms:', e); })
      .finally(function() {
        _sectionsLoading--;
        if (_sectionsLoading <= 0) document.getElementById('status-dot').className = 'dot';
      });
  }

  function fetchData() {
    document.getElementById('status-dot').className = 'dot loading';
    // Fire all sections independently — each renders as it arrives, no waiting
    fetchSection('pipeline', renderPipeline);
    fetchSection('review', renderReview);
    fetchSection('tokens', renderTokens);
    fetchSection('recent', renderRecent);
  }

  // Drop the overlay immediately — sections load in behind it
  (function() {
    var ov = document.getElementById('init-overlay');
    if (ov) { ov.style.opacity = '0'; setTimeout(function() { ov.remove(); }, 420); }
  })();
  fetchData();
  setInterval(function() { countdown--; if (countdown <= 0) { fetchData(); countdown = 30; } document.getElementById('countdown').textContent = String(countdown); }, 1000);
  setInterval(tickLive, 1000);

  // Search
  function doSearch() {
    var q = document.getElementById('search-input').value.trim();
    if (!q) return;
    window.open('/audit/report?id=' + encodeURIComponent(q), '_blank');
  }
  document.getElementById('search-btn').addEventListener('click', doSearch);
  document.getElementById('search-input').addEventListener('keydown', function(e) { if (e.key === 'Enter') doSearch(); });

  // Redraw charts on resize
  var resizeTimer;
  window.addEventListener('resize', function() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function() {
      if (lastData) {
        var p = lastData.pipeline || {};
        drawActivityChart(p.completedTs, p.errorsTs, p.retriesTs);
      }
    }, 150);
  });

  // ===== Modal helpers =====
  function openModal(id) { document.getElementById(id).classList.add('open'); }
  function closeModal(id) { document.getElementById(id).classList.remove('open'); }
  function backdropClose(id) {
    var overlay = document.getElementById(id);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) closeModal(id); });
  }

  // ===== Users Modal =====
  var allUsers = [];
  var currentAdminEmail = '';
  var currentOrgId = '';
  fetch('/admin/api/me').then(function(r){return r.json()}).then(function(d){currentAdminEmail=d.username||''; currentOrgId=d.orgId||''; document.getElementById('user-email').textContent=currentAdminEmail; document.getElementById('user-avatar').textContent=(currentAdminEmail||'?')[0].toUpperCase(); if(currentAdminEmail==='ai@monsterrg.com'){document.getElementById('super-admin-link').style.display='';}}).catch(function(){});
  var roleColors = { admin: 'blue', judge: 'purple', manager: 'yellow', reviewer: 'green', user: 'cyan' };
  var roleInitials = { admin: 'A', judge: 'J', manager: 'M', reviewer: 'R', user: 'U' };

  function fetchUsers() {
    return fetch('/admin/users').then(function(r){return r.json()}).then(function(d) {
      allUsers = Array.isArray(d) ? d : [];
    }).catch(function(){ allUsers = []; });
  }

  function renderUserList() {
    var el = document.getElementById('um-user-list');
    if (!allUsers.length) {
      el.innerHTML = '<div class="um-empty"><div class="um-empty-icon">${icons.userCog}</div><div class="um-empty-text">No users yet. Click "+ Add" to create one.</div></div>';
      return;
    }
    var order = ['admin','judge','manager','reviewer','user'];
    var sorted = allUsers.slice().sort(function(a,b) { return order.indexOf(a.role) - order.indexOf(b.role); });
    var html = '';
    for (var i = 0; i < sorted.length; i++) {
      var u = sorted[i], c = roleColors[u.role] || 'blue';
      html += '<div class="um-user-row">'
        + '<div class="um-user-avatar" style="background:var(--' + c + '-bg);color:var(--' + c + ');">' + (roleInitials[u.role] || '?') + '</div>'
        + '<div class="um-user-info"><div class="um-user-email">' + esc(u.email) + '</div>'
        + '<div class="um-user-meta">' + (u.supervisor ? 'reports to ' + esc(u.supervisor) : 'no supervisor') + '</div></div>'
        + '<span class="um-badge ' + u.role + '">' + (u.role === 'user' ? 'agent' : u.role) + '</span>'
        + '<button class="sf-btn ghost um-delete-btn" data-email="' + esc(u.email) + '" style="margin-left:6px;font-size:10px;padding:3px 8px;color:var(--red);" title="Delete user">✕</button>'
        + '</div>';
    }
    el.innerHTML = html;
    el.querySelectorAll('.um-delete-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var email = this.getAttribute('data-email');
        if (!confirm('Delete user ' + email + '? This cannot be undone.')) return;
        fetch('/admin/users/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email }) })
          .then(function(r) { return r.json(); })
          .then(function(d) {
            if (d.error) { toast(d.error, 'error'); return; }
            toast('Deleted ' + email, 'success');
            fetchUsers().then(function() { renderUserList(); updateSupervisorDropdown(); });
          })
          .catch(function() { toast('Delete failed', 'error'); });
      });
    });
  }

  function updateSupervisorDropdown() {
    var group = document.getElementById('supervisor-group');
    var label = document.getElementById('supervisor-label');
    var sel = document.getElementById('a-supervisor');
    var credStep = document.getElementById('um-cred-step');
    var btnRole = document.getElementById('um-btn-role');
    if (!btnRole || !group || !sel || !credStep) return;
    btnRole.textContent = selectedRole === 'user' ? 'Agent' : selectedRole.charAt(0).toUpperCase() + selectedRole.slice(1);

    if (selectedRole === 'admin') {
      group.style.display = 'none';
      sel.innerHTML = '<option value="">-- Select --</option>';
      credStep.textContent = '2. Credentials';
      return;
    }
    group.style.display = '';
    credStep.textContent = '3. Credentials';
    var labelText, filterFn;
    if (selectedRole === 'judge' || selectedRole === 'manager') {
      labelText = 'an Admin';
      filterFn = function(u) { return u.role === 'admin'; };
    } else {
      labelText = 'a Judge, Manager, or Admin';
      filterFn = function(u) { return u.role === 'judge' || u.role === 'manager' || u.role === 'admin'; };
    }
    label.textContent = labelText;
    var opts = '<option value="">-- Select --</option>';
    var others = '';
    for (var i = 0; i < allUsers.length; i++) {
      if (filterFn(allUsers[i])) {
        if (currentAdminEmail && allUsers[i].email === currentAdminEmail) {
          opts += '<option value="' + esc(currentAdminEmail) + '">Self (' + esc(currentAdminEmail) + ')</option>';
        } else {
          others += '<option value="' + esc(allUsers[i].email) + '">' + esc(allUsers[i].email) + '</option>';
        }
      }
    }
    sel.innerHTML = opts + others;
  }

  // Tab switching
  document.getElementById('um-tabs').addEventListener('click', function(e) {
    var tab = e.target.closest('.um-tab');
    if (!tab) return;
    this.querySelectorAll('.um-tab').forEach(function(t){t.classList.remove('active')});
    tab.classList.add('active');
    var which = tab.getAttribute('data-tab');
    document.getElementById('um-list-tab').style.display = which === 'list' ? '' : 'none';
    document.getElementById('um-add-tab').style.display = which === 'add' ? '' : 'none';
    document.getElementById('um-scopes-tab').style.display = which === 'scopes' ? '' : 'none';
    if (which === 'scopes') loadScopesTab();
  });

  // ===== Manager Scopes Tab =====
  (function() {
    var allScopes = {};
    var allDimDepts = [];
    var allDimShifts = [];
    var selectedManager = null;
    var currentDepts = [];
    var currentShifts = [];

    function loadScopesTab() {
      Promise.all([
        fetch('/admin/manager-scopes').then(function(r){return r.json()}),
        fetch('/admin/audit-dimensions').then(function(r){return r.json()}),
      ]).then(function(results) {
        allScopes = results[0] || {};
        var dims = results[1] || {};
        allDimDepts = dims.departments || [];
        allDimShifts = dims.shifts || [];
        renderManagerList();
        populateDimDropdowns();
      }).catch(function(e) {
        console.error('[SCOPES] load error', e);
      });
    }
    window.loadScopesTab = loadScopesTab;

    function renderManagerList() {
      var managers = allUsers.filter(function(u){ return u.role === 'manager'; });
      var el = document.getElementById('um-scope-manager-list');
      if (!managers.length) {
        el.innerHTML = '<div style="padding:16px 12px;text-align:center;color:var(--text-dim);font-size:11px;">No managers yet</div>';
        return;
      }
      var html = '';
      for (var i = 0; i < managers.length; i++) {
        var m = managers[i];
        var hasScope = allScopes[m.email] && (allScopes[m.email].departments.length || allScopes[m.email].shifts.length);
        html += '<div class="um-user-row scope-mgr-row" data-email="' + esc(m.email) + '" style="cursor:pointer;' + (selectedManager === m.email ? 'background:var(--bg-surface);' : '') + '">'
          + '<div class="um-user-info"><div class="um-user-email" style="font-size:10px;">' + esc(m.email) + '</div>'
          + '<div class="um-user-meta">' + (hasScope ? 'scope configured' : 'no scope — sees all') + '</div></div>'
          + (hasScope ? '<div style="width:6px;height:6px;border-radius:50%;background:var(--green);flex-shrink:0;"></div>' : '<div style="width:6px;height:6px;border-radius:50%;background:var(--red);flex-shrink:0;"></div>')
          + '</div>';
      }
      el.innerHTML = html;
      el.querySelectorAll('.scope-mgr-row').forEach(function(row) {
        row.addEventListener('click', function() {
          selectedManager = this.getAttribute('data-email');
          var scope = allScopes[selectedManager] || { departments: [], shifts: [] };
          currentDepts = scope.departments.slice();
          currentShifts = scope.shifts.slice();
          renderManagerList();
          showScopeEditor();
        });
      });
    }

    function populateDimDropdowns() {
      var dSel = document.getElementById('um-scope-dept-select');
      var sSel = document.getElementById('um-scope-shift-select');
      dSel.innerHTML = '<option value="">-- add department --</option>'
        + allDimDepts.map(function(d){ return '<option value="' + esc(d) + '">' + esc(d) + '</option>'; }).join('');
      sSel.innerHTML = '<option value="">-- add shift --</option>'
        + allDimShifts.map(function(s){ return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join('');
    }

    function renderTag(value, list, renderFn) {
      if (!list.includes(value)) { list.push(value); renderFn(); }
    }

    function renderDeptTags() {
      var el = document.getElementById('um-scope-dept-tags');
      el.innerHTML = currentDepts.map(function(d) {
        return '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:12px;background:var(--blue-bg);color:var(--blue);font-size:11px;font-weight:600;">'
          + esc(d) + '<button style="background:none;border:none;cursor:pointer;color:var(--blue);font-size:12px;line-height:1;padding:0 0 0 2px;" data-val="' + esc(d) + '" class="rm-dept-tag">&times;</button></span>';
      }).join('');
      el.querySelectorAll('.rm-dept-tag').forEach(function(btn) {
        btn.addEventListener('click', function() {
          currentDepts = currentDepts.filter(function(x){ return x !== btn.getAttribute('data-val'); });
          renderDeptTags();
        });
      });
    }

    function renderShiftTags() {
      var el = document.getElementById('um-scope-shift-tags');
      el.innerHTML = currentShifts.map(function(s) {
        return '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:12px;background:var(--green-bg);color:var(--green);font-size:11px;font-weight:600;">'
          + esc(s) + '<button style="background:none;border:none;cursor:pointer;color:var(--green);font-size:12px;line-height:1;padding:0 0 0 2px;" data-val="' + esc(s) + '" class="rm-shift-tag">&times;</button></span>';
      }).join('');
      el.querySelectorAll('.rm-shift-tag').forEach(function(btn) {
        btn.addEventListener('click', function() {
          currentShifts = currentShifts.filter(function(x){ return x !== btn.getAttribute('data-val'); });
          renderShiftTags();
        });
      });
    }

    function showScopeEditor() {
      document.getElementById('um-scope-editor-empty').style.display = 'none';
      var editor = document.getElementById('um-scope-editor');
      editor.style.display = 'flex';
      document.getElementById('um-scope-email-label').textContent = selectedManager;
      document.getElementById('um-scope-saved').style.display = 'none';
      renderDeptTags();
      renderShiftTags();
    }

    document.getElementById('um-scope-dept-add').addEventListener('click', function() {
      var sel = document.getElementById('um-scope-dept-select');
      var custom = document.getElementById('um-scope-dept-custom');
      var val = (custom.value.trim() || sel.value).trim();
      if (!val) return;
      renderTag(val, currentDepts, renderDeptTags);
      custom.value = ''; sel.value = '';
    });

    document.getElementById('um-scope-shift-add').addEventListener('click', function() {
      var sel = document.getElementById('um-scope-shift-select');
      var custom = document.getElementById('um-scope-shift-custom');
      var val = (custom.value.trim() || sel.value).trim();
      if (!val) return;
      renderTag(val, currentShifts, renderShiftTags);
      custom.value = ''; sel.value = '';
    });

    document.getElementById('um-scope-save-btn').addEventListener('click', function() {
      if (!selectedManager) return;
      var btn = this;
      btn.disabled = true;
      fetch('/admin/manager-scopes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: selectedManager, departments: currentDepts, shifts: currentShifts }),
      }).then(function(r){ return r.json(); }).then(function(d) {
        btn.disabled = false;
        if (d.error) { toast(d.error, 'error'); return; }
        allScopes[selectedManager] = { departments: currentDepts.slice(), shifts: currentShifts.slice() };
        document.getElementById('um-scope-saved').style.display = 'inline';
        setTimeout(function(){ document.getElementById('um-scope-saved').style.display = 'none'; }, 2000);
        renderManagerList();
      }).catch(function() { btn.disabled = false; toast('Save failed', 'error'); });
    });
  })();

  // ===== Impersonate User Modal =====
  (function() {
    var roleHome = { admin: '/admin/dashboard', judge: '/judge', manager: '/manager', reviewer: '/review', user: '/agent' };
    var roleColors = { admin: 'blue', judge: 'purple', manager: 'yellow', reviewer: 'green', user: 'cyan' };

    function openImpModal() {
      var sel = document.getElementById('imp-user-select');
      sel.innerHTML = '<option value="">-- choose a user --</option>';
      var order = ['admin','judge','manager','reviewer','user'];
      var sorted = allUsers.slice().sort(function(a,b){ return order.indexOf(a.role)-order.indexOf(b.role); });
      sorted.forEach(function(u) {
        var opt = document.createElement('option');
        opt.value = u.email;
        opt.textContent = u.email + ' (' + (u.role === 'user' ? 'agent' : u.role) + ')';
        sel.appendChild(opt);
      });
      document.getElementById('imp-user-info').style.display = 'none';
      document.getElementById('imp-go-btn').disabled = true;
      openModal('impersonate-modal');
    }

    document.getElementById('impersonate-user-open').addEventListener('click', function() {
      if (!allUsers.length) {
        fetchUsers().then(openImpModal);
      } else {
        openImpModal();
      }
    });

    document.getElementById('imp-user-select').addEventListener('change', function() {
      var email = this.value;
      var info = document.getElementById('imp-user-info');
      var badge = document.getElementById('imp-user-role-badge');
      var dest = document.getElementById('imp-user-dest');
      var goBtn = document.getElementById('imp-go-btn');
      if (!email) { info.style.display = 'none'; goBtn.disabled = true; return; }
      var u = allUsers.find(function(x){ return x.email === email; });
      if (!u) return;
      var c = roleColors[u.role] || 'blue';
      info.style.display = '';
      badge.style.color = 'var(--' + c + ')';
      badge.textContent = u.role === 'user' ? 'Agent' : u.role.charAt(0).toUpperCase() + u.role.slice(1);
      dest.textContent = 'Will open: ' + (roleHome[u.role] || '/') + '?as=' + email;
      goBtn.disabled = false;
    });

    document.getElementById('imp-go-btn').addEventListener('click', function() {
      var email = document.getElementById('imp-user-select').value;
      if (!email) return;
      var u = allUsers.find(function(x){ return x.email === email; });
      var home = u ? (roleHome[u.role] || '/') : '/';
      window.open(home + '?as=' + encodeURIComponent(email), '_blank');
      closeModal('impersonate-modal');
    });

    document.getElementById('imp-cancel').addEventListener('click', function() { closeModal('impersonate-modal'); });
    backdropClose('impersonate-modal');
  })();

  // ===== Role Views Flyout =====
  (function() {
    var wrap = document.getElementById('rv-wrap');
    var flyout = document.getElementById('rv-flyout');
    var hideTimer = null;
    function show() {
      clearTimeout(hideTimer);
      var rect = wrap.getBoundingClientRect();
      flyout.style.left = (rect.right + 8) + 'px';
      flyout.style.top = (rect.top + rect.height / 2) + 'px';
      flyout.style.transform = 'translateY(-50%) translateX(0)';
      flyout.classList.add('open');
    }
    function scheduleHide() {
      hideTimer = setTimeout(function() { flyout.classList.remove('open'); }, 150);
    }
    wrap.addEventListener('mouseenter', show);
    wrap.addEventListener('mouseleave', scheduleHide);
    flyout.addEventListener('mouseenter', function() { clearTimeout(hideTimer); });
    flyout.addEventListener('mouseleave', function() { flyout.classList.remove('open'); });
  })();

  document.getElementById('users-open').addEventListener('click', function() {
    openModal('users-modal');
    fetchUsers().then(function() { renderUserList(); updateSupervisorDropdown(); });
  });
  document.getElementById('users-cancel').addEventListener('click', function() { closeModal('users-modal'); });
  backdropClose('users-modal');

  // ===== Pipeline Modal =====
  document.getElementById('pipeline-open').addEventListener('click', function() {
    openModal('pipeline-modal');
    loadPipelineData();
  });
  document.getElementById('pipeline-cancel').addEventListener('click', function() { closeModal('pipeline-modal'); });
  backdropClose('pipeline-modal');

  // Stepper buttons
  document.querySelectorAll('.pm-step-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var input = document.getElementById(this.getAttribute('data-target'));
      var dir = parseInt(this.getAttribute('data-dir'));
      var min = parseInt(input.min) || 0;
      var max = parseInt(input.max) || 999;
      var cur = parseInt(input.value);
      if (isNaN(cur)) cur = min;
      var next = cur + dir;
      if (next < min) next = min;
      if (next > max) next = max;
      input.value = next;
      input.dispatchEvent(new Event('change'));
    });
  });

  // ===== Dev Tools Modal =====
  document.getElementById('devtools-open').addEventListener('click', function() { openModal('devtools-modal'); });
  document.getElementById('devtools-cancel').addEventListener('click', function() { closeModal('devtools-modal'); });
  backdropClose('devtools-modal');

  // ===== Queue Pause/Resume Toggle =====
  // After terminate-all the queues are paused, so we start in "paused" state (button = Resume).
  // Clicking toggles and flips the label.
  var queuesPaused = false;
  function updateQueueBtn() {
    var btn = document.getElementById('resume-queues-btn');
    btn.textContent = queuesPaused ? 'Resume Queues' : 'Pause Queues';
    btn.className = 'sf-btn' + (queuesPaused ? ' primary' : '');
  }
  updateQueueBtn(); // sync button text with initial state on load
  document.getElementById('resume-queues-btn').addEventListener('click', function() {
    var btn = this;
    var action = queuesPaused ? 'resume' : 'pause';
    btn.disabled = true; btn.textContent = action === 'resume' ? 'Resuming...' : 'Pausing...';
    fetch('/admin/' + action + '-queues', { method: 'POST' })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.ok) { queuesPaused = !queuesPaused; toast('Queues ' + action + 'd', 'success'); }
        else toast(d.error || 'Failed', 'error');
      })
      .catch(function() { toast('Request failed', 'error'); })
      .finally(function() { btn.disabled = false; updateQueueBtn(); });
  });

  // ===== Terminate Running =====
  document.getElementById('terminate-all-btn').addEventListener('click', function() {
    openModal('terminate-modal');
  });
  document.getElementById('terminate-cancel').addEventListener('click', function() { closeModal('terminate-modal'); });
  backdropClose('terminate-modal');
  document.getElementById('terminate-confirm').addEventListener('click', function() {
    var btn = this;
    btn.disabled = true; btn.textContent = 'Terminating...';
    fetch('/admin/terminate-all', { method: 'POST' })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        closeModal('terminate-modal');
        if (d.ok) {
          toast('Terminated ' + (d.terminated || 0) + ' running audits', 'success');
          fetchData();
        } else {
          toast(d.error || 'Failed', 'error');
        }
      })
      .catch(function() { toast('Request failed', 'error'); })
      .finally(function() { btn.disabled = false; btn.textContent = 'Terminate Running'; });
  });

  // ===== Clear Queue =====
  document.getElementById('clear-queue-btn').addEventListener('click', function() {
    openModal('clear-queue-modal');
  });
  document.getElementById('clear-queue-cancel').addEventListener('click', function() { closeModal('clear-queue-modal'); });
  backdropClose('clear-queue-modal');
  document.getElementById('clear-queue-confirm').addEventListener('click', function() {
    var btn = this;
    btn.disabled = true; btn.textContent = 'Clearing...';
    fetch('/admin/clear-queue', { method: 'POST' })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        closeModal('clear-queue-modal');
        if (d.ok) {
          toast('Cleared ' + (d.purged || 0) + ' queued messages', 'success');
          queuesPaused = true; updateQueueBtn();
          fetchData();
        } else {
          toast(d.error || 'Failed', 'error');
        }
      })
      .catch(function() { toast('Request failed', 'error'); })
      .finally(function() { btn.disabled = false; btn.textContent = 'Clear Queue'; });
  });

  // ===== Clear Errors =====
  document.getElementById('clear-errors-btn').addEventListener('click', function() {
    openModal('clear-errors-modal');
  });
  document.getElementById('clear-errors-cancel').addEventListener('click', function() { closeModal('clear-errors-modal'); });
  backdropClose('clear-errors-modal');
  document.getElementById('clear-errors-confirm').addEventListener('click', function() {
    var btn = this;
    btn.disabled = true; btn.textContent = 'Clearing...';
    fetch('/admin/clear-errors', { method: 'POST' })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        closeModal('clear-errors-modal');
        if (d.ok) {
          toast('Cleared ' + (d.cleared || 0) + ' errors', 'success');
          fetchData();
        } else {
          toast(d.error || 'Failed', 'error');
        }
      })
      .catch(function() { toast('Request failed', 'error'); })
      .finally(function() { btn.disabled = false; btn.textContent = 'Clear Errors'; });
  });

  // ===== Clear Review Queue =====
  document.getElementById('clear-review-btn').addEventListener('click', function() {
    openModal('clear-review-modal');
  });
  document.getElementById('clear-review-cancel').addEventListener('click', function() { closeModal('clear-review-modal'); });
  backdropClose('clear-review-modal');
  document.getElementById('clear-review-confirm').addEventListener('click', function() {
    var btn = this;
    btn.disabled = true; btn.textContent = 'Clearing...';
    fetch('/admin/clear-review-queue', { method: 'POST' })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        closeModal('clear-review-modal');
        if (d.ok) {
          toast('Review queue cleared (' + (d.cleared || 0) + ' entries removed)', 'success');
          fetchData();
        } else {
          toast(d.error || 'Failed', 'error');
        }
      })
      .catch(function() { toast('Request failed', 'error'); })
      .finally(function() { btn.disabled = false; btn.textContent = 'Yes, Clear Queue'; });
  });

  // ===== Test by RID =====
  function doRidAudit() {
    var rid = document.getElementById('rid-input').value.trim();
    var type = document.getElementById('rid-type').value;
    var resultEl = document.getElementById('rid-result');
    if (!rid) { resultEl.style.color = 'var(--red)'; resultEl.textContent = 'Enter a Record ID.'; return; }
    var btn = document.getElementById('rid-btn');
    btn.disabled = true; btn.textContent = 'Starting...';
    resultEl.style.color = 'var(--text-muted)'; resultEl.textContent = 'Submitting...';
    var endpoint = type === 'package' ? '/audit/package-by-rid' : '/audit/test-by-rid';
    fetch(endpoint + '?rid=' + encodeURIComponent(rid), { method: 'POST' })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.ok || d.findingId) {
          resultEl.style.color = 'var(--green)';
          resultEl.textContent = 'Started: ' + (d.findingId || 'queued');
          toast('Audit started for RID ' + rid, 'success');
          document.getElementById('rid-input').value = '';
        } else {
          resultEl.style.color = 'var(--red)';
          resultEl.textContent = d.error || 'Failed to start audit';
        }
      })
      .catch(function() { resultEl.style.color = 'var(--red)'; resultEl.textContent = 'Request failed'; })
      .finally(function() { btn.disabled = false; btn.textContent = 'Start Audit'; });
  }
  document.getElementById('rid-btn').addEventListener('click', doRidAudit);
  document.getElementById('rid-input').addEventListener('keydown', function(e) { if (e.key === 'Enter') doRidAudit(); });

  // ===== Bulk Audit Modal =====
  document.getElementById('bulk-open-btn').addEventListener('click', function() {
    // Sync type selector with single-audit selector
    document.getElementById('bulk-type').value = document.getElementById('rid-type').value;
    openModal('bulk-modal');
  });
  document.getElementById('bulk-cancel').addEventListener('click', function() { closeModal('bulk-modal'); });
  backdropClose('bulk-modal');

  document.getElementById('bulk-start').addEventListener('click', function() {
    var rawText = document.getElementById('bulk-rids').value.trim();
    if (!rawText) { toast('Enter at least one Record ID', 'error'); return; }

    var sep = String.fromCharCode(10);
    var rids = rawText.replace(/,/g, sep).split(sep).map(function(s) { return s.trim(); }).filter(Boolean);
    if (rids.length === 0) { toast('No valid RIDs found', 'error'); return; }
    if (rids.length > 200) { toast('Max 200 RIDs per bulk run', 'error'); return; }

    var type = document.getElementById('bulk-type').value;
    var staggerMs = Math.max(0, parseInt(document.getElementById('bulk-stagger').value, 10) || 0);
    var endpoint = type === 'package' ? '/audit/package-by-rid' : '/audit/test-by-rid';

    var btn = document.getElementById('bulk-start');
    var progress = document.getElementById('bulk-progress');
    btn.disabled = true;
    progress.style.display = 'block';
    progress.textContent = '0 / ' + rids.length + ' queued...';

    console.log('[BULK] Starting ' + rids.length + ' audits — type=' + type + ', stagger=' + staggerMs + 'ms');

    var started = 0, errors = 0;

    function fireNext(i) {
      if (i >= rids.length) {
        btn.disabled = false;
        var msg = started + ' / ' + rids.length + ' queued' + (errors > 0 ? ', ' + errors + ' failed' : '');
        progress.textContent = msg + ' ✓';
        console.log('[BULK] Complete — ' + started + ' started, ' + errors + ' errors');
        toast('Bulk complete: ' + msg, errors > 0 ? 'warning' : 'success');
        closeModal('bulk-modal');
        return;
      }
      var rid = rids[i];
      fetch(endpoint + '?rid=' + encodeURIComponent(rid), { method: 'POST' })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d.findingId || d.ok) {
            started++;
            console.log('[BULK] (' + (i + 1) + '/' + rids.length + ') RID ' + rid + ' queued — findingId=' + (d.findingId || '?'));
          } else {
            errors++;
            console.warn('[BULK] (' + (i + 1) + '/' + rids.length + ') RID ' + rid + ' failed — ' + (d.error || 'unknown error'));
          }
        })
        .catch(function(err) {
          errors++;
          console.error('[BULK] (' + (i + 1) + '/' + rids.length + ') RID ' + rid + ' fetch error:', err);
        })
        .finally(function() {
          progress.textContent = (started + errors) + ' / ' + rids.length + ' queued' + (errors > 0 ? ' (' + errors + ' err)' : '') + '...';
          setTimeout(function() { fireNext(i + 1); }, staggerMs);
        });
    }

    fireNext(0);
  });

  // ===== Webhook Modal =====
  var modal = document.getElementById('webhook-modal');
  var whKind = 'terminate';
  var whSubs = { terminate: 'Called when an audit is complete (100% first pass or review completed)', appeal: 'Called when an agent files an appeal', manager: 'Called when a manager submits a remediation note on a failed audit', 'judge-finish': 'Called when a judge finishes all appeal decisions for an audit', 're-audit-receipt': 'Sent to the agent when they request a receipt email after submitting a re-audit' };
  var whCache = {};
  var etTemplateList = [];

  // Load template list for the dropdown
  fetch('/admin/email-templates').then(function(r){return r.json()}).then(function(list){
    etTemplateList = Array.isArray(list) ? list : [];
    var sel = document.getElementById('a-template-id');
    sel.innerHTML = '<option value="">— No template (email disabled) —</option>';
    etTemplateList.forEach(function(t) {
      var opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      sel.appendChild(opt);
    });
  }).catch(function(){});

  // Kinds that have direct email sending and need template/testEmail fields
  var EMAIL_KINDS = ['terminate', 'appeal', 'manager', 'judge-finish', 're-audit-receipt'];

  function applyWebhookData(kind, d) {
    document.getElementById('a-posturl').value = d.postUrl || '';
    document.getElementById('a-headers').value = d.postHeaders ? JSON.stringify(d.postHeaders, null, 2) : '';
    document.getElementById('a-test-email').value = d.testEmail || '';
    document.getElementById('a-bcc').value = d.bcc || '';
    var templateRow = document.getElementById('wh-template-row');
    templateRow.style.display = EMAIL_KINDS.includes(kind) ? '' : 'none';
    if (EMAIL_KINDS.includes(kind)) {
      document.getElementById('a-template-id').value = d.emailTemplateId || '';
    }
    var defaultUrlRow = document.getElementById('wh-default-url-row');
    var selfEndpoints = { terminate: '/webhooks/audit-complete', appeal: '/webhooks/appeal-filed', manager: '/webhooks/manager-review', 'judge-finish': '/webhooks/appeal-decided' };
    if (selfEndpoints[kind]) {
      var orgId = currentOrgId || 'YOUR_ORG_ID';
      var defaultUrl = window.location.origin + selfEndpoints[kind] + '?org=' + encodeURIComponent(orgId);
      document.getElementById('wh-default-url-text').textContent = defaultUrl;
      defaultUrlRow.style.display = '';
    } else {
      defaultUrlRow.style.display = 'none';
    }
  }

  function loadWebhookTab(kind) {
    whKind = kind;
    document.querySelectorAll('.wh-tab').forEach(function(t){t.classList.toggle('active',t.getAttribute('data-kind')===kind)});
    document.getElementById('wh-sub').textContent = whSubs[kind];
    document.getElementById('wh-template-row').style.display = EMAIL_KINDS.includes(kind) ? '' : 'none';
    if (whCache[kind]) {
      applyWebhookData(kind, whCache[kind]);
    } else {
      document.getElementById('a-posturl').value = '';
      document.getElementById('a-headers').value = '';
      document.getElementById('a-test-email').value = '';
      document.getElementById('a-bcc').value = '';
      document.getElementById('a-template-id').value = '';
      fetch('/admin/settings/' + kind).then(function(r){return r.json()}).then(function(d) {
        whCache[kind] = d;
        if (whKind === kind) applyWebhookData(kind, d);
      }).catch(function(){});
    }
  }

  document.getElementById('wh-tabs').addEventListener('click', function(e) {
    var tab = e.target.closest('.wh-tab');
    if (tab) loadWebhookTab(tab.getAttribute('data-kind'));
  });

  document.getElementById('wh-default-url-copy').addEventListener('click', function() {
    var text = document.getElementById('wh-default-url-text').textContent;
    navigator.clipboard.writeText(text).then(function() {
      var btn = document.getElementById('wh-default-url-copy');
      btn.textContent = 'Copied!';
      setTimeout(function() { btn.textContent = 'Copy'; }, 1500);
    });
  });

  document.getElementById('webhook-open').addEventListener('click', function() {
    modal.classList.add('open');
    loadWebhookTab(whKind);
  });
  document.getElementById('webhook-cancel').addEventListener('click', function() { modal.classList.remove('open'); });
  modal.addEventListener('click', function(e) { if (e.target === modal) modal.classList.remove('open'); });

  // ===== Load pipeline data =====
  function loadPipelineData() {
    fetch('/admin/parallelism').then(function(r){return r.json()}).then(function(d) {
      document.getElementById('a-parallelism').value = d.parallelism != null ? d.parallelism : '';
    }).catch(function(){});
    fetch('/admin/pipeline-config').then(function(r){return r.json()}).then(function(d) {
      document.getElementById('a-retries').value = d.maxRetries != null ? d.maxRetries : '';
      document.getElementById('a-retry-delay').value = d.retryDelaySeconds != null ? d.retryDelaySeconds : '';
    }).catch(function(){});
  }

  // ===== Webhook save =====
  document.getElementById('a-settings-save').addEventListener('click', function() {
    var btn = this, url = document.getElementById('a-posturl').value.trim();
    var raw = document.getElementById('a-headers').value.trim(), headers = {};
    if (raw) { try { headers = JSON.parse(raw); } catch(e) { toast('Invalid JSON','error'); return; } }
    var testEmail = document.getElementById('a-test-email').value.trim();
    var bcc = document.getElementById('a-bcc').value.trim();
    var emailTemplateId = EMAIL_KINDS.includes(whKind) ? (document.getElementById('a-template-id').value || '') : '';
    btnLoad(btn);
    var saved = { postUrl: url, postHeaders: headers };
    if (testEmail) saved.testEmail = testEmail;
    if (bcc) saved.bcc = bcc;
    if (emailTemplateId) saved.emailTemplateId = emailTemplateId;
    fetch('/admin/settings/' + whKind, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(saved) })
    .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()})
    .then(function(){whCache[whKind]=saved;toast(whKind+' webhook saved','success');btnDone(btn,'Save');closeModal('webhook-modal');})
    .catch(function(e){toast(e.message,'error');btnDone(btn,'Save')});
  });

  // ===== Users =====
  var selectedRole = 'admin';
  document.getElementById('a-role-group').addEventListener('click', function(e) {
    var card = e.target.closest('.um-role');
    if (!card) return;
    this.querySelectorAll('.um-role').forEach(function(p){p.classList.remove('active')});
    card.classList.add('active');
    selectedRole = card.getAttribute('data-role');
    updateSupervisorDropdown();
  });
  document.getElementById('a-adduser').addEventListener('click', function() {
    var btn = this, u = document.getElementById('a-username').value.trim(), p = document.getElementById('a-password').value;
    if (!u || !p) { toast('Enter email & password','error'); return; }
    var atIdx = u.indexOf('@'); var dotIdx = u.lastIndexOf('.');
    if (atIdx < 1 || dotIdx <= atIdx + 1 || dotIdx >= u.length - 1) { toast('Enter a valid email address','error'); return; }
    var sup = document.getElementById('a-supervisor').value;
    if (selectedRole !== 'admin' && !sup) { toast('Select a supervisor','error'); return; }
    btnLoad(btn,'Creating...');
    fetch('/admin/users', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({email:u,password:p,role:selectedRole,supervisor:sup||null}) })
    .then(function(r){if(!r.ok)return r.json().then(function(e){throw new Error(e.error||'HTTP '+r.status)},function(){throw new Error('HTTP '+r.status)});return r.json()})
    .then(function(d){
      toast(d.role+' "'+u+'" created','success');
      document.getElementById('a-username').value='';
      document.getElementById('a-password').value='';
      btnDone(btn,'Create ' + selectedRole.charAt(0).toUpperCase() + selectedRole.slice(1));
      fetchUsers().then(function() { renderUserList(); updateSupervisorDropdown(); });
    })
    .catch(function(e){toast(e.message,'error');btnDone(btn,'Create ' + selectedRole.charAt(0).toUpperCase() + selectedRole.slice(1))});
  });

  // ===== Pipeline =====
  document.getElementById('a-pipeline-save').addEventListener('click', function() {
    var btn = this;
    var par = parseInt(document.getElementById('a-parallelism').value);
    var mr = parseInt(document.getElementById('a-retries').value);
    var rd = parseInt(document.getElementById('a-retry-delay').value);
    if (isNaN(par)||par<1) { toast('Parallelism must be >= 1','error'); return; }
    if (isNaN(mr)||mr<0) { toast('Retries must be >= 0','error'); return; }
    if (isNaN(rd)||rd<0) { toast('Delay must be >= 0','error'); return; }
    btnLoad(btn);
    Promise.all([
      fetch('/admin/parallelism', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({parallelism:par}) }).then(function(r){if(!r.ok)throw new Error('Parallelism: HTTP '+r.status)}),
      fetch('/admin/pipeline-config', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({maxRetries:mr,retryDelaySeconds:rd}) }).then(function(r){if(!r.ok)throw new Error('Pipeline: HTTP '+r.status)})
    ])
    .then(function(){toast('Pipeline settings saved','success');btnDone(btn,'Save')})
    .catch(function(e){toast(e.message,'error');btnDone(btn,'Save')});
  });

  document.getElementById('pm-check-queues').addEventListener('click', function() {
    var btn = this, el = document.getElementById('pm-queue-status');
    btn.textContent = 'Checking...'; btn.disabled = true;
    fetch('/admin/queues').then(function(r){return r.json()}).then(function(d) {
      var queues = Array.isArray(d) ? d : (d.queues || []);
      if (!queues.length) { el.innerHTML = '<span style="color:var(--yellow)">No queues found in QStash</span>'; return; }
      el.innerHTML = queues.map(function(q) {
        var par = q.parallelism ?? q.concurrency ?? '?';
        var ok = par >= 20;
        var col = ok ? 'var(--green)' : 'var(--red)';
        return '<div style="display:flex;justify-content:space-between;padding:2px 0;"><span style="color:var(--text-muted)">' + q.name + '</span><span style="color:' + col + ';font-weight:700;font-family:var(--mono)">parallelism=' + par + '</span></div>';
      }).join('');
    }).catch(function(e){
      el.innerHTML = '<span style="color:var(--red)">Error: ' + e.message + '</span>';
    }).finally(function(){ btn.textContent = 'Check'; btn.disabled = false; });
  });

  // ===== Dev tools =====
  if (new URLSearchParams(window.location.search).has('local')) {
    document.getElementById('devtools-open').style.display = '';
  }
  document.getElementById('a-seed-btn').addEventListener('click', function() {
    var btn = this; btnLoad(btn,'Seeding...');
    fetch('/admin/seed',{method:'POST'}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()})
    .then(function(d){toast('Seeded '+d.seeded+' findings','success');btnDone(btn,'Seed Test Data');fetchData()})
    .catch(function(e){toast('Seed failed: '+e.message,'error');btnDone(btn,'Seed Test Data')});
  });
  document.getElementById('a-wipe-btn').addEventListener('click', function() {
    if (!confirm('Wipe ALL KV data? Cannot be undone.')) return;
    var btn = this; btnLoad(btn,'Wiping...');
    fetch('/admin/wipe-kv',{method:'POST'}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()})
    .then(function(d){toast('Wiped '+d.deleted+' entries','info');btnDone(btn,'Wipe All KV Data');fetchData()})
    .catch(function(e){toast(e.message,'error');btnDone(btn,'Wipe All KV Data')});
  });
  // ===== Email Reports Modal =====
  var erModal = document.getElementById('email-reports-modal');
  var erContent = document.getElementById('er-content');
  var emailConfigs = [];
  var erTemplates = [];

  var ER_FIELDS = [
    {value:'questionHeader',label:'Question Header'},
    {value:'questionAnswer',label:'Question Answer'},
    {value:'score',         label:'Score'},
    {value:'reason',        label:'Condition'},
    {value:'voName',        label:'VO Name'},
    {value:'department',    label:'Department'},
    {value:'appealStatus',  label:'Appeal Status'},
    {value:'auditType',     label:'Audit Type'},
    {value:'shift',         label:'Shift (Internal Only)'},
  ];
  var ER_ENUM_VALS = {
    questionAnswer: [{value:'Yes',label:'Yes'},{value:'No',label:'No'}],
    reason:         [{value:'perfect_score',label:'Perfect Score'},{value:'invalid_genie',label:'Invalid Genie'},{value:'reviewed',label:'Reviewed'}],
    appealStatus:   [{value:'none',label:'None'},{value:'pending',label:'Pending'},{value:'complete',label:'Complete'}],
    auditType:      [{value:'internal',label:'Internal'},{value:'partner',label:'Partner'}],
    shift:          [{value:'AM',label:'AM'},{value:'PM',label:'PM'},{value:'Weekend',label:'Weekend'}],
  };
  var ER_OPS_TEXT    = [{value:'contains',label:'contains'},{value:'not_contains',label:'does not contain'},{value:'equals',label:'equals'},{value:'not_equals',label:'not equals'},{value:'starts_with',label:'starts with'}];
  var ER_OPS_NUMERIC = [{value:'equals',label:'equals'},{value:'less_than',label:'less than'},{value:'greater_than',label:'greater than'}];
  var ER_OPS_ENUM    = [{value:'equals',label:'is'},{value:'not_equals',label:'is not'}];
  var ER_COLS = [
    {value:'recordId',       label:'Record ID'},
    {value:'findingId',      label:'Audit Report'},
    {value:'guestName',      label:'Guest Name'},
    {value:'voName',         label:'VO Name'},
    {value:'department',     label:'Department'},
    {value:'score',          label:'Score'},
    {value:'appealStatus',   label:'Appeal Status'},
    {value:'finalizedAt',    label:'Timestamp'},
    {value:'markedForReview',label:'Status'},
  ];

  function erOpsForField(field) {
    if (field === 'score') return ER_OPS_NUMERIC;
    if (field === 'appealStatus' || field === 'auditType' || field === 'questionAnswer' || field === 'reason' || field === 'shift') return ER_OPS_ENUM;
    return ER_OPS_TEXT;
  }

  function erCreateValEl(field, currentVal) {
    var opts = ER_ENUM_VALS[field];
    if (opts) {
      var sel = document.createElement('select'); sel.className = 'er-rule-val er-rule-sel'; sel.style.flex = '1';
      opts.forEach(function(o) {
        var opt = document.createElement('option'); opt.value = o.value; opt.textContent = o.label;
        if (currentVal === o.value) opt.selected = true;
        sel.appendChild(opt);
      });
      return sel;
    }
    var inp = document.createElement('input'); inp.className = 'er-rule-val'; inp.type = 'text'; inp.placeholder = 'value';
    inp.value = currentVal || '';
    return inp;
  }

  function erFmtTime(t) {
    // "07:00" -> "7:00 AM"
    if (!t) return t;
    var p = t.split(':'); if (p.length < 2) return t;
    var h = parseInt(p[0]), m = p[1];
    return (h === 0 ? 12 : h > 12 ? h - 12 : h) + ':' + m + ' ' + (h < 12 ? 'AM' : 'PM');
  }

  function erScheduleDesc(s) {
    if (!s) return null;
    if (s.mode === 'cron') return 'Cron: ' + s.expression;
    if (s.frequency === 'hourly') return 'Top of every hour';
    if (s.frequency === 'monthly') return 'Monthly day ' + s.dayOfMonth + ' @ ' + erFmtTime(s.timeOfDayEst) + ' EST';
    var d = s.days === 'weekdays' ? 'Mon–Fri' : s.days === 'weekends' ? 'Sat–Sun' : 'Daily';
    return d + ' @ ' + erFmtTime(s.timeOfDayEst) + ' EST';
  }

  // ── Tag chip input ───────────────────────────────────────────────────
  function erChipInput(container, initialValues) {
    var chips = (initialValues || []).slice();

    function renderChips() {
      container.querySelectorAll('.er-chip').forEach(function(c) { c.remove(); });
      var inp = container.querySelector('.er-chip-field');
      chips.forEach(function(v, i) {
        var chip = document.createElement('span'); chip.className = 'er-chip';
        var sp = document.createElement('span'); sp.title = v; sp.textContent = v;
        var x = document.createElement('button'); x.className = 'er-chip-x'; x.tabIndex = -1; x.innerHTML = '&times;';
        x.addEventListener('click', function(e) { e.stopPropagation(); chips.splice(i, 1); renderChips(); });
        chip.appendChild(sp); chip.appendChild(x);
        if (inp) container.insertBefore(chip, inp); else container.appendChild(chip);
      });
      if (inp) inp.placeholder = chips.length ? '' : 'Type or paste emails\u2026';
    }

    var input = document.createElement('input');
    input.className = 'er-chip-field'; input.type = 'text'; input.placeholder = 'Type or paste emails\u2026';
    container.appendChild(input);

    function commit() {
      var parts = input.value.split(',').map(function(s){return s.trim();}).filter(Boolean);
      parts.forEach(function(p){ if (!chips.includes(p)) chips.push(p); });
      if (parts.length) { input.value = ''; renderChips(); }
    }
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
      else if (e.key === 'Backspace' && !input.value && chips.length) { chips.pop(); renderChips(); }
    });
    input.addEventListener('blur', commit);
    input.addEventListener('paste', function(e) {
      e.preventDefault();
      var text = (e.clipboardData || window.clipboardData).getData('text');
      text.split(/[\\n,]+/).map(function(s){return s.trim();}).filter(Boolean).forEach(function(p){
        if (!chips.includes(p)) chips.push(p);
      });
      input.value = ''; renderChips();
    });
    container.addEventListener('click', function() { input.focus(); });
    renderChips();
    return { getValues: function() { return chips.slice(); } };
  }

  // ── Rule builder ─────────────────────────────────────────────────────
  function erBuildRuleRow(rule, rulesDiv) {
    var row = document.createElement('div'); row.className = 'er-rule-row';
    var fieldSel = document.createElement('select'); fieldSel.className = 'er-rule-sel'; fieldSel.style.width = '148px';
    ER_FIELDS.forEach(function(f) {
      var o = document.createElement('option'); o.value = f.value; o.textContent = f.label;
      if (rule && rule.field === f.value) o.selected = true;
      fieldSel.appendChild(o);
    });
    var opSel = document.createElement('select'); opSel.className = 'er-rule-sel'; opSel.style.width = '124px';
    var del = document.createElement('button'); del.className = 'er-icon-btn danger'; del.innerHTML = '&times;'; del.title = 'Remove';
    del.addEventListener('click', function() { row.remove(); });
    var initialVal = rule ? (rule.value || '') : '';
    var valEl = erCreateValEl(fieldSel.value, initialVal);
    function refreshOps() {
      var ops = erOpsForField(fieldSel.value); var cur = opSel.value; opSel.innerHTML = '';
      ops.forEach(function(op) {
        var o = document.createElement('option'); o.value = op.value; o.textContent = op.label;
        if ((rule && rule.operator === op.value) || cur === op.value) o.selected = true;
        opSel.appendChild(o);
      });
    }
    function refreshVal() {
      var cur = row.querySelector('.er-rule-val');
      if (!cur) return;
      var newEl = erCreateValEl(fieldSel.value, '');
      row.replaceChild(newEl, cur);
    }
    refreshOps();
    fieldSel.addEventListener('change', function() { refreshOps(); refreshVal(); });
    row.appendChild(fieldSel); row.appendChild(opSel); row.appendChild(valEl); row.appendChild(del);
    rulesDiv.appendChild(row);
  }

  function erBuildRuleList(rules, container) {
    var rulesDiv = document.createElement('div'); container.appendChild(rulesDiv);
    (rules || []).forEach(function(r) { erBuildRuleRow(r, rulesDiv); });
    var addBtn = document.createElement('button'); addBtn.className = 'er-add-rule'; addBtn.textContent = '+ Add Filter';
    addBtn.addEventListener('click', function() { erBuildRuleRow(null, rulesDiv); });
    container.appendChild(addBtn);
    return {
      getRules: function() {
        var out = [];
        rulesDiv.querySelectorAll('.er-rule-row').forEach(function(row) {
          var sels = row.querySelectorAll('select'); var val = row.querySelector('.er-rule-val');
          if (val && val.value.trim()) out.push({field:sels[0].value, operator:sels[1].value, value:val.value.trim()});
        });
        return out;
      }
    };
  }

  // ── Section card ─────────────────────────────────────────────────────
  function erBuildSectionCard(sectionDef, sectionsContainer) {
    var card = document.createElement('div'); card.className = 'er-section-card open';
    var initName = (sectionDef && sectionDef.header) || 'New Section';

    var head = document.createElement('div'); head.className = 'er-section-head';
    var chevron = document.createElement('span'); chevron.className = 'er-section-chevron'; chevron.innerHTML = '&#9656;';
    var titleEl = document.createElement('span'); titleEl.className = 'er-section-title'; titleEl.textContent = initName;
    var delBtn = document.createElement('button'); delBtn.className = 'er-icon-btn danger'; delBtn.innerHTML = '&times;'; delBtn.style.fontSize = '15px'; delBtn.title = 'Remove';
    delBtn.addEventListener('click', function(e) { e.stopPropagation(); card.remove(); });
    head.appendChild(chevron); head.appendChild(titleEl); head.appendChild(delBtn);
    head.addEventListener('click', function(e) { if (delBtn.contains(e.target)) return; card.classList.toggle('open'); });

    var body = document.createElement('div'); body.className = 'er-section-body';

    var hdrLbl = document.createElement('div'); hdrLbl.className = 'er-sub-label'; hdrLbl.style.marginTop = '0'; hdrLbl.textContent = 'Section Header';
    var hdrInput = document.createElement('input'); hdrInput.className = 'sf-input er-sec-hdr'; hdrInput.type = 'text'; hdrInput.value = initName; hdrInput.placeholder = 'e.g. Invalid Genie Audits'; hdrInput.style.marginBottom = '12px';
    hdrInput.addEventListener('input', function() { titleEl.textContent = hdrInput.value.trim() || 'New Section'; });

    var critLbl = document.createElement('div'); critLbl.className = 'er-sub-label'; critLbl.style.color = 'var(--blue)';
    critLbl.innerHTML = 'CRITERIA <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--text-dim);font-size:10px;">\u2014 further narrows the top-level set</span>';
    var critCont = document.createElement('div'); critCont.style.marginBottom = '12px';
    var critRules = erBuildRuleList(sectionDef && sectionDef.criteria, critCont);

    var colLbl = document.createElement('div'); colLbl.className = 'er-sub-label'; colLbl.textContent = 'Columns';
    var colGrid = document.createElement('div'); colGrid.className = 'er-col-grid er-sec-cols';
    var defCols = (sectionDef && sectionDef.columns) || ['recordId','guestName','voName','score'];
    ER_COLS.forEach(function(col) {
      var lbl = document.createElement('label'); lbl.className = 'er-col-check';
      if (col.value === 'markedForReview') {
        lbl.classList.add('er-status-col-lbl');
        var oc = document.getElementById('er-only-completed');
        if (oc && oc.checked) lbl.style.display = 'none';
      }
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = col.value; cb.checked = defCols.indexOf(col.value) !== -1;
      var sp = document.createElement('span'); sp.textContent = col.label;
      lbl.appendChild(cb); lbl.appendChild(sp); colGrid.appendChild(lbl);
    });

    body.appendChild(hdrLbl); body.appendChild(hdrInput);
    body.appendChild(critLbl); body.appendChild(critCont);
    body.appendChild(colLbl); body.appendChild(colGrid);
    card.appendChild(head); card.appendChild(body);
    sectionsContainer.appendChild(card);
  }

  // ── Schedule builder ─────────────────────────────────────────────────
  function erBuildSchedule(container, schedule) {
    var mode = (schedule && schedule.mode === 'cron') ? 'cron' : 'simple';
    var freq = (schedule && schedule.frequency) || 'daily';
    var tod  = (schedule && schedule.timeOfDayEst) || '07:00';
    var days = (schedule && schedule.days) || 'every';
    var dom  = (schedule && schedule.dayOfMonth) || 1;
    var cronExp = (schedule && schedule.expression) || '';

    function updatePreview() {
      var p = container.querySelector('.er-sched-preview'); if (!p) return;
      if (mode === 'cron') { p.textContent = cronExp ? 'Cron: ' + cronExp + ' (UTC)' : ''; return; }
      if (freq === 'hourly') { p.textContent = 'Runs at the top of every hour'; return; }
      if (freq === 'monthly') {
        var sfx = dom===1?'st':dom===2?'nd':dom===3?'rd':'th';
        p.textContent = 'Runs on the ' + dom + sfx + ' of each month at ' + erFmtTime(tod) + ' EST'; return;
      }
      var dl = days==='weekdays'?'Mon\u2013Fri':days==='weekends'?'Sat\u2013Sun':'every day';
      p.textContent = 'Runs ' + dl + ' at ' + erFmtTime(tod) + ' EST';
    }

    function render() {
      container.innerHTML = '';
      var tabRow = document.createElement('div'); tabRow.className = 'er-sched-tabs';
      ['Simple','Cron expression'].forEach(function(label, i) {
        var tm = i === 0 ? 'simple' : 'cron';
        var tab = document.createElement('button'); tab.className = 'er-sched-tab' + (mode===tm?' active':''); tab.textContent = label;
        tab.addEventListener('click', function() { mode = tm; render(); });
        tabRow.appendChild(tab);
      });
      container.appendChild(tabRow);

      if (mode === 'simple') {
        var row = document.createElement('div'); row.className = 'er-sched-row';
        // Frequency
        var fc = document.createElement('div'); fc.className = 'er-sched-col';
        var fl = document.createElement('div'); fl.className = 'er-sched-col-label'; fl.textContent = 'FREQUENCY';
        var fs = document.createElement('select'); fs.className = 'er-sched-sel';
        [['daily','Daily'],['hourly','Hourly'],['monthly','Monthly']].forEach(function(opt) {
          var o = document.createElement('option'); o.value = opt[0]; o.textContent = opt[1]; if (freq===opt[0]) o.selected=true; fs.appendChild(o);
        });
        fs.addEventListener('change', function() { freq = fs.value; render(); });
        fc.appendChild(fl); fc.appendChild(fs); row.appendChild(fc);

        if (freq !== 'hourly') {
          var tc = document.createElement('div'); tc.className = 'er-sched-col';
          var tl = document.createElement('div'); tl.className = 'er-sched-col-label'; tl.textContent = 'TIME OF DAY (EST)';
          var ts = document.createElement('select'); ts.className = 'er-sched-sel';
          for (var h = 0; h < 24; h++) {
            for (var m = 0; m < 60; m += 10) {
              var hh = (h < 10 ? '0' : '') + h, mm = (m < 10 ? '0' : '') + m;
              var val24 = hh + ':' + mm;
              var disp = (h===0?12:h>12?h-12:h) + ':' + mm + ' ' + (h<12?'AM':'PM');
              var to = document.createElement('option'); to.value = val24; to.textContent = disp; if (tod===val24) to.selected=true; ts.appendChild(to);
            }
          }
          ts.addEventListener('change', function() { tod = ts.value; updatePreview(); });
          tc.appendChild(tl); tc.appendChild(ts); row.appendChild(tc);
        }

        if (freq === 'daily') {
          var dc = document.createElement('div'); dc.className = 'er-sched-col';
          var dl = document.createElement('div'); dl.className = 'er-sched-col-label'; dl.textContent = 'DAYS';
          var ds = document.createElement('select'); ds.className = 'er-sched-sel';
          [['every','Every day'],['weekdays','Weekdays'],['weekends','Weekends']].forEach(function(opt) {
            var o = document.createElement('option'); o.value = opt[0]; o.textContent = opt[1]; if (days===opt[0]) o.selected=true; ds.appendChild(o);
          });
          ds.addEventListener('change', function() { days = ds.value; updatePreview(); });
          dc.appendChild(dl); dc.appendChild(ds); row.appendChild(dc);
        }

        if (freq === 'monthly') {
          var mc = document.createElement('div'); mc.className = 'er-sched-col';
          var ml = document.createElement('div'); ml.className = 'er-sched-col-label'; ml.textContent = 'DAY OF MONTH';
          var mi = document.createElement('input'); mi.className = 'er-sched-sel'; mi.type = 'number'; mi.min = '1'; mi.max = '28'; mi.value = dom; mi.style.width = '80px';
          mi.addEventListener('change', function() { dom = Math.max(1, Math.min(28, parseInt(mi.value)||1)); updatePreview(); });
          mc.appendChild(ml); mc.appendChild(mi); row.appendChild(mc);
        }

        container.appendChild(row);
      } else {
        var cc = document.createElement('div'); cc.className = 'er-sched-col'; cc.style.width = '100%';
        var cl = document.createElement('div'); cl.className = 'er-sched-col-label'; cl.textContent = 'CRON EXPRESSION (UTC)';
        var ci = document.createElement('input'); ci.className = 'sf-input'; ci.type = 'text'; ci.value = cronExp; ci.placeholder = '0 7 * * 1-5';
        ci.addEventListener('input', function() { cronExp = ci.value; updatePreview(); });
        cc.appendChild(cl); cc.appendChild(ci); container.appendChild(cc);
      }

      var prev = document.createElement('div'); prev.className = 'er-sched-preview';
      container.appendChild(prev); updatePreview();
    }

    render();
    return {
      getSchedule: function() {
        if (mode === 'simple') {
          if (freq === 'hourly') return {mode:'simple',frequency:'hourly'};
          if (freq === 'monthly') return {mode:'simple',frequency:'monthly',timeOfDayEst:tod,dayOfMonth:dom};
          return {mode:'simple',frequency:'daily',timeOfDayEst:tod,days:days};
        }
        return {mode:'cron',expression:cronExp};
      }
    };
  }

  // ── List view ─────────────────────────────────────────────────────────
  function renderERList() {
    var html = '<div class="er-list-hdr"><div class="modal-title">Email Reports</div><button class="sf-btn primary" id="er-new" style="font-size:11px;">+ New Report</button></div>';
    if (!emailConfigs.length) {
      html += '<div class="er-empty">No reports yet. Click <strong>+ New Report</strong> to create one.</div>';
    } else {
      html += '<table class="er-table"><thead><tr><th style="width:50px;">Active</th><th>Name</th><th>Schedule</th><th>Recipients</th><th></th></tr></thead><tbody>';
      emailConfigs.forEach(function(c, i) {
        var dis = !!c.disabled;
        var sched = c.schedule ? erScheduleDesc(c.schedule) : '<span style="color:var(--text-dim);font-style:italic;">No schedule</span>';
        var rc = (c.recipients||[]).length;
        html += '<tr data-idx="'+i+'"'+(dis?' class="er-disabled"':'')+'>'+
          '<td style="text-align:center;" class="er-cb-cell"><input type="checkbox" class="er-active-cb" data-id="'+c.id+'" data-idx="'+i+'"'+(dis?'':' checked')+'></td>'+
          '<td style="font-weight:600;">'+esc(c.name)+'</td>'+
          '<td>'+sched+'</td>'+
          '<td>'+rc+' recipient'+(rc!==1?'s':'')+'</td>'+
          '<td><div class="er-row-actions">'+
            '<button class="er-icon-btn er-sn-btn" data-id="'+c.id+'" style="color:var(--blue);">&#9654; Send</button>'+
            '<button class="er-icon-btn er-pv-btn" data-id="'+c.id+'" style="font-size:13px;">&#128065;</button>'+
          '</div></td></tr>';
      });
      html += '</tbody></table>';
    }
    erContent.innerHTML = html;
    document.getElementById('er-new').addEventListener('click', function() { renderEREdit(null); });
    erContent.querySelectorAll('tr[data-idx]').forEach(function(row) {
      row.querySelectorAll('td:not(:last-child):not(.er-cb-cell)').forEach(function(td) {
        td.addEventListener('click', function() { renderEREdit(emailConfigs[parseInt(row.dataset.idx)]); });
      });
    });
    erContent.querySelectorAll('.er-active-cb').forEach(function(cb) {
      cb.addEventListener('click', function(e) { e.stopPropagation(); });
      cb.addEventListener('change', function() {
        var id = this.dataset.id; var active = this.checked;
        var cfg = emailConfigs.find(function(c) { return c.id === id; });
        if (!cfg) return;
        var updated = Object.assign({}, cfg, { disabled: !active });
        fetch('/admin/email-reports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(updated)})
          .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})
          .then(function(saved){
            var idx = emailConfigs.findIndex(function(c){return c.id===id;});
            if (idx!==-1) emailConfigs[idx]=saved;
            var row = cb.closest('tr');
            if (row) { if(!active) row.classList.add('er-disabled'); else row.classList.remove('er-disabled'); }
            toast(active?'Report enabled':'Report disabled','info');
          })
          .catch(function(e){ toast(e.message,'error'); cb.checked = !active; });
      });
    });
    erContent.querySelectorAll('.er-sn-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation(); var id = this.dataset.id; var b = this; btnLoad(b,'...');
        fetch('/admin/email-reports/send-now',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id})})
          .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})
          .then(function(){toast('Report sent','success');btnDone(b,'\u25B6 Send');})
          .catch(function(e){toast(e.message,'error');btnDone(b,'\u25B6 Send');});
      });
    });
    erContent.querySelectorAll('.er-pv-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation(); var id = this.dataset.id; var b = this; btnLoad(b,'...');
        fetch('/admin/email-reports/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id})})
          .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})
          .then(function(){btnDone(b,'\uD83D\uDC41');window.open('/admin/email-reports/preview-view?id='+encodeURIComponent(id),'_blank');})
          .catch(function(e){toast(e.message,'error');btnDone(b,'\uD83D\uDC41');});
      });
    });
  }

  // ── Edit view ─────────────────────────────────────────────────────────
  function renderEREdit(config) {
    var isNew = !config; var c = config || {};
    erContent.innerHTML = '';

    // Header
    var hdr = document.createElement('div'); hdr.className = 'er-edit-hdr';
    var left = document.createElement('div'); left.className = 'er-edit-hdr-left';
    var backBtn = document.createElement('button'); backBtn.className = 'er-back'; backBtn.innerHTML = '&#8592;';
    backBtn.addEventListener('click', function() { renderERList(); });
    var titleEl = document.createElement('div'); titleEl.className = 'modal-title'; titleEl.style.marginBottom = '0'; titleEl.textContent = isNew ? 'New Report' : 'Edit Report';
    left.appendChild(backBtn); left.appendChild(titleEl);
    var acts = document.createElement('div'); acts.className = 'er-edit-actions';

    // Preview — always available, uses current form state via inline endpoint
    var pvBtn = document.createElement('button'); pvBtn.className = 'sf-btn secondary'; pvBtn.style.fontSize = '11px'; pvBtn.textContent = '\uD83D\uDC41 Preview';
    pvBtn.addEventListener('click', function() {
      btnLoad(pvBtn,'...');
      var pvSections = [];
      secCont.querySelectorAll('.er-section-card').forEach(function(card) {
        var hi = card.querySelector('.er-sec-hdr'); var cols = [];
        card.querySelectorAll('.er-sec-cols input:checked').forEach(function(cb){cols.push(cb.value);});
        var criteria = [];
        card.querySelectorAll('.er-rule-row').forEach(function(row) {
          var sels = row.querySelectorAll('select'); var val = row.querySelector('.er-rule-val');
          if (val && val.value.trim()) criteria.push({field:sels[0].value,operator:sels[1].value,value:val.value.trim()});
        });
        pvSections.push({header:(hi?hi.value.trim():'')||'Section',criteria:criteria,columns:cols});
      });
      var pvPayload = {
        name: document.getElementById('er-name').value.trim() || c.name || 'Preview',
        onlyCompleted: ocInput.checked,
        dateRange: getDateRange(),
        templateId: document.getElementById('er-tpl').value || undefined,
        topLevelFilters: tlRules.getRules(),
        reportSections: pvSections,
      };
      if (c.id) pvPayload.id = c.id;
      fetch('/admin/email-reports/preview-inline',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pvPayload)})
        .then(function(r){if(!r.ok)return r.json().then(function(e){throw new Error(e.error||'HTTP '+r.status);});return r.text();})
        .then(function(html){
          btnDone(pvBtn,'\uD83D\uDC41 Preview');
          var w = window.open('','_blank');
          if (!w) { toast('Allow popups for this site to view the preview','error'); return; }
          w.document.write(html); w.document.close();
        })
        .catch(function(e){toast(e.message,'error');btnDone(pvBtn,'\uD83D\uDC41 Preview');});
    });
    acts.appendChild(pvBtn);

    // Send Now + Delete — only for saved configs
    if (!isNew) {
      var snBtn = document.createElement('button'); snBtn.className = 'sf-btn secondary'; snBtn.style.fontSize = '11px'; snBtn.textContent = '\u25B6 Send Now';
      snBtn.addEventListener('click', function() {
        btnLoad(snBtn,'...');
        fetch('/admin/email-reports/send-now',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:c.id})})
          .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})
          .then(function(){toast('Sent','success');btnDone(snBtn,'\u25B6 Send Now');})
          .catch(function(e){toast(e.message,'error');btnDone(snBtn,'\u25B6 Send Now');});
      });
      var delBtn = document.createElement('button'); delBtn.className = 'sf-btn danger'; delBtn.style.fontSize = '11px'; delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', function() {
        if (!confirm('Delete this report?')) return;
        fetch('/admin/email-reports/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:c.id})})
          .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})
          .then(function(){emailConfigs=emailConfigs.filter(function(x){return x.id!==c.id;});toast('Deleted','info');renderERList();})
          .catch(function(e){toast(e.message,'error');});
      });
      acts.appendChild(snBtn); acts.appendChild(delBtn);
    }

    hdr.appendChild(left); hdr.appendChild(acts); erContent.appendChild(hdr);

    // Status toggle
    var statusRow = document.createElement('div'); statusRow.className = 'er-status-row';
    var toggleWrap = document.createElement('label'); toggleWrap.className = 'er-toggle';
    var toggleInput = document.createElement('input'); toggleInput.type = 'checkbox'; toggleInput.id = 'er-enabled'; toggleInput.checked = !c.disabled;
    var toggleSlider = document.createElement('span'); toggleSlider.className = 'er-toggle-slider';
    toggleWrap.appendChild(toggleInput); toggleWrap.appendChild(toggleSlider);
    var toggleLbl = document.createElement('span'); toggleLbl.className = 'er-toggle-label';
    toggleLbl.textContent = !c.disabled ? 'Active \u2014 will send on schedule' : 'Disabled \u2014 will not auto-send';
    toggleInput.addEventListener('change', function() {
      toggleLbl.textContent = toggleInput.checked ? 'Active \u2014 will send on schedule' : 'Disabled \u2014 will not auto-send';
    });
    statusRow.appendChild(toggleWrap); statusRow.appendChild(toggleLbl); erContent.appendChild(statusRow);

    // Name
    var nameWrap = document.createElement('div'); nameWrap.className = 'sf';
    nameWrap.innerHTML = '<label class="sf-label">Report Name</label><input type="text" class="sf-input" id="er-name" value="'+esc(c.name||'')+'" placeholder="e.g. Daily MCC Non-Compliant">';
    erContent.appendChild(nameWrap);

    // Schedule
    var schedToggleRow = document.createElement('div'); schedToggleRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:4px;';
    var schedCb = document.createElement('input'); schedCb.type = 'checkbox'; schedCb.id = 'er-sched-on'; schedCb.checked = !!c.schedule; schedCb.style.accentColor = 'var(--blue)';
    var schedCbLbl = document.createElement('label'); schedCbLbl.htmlFor = 'er-sched-on'; schedCbLbl.className = 'sf-label'; schedCbLbl.style.cssText = 'margin-bottom:0;cursor:pointer;'; schedCbLbl.textContent = 'Enable Schedule';
    schedToggleRow.appendChild(schedCb); schedToggleRow.appendChild(schedCbLbl); erContent.appendChild(schedToggleRow);
    var schedBlock = document.createElement('div'); schedBlock.className = 'er-sched-block'; schedBlock.style.display = c.schedule ? 'block' : 'none';
    var schedBlockLbl = document.createElement('div'); schedBlockLbl.className = 'er-sched-label'; schedBlockLbl.textContent = 'SCHEDULE';
    var schedInner = document.createElement('div');
    schedBlock.appendChild(schedBlockLbl); schedBlock.appendChild(schedInner);
    var schedCtrl = erBuildSchedule(schedInner, c.schedule || null);
    schedCb.addEventListener('change', function() { schedBlock.style.display = schedCb.checked ? 'block' : 'none'; });
    erContent.appendChild(schedBlock);

    // Template
    var tplWrap = document.createElement('div'); tplWrap.className = 'sf'; tplWrap.style.marginTop = '14px';
    var tplLbl = document.createElement('label'); tplLbl.className = 'sf-label'; tplLbl.textContent = 'Email Template';
    var tplSel = document.createElement('select'); tplSel.className = 'sf-input'; tplSel.id = 'er-tpl';
    var tplNone = document.createElement('option'); tplNone.value = ''; tplNone.textContent = 'None (use default dark template)'; tplSel.appendChild(tplNone);
    erTemplates.forEach(function(t) {
      var o = document.createElement('option'); o.value = t.id; o.textContent = t.name; if (c.templateId === t.id) o.selected = true; tplSel.appendChild(o);
    });
    var tplHint = document.createElement('div'); tplHint.style.cssText = 'font-size:10px;color:var(--text-dim);margin-top:4px;';
    tplHint.innerHTML = 'Add <code style="background:var(--bg-surface);padding:1px 5px;border-radius:3px;">{{sections}}</code> in your template where the report tables should appear.';
    tplWrap.appendChild(tplLbl); tplWrap.appendChild(tplSel); tplWrap.appendChild(tplHint); erContent.appendChild(tplWrap);

    // Recipients / CC / BCC
    var chipCtrls = {};
    [{field:'recipients',label:'Recipients'},{field:'cc',label:'CC'},{field:'bcc',label:'BCC'}].forEach(function(item) {
      var wrap = document.createElement('div'); wrap.className = 'sf';
      var lbl = document.createElement('label'); lbl.className = 'sf-label'; lbl.textContent = item.label;
      var chipWrap = document.createElement('div'); chipWrap.className = 'er-chip-wrap'; chipWrap.id = 'er-chips-'+item.field;
      wrap.appendChild(lbl); wrap.appendChild(chipWrap); erContent.appendChild(wrap);
      chipCtrls[item.field] = erChipInput(chipWrap, c[item.field] || []);
    });

    // ── onlyCompleted toggle ───────────────────────────────────────────────
    var ocSep = document.createElement('div'); ocSep.className = 'sf-sep'; erContent.appendChild(ocSep);
    var ocRow = document.createElement('div'); ocRow.className = 'er-status-row';
    var ocWrap = document.createElement('label'); ocWrap.className = 'er-toggle';
    var ocInput = document.createElement('input'); ocInput.type = 'checkbox'; ocInput.id = 'er-only-completed';
    ocInput.checked = c.onlyCompleted !== false;
    var ocSlider = document.createElement('span'); ocSlider.className = 'er-toggle-slider';
    ocWrap.appendChild(ocInput); ocWrap.appendChild(ocSlider);
    var ocLbl = document.createElement('span'); ocLbl.className = 'er-toggle-label';
    function updateOcLabel() {
      ocLbl.textContent = ocInput.checked
        ? 'Completed audits only'
        : 'All audits \u2014 in-review rows labeled';
    }
    updateOcLabel();
    ocInput.addEventListener('change', function() {
      updateOcLabel();
      document.querySelectorAll('.er-status-col-lbl').forEach(function(el) {
        el.style.display = ocInput.checked ? 'none' : '';
      });
    });
    ocRow.appendChild(ocWrap); ocRow.appendChild(ocLbl); erContent.appendChild(ocRow);

    // ── Date range widget ──────────────────────────────────────────────────
    var dr = c.dateRange || { mode: 'rolling', hours: 24 };
    var drMode = dr.mode || 'rolling';

    var drBlock = document.createElement('div');
    drBlock.style.cssText = 'border:1px solid var(--border);border-left:3px solid var(--blue);border-radius:8px;padding:14px 16px;margin-bottom:14px;background:rgba(88,166,255,0.04);';
    var drLbl = document.createElement('div');
    drLbl.style.cssText = 'font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:var(--blue);margin-bottom:10px;';
    drLbl.textContent = 'DATE RANGE';

    var drModes = document.createElement('div'); drModes.style.cssText = 'display:flex;gap:6px;margin-bottom:12px;';
    var drTabRolling = document.createElement('button'); drTabRolling.className = 'wh-tab'; drTabRolling.textContent = 'Rolling'; drTabRolling.type = 'button';
    var drTabFixed = document.createElement('button'); drTabFixed.className = 'wh-tab'; drTabFixed.textContent = 'Fixed'; drTabFixed.type = 'button';
    drModes.appendChild(drTabRolling); drModes.appendChild(drTabFixed);

    // Rolling inputs
    var drRolling = document.createElement('div'); drRolling.style.cssText = 'display:flex;align-items:center;gap:8px;';
    var drHoursInput = document.createElement('input'); drHoursInput.type = 'number'; drHoursInput.className = 'sf-input num'; drHoursInput.min = '1'; drHoursInput.step = '1';
    var drUnitSel = document.createElement('select'); drUnitSel.className = 'sf-input'; drUnitSel.style.cssText = 'width:auto;padding:6px 9px;';
    ['hours','days'].forEach(function(u) { var o = document.createElement('option'); o.value = u; o.textContent = u; drUnitSel.appendChild(o); });
    var initHours = (dr.mode === 'rolling') ? (dr.hours || 24) : 24;
    if (initHours % 24 === 0 && initHours >= 24) { drHoursInput.value = String(initHours / 24); drUnitSel.value = 'days'; }
    else { drHoursInput.value = String(initHours); drUnitSel.value = 'hours'; }
    drRolling.appendChild(drHoursInput); drRolling.appendChild(drUnitSel);

    // Fixed inputs
    var drFixed = document.createElement('div'); drFixed.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
    function tsToLocal(ts) {
      if (!ts) return '';
      var d = new Date(ts); var pad = function(n) { return n < 10 ? '0'+n : String(n); };
      return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes());
    }
    var drFromRow = document.createElement('div'); drFromRow.style.cssText = 'display:flex;align-items:center;gap:8px;';
    var drFromLbl = document.createElement('label'); drFromLbl.className = 'sf-label'; drFromLbl.style.cssText = 'margin-bottom:0;min-width:36px;'; drFromLbl.textContent = 'From';
    var drFromInput = document.createElement('input'); drFromInput.type = 'datetime-local'; drFromInput.className = 'sf-input'; drFromInput.style.cssText = 'flex:1;font-size:12px;padding:5px 8px;color-scheme:dark;';
    if (dr.mode === 'fixed' && dr.from) drFromInput.value = tsToLocal(dr.from);
    drFromRow.appendChild(drFromLbl); drFromRow.appendChild(drFromInput);
    var drToRow = document.createElement('div'); drToRow.style.cssText = 'display:flex;align-items:center;gap:8px;';
    var drToLbl = document.createElement('label'); drToLbl.className = 'sf-label'; drToLbl.style.cssText = 'margin-bottom:0;min-width:36px;'; drToLbl.textContent = 'To';
    var drToInput = document.createElement('input'); drToInput.type = 'datetime-local'; drToInput.className = 'sf-input'; drToInput.style.cssText = 'flex:1;font-size:12px;padding:5px 8px;color-scheme:dark;';
    if (dr.mode === 'fixed' && dr.to) drToInput.value = tsToLocal(dr.to);
    drToRow.appendChild(drToLbl); drToRow.appendChild(drToInput);
    drFixed.appendChild(drFromRow); drFixed.appendChild(drToRow);

    function updateDrTabs() {
      if (drMode === 'rolling') {
        drTabRolling.classList.add('active'); drTabFixed.classList.remove('active');
        drRolling.style.display = ''; drFixed.style.display = 'none';
      } else {
        drTabFixed.classList.add('active'); drTabRolling.classList.remove('active');
        drFixed.style.display = ''; drRolling.style.display = 'none';
      }
    }
    drTabRolling.addEventListener('click', function() { drMode = 'rolling'; updateDrTabs(); });
    drTabFixed.addEventListener('click', function() { drMode = 'fixed'; updateDrTabs(); });

    drBlock.appendChild(drLbl); drBlock.appendChild(drModes); drBlock.appendChild(drRolling); drBlock.appendChild(drFixed);
    updateDrTabs();
    erContent.appendChild(drBlock);

    function getDateRange() {
      if (drMode === 'rolling') {
        var n = parseInt(drHoursInput.value, 10) || 24;
        return { mode: 'rolling', hours: drUnitSel.value === 'days' ? n * 24 : n };
      }
      var fromTs = drFromInput.value ? new Date(drFromInput.value).getTime() : 0;
      var toTs = drToInput.value ? new Date(drToInput.value).getTime() : 0;
      if (!fromTs || !toTs) return { mode: 'rolling', hours: 24 };
      return { mode: 'fixed', from: fromTs, to: toTs };
    }

    // Top-level filters
    var tlBlock = document.createElement('div'); tlBlock.className = 'er-filter-block';
    var tlLbl = document.createElement('div'); tlLbl.className = 'er-filter-label'; tlLbl.textContent = 'TOP-LEVEL FILTERS';
    var tlHint = document.createElement('div'); tlHint.className = 'er-filter-hint'; tlHint.textContent = 'Return only audits matching all of these rules. Each section then further narrows this set.';
    var tlCont = document.createElement('div'); var tlRules = erBuildRuleList(c.topLevelFilters, tlCont);
    tlBlock.appendChild(tlLbl); tlBlock.appendChild(tlHint); tlBlock.appendChild(tlCont); erContent.appendChild(tlBlock);

    // Report sections
    var secHdr = document.createElement('div'); secHdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;';
    var secHdrLbl = document.createElement('div'); secHdrLbl.className = 'sf-label'; secHdrLbl.style.marginBottom = '0'; secHdrLbl.textContent = 'Report Sections';
    var addSecBtn = document.createElement('button'); addSecBtn.className = 'sf-btn secondary'; addSecBtn.style.fontSize = '11px'; addSecBtn.textContent = '+ Add Section';
    secHdr.appendChild(secHdrLbl); secHdr.appendChild(addSecBtn); erContent.appendChild(secHdr);
    var secCont = document.createElement('div'); secCont.id = 'er-sec-container'; erContent.appendChild(secCont);
    (c.reportSections || []).forEach(function(sec) { erBuildSectionCard(sec, secCont); });
    addSecBtn.addEventListener('click', function() { erBuildSectionCard(null, secCont); });

    // Save / Cancel
    var actBar = document.createElement('div'); actBar.className = 'modal-actions';
    var cancelBtn = document.createElement('button'); cancelBtn.className = 'sf-btn secondary'; cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', function() { erModal.classList.remove('open'); });
    var saveBtn = document.createElement('button'); saveBtn.className = 'sf-btn primary'; saveBtn.textContent = 'Save Report';
    saveBtn.addEventListener('click', function() {
      var name = document.getElementById('er-name').value.trim();
      if (!name) { toast('Report name required','error'); return; }
      var recips = chipCtrls.recipients.getValues();
      if (!recips.length) { toast('At least one recipient required','error'); return; }
      var sections = [];
      secCont.querySelectorAll('.er-section-card').forEach(function(card) {
        var hi = card.querySelector('.er-sec-hdr'); var cols = [];
        card.querySelectorAll('.er-sec-cols input:checked').forEach(function(cb){cols.push(cb.value);});
        var criteria = [];
        card.querySelectorAll('.er-rule-row').forEach(function(row) {
          var sels = row.querySelectorAll('select'); var val = row.querySelector('.er-rule-val');
          if (val && val.value.trim()) criteria.push({field:sels[0].value,operator:sels[1].value,value:val.value.trim()});
        });
        sections.push({header:(hi?hi.value.trim():'')||'Section',criteria:criteria,columns:cols});
      });
      var payload = {
        name: name, disabled: !document.getElementById('er-enabled').checked,
        onlyCompleted: ocInput.checked,
        dateRange: getDateRange(),
        recipients: recips, cc: chipCtrls.cc.getValues(), bcc: chipCtrls.bcc.getValues(),
        templateId: document.getElementById('er-tpl').value || undefined,
        schedule: document.getElementById('er-sched-on').checked ? schedCtrl.getSchedule() : undefined,
        topLevelFilters: tlRules.getRules(), reportSections: sections,
      };
      if (c.id) { payload.id = c.id; payload.createdAt = c.createdAt; }
      btnLoad(saveBtn,'Saving\u2026');
      fetch('/admin/email-reports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
        .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})
        .then(function(saved){
          if (c.id) { for(var i=0;i<emailConfigs.length;i++){if(emailConfigs[i].id===saved.id){emailConfigs[i]=saved;break;}} }
          else { emailConfigs.push(saved); }
          toast('Report saved','success'); btnDone(saveBtn,'Save Report'); renderERList();
        })
        .catch(function(e){toast(e.message,'error');btnDone(saveBtn,'Save Report');});
    });
    actBar.appendChild(cancelBtn); actBar.appendChild(saveBtn); erContent.appendChild(actBar);
  }

  function loadEmailConfigs() {
    return fetch('/admin/email-reports').then(function(r){return r.json();}).then(function(d){emailConfigs=Array.isArray(d)?d:[];});
  }
  function loadERTemplates() {
    return fetch('/admin/email-templates').then(function(r){return r.json();}).then(function(d){erTemplates=Array.isArray(d)?d:[];}).catch(function(){erTemplates=[];});
  }

  document.getElementById('email-reports-open').addEventListener('click', function() {
    erModal.classList.add('open');
    Promise.all([loadEmailConfigs(), loadERTemplates()]).then(function(){ renderERList(); }).catch(function(){ renderERList(); });
  });
  var erModalDownOnBackdrop = false;
  erModal.addEventListener('mousedown', function(e) { erModalDownOnBackdrop = e.target === erModal; });
  erModal.addEventListener('click', function(e) { if (erModalDownOnBackdrop && e.target === erModal) erModal.classList.remove('open'); });

  // ===== Email Templates =====
  console.log('[ET] init — openModal:', typeof openModal, '| backdropClose:', typeof backdropClose, '| closeModal:', typeof closeModal);
  var etTemplates = [];
  var etCurrentId = null;

  function etRenderList() {
    var list = document.getElementById('et-list');
    if (!etTemplates.length) {
      list.innerHTML = '<div style="color:var(--text-dim);font-size:10px;padding:8px 4px;">No templates yet</div>';
      return;
    }
    list.innerHTML = etTemplates.map(function(t) {
      var active = t.id === etCurrentId;
      return '<div class="et-item" data-id="' + t.id + '" style="padding:8px 10px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;color:' + (active ? 'var(--text-bright)' : 'var(--text-muted)') + ';background:' + (active ? 'var(--bg-surface)' : 'transparent') + ';margin-bottom:2px;transition:all 0.1s;">' + esc(t.name) + '</div>';
    }).join('');
    list.querySelectorAll('.et-item').forEach(function(el) {
      el.addEventListener('click', function() { etLoadTemplate(this.getAttribute('data-id')); });
    });
  }

  function etShowWebhookInfo(id) {
    var info = document.getElementById('et-webhook-info');
    if (!id) { info.style.display = 'none'; return; }
    var orgId = currentOrgId || 'YOUR_ORG_ID';
    var base = window.location.origin + '/webhooks/audit-complete?org=' + encodeURIComponent(orgId) + '&template=' + encodeURIComponent(id);
    var liveUrl = base;
    var testUrl = base + '&test=YOUR_EMAIL';
    document.getElementById('et-id-display').textContent = id;
    document.getElementById('et-url-live').textContent = liveUrl;
    document.getElementById('et-url-test').textContent = testUrl;
    info.style.display = '';
  }

  function etCopyText(text, btn) {
    navigator.clipboard.writeText(text).then(function() {
      var orig = btn.textContent;
      btn.textContent = 'Copied!';
      btn.style.color = 'var(--green)';
      setTimeout(function() { btn.textContent = orig; btn.style.color = ''; }, 1500);
    }).catch(function() { toast('Copy failed', 'error'); });
  }

  // Register copy button handlers (null-guarded)
  var elCopyId = document.getElementById('et-copy-id');
  var elCopyLive = document.getElementById('et-copy-live');
  var elCopyTest = document.getElementById('et-copy-test');
  if (elCopyId) elCopyId.addEventListener('click', function() { etCopyText(document.getElementById('et-id-display').textContent, this); });
  if (elCopyLive) elCopyLive.addEventListener('click', function() { etCopyText(document.getElementById('et-url-live').textContent, this); });
  if (elCopyTest) elCopyTest.addEventListener('click', function() { etCopyText(document.getElementById('et-url-test').textContent, this); });

  function etLoadTemplate(id) {
    var t = etTemplates.find(function(x) { return x.id === id; });
    if (!t) return;
    etCurrentId = id;
    document.getElementById('et-name').value = t.name;
    document.getElementById('et-subject').value = t.subject;
    document.getElementById('et-html').value = t.html;
    document.getElementById('et-delete-btn').disabled = false;
    etUpdatePreview();
    etShowWebhookInfo(id);
    etRenderList();
  }

  function etUpdatePreview() {
    var html = document.getElementById('et-html').value;
    html = html.replace(/\{\{logoUrl\}\}/g, '/logo.png');
    document.getElementById('et-preview').srcdoc = html;
  }

  function etNewTemplate() {
    etCurrentId = null;
    document.getElementById('et-name').value = '';
    document.getElementById('et-subject').value = '';
    document.getElementById('et-html').value = '';
    document.getElementById('et-delete-btn').disabled = true;
    document.getElementById('et-preview').srcdoc = '';
    etShowWebhookInfo(null);
    etRenderList();
  }

  function etFetch() {
    console.log('[ET] fetching templates...');
    return fetch('/admin/email-templates')
      .then(function(r) {
        console.log('[ET] fetch status:', r.status);
        return r.json();
      })
      .then(function(d) {
        console.log('[ET] fetch result:', d);
        etTemplates = Array.isArray(d) ? d : [];
        etRenderList();
      })
      .catch(function(e) { console.error('[ET] fetch error:', e); });
  }

  var etOpenBtn = document.getElementById('email-templates-open');
  console.log('[ET] open button element:', etOpenBtn);
  if (etOpenBtn) {
    etOpenBtn.addEventListener('click', function() {
      console.log('[ET] open clicked — openModal type:', typeof openModal);
      try {
        openModal('email-templates-modal');
        console.log('[ET] openModal succeeded');
      } catch(e) { console.error('[ET] openModal failed:', e); }
      etFetch();
    });
  } else {
    console.error('[ET] email-templates-open element NOT FOUND in DOM');
  }
  var etCancelBtn = document.getElementById('email-templates-cancel');
  if (etCancelBtn) etCancelBtn.addEventListener('click', function() { closeModal('email-templates-modal'); });
  try { backdropClose('email-templates-modal'); } catch(e) { console.error('[ET] backdropClose failed:', e); }
  document.getElementById('et-new-btn').addEventListener('click', etNewTemplate);
  document.getElementById('et-html').addEventListener('input', etUpdatePreview);

  document.getElementById('et-save-btn').addEventListener('click', function() {
    var btn = this;
    var name = document.getElementById('et-name').value.trim();
    var subject = document.getElementById('et-subject').value.trim();
    var html = document.getElementById('et-html').value;
    if (!name || !subject || !html) { toast('Name, subject, and HTML are required', 'error'); return; }
    btn.disabled = true; btn.textContent = 'Saving...';
    var payload = { name: name, subject: subject, html: html };
    if (etCurrentId) payload.id = etCurrentId;
    fetch('/admin/email-templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.error) { toast(d.error, 'error'); }
        else { etCurrentId = d.id; etShowWebhookInfo(d.id); toast('Template saved', 'success'); etFetch().then(function() { etRenderList(); }); }
      })
      .catch(function() { toast('Save failed', 'error'); })
      .finally(function() { btn.disabled = false; btn.textContent = 'Save'; });
  });

  document.getElementById('et-delete-btn').addEventListener('click', function() {
    if (!etCurrentId || !confirm('Delete this template? This cannot be undone.')) return;
    var btn = this;
    btn.disabled = true;
    fetch('/admin/email-templates/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: etCurrentId }) })
      .then(function(r) { return r.json(); })
      .then(function() { etNewTemplate(); return etFetch(); })
      .then(function() { toast('Template deleted', 'success'); })
      .catch(function() { toast('Delete failed', 'error'); btn.disabled = false; });
  });

  // ===== Chargebacks & Omissions / Wire Deductions =====
  var cbData = { chargebacks: [], omissions: [] };
  var wireData = { items: [] };
  var rptActiveTab = 'cb';
  var qbDateUrl = 'https://monsterrg.quickbase.com/nav/app/bmhvhc7sk/table/bpb28qsnn/action/dr?rid=';
  var qbPkgUrl = 'https://monsterrg.quickbase.com/nav/app/bmhvhc7sk/table/bttffb64u/action/dr?rid=';

  function rptSwitchTab(tab) {
    rptActiveTab = tab;
    document.getElementById('rpt-tab-cb').style.color = tab === 'cb' ? 'var(--blue)' : 'var(--text-dim)';
    document.getElementById('rpt-tab-cb').style.borderBottomColor = tab === 'cb' ? 'var(--blue)' : 'transparent';
    document.getElementById('rpt-tab-wire').style.color = tab === 'wire' ? 'var(--blue)' : 'var(--text-dim)';
    document.getElementById('rpt-tab-wire').style.borderBottomColor = tab === 'wire' ? 'var(--blue)' : 'transparent';
    document.getElementById('rpt-panel-cb').style.display = tab === 'cb' ? '' : 'none';
    document.getElementById('rpt-panel-wire').style.display = tab === 'wire' ? '' : 'none';
    rptUpdateButtons();
  }

  function rptUpdateButtons() {
    var hasCb = cbData.chargebacks.length || cbData.omissions.length;
    var hasWire = wireData.items.length;
    var hasData = rptActiveTab === 'cb' ? hasCb : hasWire;
    document.getElementById('cb-download-btn').disabled = !hasData;
    document.getElementById('cb-post-btn').disabled = !hasData;
  }

  function cbPrevMonday() {
    var d = new Date();
    var day = d.getDay();
    var diffToLastMon = day === 0 ? 6 : day - 1;
    var mon = new Date(d);
    mon.setDate(d.getDate() - diffToLastMon - 7);
    mon.setHours(0,0,0,0);
    return mon;
  }

  function cbPrevSunday() {
    var mon = cbPrevMonday();
    var sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    sun.setHours(23,59,59,999);
    return sun;
  }

  function toInputDate(d) {
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }

  document.getElementById('cb-date-from').value = toInputDate(cbPrevMonday());
  document.getElementById('cb-date-to').value = toInputDate(cbPrevSunday());

  function cbFmtDate(ts) {
    var d = new Date(ts);
    return (d.getMonth()+1) + '/' + d.getDate() + '/' + String(d.getFullYear()).slice(2) + ' ' +
      d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }

  function cbFmtRevenue(r) {
    if (!r) return '';
    var n = parseFloat(r);
    return isNaN(n) ? r : '$' + n.toFixed(2);
  }

  function cbTeamMember(entry) {
    return entry.voName || entry.destination || '';
  }

  function cbRenderRows(tbodyId, rows, type) {
    var tbody = document.getElementById(tbodyId);
    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="6" style="padding:12px 10px;color:var(--text-dim);">None</td></tr>'; return; }
    tbody.innerHTML = rows.map(function(e) {
      var crmLink = e.recordId ? '<a href="' + qbDateUrl + encodeURIComponent(e.recordId) + '" target="_blank" style="color:var(--blue);text-decoration:none;">CRM</a>' : '';
      var tm = cbTeamMember(e).replace(/</g,'&lt;');
      var fq = (e.failedQHeaders || []).join(', ').replace(/</g,'&lt;');
      return '<tr style="border-bottom:1px solid var(--border);">' +
        '<td style="padding:6px 10px;color:var(--text);">' + cbFmtDate(e.ts) + '</td>' +
        '<td style="padding:6px 10px;color:var(--text-bright);font-weight:500;">' + tm + '</td>' +
        '<td style="padding:6px 10px;color:var(--green);">' + cbFmtRevenue(e.revenue) + '</td>' +
        '<td style="padding:6px 10px;">' + crmLink + '</td>' +
        '<td style="padding:6px 10px;font-weight:600;color:' + (type === 'Chargeback' ? 'var(--red)' : 'var(--yellow)') + ';">' + type + '</td>' +
        '<td style="padding:6px 10px;color:var(--text-dim);">' + fq + '</td>' +
        '</tr>';
    }).join('');
  }

  function cbRender() {
    var cbs = cbData.chargebacks;
    var oms = cbData.omissions;
    document.getElementById('cb-empty').style.display = (cbs.length || oms.length) ? 'none' : '';
    document.getElementById('cb-chargebacks-block').style.display = cbs.length ? '' : 'none';
    document.getElementById('cb-omissions-block').style.display = oms.length ? '' : 'none';
    document.getElementById('cb-cb-heading').textContent = 'Chargebacks (' + cbs.length + ')';
    document.getElementById('cb-om-heading').textContent = 'Omissions (' + oms.length + ')';
    cbRenderRows('cb-cb-body', cbs, 'Chargeback');
    cbRenderRows('cb-om-body', oms, 'Omission');
    rptUpdateButtons();
  }

  function wireRender() {
    var items = wireData.items;
    document.getElementById('wire-empty').style.display = items.length ? 'none' : '';
    document.getElementById('wire-block').style.display = items.length ? '' : 'none';
    document.getElementById('wire-heading').textContent = 'Wire Deductions (' + items.length + ')';
    var tbody = document.getElementById('wire-body');
    if (!items.length) { tbody.innerHTML = ''; rptUpdateButtons(); return; }
    tbody.innerHTML = items.map(function(e) {
      var crmLink = e.recordId ? '<a href="' + qbPkgUrl + encodeURIComponent(e.recordId) + '" target="_blank" style="color:var(--blue);text-decoration:none;">CRM</a>' : '';
      var auditLink = e.findingId ? '<a href="/audit/report?id=' + encodeURIComponent(e.findingId) + '" target="_blank" style="color:var(--blue);text-decoration:none;">Audit</a>' : '';
      return '<tr style="border-bottom:1px solid var(--border);">' +
        '<td style="padding:6px 10px;color:var(--text);">' + cbFmtDate(e.ts) + '</td>' +
        '<td style="padding:6px 10px;color:var(--text-bright);font-weight:500;">' + e.score + '%</td>' +
        '<td style="padding:6px 10px;color:var(--text);">' + e.questionsAudited + '</td>' +
        '<td style="padding:6px 10px;color:var(--green);">' + e.totalSuccess + '</td>' +
        '<td style="padding:6px 10px;">' + crmLink + '</td>' +
        '<td style="padding:6px 10px;">' + auditLink + '</td>' +
        '<td style="padding:6px 10px;color:var(--text);">' + (e.office||'').replace(/</g,'&lt;') + '</td>' +
        '<td style="padding:6px 10px;color:var(--text-dim);">' + (e.excellenceAuditor||'').replace(/</g,'&lt;') + '</td>' +
        '<td style="padding:6px 10px;color:var(--text-dim);">' + (e.guestName||'').replace(/</g,'&lt;') + '</td>' +
        '</tr>';
    }).join('');
    rptUpdateButtons();
  }

  document.getElementById('chargebacks-open').addEventListener('click', function() {
    openModal('chargebacks-modal');
  });
  document.getElementById('chargebacks-cancel').addEventListener('click', function() { closeModal('chargebacks-modal'); });
  backdropClose('chargebacks-modal');

  document.getElementById('cb-fetch-btn').addEventListener('click', function() {
    var btn = this;
    var fromVal = document.getElementById('cb-date-from').value;
    var toVal = document.getElementById('cb-date-to').value;
    if (!fromVal || !toVal) { toast('Select both dates', 'error'); return; }
    var since = new Date(fromVal + 'T00:00:00').getTime();
    var until = new Date(toVal + 'T23:59:59').getTime();
    if (since > until) { toast('From date must be before To date', 'error'); return; }
    btn.disabled = true; btn.textContent = 'Loading...';
    var url = rptActiveTab === 'cb'
      ? '/admin/chargebacks?since=' + since + '&until=' + until
      : '/admin/wire-deductions?since=' + since + '&until=' + until;
    fetch(url)
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.error) { toast(d.error, 'error'); return; }
        if (rptActiveTab === 'cb') { cbData = d; cbRender(); }
        else { wireData = d; wireRender(); }
      })
      .catch(function() { toast('Fetch failed', 'error'); })
      .finally(function() { btn.disabled = false; btn.textContent = 'Pull Report'; });
  });

  function cbBuildRows(entries, type) {
    return entries.map(function(e) {
      return {
        Date: cbFmtDate(e.ts),
        'Team Member': cbTeamMember(e),
        Revenue: cbFmtRevenue(e.revenue),
        'CRM Link': e.recordId ? (qbDateUrl + e.recordId) : '',
        'Chargeback/Omission': type,
        'Failed Questions': (e.failedQHeaders || []).join('; '),
      };
    });
  }

  function wireBuildRows(items) {
    return items.map(function(e) {
      return {
        Timestamp: cbFmtDate(e.ts),
        Score: e.score + '%',
        'Questions Audited': e.questionsAudited,
        'Total Success': e.totalSuccess,
        'CRM Hyperlink': e.recordId ? (qbPkgUrl + e.recordId) : '',
        'Recording Hyperlink': e.findingId ? ('/audit/report?id=' + e.findingId) : '',
        Office: e.office || '',
        'Excellence Auditor': e.excellenceAuditor || '',
        'Date of Booking': '',
        'Guest Name': e.guestName || '',
      };
    });
  }

  function rptDownloadCsv(rows, headers, filename) {
    var csv = [headers.join(',')].concat(rows.map(function(r) {
      return headers.map(function(h) {
        var v = String(r[h] != null ? r[h] : '').replace(/"/g,'""');
        return '"' + v + '"';
      }).join(',');
    })).join('\\n');
    var blob = new Blob([csv], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
  }

  function rptDownloadXlsx(rows, headers, filename) {
    var doIt = function() {
      var wb = XLSX.utils.book_new();
      var ws = XLSX.utils.json_to_sheet(rows, { header: headers });
      XLSX.utils.book_append_sheet(wb, ws, 'Report');
      XLSX.writeFile(wb, filename);
    };
    if (typeof XLSX !== 'undefined') { doIt(); return; }
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js';
    s.onload = doIt;
    s.onerror = function() { toast('Failed to load XLSX library', 'error'); };
    document.head.appendChild(s);
  }

  document.getElementById('cb-download-btn').addEventListener('click', function() {
    var fmt = document.getElementById('cb-format').value;
    if (rptActiveTab === 'cb') {
      var rows = cbBuildRows(cbData.chargebacks, 'Chargeback').concat(cbBuildRows(cbData.omissions, 'Omission'));
      var headers = ['Date','Team Member','Revenue','CRM Link','Chargeback/Omission','Failed Questions'];
      if (fmt === 'csv') rptDownloadCsv(rows, headers, 'chargebacks-omissions.csv');
      else rptDownloadXlsx(rows, headers, 'chargebacks-omissions.xlsx');
    } else {
      var wrows = wireBuildRows(wireData.items);
      var wheaders = ['Timestamp','Score','Questions Audited','Total Success','CRM Hyperlink','Recording Hyperlink','Office','Excellence Auditor','Date of Booking','Guest Name'];
      if (fmt === 'csv') rptDownloadCsv(wrows, wheaders, 'wire-deductions.csv');
      else rptDownloadXlsx(wrows, wheaders, 'wire-deductions.xlsx');
    }
  });

  document.getElementById('cb-post-btn').addEventListener('click', function() {
    var btn = this;
    var fromVal = document.getElementById('cb-date-from').value;
    var toVal = document.getElementById('cb-date-to').value;
    if (!fromVal || !toVal) { toast('Select both dates', 'error'); return; }
    var since = new Date(fromVal + 'T00:00:00').getTime();
    var until = new Date(toVal + 'T23:59:59').getTime();
    var tabs = rptActiveTab === 'cb' ? 'chargebacks,omissions' : 'wire';
    btn.disabled = true; btn.textContent = 'Posting...';
    fetch('/admin/post-to-sheet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ since: since, until: until, tabs: tabs }),
    })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.error) { toast(d.error, 'error'); return; }
        toast('Posted to sheet ✓', 'success');
      })
      .catch(function() { toast('Post failed', 'error'); })
      .finally(function() { btn.disabled = false; btn.textContent = 'Post to Sheet'; });
  });

  // ===== Purge Audit Data =====
  document.getElementById('purge-open').addEventListener('click', function() { openModal('purge-modal'); });
  document.getElementById('purge-cancel').addEventListener('click', function() { closeModal('purge-modal'); });
  backdropClose('purge-modal');

  document.getElementById('purge-confirm-btn').addEventListener('click', function() {
    var fromVal = document.getElementById('purge-date-from').value;
    var toVal = document.getElementById('purge-date-to').value;
    if (!toVal) { toast('Select at least a To date', 'error'); return; }
    var since = fromVal ? new Date(fromVal + 'T00:00:00').getTime() : 0;
    var before = new Date(toVal + 'T23:59:59.999').getTime(); // inclusive: end of To date
    if (since && since >= before) { toast('From must be before To', 'error'); return; }
    var rangeLabel = (fromVal || 'epoch') + ' to ' + toVal;
    if (!confirm('Permanently delete ALL audit data from ' + rangeLabel + '? This cannot be undone.')) return;
    var btn = this;
    btn.disabled = true; btn.textContent = 'Purging...';
    document.getElementById('purge-msg').textContent = '';
    fetch('/admin/purge-old-audits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ since: since || undefined, before: before }),
    })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.error) { toast(d.error, 'error'); return; }
        var msg = 'Purged: ' + d.completed + ' audit history, ' + d.chargebacks + ' chargeback/omission, ' + d.wire + ' wire deduction records';
        document.getElementById('purge-msg').textContent = msg;
        toast(msg, 'success');
      })
      .catch(function() { toast('Purge failed', 'error'); })
      .finally(function() { btn.disabled = false; btn.textContent = 'Purge'; });
  });

  // ===== Bad Words =====
  var bwConfig = { enabled: false, allOffices: false, emails: [], words: [], officePatterns: [] };

  function bwRenderTag(text, onRemove) {
    var el = document.createElement('div');
    el.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:var(--bg-surface);border:1px solid var(--border);border-radius:6px;font-size:11px;color:var(--text-bright);';
    el.innerHTML = '<span>' + text.replace(/</g, '&lt;') + '</span><button style="background:transparent;border:none;color:var(--red);cursor:pointer;font-size:13px;padding:0 0 0 8px;">×</button>';
    el.querySelector('button').addEventListener('click', onRemove);
    return el;
  }

  function bwRenderWordRow(w, i) {
    var excls = w.exclusions || [];
    var row = document.createElement('div');
    row.style.cssText = 'background:#161c28;border:1px solid #1c2333;border-radius:6px;overflow:hidden;flex-shrink:0;';

    var header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:6px;padding:7px 10px;cursor:pointer;';

    var wordSpan = document.createElement('span');
    wordSpan.style.cssText = 'font-size:11px;color:#e6edf3;flex:1;';
    wordSpan.textContent = w.word || '';

    var badge = document.createElement('span');
    badge.style.cssText = 'font-size:9px;color:#6e7681;padding:2px 6px;background:#0b0f15;border:1px solid #1c2333;border-radius:10px;white-space:nowrap;';
    badge.textContent = excls.length ? excls.length + ' exclusion' + (excls.length > 1 ? 's' : '') : 'no exclusions';

    var toggle = document.createElement('span');
    toggle.className = 'bw-excl-toggle';
    toggle.style.cssText = 'font-size:10px;color:#58a6ff;margin-left:2px;';
    toggle.textContent = '▸';

    var removeBtn = document.createElement('button');
    removeBtn.style.cssText = 'background:transparent;border:none;color:#f85149;cursor:pointer;font-size:13px;padding:0 0 0 6px;';
    removeBtn.title = 'Remove word';
    removeBtn.textContent = '×';

    header.appendChild(wordSpan);
    header.appendChild(badge);
    header.appendChild(toggle);
    header.appendChild(removeBtn);

    var removeBtn = header.querySelector('button');
    removeBtn.addEventListener('click', function(e) { e.stopPropagation(); bwConfig.words.splice(i, 1); bwRenderLists(); });

    var body = document.createElement('div');
    body.style.cssText = 'display:none;padding:8px 10px 10px;border-top:1px solid var(--border);background:var(--bg);';

    function renderExclusions() {
      body.innerHTML = '';
      if (excls.length) {
        var exList = document.createElement('div');
        exList.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin-bottom:8px;';
        excls.forEach(function(ex, ei) {
          var exRow = document.createElement('div');
          exRow.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 8px;background:var(--bg-surface);border:1px solid var(--border);border-radius:5px;font-size:10px;color:var(--text-muted);';
          exRow.innerHTML = '<span style="color:var(--yellow);font-weight:600;">' + (ex.type === 'prefix' ? 'before' : 'after') + '</span>' +
            '<span style="color:var(--text-bright);">"' + ex.word.replace(/</g,'&lt;') + '"</span>' +
            '<span>within ' + ex.buffer + ' word' + (ex.buffer !== 1 ? 's' : '') + '</span>' +
            '<button style="margin-left:auto;background:transparent;border:none;color:var(--red);cursor:pointer;font-size:12px;">×</button>';
          exRow.querySelector('button').addEventListener('click', function() { excls.splice(ei, 1); renderExclusions(); });
          exList.appendChild(exRow);
        });
        body.appendChild(exList);
      } else {
        body.insertAdjacentHTML('beforeend', '<div style="font-size:10px;color:var(--text-dim);margin-bottom:8px;">No exclusions — word always triggers</div>');
      }
      // Add exclusion form
      var form = document.createElement('div');
      form.style.cssText = 'display:flex;gap:5px;align-items:center;flex-wrap:wrap;';
      form.innerHTML = '<span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);">Add exclusion:</span>' +
        '<select class="ex-type" style="background:var(--bg-raised);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:10px;padding:3px 5px;">' +
          '<option value="prefix">if word before</option><option value="suffix">if word after</option></select>' +
        '<input class="sf-input ex-word" type="text" placeholder="e.g. toll" style="flex:1;min-width:80px;font-size:10px;padding:4px 7px;">' +
        '<span style="font-size:10px;color:var(--text-muted);">within</span>' +
        '<input class="ex-buf" type="number" min="1" max="20" value="1" style="width:42px;background:var(--bg-raised);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:10px;padding:3px 5px;">' +
        '<span style="font-size:10px;color:var(--text-muted);">word(s)</span>' +
        '<button class="sf-btn primary ex-add" style="font-size:10px;padding:3px 9px;">Add</button>';
      form.querySelector('.ex-add').addEventListener('click', function() {
        var exWord = form.querySelector('.ex-word').value.trim();
        if (!exWord) { toast('Enter an exclusion word', 'error'); return; }
        var buf = parseInt(form.querySelector('.ex-buf').value, 10) || 1;
        var type = form.querySelector('.ex-type').value;
        excls.push({ word: exWord, buffer: buf, type: type });
        form.querySelector('.ex-word').value = '';
        renderExclusions();
      });
      body.appendChild(form);
    }

    header.addEventListener('click', function(e) {
      if (e.target === removeBtn) return;
      var open = body.style.display !== 'none';
      body.style.display = open ? 'none' : '';
      header.querySelector('.bw-excl-toggle').textContent = open ? '▸' : '▾';
      if (!open) renderExclusions();
    });

    row.appendChild(header);
    row.appendChild(body);
    return row;
  }

  function bwRenderLists() {
    var emailList = document.getElementById('bw-email-list');
    var wordList = document.getElementById('bw-word-list');
    var officeList = document.getElementById('bw-office-list');
    emailList.innerHTML = '';
    wordList.innerHTML = '';
    officeList.innerHTML = '';
    if (!bwConfig.emails.length) emailList.innerHTML = '<div style="color:var(--text-dim);font-size:10px;padding:6px;">No recipients</div>';
    bwConfig.emails.forEach(function(email, i) {
      emailList.appendChild(bwRenderTag(email, function() { bwConfig.emails.splice(i, 1); bwRenderLists(); }));
    });
    if (!bwConfig.words.length) wordList.innerHTML = '<div style="color:var(--text-dim);font-size:10px;padding:6px;">No words configured</div>';
    bwConfig.words.forEach(function(w, i) {
      wordList.appendChild(bwRenderWordRow(w, i));
    });
    if (!bwConfig.officePatterns.length) officeList.innerHTML = '<div style="color:var(--text-dim);font-size:10px;padding:6px;">No patterns — add patterns or enable "all offices" above</div>';
    bwConfig.officePatterns.forEach(function(p, i) {
      officeList.appendChild(bwRenderTag(p, function() { bwConfig.officePatterns.splice(i, 1); bwRenderLists(); }));
    });
  }

  function bwFetch() {
    fetch('/admin/bad-word-config').then(function(r) { return r.json(); }).then(function(d) {
      bwConfig = { enabled: !!d.enabled, allOffices: !!d.allOffices, emails: d.emails || [], words: d.words || [], officePatterns: d.officePatterns || [] };
      document.getElementById('bw-enabled').checked = bwConfig.enabled;
      document.getElementById('bw-all-offices').checked = bwConfig.allOffices;
      bwRenderLists();
    });
  }

  document.getElementById('bad-words-open').addEventListener('click', function() {
    openModal('bad-words-modal');
    bwFetch();
  });
  document.getElementById('bad-words-cancel').addEventListener('click', function() { closeModal('bad-words-modal'); });
  document.getElementById('bad-words-cancel2').addEventListener('click', function() { closeModal('bad-words-modal'); });
  backdropClose('bad-words-modal');

  // Tab switching
  document.querySelectorAll('.bw-tab').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var tab = this.getAttribute('data-tab');
      document.querySelectorAll('.bw-tab').forEach(function(b) {
        b.style.color = 'var(--text-muted)'; b.style.borderBottom = '2px solid transparent';
      });
      this.style.color = 'var(--blue)'; this.style.borderBottom = '2px solid var(--blue)';
      document.querySelectorAll('.bw-tab-panel').forEach(function(p) { p.style.display = 'none'; });
      document.getElementById('bw-tab-' + tab).style.display = '';
    });
  });

  // Add handlers
  document.getElementById('bw-email-add').addEventListener('click', function() {
    var val = document.getElementById('bw-email-input').value.trim();
    if (!val || !val.includes('@')) { toast('Enter a valid email', 'error'); return; }
    if (bwConfig.emails.includes(val)) { toast('Already added', 'error'); return; }
    bwConfig.emails.push(val);
    document.getElementById('bw-email-input').value = '';
    bwRenderLists();
  });
  document.getElementById('bw-email-input').addEventListener('keydown', function(e) { if (e.key === 'Enter') document.getElementById('bw-email-add').click(); });

  document.getElementById('bw-word-add').addEventListener('click', function() {
    var val = document.getElementById('bw-word-input').value.trim();
    if (!val) { toast('Enter a word or phrase', 'error'); return; }
    if (bwConfig.words.some(function(w) { return w.word.toLowerCase() === val.toLowerCase(); })) { toast('Already added', 'error'); return; }
    bwConfig.words.push({ word: val });
    document.getElementById('bw-word-input').value = '';
    bwRenderLists();
  });
  document.getElementById('bw-word-input').addEventListener('keydown', function(e) { if (e.key === 'Enter') document.getElementById('bw-word-add').click(); });

  document.getElementById('bw-office-add').addEventListener('click', function() {
    var val = document.getElementById('bw-office-input').value.trim();
    if (!val) { toast('Enter an office name pattern', 'error'); return; }
    if (bwConfig.officePatterns.some(function(p) { return p.toLowerCase() === val.toLowerCase(); })) { toast('Already added', 'error'); return; }
    bwConfig.officePatterns.push(val);
    document.getElementById('bw-office-input').value = '';
    bwRenderLists();
  });
  document.getElementById('bw-office-input').addEventListener('keydown', function(e) { if (e.key === 'Enter') document.getElementById('bw-office-add').click(); });

  document.getElementById('bw-enabled').addEventListener('change', function() { bwConfig.enabled = this.checked; });
  document.getElementById('bw-all-offices').addEventListener('change', function() { bwConfig.allOffices = this.checked; });

  document.getElementById('bw-save-btn').addEventListener('click', function() {
    var btn = this;
    btn.disabled = true; btn.textContent = 'Saving...';
    fetch('/admin/bad-word-config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bwConfig) })
      .then(function(r) { return r.json(); })
      .then(function() { toast('Bad word config saved', 'success'); })
      .catch(function() { toast('Save failed', 'error'); })
      .finally(function() { btn.disabled = false; btn.textContent = 'Save Changes'; });
  });

  // ===== Offices Modal (tabbed) =====
  (function() {
    var obPatterns = [];
    var obDepts = [];

    // Tab switching
    document.getElementById('ob-tabs').addEventListener('click', function(e) {
      var tab = e.target.closest('.um-tab');
      if (!tab) return;
      this.querySelectorAll('.um-tab').forEach(function(t){t.classList.remove('active');});
      tab.classList.add('active');
      var which = tab.getAttribute('data-tab');
      document.getElementById('ob-offices-tab').style.display = which === 'offices' ? '' : 'none';
      document.getElementById('ob-bypass-tab').style.display = which === 'bypass' ? '' : 'none';
      document.getElementById('ob-offices-actions').style.display = which === 'offices' ? '' : 'none';
    });

    function obRenderDeptList() {
      var el = document.getElementById('ob-dept-list');
      if (!obDepts.length) {
        el.innerHTML = '<div style="color:var(--text-dim);font-size:11px;padding:6px 0;">No offices yet. Add one above.</div>';
        return;
      }
      el.innerHTML = obDepts.map(function(d) {
        return '<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:12px;background:var(--bg-surface);border:1px solid var(--border);font-size:12px;font-weight:600;color:var(--text);">'
          + esc(d)
          + '<button style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:13px;line-height:1;padding:0 0 0 4px;" data-val="' + esc(d) + '" class="ob-rm-dept">&times;</button></span>';
      }).join('');
      el.querySelectorAll('.ob-rm-dept').forEach(function(btn) {
        btn.addEventListener('click', function() {
          obDepts = obDepts.filter(function(x){ return x !== btn.getAttribute('data-val'); });
          obRenderDeptList();
          saveDepts();
        });
      });
    }

    var obShifts = [];
    function saveDepts() {
      fetch('/admin/audit-dimensions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ departments: obDepts, shifts: obShifts }) })
        .then(function(r){ return r.json(); })
        .then(function(d){
          if (d.error) { toast(d.error, 'error'); return; }
          if (typeof window.loadScopesTab === 'function') window.loadScopesTab();
        })
        .catch(function(){ toast('Save failed', 'error'); });
    }

    function obRenderBypassList() {
      var el = document.getElementById('ob-list');
      if (!obPatterns.length) {
        el.innerHTML = '<div style="color:var(--text-dim);font-size:11px;padding:6px 0;">No patterns — all offices go through review and receive emails.</div>';
        return;
      }
      el.innerHTML = obPatterns.map(function(p, i) {
        return '<div style="display:flex;align-items:center;gap:8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:6px 10px;">' +
          '<span style="flex:1;font-size:12px;font-family:var(--mono);color:var(--yellow);">' + esc(p) + '</span>' +
          '<button class="sf-btn ghost" style="font-size:10px;padding:2px 8px;" data-idx="' + i + '">Remove</button>' +
          '</div>';
      }).join('');
      el.querySelectorAll('[data-idx]').forEach(function(btn) {
        btn.addEventListener('click', function() {
          obPatterns.splice(parseInt(this.getAttribute('data-idx'), 10), 1);
          obRenderBypassList();
        });
      });
    }

    document.getElementById('office-bypass-open').addEventListener('click', function() {
      openModal('office-bypass-modal');
      Promise.all([
        fetch('/admin/audit-dimensions').then(function(r){ return r.json(); }),
        fetch('/admin/office-bypass').then(function(r){ return r.json(); }),
      ]).then(function(results) {
        var dims = results[0] || {};
        obDepts = Array.isArray(dims.departments) ? dims.departments.slice() : [];
        obShifts = Array.isArray(dims.shifts) ? dims.shifts.slice() : [];
        obRenderDeptList();
        obPatterns = Array.isArray(results[1].patterns) ? results[1].patterns : [];
        obRenderBypassList();
      });
    });

    document.getElementById('office-bypass-cancel').addEventListener('click', function() { closeModal('office-bypass-modal'); });
    document.getElementById('office-bypass-cancel2').addEventListener('click', function() { closeModal('office-bypass-modal'); });
    backdropClose('office-bypass-modal');

    document.getElementById('ob-dept-add-btn').addEventListener('click', function() {
      var val = document.getElementById('ob-dept-input').value.trim().toUpperCase();
      if (!val) return;
      if (obDepts.indexOf(val) === -1) { obDepts.push(val); obDepts.sort(); }
      document.getElementById('ob-dept-input').value = '';
      obRenderDeptList();
      saveDepts();
    });
    document.getElementById('ob-dept-input').addEventListener('keydown', function(e) { if (e.key === 'Enter') document.getElementById('ob-dept-add-btn').click(); });

    document.getElementById('ob-add-btn').addEventListener('click', function() {
      var val = document.getElementById('ob-input').value.trim().toUpperCase();
      if (!val) return;
      if (obPatterns.indexOf(val) === -1) obPatterns.push(val);
      document.getElementById('ob-input').value = '';
      obRenderBypassList();
    });
    document.getElementById('ob-input').addEventListener('keydown', function(e) { if (e.key === 'Enter') document.getElementById('ob-add-btn').click(); });

    document.getElementById('ob-save-btn').addEventListener('click', function() {
      var btn = this;
      btn.disabled = true; btn.textContent = 'Saving...';
      fetch('/admin/office-bypass', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ patterns: obPatterns }) })
        .then(function(r) { return r.json(); })
        .then(function() { toast('Bypass patterns saved', 'success'); })
        .catch(function() { toast('Save failed', 'error'); })
        .finally(function() { btn.disabled = false; btn.textContent = 'Save Bypass'; });
    });
  })();

})();
</script>
</body>
</html>`;
}
