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
  .er-modal { width: 540px; }
  .er-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
  .er-header .modal-title { margin-bottom: 0; }
  .er-back { background: none; border: none; color: var(--text-muted); font-size: 16px; cursor: pointer; padding: 0 8px 0 0; }
  .er-back:hover { color: var(--text-bright); }
  .er-table { width: 100%; border-collapse: collapse; }
  .er-table th { text-align: left; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--text-dim); padding: 6px 8px; border-bottom: 1px solid var(--border); }
  .er-table td { font-size: 11px; padding: 8px 8px; border-bottom: 1px solid rgba(28,35,51,0.4); color: var(--text-muted); cursor: pointer; }
  .er-table tr:hover td { color: var(--text); background: var(--bg-surface); }
  .er-table tr:last-child td { border-bottom: none; }
  .er-empty { text-align: center; color: var(--text-dim); font-style: italic; padding: 24px; font-size: 11px; }
  .er-trash { background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 13px; padding: 2px 6px; border-radius: 4px; }
  .er-trash:hover { color: var(--red); background: var(--red-bg); }
  .er-sections-table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  .er-sections-table td { padding: 6px 0; border-bottom: 1px solid rgba(28,35,51,0.3); font-size: 12px; color: var(--text); }
  .er-sections-table tr:last-child td { border-bottom: none; }
  .er-section-name { font-weight: 600; text-transform: capitalize; min-width: 80px; }
  .er-section-check { width: 28px; }
  .er-section-check input { accent-color: var(--blue); }
  .er-pills { display: flex; gap: 3px; }
  .er-pill { padding: 3px 10px; border: 1px solid var(--border); border-radius: 12px; background: transparent; color: var(--text-dim); font-size: 10px; font-weight: 600; cursor: pointer; transition: all 0.12s; }
  .er-pill:hover { border-color: var(--border-hover); color: var(--text-muted); }
  .er-pill.active { background: var(--blue-bg); border-color: rgba(88,166,255,0.3); color: var(--blue); }
  .er-pill.disabled { opacity: 0.3; pointer-events: none; }
  .er-cadence { display: flex; gap: 3px; margin-top: 4px; }
  .er-cadence-pill { padding: 3px 10px; border: 1px solid var(--border); border-radius: 12px; background: transparent; color: var(--text-dim); font-size: 10px; font-weight: 600; cursor: pointer; transition: all 0.12s; }
  .er-cadence-pill:hover { border-color: var(--border-hover); color: var(--text-muted); }
  .er-cadence-pill.active { background: var(--blue-bg); border-color: rgba(88,166,255,0.3); color: var(--blue); }
  .er-cadence-day { display: flex; gap: 3px; margin-top: 8px; flex-wrap: wrap; align-items: center; }
  .er-cadence-day-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-dim); margin-right: 4px; }
  .er-day-pill { padding: 3px 10px; border: 1px solid var(--border); border-radius: 12px; background: transparent; color: var(--text-dim); font-size: 10px; font-weight: 600; cursor: pointer; transition: all 0.12s; min-width: 28px; text-align: center; }
  .er-day-pill:hover { border-color: var(--border-hover); color: var(--text-muted); }
  .er-day-pill.active { background: var(--blue-bg); border-color: rgba(88,166,255,0.3); color: var(--blue); }
  .er-day-input { width: 56px; padding: 3px 8px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 11px; font-weight: 600; text-align: center; }
  .er-day-input:focus { outline: none; border-color: var(--blue); }

  /* ===== Main Content ===== */
  .main { flex: 1; margin-left: var(--sidebar-w); padding: 22px 24px; }

  .stat-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; }
  .stat-card { background: var(--bg-raised); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; transition: border-color 0.15s; }
  .stat-card:hover { border-color: var(--border-hover); }
  .stat-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: var(--text-dim); margin-bottom: 3px; }
  .stat-value { font-size: 28px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .stat-card.blue .stat-value { color: var(--blue); }
  .stat-card.green .stat-value { color: var(--green); }
  .stat-card.red .stat-value { color: var(--red); }
  .stat-card.yellow .stat-value { color: var(--yellow); }

  /* Charts row */
  .charts { display: grid; grid-template-columns: 2fr 1fr; gap: 10px; margin-bottom: 16px; }
  .chart-panel { background: var(--bg-raised); border: 1px solid var(--border); border-radius: 10px; padding: 16px 16px 12px; }
  .chart-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--text-dim); margin-bottom: 10px; }
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
  .panel-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--text-dim); margin-bottom: 10px; }

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
  .tbl-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--text-dim); margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--text-dim); padding: 4px 8px; border-bottom: 1px solid var(--border); }
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
    .stat-row { grid-template-columns: repeat(2, 1fr); }
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

      <!-- Bad Words (opens modal) -->
      <div class="sb-link" id="bad-words-open">
        <div class="icon" style="background:var(--red-bg);color:var(--red);">${icons.alertTriangle}</div>
        <span class="title">Bad Words</span>
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
      <div class="stat-card blue">
        <div class="stat-label">In Pipeline</div>
        <div class="stat-value" id="s-pipe">--</div>
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
        <div class="rq-row">
          <div class="rq-stat pending"><div class="rv" id="r-pending">--</div><div class="rl">Pending</div></div>
          <div class="rq-div"></div>
          <div class="rq-stat decided"><div class="rv" id="r-decided">--</div><div class="rl">Decided</div></div>
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
          <option value="dateleg">Date Leg</option>
          <option value="package">Package</option>
        </select>
        <button class="sf-btn secondary" id="bulk-open-btn" style="padding:6px 14px;font-size:11px;white-space:nowrap;">Bulk</button>
        <button class="sf-btn primary" id="rid-btn" style="padding:6px 16px;font-size:11px;white-space:nowrap;">Start Audit</button>
      </div>
      <div id="rid-result" style="font-size:10px;margin-top:6px;min-height:14px;"></div>
    </div>

    <div class="tbl">
      <div class="tbl-title" style="display:flex;align-items:center;justify-content:space-between;">
        <span>Active Audits</span>
        <button class="sf-btn danger" id="terminate-all-btn" style="font-size:9px;padding:3px 10px;">Terminate All</button>
      </div>
      <table><thead><tr><th>Finding ID</th><th>QB Record</th><th>Step</th><th>Started</th><th>Duration</th><th></th></tr></thead>
      <tbody id="tb-active"><tr class="empty-row"><td colspan="6">No active audits</td></tr></tbody></table>
    </div>

    <div class="tbl">
      <div class="tbl-title">Recent Errors (24h)</div>
      <table><thead><tr><th>Finding ID</th><th>Step</th><th>Error</th><th>When</th></tr></thead>
      <tbody id="tb-errors"><tr class="empty-row"><td colspan="4">No errors</td></tr></tbody></table>
    </div>

    <div class="tbl">
      <div class="tbl-title">Recently Completed (24h)</div>
      <table><thead><tr><th>Finding ID</th><th>QB Record</th><th>Started</th><th>Finished</th><th>Duration</th></tr></thead>
      <tbody id="tb-recent"><tr class="empty-row"><td colspan="5">No completed audits</td></tr></tbody></table>
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
        <button class="sf-btn ghost" id="et-seed-btn" style="font-size:11px;" title="Load built-in default templates">Seed Defaults</button>
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
      <div class="modal-sub" style="margin-bottom:10px;">Phrases to search for in transcripts. Case-insensitive, partial phrase match.</div>
      <div style="display:flex;gap:6px;margin-bottom:10px;">
        <input id="bw-word-input" class="sf-input" type="text" placeholder="e.g. resort fees included" style="flex:1;">
        <button class="sf-btn primary" id="bw-word-add">Add</button>
      </div>
      <div id="bw-word-list" style="display:flex;flex-direction:column;gap:4px;max-height:220px;overflow-y:auto;"></div>
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

<!-- Users Modal -->
<div class="modal-overlay" id="users-modal">
  <div class="modal" style="width:560px;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
      <div class="modal-title" style="margin-bottom:0;">Team</div>
      <div style="display:flex;gap:4px;" id="um-tabs">
        <button class="sf-btn ghost um-tab active" data-tab="list" style="font-size:10px;padding:4px 10px;">Members</button>
        <button class="sf-btn ghost um-tab" data-tab="add" style="font-size:10px;padding:4px 10px;">+ Add</button>
      </div>
    </div>
    <div class="modal-sub">Manage your organization's users and roles</div>

    <!-- Members List Tab -->
    <div id="um-list-tab">
      <div id="um-user-list" style="max-height:340px;overflow-y:auto;margin-bottom:12px;">
        <div style="text-align:center;padding:24px;color:var(--text-dim);font-size:11px;">Loading...</div>
      </div>
    </div>

    <!-- Add User Tab -->
    <div id="um-add-tab" style="display:none;">
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
              <span class="um-role-desc">Remediates failures. Owns reviewers.</span>
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
              <span class="um-role-desc">Call center agent. Scoped to manager.</span>
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
            <input type="email" class="sf-input" id="a-username" placeholder="jsmith@example.com">
          </div>
          <div class="sf">
            <label class="sf-label">Password</label>
            <input type="password" class="sf-input" id="a-password" placeholder="&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;">
          </div>
        </div>
      </div>

      <button class="sf-btn primary" id="a-adduser" style="width:100%;padding:10px;font-size:12px;border-radius:8px;">Create&nbsp;<span id="um-btn-role">Admin</span></button>
    </div>

    <div class="modal-actions" style="margin-top:12px;">
      <button class="sf-btn secondary" id="users-cancel">Close</button>
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

<!-- Terminate All Confirmation Modal -->
<div class="modal-overlay" id="terminate-modal">
  <div class="modal" style="width:420px;">
    <div class="modal-title" style="color:var(--red);">Terminate All Active Audits</div>
    <div class="modal-sub">This will mark every currently active audit as <strong>terminated</strong>. In-flight pipeline steps will bail out when they check in. This cannot be undone.</div>
    <div style="background:var(--red-bg);border:1px solid rgba(248,81,73,0.2);border-radius:8px;padding:12px 14px;font-size:11px;color:var(--text-muted);margin-bottom:4px;">
      Are you sure you want to terminate all active audits?
    </div>
    <div class="modal-actions">
      <button class="sf-btn ghost" id="terminate-cancel">Cancel</button>
      <button class="sf-btn danger" id="terminate-confirm" style="padding:10px 24px;font-size:13px;border-radius:8px;background:var(--red);color:#fff;border:none;">Yes, Terminate All</button>
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
          <option value="dateleg">Date Leg</option>
          <option value="package">Package</option>
        </select>
      </div>
      <div class="sf" style="width:130px;margin-bottom:0;">
        <label class="sf-label">Stagger (ms)</label>
        <input type="number" class="sf-input" id="bulk-stagger" value="100" min="0" max="5000" style="font-size:12px;">
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
      ctx.fillStyle = '#3d4452';
      ctx.font = '9px -apple-system, sans-serif';
      ctx.fillText(String(Math.round(maxVal * g / gridLines)), pad.left - 6, gy);
    }

    // X-axis labels
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillStyle = '#3d4452'; ctx.font = '9px -apple-system, sans-serif';
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
      ctx.font = '9px -apple-system, sans-serif';
      var tw = ctx.measureText(series[j].label).width;
      ctx.fillStyle = '#6e7681';
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

  // ===== Render =====
  function render(data) {
    lastData = data;
    var p = data.pipeline || {}, r = data.review || {}, t = data.tokens || {};

    document.getElementById('s-pipe').textContent = fmt(p.inPipe);
    document.getElementById('s-completed').textContent = fmt(p.completed24h);
    document.getElementById('s-errors').textContent = fmt(p.errors24h);
    document.getElementById('s-retries').textContent = fmt(p.retries24h);
    document.getElementById('r-pending').textContent = fmt(r.pending);
    document.getElementById('r-decided').textContent = fmt(r.decided);
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

    renderActive(p.active || []);
    renderErrors(p.errors || []);
    renderRecent(data.recentCompleted || []);

    // Charts
    drawActivityChart(p.completedTs, p.errorsTs, p.retriesTs);
    drawDonut(r.pending || 0, r.decided || 0);
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
    if (!items.length) { tb.innerHTML = '<tr class="empty-row"><td colspan="5">No completed audits</td></tr>'; return; }
    var qbDateUrl = 'https://monsterrg.quickbase.com/nav/app/bmhvhc7sk/table/bpb28qsnn/action/dr?rid=';
    var qbPkgUrl  = 'https://monsterrg.quickbase.com/nav/app/bmhvhc7sk/table/bttffb64u/action/dr?rid=';
    tb.innerHTML = '';
    for (var i = 0; i < items.length; i++) {
      var c = items[i], tr = document.createElement('tr');
      var fid = c.findingId || '--';
      var ridHtml = '--';
      if (c.recordId) {
        var qbUrl = (c.isPackage ? qbPkgUrl : qbDateUrl) + encodeURIComponent(c.recordId);
        ridHtml = '<a href="' + qbUrl + '" target="_blank" class="tbl-link">' + c.recordId + '</a>';
      }
      var startedHtml = c.startedAt ? '<span class="time-ago" title="' + new Date(c.startedAt).toLocaleTimeString() + '">' + timeAgo(c.startedAt) + '</span>' : '--';
      var finishedHtml = '<span class="time-ago" title="' + new Date(c.ts).toLocaleTimeString() + '">' + timeAgo(c.ts) + '</span>';
      var durHtml = c.durationMs ? '<span style="font-variant-numeric:tabular-nums">' + fmtDur(c.durationMs) + '</span>' : '--';
      tr.innerHTML = '<td class="mono"><a href="/audit/report?id=' + encodeURIComponent(fid) + '" target="_blank" class="tbl-link">' + fid + '</a></td><td>' + ridHtml + '</td><td>' + startedHtml + '</td><td>' + finishedHtml + '</td><td>' + durHtml + '</td>';
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
      var startedCell = a.startedAt ? '<span title="' + new Date(a.startedAt).toLocaleTimeString() + '">' + timeAgo(a.startedAt) + '</span>' : '--';
      tr.innerHTML = '<td>' + fidHtml + '</td><td>' + ridHtml + '</td><td><span class="step-badge">' + (a.step||'--') + '</span></td><td>' + startedCell + '</td><td class="duration">' + dur(a.ts) + '</td><td style="text-align:right"><button class="retry-btn sf-btn ghost" data-id="' + fid + '" data-idx="' + i + '" style="font-size:9px;padding:2px 8px;">Retry</button></td>';
      tb.appendChild(tr);
    }
    tb.querySelectorAll('.retry-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var id = this.getAttribute('data-id');
        var idx = parseInt(this.getAttribute('data-idx'));
        var b = this;
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
  }

  function renderErrors(errors) {
    var tb = document.getElementById('tb-errors');
    if (!errors.length) { tb.innerHTML = '<tr class="empty-row"><td colspan="4">No errors</td></tr>'; return; }
    errors.sort(function(a,b) { return (b.ts||0)-(a.ts||0); });
    tb.innerHTML = '';
    for (var i = 0; i < Math.min(errors.length, 20); i++) {
      var e = errors[i], tr = document.createElement('tr');
      tr.innerHTML = '<td class="mono">' + (e.findingId||'--') + '</td><td><span class="step-badge">' + (e.step||'--') + '</span></td><td class="error-msg" title="' + ((e.error||'').replace(/"/g,'&quot;')) + '">' + (e.error||'--') + '</td><td class="time-ago">' + timeAgo(e.ts) + '</td>';
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

  async function fetchData() {
    var dot = document.getElementById('status-dot');
    dot.className = 'dot loading';
    try {
      var res = await fetch('/admin/dashboard/data');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      render(await res.json());
      dot.className = 'dot';
    } catch(e) { console.error('fetch:', e); dot.className = 'dot error'; }
  }

  fetchData().finally(function() {
    var ov = document.getElementById('init-overlay');
    if (ov) { ov.style.opacity = '0'; setTimeout(function() { ov.remove(); }, 420); }
  });
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
        + '<div class="um-user-info"><div class="um-user-email">' + esc(u.username) + '</div>'
        + '<div class="um-user-meta">' + (u.supervisor ? 'reports to ' + esc(u.supervisor) : 'no supervisor') + '</div></div>'
        + '<span class="um-badge ' + u.role + '">' + (u.role === 'user' ? 'agent' : u.role) + '</span>'
        + '</div>';
    }
    el.innerHTML = html;
  }

  function updateSupervisorDropdown() {
    var group = document.getElementById('supervisor-group');
    var label = document.getElementById('supervisor-label');
    var sel = document.getElementById('a-supervisor');
    var credStep = document.getElementById('um-cred-step');
    var btnRole = document.getElementById('um-btn-role');
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
      labelText = 'a Judge or Manager';
      filterFn = function(u) { return u.role === 'judge' || u.role === 'manager'; };
    }
    label.textContent = labelText;
    var opts = '<option value="">-- Select --</option>';
    var others = '';
    for (var i = 0; i < allUsers.length; i++) {
      if (filterFn(allUsers[i])) {
        if (currentAdminEmail && allUsers[i].username === currentAdminEmail) {
          opts += '<option value="' + esc(currentAdminEmail) + '">Self (' + esc(currentAdminEmail) + ')</option>';
        } else {
          others += '<option value="' + esc(allUsers[i].username) + '">' + esc(allUsers[i].username) + '</option>';
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
  });

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

  // ===== Terminate All =====
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
          toast('Terminated ' + (d.terminated || 0) + ' active audit(s)', 'success');
          fetchData();
        } else {
          toast(d.error || 'Failed', 'error');
        }
      })
      .catch(function() { toast('Request failed', 'error'); })
      .finally(function() { btn.disabled = false; btn.textContent = 'Yes, Terminate All'; });
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
  var whSubs = { terminate: 'Called when an audit is complete (100% first pass or review completed)', appeal: 'Called when an agent files an appeal', manager: 'Called when a manager submits a remediation note on a failed audit', 'judge-finish': 'Called when a judge finishes all appeal decisions for an audit' };
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
  var EMAIL_KINDS = ['terminate', 'appeal', 'manager', 'judge-finish'];

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
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u)) { toast('Enter a valid email address','error'); return; }
    var sup = document.getElementById('a-supervisor').value;
    if (selectedRole !== 'admin' && !sup) { toast('Select a supervisor','error'); return; }
    btnLoad(btn,'Creating...');
    fetch('/admin/users', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username:u,password:p,role:selectedRole,supervisor:sup||null}) })
    .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()})
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
  var SECTIONS = ['pipeline','review','appeals','manager','tokens'];
  var SECTION_LABELS = {pipeline:'Pipeline',review:'Review',appeals:'Appeals',manager:'Manager',tokens:'Tokens'};
  var CADENCES = ['daily','weekly','biweekly','monthly'];
  var CADENCE_LABELS = {daily:'Daily',weekly:'Weekly',biweekly:'Biweekly',monthly:'Monthly'};
  var WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  function loadEmailConfigs() {
    return fetch('/admin/email-reports').then(function(r){return r.json()}).then(function(d) {
      emailConfigs = Array.isArray(d) ? d : [];
      return emailConfigs;
    });
  }

  function saveEmailConfig(config) {
    return fetch('/admin/email-reports', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(config)}).then(function(r){
      if(!r.ok) throw new Error('HTTP '+r.status);
      return r.json();
    });
  }

  function deleteEmailConfig(id) {
    return fetch('/admin/email-reports/delete', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id})}).then(function(r){
      if(!r.ok) throw new Error('HTTP '+r.status);
      return r.json();
    });
  }

  function renderEmailList() {
    var html = '<div class="er-header"><div class="modal-title">Email Report Configs</div><button class="sf-btn primary" id="er-new">+ New</button></div>';
    if (!emailConfigs.length) {
      html += '<div class="er-empty">No report configs yet</div>';
    } else {
      html += '<table class="er-table"><thead><tr><th>Name</th><th>Cadence</th><th>Recipients</th><th>Sections</th><th></th></tr></thead><tbody>';
      for (var i = 0; i < emailConfigs.length; i++) {
        var c = emailConfigs[i];
        var enabledCount = 0;
        for (var k = 0; k < SECTIONS.length; k++) { if (c.sections[SECTIONS[k]] && c.sections[SECTIONS[k]].enabled) enabledCount++; }
        var cadenceLabel = CADENCE_LABELS[c.cadence] || 'Weekly';
        if (c.cadenceDay != null && c.cadence !== 'daily') {
          if (c.cadence === 'monthly') { cadenceLabel += ' (day ' + c.cadenceDay + ')'; }
          else { cadenceLabel += ' (' + WEEKDAYS[c.cadenceDay] + ')'; }
        }
        html += '<tr data-idx="'+i+'"><td>'+esc(c.name)+'</td><td>'+cadenceLabel+'</td><td>'+c.recipients.length+'</td><td>'+enabledCount+'/'+SECTIONS.length+'</td><td><button class="er-trash" data-id="'+c.id+'" title="Delete">${icons.trash}</button></td></tr>';
      }
      html += '</tbody></table>';
    }
    erContent.innerHTML = html;
    document.getElementById('er-new').addEventListener('click', function() { renderEmailEdit(); });
    erContent.querySelectorAll('.er-table tr[data-idx]').forEach(function(row) {
      row.querySelectorAll('td:not(:last-child)').forEach(function(td) {
        td.addEventListener('click', function() { renderEmailEdit(emailConfigs[parseInt(row.getAttribute('data-idx'))]); });
      });
    });
    erContent.querySelectorAll('.er-trash').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (!confirm('Delete this report config?')) return;
        var id = this.getAttribute('data-id');
        deleteEmailConfig(id).then(function() {
          emailConfigs = emailConfigs.filter(function(c){return c.id !== id});
          toast('Config deleted','info');
          renderEmailList();
        }).catch(function(err) { toast(err.message,'error'); });
      });
    });
  }

  function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  function defaultSections() {
    var s = {};
    for (var i = 0; i < SECTIONS.length; i++) s[SECTIONS[i]] = { enabled: true, detail: 'medium' };
    return s;
  }

  function renderEmailEdit(config) {
    var isNew = !config;
    var c = config || { name: '', recipients: [], sections: defaultSections() };
    var html = '<div class="er-header"><div style="display:flex;align-items:center;gap:8px"><button class="er-back" id="er-back-btn">${icons.arrowLeft}</button><div class="modal-title">'+(isNew?'New Report Config':'Edit Report Config')+'</div></div></div>';
    html += '<div class="sf"><label class="sf-label">Name</label><input type="text" class="sf-input" id="er-name" value="'+esc(c.name)+'" placeholder="Weekly Executive Summary"></div>';
    html += '<div class="sf"><label class="sf-label">Recipients (one per line)</label><textarea class="sf-input" id="er-recipients" placeholder="ceo@example.com">'+(c.recipients||[]).join('\\n')+'</textarea></div>';
    var currentCadence = c.cadence || 'weekly';
    html += '<div class="sf"><label class="sf-label">Cadence</label><div class="er-cadence" id="er-cadence">';
    for (var ci = 0; ci < CADENCES.length; ci++) {
      html += '<button class="er-cadence-pill'+(currentCadence===CADENCES[ci]?' active':'')+'" data-cadence="'+CADENCES[ci]+'">'+CADENCE_LABELS[CADENCES[ci]]+'</button>';
    }
    html += '</div><div class="er-cadence-day" id="er-cadence-day"></div></div>';
    html += '<div class="sf"><label class="sf-label">Sections</label><table class="er-sections-table"><tbody>';
    for (var i = 0; i < SECTIONS.length; i++) {
      var key = SECTIONS[i];
      var sc = c.sections[key] || { enabled: true, detail: 'medium' };
      var dis = !sc.enabled;
      html += '<tr data-section="'+key+'">';
      html += '<td class="er-section-check"><input type="checkbox" '+(sc.enabled?'checked':'')+' data-section="'+key+'"></td>';
      html += '<td class="er-section-name">'+SECTION_LABELS[key]+'</td>';
      html += '<td><div class="er-pills" data-section="'+key+'">';
      var levels = ['low','medium','high'];
      var labels = ['Low','Med','High'];
      for (var j = 0; j < levels.length; j++) {
        html += '<button class="er-pill'+(sc.detail===levels[j]?' active':'')+(dis?' disabled':'')+'" data-level="'+levels[j]+'">'+labels[j]+'</button>';
      }
      html += '</div></td></tr>';
    }
    html += '</tbody></table></div>';
    html += '<div class="modal-actions"><button class="sf-btn secondary" id="er-cancel">Cancel</button><button class="sf-btn primary" id="er-save">Save</button></div>';
    erContent.innerHTML = html;

    document.getElementById('er-back-btn').addEventListener('click', function() { renderEmailList(); });
    document.getElementById('er-cancel').addEventListener('click', function() { erModal.classList.remove('open'); });

    // Checkbox toggles
    erContent.querySelectorAll('.er-section-check input').forEach(function(cb) {
      cb.addEventListener('change', function() {
        var sec = this.getAttribute('data-section');
        var pills = erContent.querySelector('.er-pills[data-section="'+sec+'"]').querySelectorAll('.er-pill');
        pills.forEach(function(p) { if(cb.checked) p.classList.remove('disabled'); else p.classList.add('disabled'); });
      });
    });

    // Detail pills
    erContent.querySelectorAll('.er-pills').forEach(function(group) {
      group.addEventListener('click', function(e) {
        var pill = e.target.closest('.er-pill');
        if (!pill || pill.classList.contains('disabled')) return;
        group.querySelectorAll('.er-pill').forEach(function(p){p.classList.remove('active')});
        pill.classList.add('active');
      });
    });

    // Cadence day picker helper
    function renderCadenceDay(cadence, selectedDay) {
      var container = document.getElementById('er-cadence-day');
      if (cadence === 'daily') { container.innerHTML = ''; return; }
      var h = '<span class="er-cadence-day-label">';
      if (cadence === 'monthly') {
        h += 'Day of month</span>';
        h += '<input type="number" class="er-day-input" id="er-day-num" min="1" max="30" value="'+(selectedDay || 1)+'">';
      } else {
        h += 'Day of week</span>';
        for (var w = 0; w < 7; w++) {
          h += '<button class="er-day-pill'+(w === (selectedDay != null ? selectedDay : 1) ? ' active' : '')+'" data-day="'+w+'">'+WEEKDAYS[w]+'</button>';
        }
      }
      container.innerHTML = h;
      if (cadence !== 'monthly') {
        container.addEventListener('click', function(e) {
          var dp = e.target.closest('.er-day-pill');
          if (!dp) return;
          container.querySelectorAll('.er-day-pill').forEach(function(p){p.classList.remove('active')});
          dp.classList.add('active');
        });
      }
    }

    renderCadenceDay(currentCadence, c.cadenceDay);

    // Cadence pills
    document.getElementById('er-cadence').addEventListener('click', function(e) {
      var pill = e.target.closest('.er-cadence-pill');
      if (!pill) return;
      this.querySelectorAll('.er-cadence-pill').forEach(function(p){p.classList.remove('active')});
      pill.classList.add('active');
      renderCadenceDay(pill.getAttribute('data-cadence'), null);
    });

    // Save
    document.getElementById('er-save').addEventListener('click', function() {
      var btn = this;
      var name = document.getElementById('er-name').value.trim();
      if (!name) { toast('Name is required','error'); return; }
      var recips = document.getElementById('er-recipients').value.split('\\n').map(function(s){return s.trim()}).filter(Boolean);
      if (!recips.length) { toast('At least one recipient required','error'); return; }
      var sections = {};
      for (var i = 0; i < SECTIONS.length; i++) {
        var key = SECTIONS[i];
        var enabled = erContent.querySelector('.er-section-check input[data-section="'+key+'"]').checked;
        var activePill = erContent.querySelector('.er-pills[data-section="'+key+'"] .er-pill.active');
        var detail = activePill ? activePill.getAttribute('data-level') : 'medium';
        sections[key] = { enabled: enabled, detail: detail };
      }
      var activeCadence = erContent.querySelector('.er-cadence-pill.active');
      var cadence = activeCadence ? activeCadence.getAttribute('data-cadence') : 'weekly';
      var cadenceDay = null;
      if (cadence === 'monthly') {
        var dayInput = document.getElementById('er-day-num');
        cadenceDay = dayInput ? Math.max(1, Math.min(30, parseInt(dayInput.value) || 1)) : 1;
      } else if (cadence === 'weekly' || cadence === 'biweekly') {
        var activeDayPill = erContent.querySelector('.er-day-pill.active');
        cadenceDay = activeDayPill ? parseInt(activeDayPill.getAttribute('data-day')) : 1;
      }
      var payload = { name: name, recipients: recips, cadence: cadence, cadenceDay: cadenceDay, sections: sections };
      if (c.id) { payload.id = c.id; payload.createdAt = c.createdAt; }
      btnLoad(btn);
      saveEmailConfig(payload).then(function(saved) {
        if (c.id) {
          for (var i = 0; i < emailConfigs.length; i++) { if (emailConfigs[i].id === saved.id) { emailConfigs[i] = saved; break; } }
        } else { emailConfigs.push(saved); }
        toast('Config saved','success');
        btnDone(btn,'Save');
        renderEmailList();
      }).catch(function(err) { toast(err.message,'error'); btnDone(btn,'Save'); });
    });
  }

  document.getElementById('email-reports-open').addEventListener('click', function() {
    erModal.classList.add('open');
    loadEmailConfigs().then(function() { renderEmailList(); }).catch(function() { renderEmailList(); });
  });
  erModal.addEventListener('click', function(e) { if (e.target === erModal) erModal.classList.remove('open'); });

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
    document.getElementById('et-preview').srcdoc = document.getElementById('et-html').value;
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

  document.getElementById('et-seed-btn').addEventListener('click', function() {
    var btn = this;
    btn.disabled = true; btn.textContent = 'Seeding...';
    fetch('/admin/email-templates/seed-defaults', { method: 'POST' })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.created && d.created.length) {
          toast('Created: ' + d.created.join(', '), 'success');
          etFetch();
        } else {
          toast('Default templates already exist', 'success');
        }
      })
      .catch(function() { toast('Seed failed', 'error'); })
      .finally(function() { btn.disabled = false; btn.textContent = 'Seed Defaults'; });
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
      wordList.appendChild(bwRenderTag(w.word, function() { bwConfig.words.splice(i, 1); bwRenderLists(); }));
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

})();
</script>
</body>
</html>`;
}
