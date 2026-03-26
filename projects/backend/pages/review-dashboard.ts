/** Inline HTML/CSS/JS for the reviewer dashboard -- queue stats, leaderboard & personal history. */

import * as icons from "./icons.ts";

export function getReviewDashboardPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Review Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --bg: #0b0f15; --bg-raised: #111620; --bg-surface: #161c28;
    --border: #1c2333; --border-hover: #2a3346;
    --text: #c9d1d9; --text-muted: #6e7681; --text-dim: #484f58; --text-bright: #e6edf3;
    --purple: #8b5cf6; --purple-dim: #7c3aed; --purple-bg: rgba(139,92,246,0.10);
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
  .sb-link.active { border-color: var(--purple-dim); background: var(--purple-bg); }
  .sb-link .icon { width: 24px; height: 24px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 11px; flex-shrink: 0; }
  .sb-link .icon.purple { background: var(--purple-bg); color: var(--purple); }
  .sb-link .title { font-size: 12px; font-weight: 600; color: var(--text-bright); flex: 1; }
  .sb-link .arrow { font-size: 10px; color: var(--text-dim); }
  .sb-footer { margin-top: auto; border-top: 1px solid var(--border); }
  .sb-footer .sb-user { padding: 14px 18px 8px; display: flex; align-items: center; gap: 8px; }
  .sb-footer .sb-avatar { width: 28px; height: 28px; border-radius: 50%; background: var(--purple-bg); color: var(--purple); display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0; }
  .sb-footer .sb-email { font-size: 11px; color: var(--text-bright); font-weight: 600; word-break: break-all; line-height: 1.3; }
  .sb-footer .sb-role { font-size: 9px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; }
  .sb-footer .sb-settings { padding: 6px 14px 14px; }
  .main { margin-left: var(--sidebar-w); flex: 1; padding: 24px 32px; }
  @media (max-width: 900px) {
    .sidebar { display: none; }
    .main { margin-left: 0; }
  }

  /* Stat cards row */
  .stat-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .stat-card {
    background: var(--bg-raised); border: 1px solid var(--border); border-radius: 10px;
    padding: 16px 18px; transition: border-color 0.15s;
  }
  .stat-card:hover { border-color: var(--border-hover); }
  .stat-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--text-dim); margin-bottom: 6px; }
  .stat-value { font-size: 28px; font-weight: 700; color: var(--text-bright); font-variant-numeric: tabular-nums; }
  .stat-value.purple { color: var(--purple); }
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
    background: var(--purple-bg); color: var(--purple);
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
    display: inline-block; font-size: 10px; font-weight: 700; padding: 2px 8px;
    border-radius: 10px; text-transform: uppercase;
  }
  .pill-confirm { background: var(--green-bg); color: var(--green); }
  .pill-flip { background: var(--red-bg); color: var(--red); }
  .pill-green { background: var(--green-bg); color: var(--green); }
  .pill-red { background: var(--red-bg); color: var(--red); }
  .pill-purple { background: var(--purple-bg); color: var(--purple); }

  /* Highlight current user row */
  .tbl tr.me td { background: var(--purple-bg); }

  /* Loading / Error */
  .loading-wrap { display: flex; align-items: center; justify-content: center; padding: 60px; color: var(--text-dim); font-size: 13px; }
  .error-msg { padding: 12px 16px; background: var(--red-bg); color: var(--red); border-radius: 8px; font-size: 13px; display: none; margin-bottom: 16px; }
  .empty-row td { color: var(--text-dim); font-style: italic; text-align: center; padding: 20px; }
  .truncate { max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* Badge showcase */
  .badge-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
  .badge-item {
    background: var(--bg-raised); border: 1px solid var(--border); border-radius: 10px;
    padding: 14px 12px; text-align: center; transition: border-color 0.15s;
  }
  .badge-item:hover { border-color: var(--border-hover); }
  .badge-item.earned { border-color: var(--purple-dim); }
  .badge-item.locked { opacity: 0.4; }
  .badge-icon { font-size: 28px; margin-bottom: 6px; }
  .badge-name { font-size: 11px; font-weight: 700; color: var(--text-bright); margin-bottom: 2px; }
  .badge-tier { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
  .badge-desc { font-size: 9px; color: var(--text-dim); margin-top: 4px; line-height: 1.3; }
</style>
</head>
<body>

<div class="layout">
  <aside class="sidebar">
    <div class="sb-brand">
      <h1>Auto-Bot</h1>
      <div class="sb-sub">Reviewer Panel</div>
    </div>
    <div class="sb-section">
      <div class="sb-label">Navigation</div>
      <a href="/review" class="sb-link">
        <div class="icon purple">${icons.playCircle}</div>
        <span class="title">Review Queue</span>
        <span class="arrow">${icons.chevronRight}</span>
      </a>
      <a href="/review/dashboard" class="sb-link active">
        <div class="icon purple">${icons.layoutDashboard}</div>
        <span class="title">Dashboard</span>
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
        <div class="sb-avatar" id="user-avatar"></div>
        <div>
          <div class="sb-email" id="user-email"></div>
          <div class="sb-role">Reviewer</div>
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

      <!-- Top stat cards -->
      <div class="stat-row">
        <div class="stat-card">
          <div class="stat-label">Queue Pending</div>
          <div class="stat-value yellow" id="s-q-pending">0</div>
          <div class="stat-sub">awaiting review</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Queue Decided</div>
          <div class="stat-value green" id="s-q-decided">0</div>
          <div class="stat-sub">total decisions</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">My Decisions</div>
          <div class="stat-value purple" id="s-my-total">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Confirm Rate</div>
          <div class="stat-value" id="s-confirm">--</div>
          <div class="stat-sub" id="s-confirm-sub"></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Flip Rate</div>
          <div class="stat-value" id="s-flip">--</div>
          <div class="stat-sub" id="s-flip-sub"></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Avg Speed</div>
          <div class="stat-value" id="s-speed">--</div>
          <div class="stat-sub">between decisions</div>
        </div>
      </div>

      <!-- Reviewer Performance table -->
      <div class="section">
        <div class="section-head">
          <div class="section-title">Reviewer Performance</div>
          <div class="section-badge" id="reviewer-count">0 reviewers</div>
        </div>
        <div style="overflow-x:auto;">
          <table class="tbl">
            <thead>
              <tr>
                <th>Reviewer</th>
                <th class="num">Decisions</th>
                <th class="num">Confirms</th>
                <th class="num">Flips</th>
                <th class="num">Flip Rate</th>
              </tr>
            </thead>
            <tbody id="reviewer-tbody">
              <tr class="empty-row"><td colspan="5">No reviewer activity yet</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Recent Decisions table -->
      <div class="section">
        <div class="section-head">
          <div class="section-title">Recent Decisions</div>
          <div class="section-badge" id="recent-count">0</div>
        </div>
        <div style="overflow-x:auto;">
          <table class="tbl">
            <thead>
              <tr>
                <th>Date</th>
                <th>Finding</th>
                <th>Question</th>
                <th>Decision</th>
                <th>Header</th>
              </tr>
            </thead>
            <tbody id="decisions-body">
              <tr class="empty-row"><td colspan="5">No decisions yet</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Badge Showcase -->
      <div class="section">
        <div class="section-head">
          <div class="section-title">Badges</div>
          <div class="section-badge" id="badge-counter">0 / 0</div>
        </div>
        <div class="badge-grid" id="badge-grid"></div>
      </div>

    </div>
  </main>
</div>

<script>
(function() {
  var currentUser = '';

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  function formatDate(ts) {
    if (!ts) return '--';
    var d = new Date(ts);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
           d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  function formatDuration(ms) {
    if (!ms || ms <= 0) return '--';
    if (ms < 60000) return Math.round(ms / 1000) + 's';
    if (ms < 3600000) return Math.round(ms / 60000) + 'm';
    return Math.round(ms / 3600000 * 10) / 10 + 'h';
  }

  function render(data) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('dashboard').style.display = 'block';

    // Queue stats
    document.getElementById('s-q-pending').textContent = data.queue.pending;
    document.getElementById('s-q-decided').textContent = data.queue.decided;

    // Personal stats
    var p = data.personal;
    document.getElementById('s-my-total').textContent = p.totalDecisions;

    var confirmRate = p.totalDecisions > 0 ? Math.round(p.confirmCount / p.totalDecisions * 100) : 0;
    var flipRate = p.totalDecisions > 0 ? Math.round(p.flipCount / p.totalDecisions * 100) : 0;
    document.getElementById('s-confirm').textContent = confirmRate + '%';
    document.getElementById('s-confirm').className = 'stat-value ' + (confirmRate > 60 ? 'red' : 'green');
    document.getElementById('s-confirm-sub').textContent = p.confirmCount + ' confirmed';
    document.getElementById('s-flip').textContent = flipRate + '%';
    document.getElementById('s-flip').className = 'stat-value ' + (flipRate > 40 ? 'green' : '');
    document.getElementById('s-flip-sub').textContent = p.flipCount + ' flipped';
    document.getElementById('s-speed').textContent = formatDuration(p.avgDecisionSpeedMs);

    // Reviewer performance table
    var rTbody = document.getElementById('reviewer-tbody');
    var reviewers = data.byReviewer || [];
    document.getElementById('reviewer-count').textContent = reviewers.length + ' reviewer' + (reviewers.length !== 1 ? 's' : '');
    if (reviewers.length > 0) {
      rTbody.innerHTML = '';
      for (var i = 0; i < reviewers.length; i++) {
        var r = reviewers[i];
        var isMe = currentUser && r.reviewer === currentUser;
        var tr = document.createElement('tr');
        if (isMe) tr.className = 'me';
        tr.innerHTML =
          '<td><strong>' + esc(r.reviewer) + '</strong>' + (isMe ? ' <span class="pill pill-purple">you</span>' : '') + '</td>' +
          '<td class="num">' + r.decisions + '</td>' +
          '<td class="num"><span class="pill pill-green">' + r.confirms + '</span></td>' +
          '<td class="num"><span class="pill pill-red">' + r.flips + '</span></td>' +
          '<td class="num">' + esc(r.flipRate) + '</td>';
        rTbody.appendChild(tr);
      }
    }

    // Recent decisions table
    var decisions = data.recentDecisions || [];
    document.getElementById('recent-count').textContent = decisions.length;
    var dTbody = document.getElementById('decisions-body');
    if (decisions.length > 0) {
      dTbody.innerHTML = '';
      for (var j = 0; j < decisions.length; j++) {
        var d = decisions[j];
        var tr = document.createElement('tr');
        tr.innerHTML =
          '<td>' + formatDate(d.decidedAt) + '</td>' +
          '<td class="mono">' + esc((d.findingId || '').slice(0, 12)) + '</td>' +
          '<td>' + (d.questionIndex !== undefined ? '#' + d.questionIndex : '--') + '</td>' +
          '<td><span class="pill pill-' + d.decision + '">' + esc(d.decision) + '</span></td>' +
          '<td class="truncate">' + esc(d.header || '--') + '</td>';
        dTbody.appendChild(tr);
      }
    }
  }

  async function load() {
    try {
      var meRes = await fetch('/review/api/me');
      if (!meRes.ok) throw new Error('Not authenticated');
      var me = await meRes.json();
      currentUser = me.username;
      document.getElementById('user-email').textContent = me.username;
      document.getElementById('user-avatar').textContent = (me.username || '?')[0].toUpperCase();

      var dataRes = await fetch('/review/api/dashboard');
      if (!dataRes.ok) throw new Error('HTTP ' + dataRes.status);
      var data = await dataRes.json();
      render(data);
    } catch (err) {
      document.getElementById('loading').style.display = 'none';
      var el = document.getElementById('error-msg');
      el.textContent = 'Failed to load dashboard: ' + err.message;
      el.style.display = 'block';
      if (err.message === 'Not authenticated') window.location.href = '/login';
    }
  }

  // Badge showcase
  var REV_BADGES = [
    { id:'rev_first_blood', name:'First Blood', tier:'common', icon:'\\u{1F514}', description:'Complete your first review' },
    { id:'rev_centurion', name:'Centurion', tier:'uncommon', icon:'\\u{1F396}', description:'Complete 100 reviews' },
    { id:'rev_grinder', name:'The Grinder', tier:'rare', icon:'\\u{2699}', description:'Complete 1,000 reviews' },
    { id:'rev_speed_demon', name:'Speed Demon', tier:'uncommon', icon:'\\u{26A1}', description:'Average under 8s per decision (50+)' },
    { id:'rev_streak_7', name:'Week Warrior', tier:'uncommon', icon:'\\u{1F525}', description:'7-day decision streak' },
    { id:'rev_streak_30', name:'Iron Will', tier:'rare', icon:'\\u{1F9CA}', description:'30-day decision streak' },
    { id:'rev_combo_10', name:'Combo Breaker', tier:'uncommon', icon:'\\u{1F4A5}', description:'Reach a 10x combo' },
    { id:'rev_combo_20', name:'Unstoppable', tier:'rare', icon:'\\u{1F680}', description:'Reach a 20x combo' },
    { id:'rev_combo_50', name:'Beyond Godlike', tier:'epic', icon:'\\u{1F30C}', description:'Reach a 50x combo' },
    { id:'rev_level_10', name:'Max Level', tier:'legendary', icon:'\\u{1F48E}', description:'Reach level 10' }
  ];
  var TIER_COLORS = { common:'#6b7280', uncommon:'#22c55e', rare:'#3b82f6', epic:'#a855f7', legendary:'#f59e0b' };

  function renderBadgeShowcase(earnedIds) {
    var grid = document.getElementById('badge-grid');
    var earned = earnedIds || [];
    var count = 0;
    grid.innerHTML = '';
    REV_BADGES.forEach(function(b) {
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
    document.getElementById('badge-counter').textContent = count + ' / ' + REV_BADGES.length;
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
  loadBadges();
  setInterval(load, 15000);
})();
</script>
</body>
</html>`;
}
