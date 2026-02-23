/** Inline HTML/CSS/JS for the admin dashboard. */

export function getDashboardPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Auto-Bot Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --bg: #0b0f15; --bg-raised: #111620; --bg-surface: #161c28;
    --border: #1c2333; --border-hover: #2a3346;
    --text: #c9d1d9; --text-muted: #6e7681; --text-dim: #484f58; --text-bright: #e6edf3;
    --blue: #58a6ff; --green: #3fb950; --red: #f85149; --yellow: #d29922; --purple: #bc8cff;
    --blue-bg: rgba(31,111,235,0.10); --green-bg: rgba(63,185,80,0.10);
    --red-bg: rgba(248,81,73,0.10); --yellow-bg: rgba(210,153,34,0.10); --purple-bg: rgba(139,92,246,0.10);
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

  /* ===== Modal ===== */
  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); z-index: 100; display: none; align-items: center; justify-content: center; }
  .modal-overlay.open { display: flex; }
  .modal { background: var(--bg-raised); border: 1px solid var(--border); border-radius: 12px; width: 440px; max-width: 90vw; padding: 24px; animation: modalIn 0.15s ease; }
  @keyframes modalIn { from { opacity: 0; transform: scale(0.96) translateY(8px); } to { opacity: 1; transform: none; } }
  .modal-title { font-size: 15px; font-weight: 700; color: var(--text-bright); margin-bottom: 4px; }
  .modal-sub { font-size: 11px; color: var(--text-dim); margin-bottom: 16px; }
  .modal .sf-input { font-size: 12px; padding: 8px 11px; }
  .modal textarea.sf-input { height: 72px; }
  .modal .sf { margin-bottom: 12px; }
  .modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border); }
  .modal-actions .sf-btn { padding: 8px 20px; font-size: 12px; border-radius: 8px; }

  /* Modal form overrides */
  .modal .sf { margin-bottom: 14px; }
  .modal .sf-label { font-size: 10px; margin-bottom: 5px; letter-spacing: 1px; }
  .modal .sf-input { padding: 10px 12px; font-size: 12px; border-radius: 8px; background: var(--bg); }
  .modal .sf-input.num { width: 90px; padding: 10px 12px; font-size: 14px; font-weight: 700; }
  .modal .sf-row { margin-bottom: 12px; gap: 12px; }
  .modal .sf-row .sf-label { font-size: 10px; min-width: 72px; }
  .modal .sf-unit { font-size: 11px; }
  .modal .sf-sep { margin: 16px 0; }
  .modal .role-pills { gap: 6px; }
  .modal .role-pill { padding: 6px 16px; font-size: 11px; border-radius: 16px; }

  .modal-group { margin-bottom: 16px; }
  .modal-group-title { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: var(--text-dim); margin-bottom: 10px; }

  .dt-action { padding: 16px; border: 1px solid var(--border); border-radius: 10px; margin-bottom: 10px; display: flex; align-items: center; gap: 14px; transition: border-color 0.15s; }
  .dt-action:hover { border-color: var(--border-hover); }
  .dt-action .dt-icon { width: 36px; height: 36px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 15px; flex-shrink: 0; }
  .dt-action .dt-info { flex: 1; }
  .dt-action .dt-name { font-size: 12px; font-weight: 600; color: var(--text-bright); margin-bottom: 2px; }
  .dt-action .dt-desc { font-size: 10px; color: var(--text-dim); }
  .dt-action .sf-btn { flex-shrink: 0; padding: 7px 18px; font-size: 11px; border-radius: 8px; }
  .dt-action.seed .dt-icon { background: var(--blue-bg); color: var(--blue); }
  .dt-action.wipe .dt-icon { background: var(--red-bg); color: var(--red); }
  .wh-tabs { display: flex; gap: 4px; margin-bottom: 12px; }
  .wh-tab { padding: 4px 12px; border: 1px solid var(--border); border-radius: 12px; background: transparent; color: var(--text-dim); font-size: 11px; font-weight: 600; cursor: pointer; transition: all 0.12s; }
  .wh-tab:hover { border-color: var(--border-hover); color: var(--text-muted); }
  .wh-tab.active { background: var(--blue-bg); border-color: rgba(88,166,255,0.3); color: var(--blue); }
  .sf-btn.secondary { background: transparent; color: var(--text-muted); border: 1px solid var(--border); }
  .sf-btn.secondary:hover { background: var(--bg-surface); }

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
      <div class="sb-label">Configuration</div>

      <!-- Webhook (opens modal) -->
      <div class="sb-link" id="webhook-open">
        <div class="icon">&#9889;</div>
        <span class="title">Webhook</span>
        <span class="arrow">&#8250;</span>
      </div>

      <!-- Email Reports (opens modal) -->
      <div class="sb-link" id="email-reports-open">
        <div class="icon">&#9993;</div>
        <span class="title">Email Reports</span>
        <span class="arrow">&#8250;</span>
      </div>

      <!-- Users (opens modal) -->
      <div class="sb-link" id="users-open">
        <div class="icon users">&#9679;</div>
        <span class="title">Users</span>
        <span class="arrow">&#8250;</span>
      </div>

      <!-- Pipeline (opens modal) -->
      <div class="sb-link" id="pipeline-open">
        <div class="icon pipeline">&#9881;</div>
        <span class="title">Pipeline</span>
        <span class="arrow">&#8250;</span>
      </div>
    </div>

    <div class="sb-section">
      <!-- Dev Tools (opens modal, conditionally shown) -->
      <div class="sb-link" id="devtools-open" style="display:none">
        <div class="icon dev">&#9888;</div>
        <span class="title">Dev Tools</span>
        <span class="arrow">&#8250;</span>
      </div>
    </div>
  </aside>

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
        <div class="panel-title">Review Queue</div>
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

    <div class="tbl">
      <div class="tbl-title">Active Audits</div>
      <table><thead><tr><th>Finding ID</th><th>Step</th><th>Duration</th></tr></thead>
      <tbody id="tb-active"><tr class="empty-row"><td colspan="3">No active audits</td></tr></tbody></table>
    </div>

    <div class="tbl">
      <div class="tbl-title">Recent Errors (24h)</div>
      <table><thead><tr><th>Finding ID</th><th>Step</th><th>Error</th><th>When</th></tr></thead>
      <tbody id="tb-errors"><tr class="empty-row"><td colspan="4">No errors</td></tr></tbody></table>
    </div>
  </main>
</div>

<!-- Webhook Modal -->
<div class="modal-overlay" id="webhook-modal">
  <div class="modal">
    <div class="modal-title">Webhook Configuration</div>
    <div class="wh-tabs" id="wh-tabs">
      <button class="wh-tab active" data-kind="terminate">Terminate</button>
      <button class="wh-tab" data-kind="appeal">Appeal</button>
      <button class="wh-tab" data-kind="manager">Manager</button>
      <button class="wh-tab" data-kind="judge-finish">Judge Finish</button>
    </div>
    <div class="modal-sub" id="wh-sub">Called when an audit review is completed</div>
    <div class="sf">
      <label class="sf-label">POST URL</label>
      <input type="text" class="sf-input" id="a-posturl" placeholder="https://example.com/webhook">
    </div>
    <div class="sf">
      <label class="sf-label">Headers (JSON)</label>
      <textarea class="sf-input" id="a-headers" placeholder='{"Authorization": "Bearer ..."}'></textarea>
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

<!-- Users Modal -->
<div class="modal-overlay" id="users-modal">
  <div class="modal">
    <div class="modal-title">Add User</div>
    <div class="modal-sub">Create a new account with a specific role</div>
    <div class="modal-group">
      <div class="modal-group-title">Credentials</div>
      <div class="sf">
        <label class="sf-label">Email</label>
        <input type="email" class="sf-input" id="a-username" placeholder="jsmith@example.com">
      </div>
      <div class="sf">
        <label class="sf-label">Password</label>
        <input type="password" class="sf-input" id="a-password" placeholder="&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;">
      </div>
    </div>
    <div class="modal-group">
      <div class="modal-group-title">Role</div>
      <div class="role-pills" id="a-role-group">
        <button class="role-pill active" data-role="reviewer">Reviewer</button>
        <button class="role-pill" data-role="judge">Judge</button>
        <button class="role-pill" data-role="manager">Manager</button>
      </div>
    </div>
    <div class="modal-group" id="supervisor-group">
      <div class="modal-group-title" id="supervisor-label">Assign to Judge</div>
      <div class="sf">
        <select class="sf-input" id="a-supervisor">
          <option value="">-- Select --</option>
        </select>
      </div>
    </div>
    <div class="modal-actions">
      <button class="sf-btn secondary" id="users-cancel">Cancel</button>
      <button class="sf-btn primary" id="a-adduser">Add User</button>
    </div>
  </div>
</div>

<!-- Pipeline Modal -->
<div class="modal-overlay" id="pipeline-modal">
  <div class="modal">
    <div class="modal-title">Pipeline Settings</div>
    <div class="modal-sub">Control concurrency and failure recovery</div>
    <div class="modal-group">
      <div class="modal-group-title">Concurrency</div>
      <div class="sf-row">
        <label class="sf-label">Parallelism</label>
        <input type="number" class="sf-input num" id="a-parallelism" min="1" max="100" placeholder="--">
      </div>
    </div>
    <div class="sf-sep"></div>
    <div class="modal-group">
      <div class="modal-group-title">Retry Policy</div>
      <div class="sf-row">
        <label class="sf-label">Max Retries</label>
        <input type="number" class="sf-input num" id="a-retries" min="0" max="50" placeholder="--">
      </div>
      <div class="sf-row">
        <label class="sf-label">Delay</label>
        <input type="number" class="sf-input num" id="a-retry-delay" min="0" max="300" placeholder="--">
        <span class="sf-unit">sec</span>
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
      <div class="dt-icon">&#9881;</div>
      <div class="dt-info">
        <div class="dt-name">Seed Test Data</div>
        <div class="dt-desc">Populate KV with sample findings for testing</div>
      </div>
      <button class="sf-btn primary" id="a-seed-btn">Seed</button>
    </div>
    <div class="dt-action wipe">
      <div class="dt-icon">&#9888;</div>
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

    // Charts
    drawActivityChart(p.completedTs, p.errorsTs, p.retriesTs);
    drawDonut(r.pending || 0, r.decided || 0);
  }

  function renderActive(active) {
    var tb = document.getElementById('tb-active');
    if (!active.length) { tb.innerHTML = '<tr class="empty-row"><td colspan="3">No active audits</td></tr>'; return; }
    tb.innerHTML = '';
    for (var i = 0; i < active.length; i++) {
      var a = active[i], tr = document.createElement('tr');
      tr.innerHTML = '<td class="mono">' + (a.findingId||'--') + '</td><td><span class="step-badge">' + (a.step||'--') + '</span></td><td class="duration">' + dur(a.ts) + '</td>';
      tb.appendChild(tr);
    }
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

  fetchData();
  setInterval(function() { countdown--; if (countdown <= 0) { fetchData(); countdown = 30; } document.getElementById('countdown').textContent = String(countdown); }, 1000);
  setInterval(tickLive, 1000);

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
  function fetchUsers() {
    return fetch('/admin/users').then(function(r){return r.json()}).then(function(d) {
      allUsers = Array.isArray(d) ? d : [];
    }).catch(function(){ allUsers = []; });
  }
  function updateSupervisorDropdown() {
    var group = document.getElementById('supervisor-group');
    var label = document.getElementById('supervisor-label');
    var sel = document.getElementById('a-supervisor');
    if (selectedRole === 'manager') {
      group.style.display = 'none';
      sel.value = '';
      return;
    }
    group.style.display = '';
    var filterRole = selectedRole === 'reviewer' ? 'judge' : 'manager';
    label.textContent = selectedRole === 'reviewer' ? 'Assign to Judge' : 'Assign to Manager';
    var opts = '<option value="">-- Select --</option>';
    for (var i = 0; i < allUsers.length; i++) {
      if (allUsers[i].role === filterRole) {
        opts += '<option value="' + esc(allUsers[i].username) + '">' + esc(allUsers[i].username) + '</option>';
      }
    }
    sel.innerHTML = opts;
  }
  document.getElementById('users-open').addEventListener('click', function() {
    openModal('users-modal');
    fetchUsers().then(function() { updateSupervisorDropdown(); });
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

  // ===== Dev Tools Modal =====
  document.getElementById('devtools-open').addEventListener('click', function() { openModal('devtools-modal'); });
  document.getElementById('devtools-cancel').addEventListener('click', function() { closeModal('devtools-modal'); });
  backdropClose('devtools-modal');

  // ===== Webhook Modal =====
  var modal = document.getElementById('webhook-modal');
  var whKind = 'terminate';
  var whSubs = { terminate: 'Called when an audit is terminated (100% first pass or review completed)', appeal: 'Called when an appeal is filed', manager: 'Called when remediation is submitted', 'judge-finish': 'Called when a judge finishes all appeal decisions for an audit' };
  var whCache = {};

  function loadWebhookTab(kind) {
    whKind = kind;
    document.querySelectorAll('.wh-tab').forEach(function(t){t.classList.toggle('active',t.getAttribute('data-kind')===kind)});
    document.getElementById('wh-sub').textContent = whSubs[kind];
    if (whCache[kind]) {
      document.getElementById('a-posturl').value = whCache[kind].postUrl || '';
      document.getElementById('a-headers').value = whCache[kind].postHeaders ? JSON.stringify(whCache[kind].postHeaders, null, 2) : '';
    } else {
      document.getElementById('a-posturl').value = '';
      document.getElementById('a-headers').value = '';
      fetch('/admin/settings/' + kind).then(function(r){return r.json()}).then(function(d) {
        whCache[kind] = d;
        if (whKind === kind) {
          document.getElementById('a-posturl').value = d.postUrl || '';
          document.getElementById('a-headers').value = d.postHeaders ? JSON.stringify(d.postHeaders, null, 2) : '';
        }
      }).catch(function(){});
    }
  }

  document.getElementById('wh-tabs').addEventListener('click', function(e) {
    var tab = e.target.closest('.wh-tab');
    if (tab) loadWebhookTab(tab.getAttribute('data-kind'));
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
    btnLoad(btn);
    var saved = { postUrl: url, postHeaders: headers };
    fetch('/admin/settings/' + whKind, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(saved) })
    .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()})
    .then(function(){whCache[whKind]=saved;toast(whKind+' webhook saved','success');btnDone(btn,'Save')})
    .catch(function(e){toast(e.message,'error');btnDone(btn,'Save')});
  });

  // ===== Users =====
  var selectedRole = 'reviewer';
  document.getElementById('a-role-group').addEventListener('click', function(e) {
    var pill = e.target.closest('.role-pill');
    if (!pill) return;
    this.querySelectorAll('.role-pill').forEach(function(p){p.classList.remove('active')});
    pill.classList.add('active');
    selectedRole = pill.getAttribute('data-role');
    updateSupervisorDropdown();
  });
  document.getElementById('a-adduser').addEventListener('click', function() {
    var btn = this, u = document.getElementById('a-username').value.trim(), p = document.getElementById('a-password').value;
    if (!u || !p) { toast('Enter email & password','error'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u)) { toast('Enter a valid email address','error'); return; }
    var sup = document.getElementById('a-supervisor').value;
    btnLoad(btn,'Adding...');
    fetch('/admin/users', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username:u,password:p,role:selectedRole,supervisor:sup||null}) })
    .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()})
    .then(function(d){ toast(d.role+' "'+u+'" created','success'); document.getElementById('a-username').value=''; document.getElementById('a-password').value=''; btnDone(btn,'Add User'); })
    .catch(function(e){toast(e.message,'error');btnDone(btn,'Add User')});
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
      html += '<table class="er-table"><thead><tr><th>Name</th><th>Recipients</th><th>Sections</th><th></th></tr></thead><tbody>';
      for (var i = 0; i < emailConfigs.length; i++) {
        var c = emailConfigs[i];
        var enabledCount = 0;
        for (var k = 0; k < SECTIONS.length; k++) { if (c.sections[SECTIONS[k]] && c.sections[SECTIONS[k]].enabled) enabledCount++; }
        html += '<tr data-idx="'+i+'"><td>'+esc(c.name)+'</td><td>'+c.recipients.length+'</td><td>'+enabledCount+'/'+SECTIONS.length+'</td><td><button class="er-trash" data-id="'+c.id+'" title="Delete">&#128465;</button></td></tr>';
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
    var html = '<div class="er-header"><div style="display:flex;align-items:center;gap:8px"><button class="er-back" id="er-back-btn">&#8592;</button><div class="modal-title">'+(isNew?'New Report Config':'Edit Report Config')+'</div></div></div>';
    html += '<div class="sf"><label class="sf-label">Name</label><input type="text" class="sf-input" id="er-name" value="'+esc(c.name)+'" placeholder="Weekly Executive Summary"></div>';
    html += '<div class="sf"><label class="sf-label">Recipients (one per line)</label><textarea class="sf-input" id="er-recipients" placeholder="ceo@example.com">'+(c.recipients||[]).join('\\n')+'</textarea></div>';
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
      var payload = { name: name, recipients: recips, sections: sections };
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
})();
</script>
</body>
</html>`;
}
