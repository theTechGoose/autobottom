/** Inline HTML/CSS/JS for the judge dashboard -- appeal & reviewer statistics. */

import * as icons from "../shared/icons.ts";

export function getJudgeDashboardPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Judge Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --bg: #0b0f15; --bg-raised: #111620; --bg-surface: #161c28;
    --border: #1c2333; --border-hover: #2a3346;
    --text: #c9d1d9; --text-muted: #6e7681; --text-dim: #484f58; --text-bright: #e6edf3;
    --teal: #14b8a6; --teal-dim: #0d9488; --teal-bg: rgba(20,184,166,0.10);
    --green: #3fb950; --red: #f85149; --yellow: #d29922;
    --green-bg: rgba(63,185,80,0.10); --red-bg: rgba(248,81,73,0.10); --yellow-bg: rgba(210,153,34,0.10);
    --mono: 'SF Mono', 'Fira Code', monospace;
    --sidebar-w: 280px;
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
  .sb-link.active { border-color: var(--teal-dim); background: var(--teal-bg); }
  .sb-link .icon { width: 24px; height: 24px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 11px; flex-shrink: 0; }
  .sb-link .icon.teal { background: var(--teal-bg); color: var(--teal); }
  .sb-link .icon.green { background: var(--green-bg); color: var(--green); }
  .sb-link .icon.yellow { background: var(--yellow-bg); color: var(--yellow); }
  .sb-link .title { font-size: 12px; font-weight: 600; color: var(--text-bright); flex: 1; }
  .sb-link .arrow { font-size: 10px; color: var(--text-dim); }
  .sb-footer { margin-top: auto; border-top: 1px solid var(--border); }
  .sb-footer .sb-user { padding: 14px 18px 8px; display: flex; align-items: center; gap: 8px; }
  .sb-footer .sb-avatar { width: 28px; height: 28px; border-radius: 50%; background: var(--teal-bg); color: var(--teal); display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0; }
  .sb-footer .sb-email { font-size: 11px; color: var(--text-bright); font-weight: 600; word-break: break-all; line-height: 1.3; }
  .sb-footer .sb-role { font-size: 9px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; }
  .sb-footer .sb-settings { padding: 6px 14px 14px; }
  .main { margin-left: var(--sidebar-w); flex: 1; padding: 24px 32px; }

  /* Stat cards row */
  .stat-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .stat-card {
    background: var(--bg-raised); border: 1px solid var(--border); border-radius: 10px;
    padding: 16px 18px; transition: border-color 0.15s;
  }
  .stat-card:hover { border-color: var(--border-hover); }
  .stat-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--text-dim); margin-bottom: 6px; }
  .stat-value { font-size: 28px; font-weight: 700; color: var(--text-bright); font-variant-numeric: tabular-nums; }
  .stat-value.teal { color: var(--teal); }
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
    background: var(--teal-bg); color: var(--teal);
  }

  /* Table */
  .tbl { width: 100%; border-collapse: collapse; }
  .tbl th {
    text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 1px; color: var(--text-dim); padding: 8px 12px;
    border-bottom: 1px solid var(--border); background: var(--bg-raised);
  }
  .tbl td {
    font-size: 13px; padding: 10px 12px; border-bottom: 1px solid var(--border);
    color: var(--text); font-variant-numeric: tabular-nums;
  }
  .tbl tr:hover td { background: var(--bg-raised); }
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
  .pill-teal { background: var(--teal-bg); color: var(--teal); }

  /* Loading / Error */
  .loading-wrap { display: flex; align-items: center; justify-content: center; padding: 60px; color: var(--text-dim); font-size: 13px; }
  .error-msg { padding: 12px 16px; background: var(--red-bg); color: var(--red); border-radius: 8px; font-size: 13px; display: none; margin-bottom: 16px; }

  /* Badge showcase */
  .badge-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
  .badge-item {
    background: var(--bg-raised); border: 1px solid var(--border); border-radius: 10px;
    padding: 14px 12px; text-align: center; transition: border-color 0.15s;
  }
  .badge-item:hover { border-color: var(--border-hover); }
  .badge-item.earned { border-color: var(--teal-dim); }
  .badge-item.locked { opacity: 0.4; }
  .badge-icon { font-size: 28px; margin-bottom: 6px; }
  .badge-name { font-size: 11px; font-weight: 700; color: var(--text-bright); margin-bottom: 2px; }
  .badge-tier { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
  .badge-desc { font-size: 9px; color: var(--text-dim); margin-top: 4px; line-height: 1.3; }

  /* Empty table state */
  .empty-row td { color: var(--text-dim); font-style: italic; text-align: center; padding: 20px; }

  /* Modal */
  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); z-index: 100; display: none; align-items: center; justify-content: center; }
  .modal-overlay.open { display: flex; }
  .modal { background: var(--bg-raised); border: 1px solid var(--border); border-radius: 12px; width: 380px; max-width: 90vw; padding: 24px; }
  .modal-title { font-size: 14px; font-weight: 700; color: var(--text-bright); margin-bottom: 14px; }
  .modal .sf { margin-bottom: 12px; }
  .modal .sf-label { display: block; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-dim); margin-bottom: 4px; }
  .modal .sf-input { width: 100%; padding: 8px 10px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 12px; }
  .modal .sf-input:focus { outline: none; border-color: var(--teal); }
  .modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border); }
  .sf-btn { padding: 6px 16px; border: none; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer; transition: all 0.15s; }
  .sf-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .sf-btn.primary { background: var(--teal-dim); color: #fff; }
  .sf-btn.primary:hover:not(:disabled) { background: var(--teal); }
  .sf-btn.ghost { background: transparent; color: var(--text-muted); border: 1px solid var(--border); }
  .sf-btn.ghost:hover:not(:disabled) { background: var(--bg-surface); }
  .sf-btn.danger { background: transparent; color: var(--red); border: 1px solid rgba(248,81,73,0.2); font-size: 10px; padding: 3px 10px; }
  .sf-btn.danger:hover:not(:disabled) { background: var(--red-bg); }
  .reviewer-actions { display: flex; gap: 8px; align-items: center; }

  @media (max-width: 900px) {
    .sidebar { display: none; }
    .main { margin-left: 0; }
  }
</style>
</head>
<body>

<div class="layout">
  <aside class="sidebar">
    <div class="sb-brand">
      <h1>Auto-Bot</h1>
      <div class="sb-sub">Judge Panel</div>
    </div>
    <div class="sb-section">
      <div class="sb-label">Navigation</div>
      <a href="/judge" class="sb-link">
        <div class="icon teal">${icons.playCircle}</div>
        <span class="title">Judge Queue</span>
        <span class="arrow">${icons.chevronRight}</span>
      </a>
      <a href="/judge/dashboard" class="sb-link active">
        <div class="icon teal">${icons.layoutDashboard}</div>
        <span class="title">Dashboard</span>
        <span class="arrow">${icons.chevronRight}</span>
      </a>
      <a href="/chat" class="sb-link">
        <div class="icon" style="background:rgba(57,208,216,0.10);color:#39d0d8;">${icons.messageCircle24}</div>
        <span class="title">Chat</span>
        <span class="arrow">${icons.chevronRight}</span>
      </a>
    </div>
    <div class="sb-section">
      <div class="sb-label">Management</div>
      <div class="sb-link" onclick="document.getElementById('add-reviewer-modal').classList.add('open')">
        <div class="icon green">${icons.users}</div>
        <span class="title">My Reviewers</span>
        <span class="arrow">${icons.chevronRight}</span>
      </div>
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
          <div class="sb-email" id="user-email"></div>
          <div class="sb-role">Judge</div>
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
  <main class="main">
  <div id="error-msg" class="error-msg"></div>
  <div id="loading" class="loading-wrap">Loading dashboard data...</div>

  <div id="dashboard" style="display:none">
    <div style="display:flex;justify-content:flex-end;margin-bottom:12px;">
      <button onclick="load();loadReviewers();loadBadges();" style="padding:6px 16px;border-radius:6px;border:1px solid #30363d;background:#161b22;color:#8b949e;font-size:11px;font-weight:600;cursor:pointer;">Refresh</button>
    </div>

    <!-- Top stat cards -->
    <div class="stat-row">
      <div class="stat-card">
        <div class="stat-label">Total Appeals</div>
        <div class="stat-value teal" id="s-total">0</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Pending</div>
        <div class="stat-value yellow" id="s-pending">0</div>
        <div class="stat-sub" id="s-queue-info">0 questions in queue</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Completed</div>
        <div class="stat-value green" id="s-completed">0</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Overturn Rate</div>
        <div class="stat-value" id="s-overturn-rate">N/A</div>
        <div class="stat-sub" id="s-overturn-detail">0 overturned / 0 upheld</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Queue Pending</div>
        <div class="stat-value" id="s-q-pending">0</div>
        <div class="stat-sub">questions awaiting judge</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Decided</div>
        <div class="stat-value green" id="s-q-decided">0</div>
        <div class="stat-sub">questions judged</div>
      </div>
    </div>

    <!-- Per-Judge table -->
    <div class="section">
      <div class="section-head">
        <div class="section-title">Judge Performance</div>
        <div class="section-badge" id="judge-count">0 judges</div>
      </div>
      <table class="tbl">
        <thead>
          <tr>
            <th>Judge</th>
            <th class="num">Decisions</th>
            <th class="num">Upheld</th>
            <th class="num">Overturned</th>
            <th class="num">Overturn %</th>
          </tr>
        </thead>
        <tbody id="judge-tbody">
          <tr class="empty-row"><td colspan="5">No judge activity yet</td></tr>
        </tbody>
      </table>
    </div>

    <!-- Per-Auditor table -->
    <div class="section">
      <div class="section-head">
        <div class="section-title">Auditor Appeal Stats</div>
        <div class="section-badge" id="auditor-count">0 auditors</div>
      </div>
      <table class="tbl">
        <thead>
          <tr>
            <th>Auditor</th>
            <th class="num">Appeals</th>
            <th class="num">Upheld</th>
            <th class="num">Overturned</th>
            <th class="num">Overturn Rate</th>
          </tr>
        </thead>
        <tbody id="auditor-tbody">
          <tr class="empty-row"><td colspan="5">No auditor appeal data yet</td></tr>
        </tbody>
      </table>
    </div>

    <!-- Recent appeals history -->
    <div class="section">
      <div class="section-head">
        <div class="section-title">Recent Appeals</div>
        <div class="section-badge" id="history-count">0</div>
      </div>
      <table class="tbl">
        <thead>
          <tr>
            <th>Finding</th>
            <th>Auditor</th>
            <th>Judge</th>
            <th class="num">Original</th>
            <th class="num">Final</th>
            <th class="num">Overturns</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody id="history-tbody">
          <tr class="empty-row"><td colspan="7">No completed appeals yet</td></tr>
        </tbody>
      </table>
    </div>

    <!-- My Reviewers -->
    <div class="section">
      <div class="section-head">
        <div class="section-title">My Reviewers</div>
        <div class="reviewer-actions">
          <div class="section-badge" id="reviewer-count">0</div>
          <button class="sf-btn primary" onclick="document.getElementById('add-reviewer-modal').classList.add('open')">+ Add</button>
        </div>
      </div>
      <table class="tbl">
        <thead>
          <tr>
            <th>Email</th>
            <th>Created</th>
            <th>Allowed Types</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="reviewer-tbody">
          <tr class="empty-row"><td colspan="4">No reviewers assigned</td></tr>
        </tbody>
      </table>
    </div>

    <!-- Badge Showcase -->
    <div class="section">
      <div class="section-head">
        <div class="section-title">Badges</div>
        <div class="section-badge" id="badge-counter">0 / 0</div>
      </div>
      <div class="badge-grid" id="badge-grid"></div>
    </div>

    <!-- Gamification (standalone page) -->
    <div class="section">
      <div class="section-head">
        <div class="section-title">Gamification</div>
      </div>
      <a href="/gamification" style="display:flex;align-items:center;gap:10px;padding:14px 20px;background:var(--bg-raised);border:1px solid var(--border);border-radius:10px;color:var(--text);text-decoration:none;transition:border-color 0.15s;">
        <span style="font-size:13px;">Sound packs, streaks, and combo settings</span>
        <span style="margin-left:auto;color:var(--text-dim);font-size:16px;">&rsaquo;</span>
      </a>
    </div>

  </div>
  </main>
</div>

<!-- Add Reviewer Modal -->
<div class="modal-overlay" id="add-reviewer-modal">
  <div class="modal">
    <div class="modal-title">Add Reviewer</div>
    <div class="sf">
      <label class="sf-label">Email</label>
      <input type="email" class="sf-input" id="rev-email" placeholder="reviewer@example.com">
    </div>
    <div class="sf">
      <label class="sf-label">Password</label>
      <input type="password" class="sf-input" id="rev-password" placeholder="Password">
    </div>
    <div class="modal-actions">
      <button class="sf-btn ghost" onclick="document.getElementById('add-reviewer-modal').classList.remove('open')">Cancel</button>
      <button class="sf-btn primary" id="rev-add-btn">Add Reviewer</button>
    </div>
  </div>
</div>

<script>
(function() {
  async function load() {
    try {
      var me = await fetch('/judge/api/me');
      if (me.ok) { var meData = await me.json(); document.getElementById('user-email').textContent = meData.username; document.getElementById('user-avatar').textContent = (meData.username || '?')[0].toUpperCase(); }
    } catch(e) {}
    try {
      var res = await fetch('/judge/api/dashboard');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      render(data);
    } catch (err) {
      document.getElementById('loading').style.display = 'none';
      var el = document.getElementById('error-msg');
      el.textContent = 'Failed to load dashboard: ' + err.message;
      el.style.display = 'block';
    }
  }

  function render(d) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('dashboard').style.display = 'block';

    // Top stats
    document.getElementById('s-total').textContent = d.appeals.total;
    document.getElementById('s-pending').textContent = d.appeals.pending;
    document.getElementById('s-completed').textContent = d.appeals.completed;
    document.getElementById('s-overturn-rate').textContent = d.appeals.overturnRate;
    document.getElementById('s-overturn-detail').textContent = d.appeals.overturns + ' overturned / ' + d.appeals.upheld + ' upheld';
    document.getElementById('s-q-pending').textContent = d.queue.pending;
    document.getElementById('s-q-decided').textContent = d.queue.decided;
    var qInfo = d.queue.pending + ' in queue';
    if (d.queue.active > 0) qInfo += ', ' + d.queue.active + ' being judged';
    document.getElementById('s-queue-info').textContent = qInfo;

    // Color the overturn rate
    var rateEl = document.getElementById('s-overturn-rate');
    var rate = parseFloat(d.appeals.overturnRate);
    if (isNaN(rate)) { rateEl.className = 'stat-value'; }
    else if (rate > 30) { rateEl.className = 'stat-value red'; }
    else if (rate > 15) { rateEl.className = 'stat-value yellow'; }
    else { rateEl.className = 'stat-value green'; }

    // Judge table
    var jTbody = document.getElementById('judge-tbody');
    document.getElementById('judge-count').textContent = d.byJudge.length + ' judge' + (d.byJudge.length !== 1 ? 's' : '');
    if (d.byJudge.length > 0) {
      jTbody.innerHTML = '';
      d.byJudge.sort(function(a, b) { return b.decisions - a.decisions; });
      d.byJudge.forEach(function(j) {
        var pct = j.decisions > 0 ? ((j.overturns / j.decisions) * 100).toFixed(1) : '0.0';
        var tr = document.createElement('tr');
        tr.innerHTML =
          '<td><strong>' + esc(j.judge) + '</strong></td>' +
          '<td class="num">' + j.decisions + '</td>' +
          '<td class="num"><span class="pill pill-green">' + j.upholds + '</span></td>' +
          '<td class="num"><span class="pill pill-red">' + j.overturns + '</span></td>' +
          '<td class="num">' + pct + '%</td>';
        jTbody.appendChild(tr);
      });
    }

    // Auditor table
    var aTbody = document.getElementById('auditor-tbody');
    document.getElementById('auditor-count').textContent = d.byAuditor.length + ' auditor' + (d.byAuditor.length !== 1 ? 's' : '');
    if (d.byAuditor.length > 0) {
      aTbody.innerHTML = '';
      d.byAuditor.sort(function(a, b) { return b.totalAppeals - a.totalAppeals; });
      d.byAuditor.forEach(function(a) {
        var tr = document.createElement('tr');
        tr.innerHTML =
          '<td><strong>' + esc(a.auditor) + '</strong></td>' +
          '<td class="num">' + a.totalAppeals + '</td>' +
          '<td class="num"><span class="pill pill-green">' + a.upheld + '</span></td>' +
          '<td class="num"><span class="pill pill-red">' + a.overturned + '</span></td>' +
          '<td class="num">' + a.overturnRate + '</td>';
        aTbody.appendChild(tr);
      });
    }

    // History table
    var hTbody = document.getElementById('history-tbody');
    document.getElementById('history-count').textContent = d.recentAppeals.length + ' completed';
    if (d.recentAppeals.length > 0) {
      hTbody.innerHTML = '';
      d.recentAppeals.forEach(function(h) {
        var scoreDelta = h.finalScore - h.originalScore;
        var deltaClass = scoreDelta > 0 ? 'pill-green' : scoreDelta < 0 ? 'pill-red' : 'pill-teal';
        var deltaText = (scoreDelta > 0 ? '+' : '') + scoreDelta + '%';
        var dateStr = new Date(h.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' });
        var tr = document.createElement('tr');
        tr.innerHTML =
          '<td class="mono" style="font-size:10px;">' + esc(h.findingId || '--') + '</td>' +
          '<td>' + esc(h.auditor) + '</td>' +
          '<td>' + esc(h.judgedBy) + '</td>' +
          '<td class="num">' + h.originalScore + '%</td>' +
          '<td class="num">' + h.finalScore + '% <span class="pill ' + deltaClass + '">' + deltaText + '</span></td>' +
          '<td class="num">' + h.overturns + '</td>' +
          '<td>' + dateStr + '</td>';
        hTbody.appendChild(tr);
      });
    }
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  // Reviewer management
  async function loadReviewers() {
    try {
      var res = await fetch('/judge/api/reviewers');
      if (!res.ok) return;
      var reviewers = await res.json();
      var tbody = document.getElementById('reviewer-tbody');
      document.getElementById('reviewer-count').textContent = reviewers.length;
      if (reviewers.length === 0) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="4">No reviewers assigned</td></tr>';
        return;
      }
      // Fetch configs for all reviewers in parallel
      var configResults = await Promise.all(reviewers.map(function(r) {
        return fetch('/judge/api/reviewer-config?email=' + encodeURIComponent(r.email))
          .then(function(res2) { return res2.ok ? res2.json() : { allowedTypes: ['date-leg', 'package'] }; })
          .catch(function() { return { allowedTypes: ['date-leg', 'package'] }; });
      }));
      tbody.innerHTML = '';
      for (var i = 0; i < reviewers.length; i++) {
        var r = reviewers[i];
        var cfg = configResults[i];
        var allowedTypes = Array.isArray(cfg.allowedTypes) ? cfg.allowedTypes : ['date-leg', 'package'];
        var dateStr = r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' }) : '--';
        var dlChecked = allowedTypes.includes('date-leg') ? 'checked' : '';
        var pkgChecked = allowedTypes.includes('package') ? 'checked' : '';
        var tr = document.createElement('tr');
        tr.innerHTML =
          '<td><strong>' + esc(r.email) + '</strong></td>' +
          '<td>' + dateStr + '</td>' +
          '<td style="white-space:nowrap">' +
            '<label style="display:inline-flex;align-items:center;gap:4px;font-size:11px;margin-right:10px;cursor:pointer;">' +
              '<input type="checkbox" class="rc-datelegs" data-email="' + esc(r.email) + '" ' + dlChecked + '> Internal' +
            '</label>' +
            '<label style="display:inline-flex;align-items:center;gap:4px;font-size:11px;cursor:pointer;">' +
              '<input type="checkbox" class="rc-packages" data-email="' + esc(r.email) + '" ' + pkgChecked + '> Partner' +
            '</label>' +
          '</td>' +
          '<td><button class="sf-btn danger" data-email="' + esc(r.email) + '">Remove</button></td>';
        tbody.appendChild(tr);
      }
      // Checkbox change → save config
      tbody.querySelectorAll('.rc-datelegs, .rc-packages').forEach(function(chk) {
        chk.addEventListener('change', function() {
          var email = this.getAttribute('data-email');
          var row = this.closest('tr');
          var dlBox = row.querySelector('.rc-datelegs');
          var pkgBox = row.querySelector('.rc-packages');
          var types = [];
          if (dlBox && dlBox.checked) types.push('date-leg');
          if (pkgBox && pkgBox.checked) types.push('package');
          // Prevent unchecking both
          if (types.length === 0) { this.checked = true; return; }
          fetch('/judge/api/reviewer-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email, allowedTypes: types })
          }).catch(function() { alert('Failed to save reviewer config'); });
        });
      });
      tbody.querySelectorAll('.sf-btn.danger').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var email = this.getAttribute('data-email');
          if (!confirm('Remove reviewer ' + email + '?')) return;
          fetch('/judge/api/reviewers', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email }) })
          .then(function(r) { if (!r.ok) throw new Error('Failed'); return r.json(); })
          .then(function() { loadReviewers(); })
          .catch(function(err) { alert(err.message); });
        });
      });
    } catch(e) {}
  }

  document.getElementById('rev-add-btn').addEventListener('click', async function() {
    var email = document.getElementById('rev-email').value.trim();
    var password = document.getElementById('rev-password').value;
    if (!email || !password) { alert('Email and password required'); return; }
    this.disabled = true;
    this.textContent = 'Adding...';
    try {
      var res = await fetch('/judge/api/reviewers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, password: password }) });
      if (!res.ok) { var d = await res.json(); throw new Error(d.error || 'Failed'); }
      document.getElementById('rev-email').value = '';
      document.getElementById('rev-password').value = '';
      document.getElementById('add-reviewer-modal').classList.remove('open');
      loadReviewers();
    } catch(err) { alert(err.message); }
    this.disabled = false;
    this.textContent = 'Add Reviewer';
  });

  // Modal backdrop close
  document.getElementById('add-reviewer-modal').addEventListener('click', function(e) {
    if (e.target === this) this.classList.remove('open');
  });

  // Badge showcase
  var JDG_BADGES = [
    { id:'jdg_first_verdict', name:'First Verdict', tier:'common', icon:'\\u{2696}', description:'Judge your first question' },
    { id:'jdg_arbiter', name:'The Arbiter', tier:'uncommon', icon:'\\u{1F3DB}', description:'Judge 100 questions' },
    { id:'jdg_supreme', name:'Supreme Court', tier:'rare', icon:'\\u{1F451}', description:'Judge 1,000 questions' },
    { id:'jdg_overturn_10', name:'Objection!', tier:'uncommon', icon:'\\u{270B}', description:'Overturn 10 decisions' },
    { id:'jdg_overturn_50', name:'Court of Appeals', tier:'rare', icon:'\\u{1F4DC}', description:'Overturn 50 decisions' },
    { id:'jdg_uphold_20', name:'Stamp of Approval', tier:'uncommon', icon:'\\u{2705}', description:'Uphold 20 in a row' },
    { id:'jdg_combo_10', name:'Swift Justice', tier:'uncommon', icon:'\\u{26A1}', description:'Reach a 10x combo' },
    { id:'jdg_streak_14', name:'Fortnight Judge', tier:'rare', icon:'\\u{1F525}', description:'14-day judging streak' },
    { id:'jdg_level_10', name:'Grand Magistrate', tier:'legendary', icon:'\\u{1F48E}', description:'Reach level 10' }
  ];
  var TIER_COLORS = { common:'#6b7280', uncommon:'#22c55e', rare:'#3b82f6', epic:'#a855f7', legendary:'#f59e0b' };

  function renderBadgeShowcase(earnedIds) {
    var grid = document.getElementById('badge-grid');
    var earned = earnedIds || [];
    var count = 0;
    grid.innerHTML = '';
    JDG_BADGES.forEach(function(b) {
      var has = earned.indexOf(b.id) !== -1;
      if (has) count++;
      var div = document.createElement('div');
      div.className = 'badge-item ' + (has ? 'earned' : 'locked');
      div.innerHTML =
        '<div class="badge-icon">' + (has ? b.icon : '\\u{1F512}') + '</div>' +
        '<div class="badge-name">' + esc(b.name) + '</div>' +
        '<div class="badge-tier" style="color:' + (TIER_COLORS[b.tier] || '#888') + '">' + b.tier + '</div>' +
        '<div class="badge-desc">' + esc(b.description) + '</div>';
      grid.appendChild(div);
    });
    document.getElementById('badge-counter').textContent = count + ' / ' + JDG_BADGES.length;
  }

  async function loadBadges() {
    try {
      var res = await fetch('/api/badges');
      if (!res.ok) return;
      var data = await res.json();
      renderBadgeShowcase(data.earned || []);
    } catch(e) {}
  }

  load();
  loadReviewers();
  loadBadges();
})();
</script>
</body>
</html>`;
}
