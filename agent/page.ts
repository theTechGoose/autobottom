/** Inline HTML/CSS/JS for the agent dashboard -- personal audit results & trends. */

import * as icons from "../shared/icons.ts";

export function getAgentPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent Dashboard</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --bg: #0a0e14; --bg-raised: #111820; --bg-surface: #161c28;
    --border: #1c2333; --border-hover: #2a3346;
    --text: #c9d1d9; --text-muted: #6e7681; --text-dim: #484f58; --text-bright: #e6edf3;
    --accent: #f97316; --accent-dim: #ea580c; --accent-bg: rgba(249,115,22,0.10);
    --green: #3fb950; --red: #f85149; --yellow: #d29922;
    --green-bg: rgba(63,185,80,0.10); --red-bg: rgba(248,81,73,0.10); --yellow-bg: rgba(210,153,34,0.10);
    --sidebar-w: 280px;
    --mono: 'SF Mono', 'Fira Code', monospace;
  }
  body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; min-height: 100vh; }

  /* Layout */
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
  .sb-link .title { font-size: 12px; font-weight: 600; color: var(--text-bright); flex: 1; }
  .sb-link .arrow { font-size: 10px; color: var(--text-dim); }
  .sb-footer { margin-top: auto; border-top: 1px solid var(--border); }
  .sb-footer .sb-user { padding: 14px 18px 8px; display: flex; align-items: center; gap: 8px; }
  .sb-footer .sb-avatar { width: 28px; height: 28px; border-radius: 50%; background: var(--accent-bg); color: var(--accent); display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0; }
  .sb-footer .sb-email { font-size: 11px; color: var(--text-bright); font-weight: 600; word-break: break-all; line-height: 1.3; }
  .sb-footer .sb-role { font-size: 9px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; }
  .sb-footer .sb-settings { padding: 6px 14px 14px; }
  .main { margin-left: var(--sidebar-w); flex: 1; padding: 24px 32px; }

  /* Stat cards row */
  .stat-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .stat-card {
    background: var(--bg-raised); border: 1px solid var(--border); border-radius: 10px;
    padding: 16px 18px; transition: border-color 0.15s;
  }
  .stat-card:hover { border-color: var(--border-hover); }
  .stat-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--text-dim); margin-bottom: 6px; }
  .stat-value { font-size: 28px; font-weight: 700; color: var(--text-bright); font-variant-numeric: tabular-nums; }
  .stat-value.accent { color: var(--accent); }
  .stat-value.green { color: var(--green); }
  .stat-value.red { color: var(--red); }
  .stat-value.yellow { color: var(--yellow); }
  .stat-sub { font-size: 11px; color: var(--text-dim); margin-top: 2px; }

  /* Section */
  .section { margin-bottom: 28px; }
  .section-head {
    display: flex; align-items: center; gap: 10px;
    margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border);
  }
  .section-title { font-size: 13px; font-weight: 700; color: var(--text-bright); text-transform: uppercase; letter-spacing: 0.8px; }
  .section-badge {
    font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 10px;
    background: var(--accent-bg); color: var(--accent);
  }

  /* Weekly trend chart */
  .trend-chart {
    display: flex; align-items: flex-end; gap: 8px; height: 140px;
    padding: 16px 18px 12px; background: var(--bg-raised); border: 1px solid var(--border);
    border-radius: 10px; margin-bottom: 24px;
  }
  .trend-bar-group {
    flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px;
    height: 100%;
  }
  .trend-bar-wrap {
    flex: 1; width: 100%; display: flex; flex-direction: column; justify-content: flex-end;
    align-items: center; position: relative;
  }
  .trend-bar {
    width: 100%; max-width: 48px; border-radius: 4px 4px 0 0;
    background: var(--accent); opacity: 0.8; transition: opacity 0.15s;
    min-height: 2px; position: relative;
  }
  .trend-bar:hover { opacity: 1; }
  .trend-bar-value {
    font-size: 9px; font-weight: 700; color: var(--text-muted); text-align: center;
    margin-bottom: 2px; font-family: var(--mono); font-variant-numeric: tabular-nums;
  }
  .trend-bar-label {
    font-size: 9px; color: var(--text-dim); text-align: center; margin-top: 6px;
    white-space: nowrap; font-family: var(--mono);
  }
  .trend-bar-audits {
    font-size: 8px; color: var(--text-dim); text-align: center; margin-top: 1px;
  }
  .trend-empty {
    display: flex; align-items: center; justify-content: center;
    height: 100%; color: var(--text-dim); font-size: 12px; font-style: italic;
    width: 100%;
  }

  /* Table */
  .tbl-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 10px; background: var(--bg-raised); }
  .tbl { width: 100%; border-collapse: collapse; }
  .tbl th {
    text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 1px; color: var(--text-dim); padding: 10px 12px;
    border-bottom: 1px solid var(--border); background: var(--bg-raised);
    position: sticky; top: 0; z-index: 1;
  }
  .tbl td {
    font-size: 13px; padding: 10px 12px; border-bottom: 1px solid var(--border);
    color: var(--text); font-variant-numeric: tabular-nums;
  }
  .tbl tbody tr:nth-child(even) td { background: rgba(17,24,32,0.5); }
  .tbl tbody tr:hover td { background: var(--bg-surface); }
  .tbl .mono { font-family: var(--mono); font-size: 11px; }
  .tbl .num { text-align: right; }

  /* Pill badges */
  .pill {
    display: inline-block; font-size: 10px; font-weight: 600; padding: 2px 8px;
    border-radius: 10px;
  }
  .pill-green { background: var(--green-bg); color: var(--green); }
  .pill-red { background: var(--red-bg); color: var(--red); }
  .pill-yellow { background: var(--yellow-bg); color: var(--yellow); }
  .pill-accent { background: var(--accent-bg); color: var(--accent); }

  /* Score pill */
  .score-pill {
    display: inline-block; font-size: 12px; font-weight: 700; padding: 2px 10px;
    border-radius: 10px; font-family: var(--mono); font-variant-numeric: tabular-nums;
  }

  /* Action link */
  .action-link {
    font-size: 11px; font-weight: 600; color: var(--accent); text-decoration: none;
    padding: 4px 10px; border: 1px solid var(--accent); border-radius: 6px;
    transition: all 0.15s; white-space: nowrap;
  }
  .action-link:hover { background: var(--accent-bg); }

  /* Loading / Error */
  .loading-wrap { display: flex; align-items: center; justify-content: center; padding: 60px; color: var(--text-dim); font-size: 13px; }
  .error-msg { padding: 12px 16px; background: var(--red-bg); color: var(--red); border-radius: 8px; font-size: 13px; display: none; margin-bottom: 16px; }

  /* Empty table state */
  .empty-row td { color: var(--text-dim); font-style: italic; text-align: center; padding: 20px; }

  /* ===== Gamification ===== */
  .game-bar {
    display: flex; align-items: center; gap: 12px; padding: 10px 18px;
    border-bottom: 1px solid var(--border); background: var(--bg-raised);
  }
  .level-badge {
    font-size: 11px; font-weight: 800; color: var(--accent); background: var(--accent-bg);
    padding: 3px 8px; border-radius: 6px; letter-spacing: 0.3px;
  }
  .xp-bar-wrap {
    flex: 1; height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; max-width: 100px;
  }
  .xp-bar-fill {
    height: 100%; background: linear-gradient(90deg, var(--accent-dim), var(--accent));
    border-radius: 3px; transition: width 0.4s ease; width: 0%;
  }
  .token-display {
    font-size: 11px; font-weight: 700; color: var(--yellow);
    display: flex; align-items: center; gap: 4px;
  }

  /* Badge showcase */
  .badge-showcase { display: flex; flex-wrap: wrap; gap: 10px; }
  .badge-item {
    display: flex; align-items: center; gap: 8px; padding: 8px 14px;
    background: var(--bg); border: 1px solid var(--border); border-radius: 10px; font-size: 12px;
  }
  .badge-item .bi-icon { font-size: 18px; }
  .badge-item .bi-name { font-weight: 600; color: var(--text-bright); }
  .badge-item .bi-tier { font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; margin-left: 4px; }
  .badge-item.locked { opacity: 0.35; }
  .badge-item.locked .bi-icon { filter: grayscale(1); }

  /* Store */
  .store-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
  .store-item {
    background: var(--bg); border: 1px solid var(--border); border-radius: 10px;
    padding: 16px; text-align: center; transition: border-color 0.15s;
  }
  .store-item:hover { border-color: var(--border-hover); }
  .store-item .si-icon { font-size: 28px; margin-bottom: 6px; }
  .store-item .si-name { font-size: 13px; font-weight: 700; color: var(--text-bright); margin-bottom: 4px; }
  .store-item .si-price { font-size: 11px; color: var(--yellow); font-weight: 600; margin-bottom: 10px; }
  .store-item .si-btn {
    padding: 6px 18px; border-radius: 8px; font-size: 11px; font-weight: 600;
    cursor: pointer; border: none; transition: all 0.15s;
  }
  .store-item .si-btn.buy {
    background: linear-gradient(135deg, var(--accent-dim), var(--accent));
    color: #fff;
  }
  .store-item .si-btn.buy:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(249,115,22,0.3); }
  .store-item .si-btn.buy:disabled { opacity: 0.5; cursor: not-allowed; transform: none !important; }
  .store-item .si-btn.owned {
    background: var(--green-bg); color: var(--green); cursor: default;
  }

  /* Tabs */
  .main-tabs { display: flex; gap: 4px; margin-bottom: 20px; }
  .main-tab {
    padding: 6px 16px; border-radius: 8px; font-size: 13px; font-weight: 600;
    color: var(--text-muted); cursor: pointer; border: none; background: none;
    transition: all 0.15s;
  }
  .main-tab:hover { color: var(--text); background: var(--bg-raised); }
  .main-tab.active { color: var(--text-bright); background: var(--accent-bg); }
  .tab-content { display: none; }
  .tab-content.active { display: block; }

  /* Toast */
  #toast-container { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); z-index: 1000; display: flex; flex-direction: column-reverse; gap: 6px; align-items: center; pointer-events: none; }
  .toast {
    padding: 8px 20px; border-radius: 10px; font-size: 13px; font-weight: 600;
    backdrop-filter: blur(16px); box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    animation: tIn 0.2s ease, tOut 0.3s ease 2s forwards;
    display: flex; align-items: center; gap: 8px; color: var(--text-bright);
  }
  .toast .dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .toast.success { background: rgba(17,24,32,0.95); color: var(--green); border: 1px solid rgba(63,185,80,0.2); }
  .toast.success .dot { background: var(--green); }
  .toast.error { background: rgba(17,24,32,0.95); color: var(--red); border: 1px solid rgba(248,81,73,0.2); }
  .toast.error .dot { background: var(--red); }
  @keyframes tIn { from { opacity: 0; transform: translateY(8px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
  @keyframes tOut { from { opacity: 1; } to { opacity: 0; transform: translateY(-6px); } }

  /* Broadcast toast */
  .broadcast-toast{position:fixed;top:20px;right:20px;background:rgba(22,28,40,0.95);border:1px solid rgba(249,115,22,0.25);border-radius:12px;padding:14px 20px;color:#e6edf3;font-size:13px;font-weight:600;z-index:9000;transform:translateX(120%);transition:transform 0.4s ease;backdrop-filter:blur(12px);max-width:360px;box-shadow:0 8px 32px rgba(0,0,0,0.4);}
  .broadcast-toast.show{transform:translateX(0);}

  /* Responsive */
  @media (max-width: 900px) {
    .sidebar { display: none; }
    .main { margin-left: 0; padding: 16px; }
    .stat-row { grid-template-columns: 1fr; }
    .trend-chart { height: 120px; padding: 12px; }
    .tbl-wrap { font-size: 12px; }
    .store-grid { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>

<div class="layout">
  <aside class="sidebar">
    <div class="sb-brand">
      <h1>Auto-Bot</h1>
      <div class="sb-sub">Agent Panel</div>
    </div>
    <div class="game-bar" id="game-bar" style="display:none">
      <span class="level-badge" id="level-badge">Lv.0</span>
      <span class="xp-bar-wrap"><span class="xp-bar-fill" id="xp-bar-fill"></span></span>
      <span class="token-display" id="token-display">0</span>
    </div>
    <div class="sb-section">
      <div class="sb-label">Navigation</div>
      <a href="/agent" class="sb-link active" data-tab="dashboard">
        <div class="icon accent">${icons.barChart}</div>
        <span class="title">Dashboard</span>
        <span class="arrow">${icons.chevronRight}</span>
      </a>
      <a class="sb-link" data-tab="badges">
        <div class="icon" style="background:var(--yellow-bg);color:var(--yellow);">&#127942;</div>
        <span class="title">Badges</span>
        <span class="arrow">${icons.chevronRight}</span>
      </a>
      <a href="/chat" class="sb-link">
        <div class="icon" style="background:rgba(57,208,216,0.10);color:#39d0d8;">${icons.messageCircle24}</div>
        <span class="title">Chat</span>
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
        <div class="sb-avatar" id="user-avatar">-</div>
        <div>
          <div class="sb-email" id="user-email">--</div>
          <div class="sb-role">Agent</div>
        </div>
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
    <div id="error-msg" class="error-msg"></div>
    <div id="loading" class="loading-wrap">Loading dashboard data...</div>

    <div id="dashboard" style="display:none">

    <!-- Dashboard Tab -->
    <div class="tab-content active" id="tab-dashboard">

    <!-- Top stat cards -->
    <div class="stat-row">
      <div class="stat-card">
        <div class="stat-label">Total Audits</div>
        <div class="stat-value accent" id="s-total">0</div>
        <div class="stat-sub">all time</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Average Score</div>
        <div class="stat-value" id="s-avg-score">--</div>
        <div class="stat-sub">across all audits</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">This Week</div>
        <div class="stat-value accent" id="s-this-week">0</div>
        <div class="stat-sub">audits completed</div>
      </div>
    </div>

    <!-- Weekly trend -->
    <div class="section">
      <div class="section-head">
        <span class="section-title">Weekly Trend</span>
        <span class="section-badge">Last 8 Weeks</span>
      </div>
      <div class="trend-chart" id="trend-chart">
        <div class="trend-empty">No trend data available</div>
      </div>
    </div>

    <!-- Audit reports table -->
    <div class="section">
      <div class="section-head">
        <span class="section-title">Audit Reports</span>
        <span class="section-badge" id="report-count">0</span>
      </div>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th>Date</th>
              <th>Record ID</th>
              <th>Recording ID</th>
              <th class="num">Questions</th>
              <th class="num">Passed</th>
              <th class="num">Failed</th>
              <th class="num">Score</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody id="audit-tbody">
            <tr class="empty-row"><td colspan="8">No audit reports yet</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    </div><!-- /tab-dashboard -->

    <!-- Badges Tab -->
    <div class="tab-content" id="tab-badges">
      <div class="section">
        <div class="section-head">
          <span class="section-title">Your Badges</span>
          <span class="section-badge" id="badge-counter">0 / 7</span>
        </div>
        <div class="badge-showcase" id="badge-showcase"></div>
      </div>
    </div>

    <!-- Store Tab -->
    <div class="tab-content" id="tab-store">
      <div class="section">
        <div class="section-head">
          <span class="section-title">AutoBot Store</span>
          <span class="section-badge" id="store-balance">0 tokens</span>
        </div>
        <div class="store-grid" id="store-grid"></div>
      </div>
    </div>

    </div>
  </main>
</div>

<div id="toast-container"></div>

<script>
(function() {
  var logoutBtn = document.getElementById('logout-btn');
  logoutBtn.addEventListener('click', function() {
    fetch('/logout', { method: 'POST', credentials: 'same-origin' }).finally(function() {
      window.location.href = '/login';
    });
  });

  function showError(msg) {
    var el = document.getElementById('error-msg');
    el.textContent = msg;
    el.style.display = 'block';
  }

  function scoreColor(pct) {
    if (pct >= 80) return 'green';
    if (pct >= 60) return 'yellow';
    return 'red';
  }

  function scorePillClass(pct) {
    var c = scoreColor(pct);
    return 'pill-' + c;
  }

  function formatDate(dateStr) {
    if (!dateStr) return '--';
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatWeekLabel(dateStr) {
    if (!dateStr) return '--';
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  function getThisWeekCount(recentAudits) {
    var now = new Date();
    var dayOfWeek = now.getDay();
    var weekStart = new Date(now);
    weekStart.setDate(now.getDate() - dayOfWeek);
    weekStart.setHours(0, 0, 0, 0);
    var count = 0;
    for (var i = 0; i < recentAudits.length; i++) {
      var auditDate = new Date(recentAudits[i].completedAt || recentAudits[i].jobTimestamp);
      if (auditDate >= weekStart) count++;
    }
    return count;
  }

  function renderTrendChart(weeklyTrend) {
    var chart = document.getElementById('trend-chart');
    if (!weeklyTrend || weeklyTrend.length === 0) return;

    chart.innerHTML = '';
    var maxScore = 100;

    for (var i = 0; i < weeklyTrend.length; i++) {
      var w = weeklyTrend[i];
      var pct = Math.round(w.avgScore || 0);
      var barHeight = Math.max(2, (pct / maxScore) * 100);
      var color = scoreColor(pct);
      var cssColor = color === 'green' ? 'var(--green)' : color === 'yellow' ? 'var(--yellow)' : 'var(--red)';

      var group = document.createElement('div');
      group.className = 'trend-bar-group';

      var valEl = document.createElement('div');
      valEl.className = 'trend-bar-value';
      valEl.textContent = pct + '%';

      var wrap = document.createElement('div');
      wrap.className = 'trend-bar-wrap';

      var bar = document.createElement('div');
      bar.className = 'trend-bar';
      bar.style.height = barHeight + '%';
      bar.style.background = cssColor;
      bar.title = formatWeekLabel(w.weekStart) + ': ' + pct + '% (' + w.audits + ' audits)';

      wrap.appendChild(bar);

      var label = document.createElement('div');
      label.className = 'trend-bar-label';
      label.textContent = formatWeekLabel(w.weekStart);

      var auditsLabel = document.createElement('div');
      auditsLabel.className = 'trend-bar-audits';
      auditsLabel.textContent = w.audits + ' audit' + (w.audits !== 1 ? 's' : '');

      group.appendChild(valEl);
      group.appendChild(wrap);
      group.appendChild(label);
      group.appendChild(auditsLabel);
      chart.appendChild(group);
    }
  }

  function renderTable(recentAudits) {
    var tbody = document.getElementById('audit-tbody');
    document.getElementById('report-count').textContent = recentAudits.length;

    if (!recentAudits || recentAudits.length === 0) return;

    var rows = '';
    for (var i = 0; i < recentAudits.length; i++) {
      var a = recentAudits[i];
      var total = a.totalQuestions || 0;
      var passed = a.passedCount || 0;
      var failed = a.failedCount || 0;
      var scorePct = total > 0 ? Math.round((passed / total) * 100) : 0;
      var sColor = scoreColor(scorePct);
      var dateStr = formatDate(a.completedAt || a.jobTimestamp);
      var reportUrl = '/audit/report?id=' + encodeURIComponent(a.findingId);

      rows += '<tr>'
        + '<td>' + dateStr + '</td>'
        + '<td class="mono">' + escHtml(a.recordId || '--') + '</td>'
        + '<td class="mono">' + escHtml(a.recordingId || '--') + '</td>'
        + '<td class="num">' + total + '</td>'
        + '<td class="num"><span class="pill pill-green">' + passed + '</span></td>'
        + '<td class="num"><span class="pill pill-red">' + failed + '</span></td>'
        + '<td class="num"><span class="score-pill pill-' + sColor + '">' + scorePct + '%</span></td>'
        + '<td><a class="action-link" href="' + escAttr(reportUrl) + '">View Report</a></td>'
        + '</tr>';
    }
    tbody.innerHTML = rows;
  }

  function escHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function escAttr(s) {
    return s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function toast(msg, type) {
    var el = document.createElement('div');
    el.className = 'toast ' + (type || 'success');
    el.innerHTML = '<span class="dot"></span>' + escHtml(msg);
    document.getElementById('toast-container').appendChild(el);
    setTimeout(function() { el.remove(); }, 2400);
  }

  // Agent badge catalog
  var AGT_BADGES = [
    { id: 'agt_first_audit', name: 'Rookie', tier: 'common', icon: '\\u{1F393}', description: 'Complete your first audit' },
    { id: 'agt_fifty', name: 'Seasoned Agent', tier: 'uncommon', icon: '\\u{1F3C5}', description: 'Complete 50 audits' },
    { id: 'agt_hundred', name: 'Road Warrior', tier: 'rare', icon: '\\u{1F6E1}', description: 'Complete 100 audits' },
    { id: 'agt_perfect_10', name: 'Perfect Ten', tier: 'rare', icon: '\\u{1F4AF}', description: 'Score 100% on 10 audits' },
    { id: 'agt_honor_roll', name: 'Honor Roll', tier: 'uncommon', icon: '\\u{1F4DC}', description: '90%+ avg score (20+ audits)' },
    { id: 'agt_comeback', name: 'Comeback Kid', tier: 'uncommon', icon: '\\u{1F4C8}', description: 'Weekly avg improves 15+ pts' },
    { id: 'agt_consistent', name: 'Consistent Performer', tier: 'rare', icon: '\\u{1F4CA}', description: '5 weeks above 80%' },
  ];
  var TIER_COLORS = { common: '#6b7280', uncommon: '#22c55e', rare: '#3b82f6', epic: '#a855f7', legendary: '#f59e0b' };
  var AGENT_LEVELS = [0, 50, 150, 350, 700, 1200, 2000, 3000, 4500, 7000];

  var gameState = null;

  // Tab switching
  document.querySelectorAll('[data-tab]').forEach(function(link) {
    link.addEventListener('click', function(e) {
      e.preventDefault();
      var tab = this.dataset.tab;
      document.querySelectorAll('.tab-content').forEach(function(t) { t.classList.remove('active'); });
      document.querySelectorAll('[data-tab]').forEach(function(l) { l.classList.remove('active'); });
      document.getElementById('tab-' + tab).classList.add('active');
      this.classList.add('active');
      if (tab === 'badges') loadGameState();
      if (tab === 'store') loadStore();
    });
  });

  function updateLevelDisplay(gs) {
    if (!gs) return;
    document.getElementById('game-bar').style.display = 'flex';
    document.getElementById('level-badge').textContent = 'Lv.' + (gs.level || 0);
    document.getElementById('token-display').textContent = (gs.tokenBalance || 0) + ' tokens';

    var currentThreshold = AGENT_LEVELS[gs.level] || 0;
    var nextThreshold = AGENT_LEVELS[gs.level + 1] || AGENT_LEVELS[AGENT_LEVELS.length - 1];
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
    for (var j = 0; j < AGT_BADGES.length; j++) {
      var b = AGT_BADGES[j];
      var isEarned = !!earnedSet[b.id];
      if (isEarned) earned++;
      var tierColor = TIER_COLORS[b.tier] || '#6e7681';
      html +=
        '<div class="badge-item' + (isEarned ? '' : ' locked') + '" title="' + escAttr(b.description) + '"' +
        (isEarned ? ' style="border-color:' + tierColor + '"' : '') + '>' +
        '<span class="bi-icon">' + b.icon + '</span>' +
        '<span class="bi-name">' + escHtml(b.name) + '</span>' +
        '<span class="bi-tier" style="color:' + tierColor + '">' + escHtml(b.tier) + '</span>' +
        '</div>';
    }
    container.innerHTML = html;
    var counter = document.getElementById('badge-counter');
    if (counter) counter.textContent = earned + ' / ' + AGT_BADGES.length;
  }

  async function loadGameState() {
    try {
      var res = await fetch('/agent/api/game-state', { credentials: 'same-origin' });
      if (!res.ok) return;
      gameState = await res.json();
      updateLevelDisplay(gameState);
      renderBadgeShowcase(gameState.badges);
    } catch (e) {}
  }

  async function loadStore() {
    try {
      var res = await fetch('/agent/api/store', { credentials: 'same-origin' });
      if (!res.ok) return;
      var data = await res.json();
      document.getElementById('store-balance').textContent = (data.balance || 0) + ' tokens';
      var grid = document.getElementById('store-grid');
      var html = '';
      var purchased = data.purchased || [];
      for (var i = 0; i < (data.items || []).length; i++) {
        var item = data.items[i];
        var owned = purchased.indexOf(item.id) >= 0;
        var canBuy = !owned && data.balance >= item.price;
        html +=
          '<div class="store-item">' +
          '<div class="si-icon">' + (item.icon || '') + '</div>' +
          '<div class="si-name">' + escHtml(item.name) + '</div>' +
          '<div class="si-price">' + item.price + ' tokens</div>' +
          (owned
            ? '<button class="si-btn owned">Owned</button>'
            : '<button class="si-btn buy" data-item="' + escAttr(item.id) + '"' + (!canBuy ? ' disabled' : '') + '>Buy</button>'
          ) +
          '</div>';
      }
      grid.innerHTML = html;

      grid.querySelectorAll('.si-btn.buy').forEach(function(btn) {
        btn.addEventListener('click', async function() {
          var itemId = this.dataset.item;
          this.disabled = true;
          this.textContent = 'Buying...';
          try {
            var buyRes = await fetch('/agent/api/store/buy', {
              method: 'POST', credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ itemId: itemId }),
            });
            var result = await buyRes.json();
            if (!buyRes.ok) throw new Error(result.error || 'Purchase failed');
            toast('Purchased! New balance: ' + result.newBalance, 'success');
            loadStore();
            loadGameState();
          } catch (err) {
            toast(err.message, 'error');
            this.disabled = false;
            this.textContent = 'Buy';
          }
        });
      });
    } catch (e) {
      toast('Failed to load store', 'error');
    }
  }

  async function load() {
    var meRes = await fetch('/agent/api/me', { credentials: 'same-origin' });
    if (!meRes.ok) throw new Error('auth');
    var me = await meRes.json();
    var uname = me.username || me.email || '--';
    document.getElementById('user-email').textContent = uname;
    document.getElementById('user-avatar').textContent = (uname || '?')[0].toUpperCase();

    var dataRes = await fetch('/agent/api/dashboard', { credentials: 'same-origin' });
    if (!dataRes.ok) throw new Error('Failed to load dashboard data');
    var data = await dataRes.json();

    // Stats
    document.getElementById('s-total').textContent = data.totalAudits || 0;

    var avgScore = Math.round(data.avgScore || 0);
    var avgEl = document.getElementById('s-avg-score');
    avgEl.textContent = avgScore + '%';
    avgEl.className = 'stat-value ' + scoreColor(avgScore);

    document.getElementById('s-this-week').textContent = getThisWeekCount(data.recentAudits || []);

    // Trend chart
    renderTrendChart(data.weeklyTrend || []);

    // Table
    renderTable(data.recentAudits || []);

    // Show dashboard
    document.getElementById('loading').style.display = 'none';
    document.getElementById('dashboard').style.display = 'block';

    // Load gamification state
    loadGameState();
  }

  load().catch(function(err) {
    if (err && err.message === 'auth') {
      window.location.href = '/login';
      return;
    }
    document.getElementById('loading').style.display = 'none';
    showError('Failed to load dashboard: ' + (err.message || 'Unknown error'));
    document.getElementById('dashboard').style.display = 'block';
  });

  // --- SSE for broadcast events ---
  var es = new EventSource("/api/events");
  es.addEventListener("prefab-broadcast", function(e) {
    if (window.__TAURI__) return; // bridge.js handles broadcasts in Tauri overlay
    try {
      var data = JSON.parse(e.data);
      showBroadcastToast(data);
      if (data.animationId) playAnimation(data.animationId);
    } catch(err) {}
  });

  function showBroadcastToast(data) {
    var el = document.getElementById("broadcast-toast");
    if (!el) { el = document.createElement("div"); el.id = "broadcast-toast"; el.className = "broadcast-toast"; document.body.appendChild(el); }
    el.innerHTML = '<span style="font-size:18px;margin-right:8px;">' + (data.type === "perfect_score" ? "\\u{1F4AF}" : data.type === "level_up" ? "\\u{2B06}" : data.type === "badge_earned" ? "\\u{1F3C5}" : "\\u{1F514}") + '</span>'
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
})();
</script>
</body>
</html>`;
}
