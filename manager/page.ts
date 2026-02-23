/** Inline HTML/CSS/JS for the manager portal UI. */

export function getManagerPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Auto-Bot Manager</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0a0e14; color: #c9d1d9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; min-height: 100vh; }

  /* ===== Login ===== */
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

  /* ===== App shell ===== */
  #app { display: none; min-height: 100vh; }

  /* Nav header */
  .nav-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 24px; height: 52px; background: #0f1219; border-bottom: 1px solid #1a1f2b;
  }
  .nav-left { display: flex; align-items: center; gap: 24px; }
  .nav-brand { font-size: 16px; font-weight: 700; color: #e6edf3; }
  .nav-tabs { display: flex; gap: 4px; }
  .nav-tab {
    padding: 6px 16px; border-radius: 8px; font-size: 13px; font-weight: 600;
    color: #6e7681; cursor: pointer; border: none; background: none;
    transition: all 0.15s;
  }
  .nav-tab:hover { color: #c9d1d9; background: #141820; }
  .nav-tab.active { color: #e6edf3; background: rgba(139,92,246,0.12); }
  .nav-right { display: flex; align-items: center; gap: 12px; }
  .nav-user { font-size: 12px; color: #6e7681; }
  .nav-user strong { color: #c9d1d9; }
  .nav-btn {
    background: none; border: 1px solid #1e2736; border-radius: 6px;
    padding: 4px 12px; color: #6e7681; font-size: 11px; cursor: pointer;
    transition: all 0.15s; text-transform: uppercase; letter-spacing: 0.5px;
  }
  .nav-btn:hover { background: #141820; color: #8b949e; border-color: #2d333b; }

  .container { padding: 20px 24px; max-width: 1400px; margin: 0 auto; }
  .screen { display: none; }
  .screen.active { display: block; }

  /* ===== Summary cards ===== */
  .stat-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 20px; }
  .stat-card {
    background: #12161e; border: 1px solid #1e2736; border-radius: 12px;
    padding: 18px 20px; transition: border-color 0.2s;
  }
  .stat-card:hover { border-color: #2d333b; }
  .stat-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: #6e7681; margin-bottom: 6px; }
  .stat-value { font-size: 28px; font-weight: 700; color: #e6edf3; font-variant-numeric: tabular-nums; }
  .stat-card.accent-purple .stat-value { color: #bc8cff; }
  .stat-card.accent-blue .stat-value { color: #58a6ff; }
  .stat-card.accent-cyan .stat-value { color: #79c0ff; }
  .stat-card.accent-yellow .stat-value { color: #d29922; }

  /* ===== Queue table ===== */
  .toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
  .toolbar-left { display: flex; gap: 8px; align-items: center; }
  .filter-btn {
    padding: 5px 14px; border-radius: 8px; font-size: 12px; font-weight: 600;
    color: #6e7681; cursor: pointer; border: 1px solid #1e2736; background: none;
    transition: all 0.15s;
  }
  .filter-btn:hover { background: #141820; color: #8b949e; }
  .filter-btn.active { background: rgba(139,92,246,0.12); color: #bc8cff; border-color: rgba(139,92,246,0.3); }
  .backfill-btn {
    padding: 5px 14px; border-radius: 8px; font-size: 12px; font-weight: 600;
    color: #58a6ff; cursor: pointer; border: 1px solid rgba(31,111,235,0.3); background: none;
    transition: all 0.15s;
  }
  .backfill-btn:hover { background: rgba(31,111,235,0.1); }

  .table-panel {
    background: #12161e; border: 1px solid #1e2736; border-radius: 12px;
    padding: 0; overflow: hidden;
  }
  table { width: 100%; border-collapse: collapse; }
  th {
    text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 1px; color: #484f58; padding: 12px 16px; border-bottom: 1px solid #1a1f2b;
    background: #0f1219;
  }
  td { font-size: 13px; padding: 12px 16px; border-bottom: 1px solid #141820; color: #8b949e; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: rgba(139,92,246,0.03); }
  .mono { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px; color: #c9d1d9; }
  .empty-row td { text-align: center; color: #3d4452; font-style: italic; padding: 40px; }

  .status-badge {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.5px;
  }
  .status-badge.pending { background: rgba(210,153,34,0.1); color: #d29922; }
  .status-badge.pending::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: #d29922; }
  .status-badge.addressed { background: rgba(88,166,255,0.1); color: #58a6ff; }
  .status-badge.addressed::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: #58a6ff; }

  .fail-ratio { font-weight: 700; }
  .fail-ratio.bad { color: #d29922; }
  .fail-ratio.moderate { color: #bc8cff; }

  .view-btn {
    padding: 4px 12px; border-radius: 6px; font-size: 11px; font-weight: 600;
    color: #58a6ff; cursor: pointer; border: 1px solid rgba(31,111,235,0.3); background: none;
    transition: all 0.15s;
  }
  .view-btn:hover { background: rgba(31,111,235,0.1); }

  /* ===== Detail screen ===== */
  .detail-header { display: flex; align-items: center; gap: 16px; margin-bottom: 20px; }
  .back-btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 6px 14px; border-radius: 8px; font-size: 12px; font-weight: 600;
    color: #6e7681; cursor: pointer; border: 1px solid #1e2736; background: none;
    transition: all 0.15s;
  }
  .back-btn:hover { background: #141820; color: #8b949e; }
  .detail-title { font-size: 18px; font-weight: 700; color: #e6edf3; }
  .detail-meta { display: flex; gap: 8px; flex-wrap: wrap; margin-left: auto; }
  .meta-chip {
    display: inline-flex; align-items: center; gap: 4px;
    background: #141820; border: 1px solid #1a1f2b; border-radius: 6px;
    padding: 4px 10px; font-size: 11px; color: #6e7681; white-space: nowrap;
  }
  .meta-chip strong { color: #c9d1d9; font-weight: 600; }

  /* Score bar */
  .score-bar-wrap { margin-bottom: 20px; }
  .score-bar-label { font-size: 11px; color: #6e7681; margin-bottom: 6px; display: flex; justify-content: space-between; }
  .score-bar { height: 8px; background: #1a1f2b; border-radius: 4px; overflow: hidden; display: flex; }
  .score-bar .pass { background: #58a6ff; transition: width 0.4s; }
  .score-bar .fail { background: #d29922; transition: width 0.4s; }
  .score-bar .flip { background: #bc8cff; transition: width 0.4s; }

  /* Failed question cards */
  .q-cards { display: flex; flex-direction: column; gap: 12px; margin-bottom: 24px; }
  .q-card {
    background: #12161e; border: 1px solid #1e2736; border-radius: 12px;
    padding: 18px 20px; transition: border-color 0.2s;
  }
  .q-card:hover { border-color: #2d333b; }
  .q-card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .q-card-title { font-size: 15px; font-weight: 700; color: #e6edf3; }
  .q-card-badge {
    font-size: 10px; font-weight: 700; padding: 3px 10px; border-radius: 20px;
    text-transform: uppercase; letter-spacing: 0.5px;
  }
  .q-card-badge.confirmed { background: rgba(210,153,34,0.12); color: #d29922; }
  .q-card-badge.flipped { background: rgba(139,92,246,0.12); color: #bc8cff; }

  .q-card-section { margin-bottom: 10px; }
  .q-card-label {
    font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;
    color: #58a6ff; margin-bottom: 4px;
  }
  .q-card-text {
    font-size: 13px; line-height: 1.6; color: #b0b8c4;
    padding: 10px 14px; background: #0f1219; border-radius: 8px; border: 1px solid #1a1f2b;
  }
  .q-card-reviewer { font-size: 11px; color: #484f58; margin-top: 6px; }
  .q-card-reviewer strong { color: #6e7681; }

  .q-card-snippet {
    font-size: 12px; line-height: 1.6; color: #8b949e;
    padding: 8px 12px; background: rgba(250,176,5,0.05); border-radius: 8px;
    border: 1px solid rgba(250,176,5,0.15); font-style: italic;
  }

  /* Transcript */
  .transcript-section { margin-bottom: 24px; }
  .section-title {
    font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;
    color: #6e7681; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;
  }
  .section-title .toggle-icon { cursor: pointer; font-size: 10px; color: #484f58; transition: transform 0.2s; }
  .section-title .toggle-icon.open { transform: rotate(90deg); }
  .transcript-body {
    background: #12161e; border: 1px solid #1e2736; border-radius: 12px;
    padding: 16px 20px; max-height: 500px; overflow-y: auto;
    scrollbar-width: thin; scrollbar-color: #1e2736 transparent;
  }
  .transcript-body::-webkit-scrollbar { width: 4px; }
  .transcript-body::-webkit-scrollbar-thumb { background: #1e2736; border-radius: 2px; }
  .t-line {
    font-size: 13px; line-height: 1.7; margin-bottom: 6px; padding: 4px 10px 4px 12px;
    border-left: 3px solid transparent; color: #6e7681; border-radius: 0 6px 6px 0;
  }
  .t-agent { border-left-color: #1f6feb; color: #79b8ff; }
  .t-customer { border-left-color: #8b5cf6; color: #d2b3ff; }
  .t-system { border-left-color: #2d333b; color: #484f58; }
  .t-speaker { font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; margin-right: 8px; }
  .t-agent .t-speaker { color: #1f6feb; }
  .t-customer .t-speaker { color: #8b5cf6; }

  /* CRM record grid */
  .record-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px;
    background: #12161e; border: 1px solid #1e2736; border-radius: 12px; padding: 16px 20px;
    margin-bottom: 24px;
  }
  .record-field { font-size: 12px; }
  .record-field .rf-label { color: #484f58; font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; }
  .record-field .rf-value { color: #c9d1d9; margin-top: 2px; word-break: break-all; }

  /* Remediation form */
  .remediation-panel {
    background: #12161e; border: 1px solid #1e2736; border-radius: 12px; padding: 20px;
  }
  .remediation-panel h3 { font-size: 14px; font-weight: 700; color: #e6edf3; margin-bottom: 12px; }
  .remediation-panel textarea {
    width: 100%; height: 120px; padding: 12px 14px; background: #0a0e14;
    border: 1px solid #1e2736; border-radius: 10px; color: #c9d1d9; font-size: 14px;
    resize: vertical; font-family: inherit; transition: border-color 0.15s, box-shadow 0.15s;
  }
  .remediation-panel textarea:focus { outline: none; border-color: #8b5cf6; box-shadow: 0 0 0 3px rgba(139,92,246,0.15); }
  .rem-footer { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; }
  .rem-counter { font-size: 11px; color: #484f58; }
  .rem-counter.short { color: #f85149; }
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
  .remediation-display h3 { font-size: 14px; font-weight: 700; color: #58a6ff; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
  .remediation-display .rem-notes { font-size: 14px; line-height: 1.6; color: #b0b8c4; margin-bottom: 10px; white-space: pre-wrap; }
  .remediation-display .rem-meta { font-size: 11px; color: #484f58; }
  .remediation-display .rem-meta strong { color: #6e7681; }

  /* ===== Stats screen ===== */
  .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 20px; }
  .panel {
    background: #12161e; border: 1px solid #1e2736; border-radius: 12px; padding: 18px 20px;
  }
  .panel-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #6e7681; margin-bottom: 14px; }

  .aging-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .aging-bucket { text-align: center; padding: 12px; background: #0f1219; border-radius: 8px; }
  .aging-bucket .ab-val { font-size: 24px; font-weight: 700; color: #e6edf3; font-variant-numeric: tabular-nums; }
  .aging-bucket .ab-label { font-size: 10px; color: #6e7681; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  .aging-bucket.warn .ab-val { color: #d29922; }
  .aging-bucket.danger .ab-val { color: #bc8cff; }

  .trend-row { display: flex; align-items: flex-end; gap: 6px; height: 120px; padding: 10px 0; }
  .trend-bar-group { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; height: 100%; justify-content: flex-end; }
  .trend-bars { display: flex; gap: 2px; align-items: flex-end; width: 100%; justify-content: center; }
  .trend-bar { width: 14px; border-radius: 3px 3px 0 0; min-height: 2px; transition: height 0.3s; }
  .trend-bar.added { background: #bc8cff; }
  .trend-bar.resolved { background: #58a6ff; }
  .trend-label { font-size: 9px; color: #484f58; text-align: center; margin-top: 4px; }

  .stats-table { width: 100%; }
  .stats-table th { background: transparent; }

  /* ===== Toasts ===== */
  #toast-container { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); z-index: 1000; display: flex; flex-direction: column-reverse; gap: 6px; align-items: center; pointer-events: none; }
  .toast {
    padding: 8px 20px; border-radius: 10px; font-size: 13px; font-weight: 600;
    backdrop-filter: blur(16px); box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    animation: tIn 0.2s ease, tOut 0.3s ease 2s forwards;
    display: flex; align-items: center; gap: 8px;
  }
  .toast .dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .toast.success { background: rgba(18,22,30,0.95); color: #58a6ff; border: 1px solid rgba(88,166,255,0.2); }
  .toast.success .dot { background: #58a6ff; }
  .toast.error { background: rgba(18,22,30,0.95); color: #d29922; border: 1px solid rgba(210,153,34,0.2); }
  .toast.error .dot { background: #d29922; }
  .toast.info { background: rgba(18,22,30,0.95); color: #8b949e; border: 1px solid #1e2736; }
  .toast.info .dot { background: #58a6ff; }
  @keyframes tIn { from { opacity: 0; transform: translateY(8px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
  @keyframes tOut { from { opacity: 1; } to { opacity: 0; transform: translateY(-6px); } }

  @media (max-width: 900px) {
    .stat-row { grid-template-columns: repeat(2, 1fr); }
    .stats-grid { grid-template-columns: 1fr; }
    .aging-grid { grid-template-columns: repeat(2, 1fr); }
    .detail-header { flex-wrap: wrap; }
    .detail-meta { margin-left: 0; }
  }
  @media (max-width: 600px) {
    .stat-row { grid-template-columns: 1fr; }
    .nav-tabs { display: none; }
  }
</style>
</head>
<body>

<!-- Login -->
<div id="login-screen">
  <div id="login-box">
    <h2>Manager Portal</h2>
    <div id="login-subtitle">Audit failure remediation & tracking</div>
    <input type="text" id="login-user" placeholder="Username" autocomplete="username">
    <input type="password" id="login-pass" placeholder="Password" autocomplete="current-password">
    <button id="login-btn">Sign In</button>
    <div id="login-error"></div>
    <div id="setup-hint">Managers are created by the admin via the dashboard.</div>
  </div>
</div>

<!-- App -->
<div id="app">
  <div class="nav-header">
    <div class="nav-left">
      <span class="nav-brand">Manager</span>
      <div class="nav-tabs">
        <button class="nav-tab active" data-screen="queue">Queue</button>
        <button class="nav-tab" data-screen="stats">Stats</button>
      </div>
    </div>
    <div class="nav-right">
      <span class="nav-user">Signed in as <strong id="nav-username"></strong></span>
      <button class="nav-btn" id="logout-btn">Logout</button>
    </div>
  </div>

  <!-- Queue Screen -->
  <div class="screen active" id="screen-queue">
    <div class="container">
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
  </div>

  <!-- Detail Screen -->
  <div class="screen" id="screen-detail">
    <div class="container">
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
          <span class="toggle-icon" id="transcript-toggle">&#9654;</span>
        </div>
        <div class="transcript-body" id="transcript-body" style="display:none"></div>
      </div>

      <div class="section-title">CRM Record</div>
      <div class="record-grid" id="record-grid"></div>

      <div id="remediation-container"></div>
    </div>
  </div>

  <!-- Stats Screen -->
  <div class="screen" id="screen-stats">
    <div class="container">
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
            <span style="font-size:10px;color:#bc8cff;display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:2px;background:#bc8cff;display:inline-block"></span>Added</span>
            <span style="font-size:10px;color:#58a6ff;display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:2px;background:#58a6ff;display:inline-block"></span>Resolved</span>
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

  var $login = document.getElementById('login-screen');
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
    document.querySelectorAll('.nav-tab').forEach(function(t) {
      t.classList.toggle('active', t.dataset.screen === name);
    });
  }

  document.querySelectorAll('.nav-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      var screen = this.dataset.screen;
      showScreen(screen);
      if (screen === 'queue') loadQueue();
      if (screen === 'stats') loadStats();
    });
  });

  // -- Auth --
  function showLoginError(msg) {
    var el = document.getElementById('login-error');
    el.textContent = msg;
    el.style.display = 'block';
  }

  document.getElementById('login-btn').addEventListener('click', doLogin);
  document.getElementById('login-pass').addEventListener('keydown', function(e) { if (e.key === 'Enter') doLogin(); });
  document.getElementById('login-user').addEventListener('keydown', function(e) { if (e.key === 'Enter') document.getElementById('login-pass').focus(); });

  async function doLogin() {
    var u = document.getElementById('login-user').value.trim();
    var p = document.getElementById('login-pass').value;
    if (!u || !p) { showLoginError('Enter username & password'); return; }
    try {
      var data = await api('/login', { method: 'POST', body: JSON.stringify({ username: u, password: p }) });
      username = data.username;
      enterApp();
    } catch (err) {
      showLoginError(err.message);
    }
  }

  function checkSetup() {
    // Managers are created by the admin -- nothing to do here
  }

  function enterApp() {
    $login.style.display = 'none';
    $app.style.display = 'block';
    document.getElementById('nav-username').textContent = username;
    loadQueue();
  }

  // -- Logout --
  document.getElementById('logout-btn').addEventListener('click', async function() {
    try { await api('/logout', { method: 'POST' }); } catch(e) {}
    username = null;
    $app.style.display = 'none';
    $login.style.display = 'flex';
    document.getElementById('login-user').value = '';
    document.getElementById('login-pass').value = '';
    document.getElementById('login-error').style.display = 'none';
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
        $app.style.display = 'none';
        $login.style.display = 'flex';
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
      var dateStr = item.completedAt ? new Date(item.completedAt).toLocaleDateString() : '--';

      tr.innerHTML =
        '<td>' + escHtml(item.owner || '--') + '</td>' +
        '<td class="mono">' + escHtml(item.recordId || item.findingId.slice(0, 12)) + '</td>' +
        '<td><span class="fail-ratio ' + ratioClass + '">' + ratio + '</span></td>' +
        '<td style="color:#6e7681;font-size:12px">' + dateStr + '</td>' +
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

    // Hide tabs in detail mode - show back nav
    document.querySelectorAll('.nav-tab').forEach(function(t) { t.classList.remove('active'); });

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
      var dateStr = new Date(rem.addressedAt).toLocaleString();
      remContainer.innerHTML =
        '<div class="remediation-display">' +
        '<h3><span style="font-size:16px">&#10003;</span> Addressed</h3>' +
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
          await api('/remediate', { method: 'POST', body: JSON.stringify({ findingId: fid, notes: notes }) });
          toast('Remediation submitted', 'success');
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
    document.querySelector('.nav-tab[data-screen="queue"]').classList.add('active');
    loadQueue();
  });

  // -- Stats --
  async function loadStats() {
    try {
      var stats = await api('/stats');
      renderStats(stats);
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
        tr.innerHTML = '<td>' + escHtml(topQs[k].header) + '</td><td style="text-align:right;font-weight:700;color:#d29922">' + topQs[k].count + '</td>';
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
        tr2.innerHTML = '<td>' + escHtml(agents[l].agent) + '</td><td style="text-align:right">' + agents[l].audits + '</td><td style="text-align:right;font-weight:700;color:#d29922">' + agents[l].totalFailures + '</td>';
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

  // -- Init: try resuming session --
  (async function() {
    try {
      var data = await api('/me');
      username = data.username;
      enterApp();
    } catch (e) {
      checkSetup();
    }
  })();
})();
</script>
</body>
</html>`;
}
