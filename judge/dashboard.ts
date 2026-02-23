/** Inline HTML/CSS/JS for the judge dashboard -- appeal & reviewer statistics. */

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
  }
  body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; min-height: 100vh; }

  /* Header */
  .header {
    padding: 24px 32px 20px; border-bottom: 1px solid var(--border);
    display: flex; align-items: center; justify-content: space-between;
    background: var(--bg-raised);
  }
  .header h1 { font-size: 18px; font-weight: 700; color: var(--text-bright); }
  .header .subtitle { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
  .header-actions { display: flex; gap: 8px; }
  .header-btn {
    padding: 6px 14px; border: 1px solid var(--border); border-radius: 6px;
    background: var(--bg); color: var(--text-muted); font-size: 11px; font-weight: 600;
    cursor: pointer; transition: all 0.15s; text-decoration: none;
  }
  .header-btn:hover { background: var(--bg-surface); color: var(--text); border-color: var(--border-hover); }
  .header-btn.primary { background: var(--teal-dim); color: #fff; border-color: var(--teal-dim); }
  .header-btn.primary:hover { background: var(--teal); }

  /* Content */
  .content { max-width: 1200px; margin: 0 auto; padding: 24px 32px; }

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

  /* Empty table state */
  .empty-row td { color: var(--text-dim); font-style: italic; text-align: center; padding: 20px; }
</style>
</head>
<body>

<div class="header">
  <div>
    <h1>Judge Dashboard</h1>
    <div class="subtitle">Appeal statistics and reviewer performance</div>
  </div>
  <div class="header-actions">
    <a href="/judge" class="header-btn primary">Review Queue</a>
    <a href="/admin/dashboard" class="header-btn">Admin Dashboard</a>
  </div>
</div>

<div class="content">
  <div id="error-msg" class="error-msg"></div>
  <div id="loading" class="loading-wrap">Loading dashboard data...</div>

  <div id="dashboard" style="display:none">

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

  </div>
</div>

<script>
(function() {
  async function load() {
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
    document.getElementById('s-queue-info').textContent = d.queue.pending + ' questions in queue';

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
        var dateStr = new Date(h.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        var tr = document.createElement('tr');
        tr.innerHTML =
          '<td class="mono">' + esc(h.findingId.slice(0, 12)) + '...</td>' +
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

  load();
  setInterval(load, 15000);
})();
</script>
</body>
</html>`;
}
