export function getWeeklyBuilderPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Weekly Report Builder</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --bg: #0b0f15; --bg-raised: #111620; --bg-surface: #161c28;
    --border: #1c2333; --border-hover: #2a3346;
    --text: #c9d1d9; --text-muted: #6e7681; --text-dim: #484f58; --text-bright: #e6edf3;
    --blue: #58a6ff; --green: #3fb950; --red: #f85149; --yellow: #d29922;
  }
  body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; min-height: 100vh; }

  .wb-header {
    background: var(--bg-raised); border-bottom: 1px solid var(--border);
    padding: 14px 24px; display: flex; align-items: center; gap: 16px;
    position: sticky; top: 0; z-index: 10;
  }
  .wb-back {
    color: var(--text-muted); text-decoration: none; font-size: 12px;
    padding: 5px 10px; border: 1px solid var(--border); border-radius: 6px;
    transition: color 0.15s, border-color 0.15s; white-space: nowrap;
  }
  .wb-back:hover { color: var(--text); border-color: var(--border-hover); }
  .wb-title { font-size: 15px; font-weight: 700; color: var(--text-bright); flex: 1; }
  .wb-test-bar { display: flex; align-items: center; gap: 8px; }
  .wb-test-input {
    background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
    color: var(--text); font-size: 12px; padding: 6px 10px; width: 240px; outline: none;
  }
  .wb-test-input:focus { border-color: var(--blue); }
  .wb-test-input::placeholder { color: var(--text-dim); }

  .wb-body { display: flex; gap: 0; height: calc(100vh - 53px); overflow: hidden; }

  .wb-left {
    width: 55%; border-right: 1px solid var(--border);
    overflow-y: auto; padding: 20px;
  }
  .wb-right { width: 45%; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; }

  .wb-section { margin-bottom: 28px; }
  .wb-section-hdr {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 12px;
  }
  .wb-section-title {
    font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 1.4px; color: var(--text-muted);
  }

  .wb-dept-row {
    border: 1px solid var(--border); border-radius: 8px;
    margin-bottom: 6px; overflow: hidden;
  }
  .wb-dept-main {
    display: flex; align-items: center; gap: 10px; padding: 9px 12px;
    cursor: pointer; user-select: none; transition: background 0.1s;
  }
  .wb-dept-main:hover { background: var(--bg-surface); }
  .wb-dept-name { font-size: 13px; font-weight: 600; flex: 1; }
  .wb-dept-emails { font-size: 10px; color: var(--text-muted); }
  .wb-shift-row {
    display: none; padding: 8px 12px 10px 34px;
    border-top: 1px solid var(--border); background: var(--bg-surface);
    gap: 16px; flex-wrap: wrap;
  }
  .wb-shift-row.open { display: flex; }
  .wb-shift-label {
    display: flex; align-items: center; gap: 5px; font-size: 12px;
    cursor: pointer; color: var(--text-muted); user-select: none;
  }
  .wb-shift-label input { accent-color: var(--blue); cursor: pointer; }
  .wb-shift-label:has(input:checked) { color: var(--text); }

  .wb-office-row {
    display: flex; align-items: center; gap: 10px; padding: 8px 12px;
    border: 1px solid var(--border); border-radius: 8px;
    margin-bottom: 6px; cursor: pointer; user-select: none;
    transition: background 0.1s;
  }
  .wb-office-row:hover { background: var(--bg-surface); }
  .wb-office-name { font-size: 13px; font-weight: 600; flex: 1; }
  .wb-office-emails { font-size: 10px; color: var(--text-muted); }

  input[type="checkbox"] { accent-color: var(--blue); cursor: pointer; width: 14px; height: 14px; flex-shrink: 0; }

  .btn {
    border: 1px solid var(--border); border-radius: 6px; padding: 5px 12px;
    font-size: 11px; font-weight: 600; cursor: pointer; transition: all 0.15s;
    background: transparent; color: var(--text-muted);
  }
  .btn:hover { color: var(--text); border-color: var(--border-hover); }
  .btn-primary { background: var(--blue); border-color: var(--blue); color: #fff; }
  .btn-primary:hover { opacity: 0.85; }
  .btn-green { background: #238636; border-color: #238636; color: #fff; }
  .btn-green:hover { opacity: 0.85; }
  .btn-red { border-color: var(--red); color: var(--red); }
  .btn-red:hover { background: rgba(248,81,73,0.1); }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .wb-staged-hdr {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 12px;
  }
  .wb-staged-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.4px; color: var(--text-muted); }
  .wb-staged-list { flex: 1; overflow-y: auto; margin-bottom: 16px; }
  .wb-staged-empty { font-size: 12px; color: var(--text-dim); padding: 20px 0; text-align: center; }

  .wb-staged-item {
    display: flex; align-items: center; gap: 10px; padding: 8px 10px;
    border: 1px solid var(--border); border-radius: 6px; margin-bottom: 5px;
    font-size: 12px;
  }
  .wb-staged-name { flex: 1; font-weight: 600; }
  .wb-staged-type { font-size: 10px; color: var(--text-muted); padding: 2px 6px; border: 1px solid var(--border); border-radius: 4px; }
  .wb-staged-dup { font-size: 10px; color: var(--yellow); }
  .wb-staged-del { background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 14px; padding: 0 2px; line-height: 1; }
  .wb-staged-del:hover { color: var(--red); }

  .wb-publish-bar { border-top: 1px solid var(--border); padding-top: 16px; display: flex; flex-direction: column; gap: 8px; }
  .wb-publish-warn { font-size: 11px; color: var(--text-muted); line-height: 1.5; }

  .toast {
    position: fixed; bottom: 20px; right: 20px; padding: 10px 16px;
    border-radius: 8px; font-size: 12px; font-weight: 600; z-index: 9999;
    animation: fadeIn 0.2s ease;
  }
  .toast.success { background: #1a3a2a; border: 1px solid var(--green); color: var(--green); }
  .toast.error { background: #3a1a1a; border: 1px solid var(--red); color: var(--red); }
  .toast.info { background: #1a2a3a; border: 1px solid var(--blue); color: var(--blue); }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

  .loading { color: var(--text-dim); font-size: 12px; padding: 20px 0; }
</style>
</head>
<body>

<div class="wb-header">
  <a href="/admin" class="wb-back">&#8592; Dashboard</a>
  <div class="wb-title">Weekly Report Builder</div>
  <div class="wb-test-bar">
    <input class="wb-test-input" id="wb-test-email" type="email" placeholder="Test email address...">
    <button class="btn btn-primary" id="wb-send-btn" disabled>&#9654; Send All to Test</button>
  </div>
</div>

<div class="wb-body">
  <div class="wb-left">
    <div class="wb-section">
      <div class="wb-section-hdr">
        <div class="wb-section-title">Internal Departments</div>
        <div style="display:flex;gap:6px;">
          <button class="btn" id="wb-int-sel-all">Select All</button>
          <button class="btn" id="wb-int-desel-all">Deselect All</button>
        </div>
      </div>
      <div id="wb-int-list"><div class="loading">Loading...</div></div>
    </div>
    <div class="wb-section">
      <div class="wb-section-hdr">
        <div class="wb-section-title">Partner Offices</div>
        <div style="display:flex;gap:6px;">
          <button class="btn" id="wb-prt-sel-all">Select All</button>
          <button class="btn" id="wb-prt-desel-all">Deselect All</button>
        </div>
      </div>
      <div id="wb-prt-list"><div class="loading">Loading...</div></div>
    </div>
  </div>

  <div class="wb-right">
    <div class="wb-staged-hdr">
      <div class="wb-staged-title">Staged Configs (<span id="wb-count">0</span>)</div>
      <button class="btn" id="wb-clear-all">Clear All</button>
    </div>
    <div class="wb-staged-list" id="wb-staged-list">
      <div class="wb-staged-empty">Check departments or offices on the left to stage configs.</div>
    </div>
    <div class="wb-publish-bar">
      <div class="wb-publish-warn">All published configs will be <strong>inactive</strong>. Go to Email Reports to selectively activate.</div>
      <button class="btn btn-green" id="wb-publish-btn" disabled>Publish All as Inactive</button>
    </div>
  </div>
</div>

<script>
(function() {
  var auditDims, partnerDims, managerScopes, bypassCfg, existingConfigs;
  var internalDepts = [];  // [{ dept, emails, shifts }]
  var partnerOffices = []; // [{ office, emails }]

  // staged: Map key = "type:dept/office:shift" -> { type, department, office, shift, name }
  var staged = new Map();
  // manually removed from staged (so select-all doesn't re-add)
  var manuallyRemoved = new Set();

  function isBypassed(name) {
    if (!bypassCfg || !bypassCfg.patterns) return false;
    return bypassCfg.patterns.some(function(p) { return name.toLowerCase().includes(p.toLowerCase()); });
  }

  function stagedKey(cfg) {
    return cfg.type + ':' + (cfg.department || cfg.office || '') + ':' + (cfg.shift || '');
  }

  function isDuplicate(cfg) {
    if (!existingConfigs) return false;
    return existingConfigs.some(function(c) {
      if (!c.weeklyType) return false;
      if (cfg.type === 'internal') {
        return c.weeklyType === 'internal' && c.weeklyDepartment === cfg.department && (c.weeklyShift || null) === (cfg.shift || null);
      }
      return c.weeklyType === 'partner' && c.weeklyOffice === cfg.office;
    });
  }

  function stageConfig(cfg) {
    var key = stagedKey(cfg);
    manuallyRemoved.delete(key);
    staged.set(key, cfg);
    renderStaged();
  }

  function unstageConfig(key) {
    staged.delete(key);
    manuallyRemoved.add(key);
    renderStaged();
  }

  function renderStaged() {
    var list = document.getElementById('wb-staged-list');
    var count = document.getElementById('wb-count');
    var publishBtn = document.getElementById('wb-publish-btn');
    var sendBtn = document.getElementById('wb-send-btn');
    count.textContent = staged.size;
    publishBtn.disabled = staged.size === 0;
    sendBtn.disabled = staged.size === 0;
    if (staged.size === 0) {
      list.innerHTML = '<div class="wb-staged-empty">Check departments or offices on the left to stage configs.</div>';
      return;
    }
    var html = '';
    staged.forEach(function(cfg) {
      var dup = isDuplicate(cfg);
      var key = stagedKey(cfg);
      html += '<div class="wb-staged-item" data-key="' + escAttr(key) + '">' +
        '<span class="wb-staged-name">' + esc(cfg.name) + '</span>' +
        '<span class="wb-staged-type">' + (cfg.type === 'internal' ? 'Internal' : 'Partner') + '</span>' +
        (dup ? '<span class="wb-staged-dup">already exists</span>' : '') +
        '<button class="wb-staged-del" data-key="' + escAttr(key) + '" title="Remove">&times;</button>' +
        '</div>';
    });
    list.innerHTML = html;
    list.querySelectorAll('.wb-staged-del').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var key = btn.dataset.key;
        unstageConfig(key);
        // uncheck the corresponding checkbox if it exists
        var cb = document.querySelector('[data-staged-key="' + CSS.escape(key) + '"]');
        if (cb) cb.checked = false;
      });
    });
  }

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function escAttr(s) { return esc(s); }

  function buildLists() {
    var partnerKeys = new Set(Object.keys((partnerDims && partnerDims.offices) || {}));
    var shifts = (auditDims && auditDims.shifts) || [];

    // Invert manager scopes: dept -> emails
    var deptEmails = {};
    Object.entries(managerScopes || {}).forEach(function(e) {
      var email = e[0]; var scope = e[1];
      (scope.departments || []).forEach(function(dept) {
        if (!deptEmails[dept]) deptEmails[dept] = [];
        if (!deptEmails[dept].includes(email)) deptEmails[dept].push(email);
      });
    });

    internalDepts = ((auditDims && auditDims.departments) || [])
      .filter(function(d) { return !partnerKeys.has(d) && !isBypassed(d) && deptEmails[d] && deptEmails[d].length > 0; })
      .map(function(d) { return { dept: d, emails: deptEmails[d], shifts: shifts }; });

    partnerOffices = Object.keys((partnerDims && partnerDims.offices) || {})
      .filter(function(o) { return !isBypassed(o); })
      .sort()
      .map(function(o) { return { office: o, emails: (partnerDims.offices[o] || []) }; });
  }

  function renderInternalList() {
    var container = document.getElementById('wb-int-list');
    if (!internalDepts.length) { container.innerHTML = '<div class="loading">No internal departments with manager scopes.</div>'; return; }
    var html = '';
    internalDepts.forEach(function(d) {
      var allKey = 'internal:' + d.dept + ':';
      html += '<div class="wb-dept-row">' +
        '<div class="wb-dept-main">' +
          '<input type="checkbox" data-dept="' + esc(d.dept) + '" data-role="dept" id="cb-dept-' + esc(d.dept) + '">' +
          '<label for="cb-dept-' + esc(d.dept) + '" style="flex:1;display:flex;align-items:center;gap:10px;cursor:pointer;">' +
            '<span class="wb-dept-name">' + esc(d.dept) + '</span>' +
            '<span class="wb-dept-emails">' + d.emails.length + ' manager' + (d.emails.length !== 1 ? 's' : '') + '</span>' +
          '</label>' +
        '</div>' +
        '<div class="wb-shift-row" id="shifts-' + esc(d.dept) + '">' +
          '<label class="wb-shift-label"><input type="checkbox" data-dept="' + esc(d.dept) + '" data-shift="" data-staged-key="' + escAttr(allKey) + '" checked> All</label>' +
          d.shifts.map(function(s) {
            var key = 'internal:' + d.dept + ':' + s;
            return '<label class="wb-shift-label"><input type="checkbox" data-dept="' + esc(d.dept) + '" data-shift="' + esc(s) + '" data-staged-key="' + escAttr(key) + '" checked> ' + esc(s) + '</label>';
          }).join('') +
        '</div>' +
      '</div>';
    });
    container.innerHTML = html;

    container.querySelectorAll('input[data-role="dept"]').forEach(function(cb) {
      cb.addEventListener('change', function() {
        var dept = cb.dataset.dept;
        var shiftsRow = document.getElementById('shifts-' + dept);
        if (cb.checked) {
          shiftsRow.classList.add('open');
          // stage all checked shifts
          shiftsRow.querySelectorAll('input[type="checkbox"]').forEach(function(scb) {
            if (scb.checked) stageFromShiftCb(scb, dept);
          });
        } else {
          shiftsRow.classList.remove('open');
          // unstage all for this dept
          staged.forEach(function(cfg, key) {
            if (cfg.type === 'internal' && cfg.department === dept) unstageConfig(key);
          });
        }
      });
    });

    container.querySelectorAll('input[data-shift]').forEach(function(scb) {
      scb.addEventListener('change', function() {
        var dept = scb.dataset.dept;
        var key = stagedKey({ type: 'internal', department: dept, shift: scb.dataset.shift || null });
        if (scb.checked) {
          stageFromShiftCb(scb, dept);
        } else {
          unstageConfig(key);
        }
      });
    });
  }

  function stageFromShiftCb(scb, dept) {
    var shift = scb.dataset.shift || null;
    var name = shift ? (dept + ' \u2014 ' + shift) : dept;
    stageConfig({ type: 'internal', department: dept, shift: shift, name: name });
  }

  function renderPartnerList() {
    var container = document.getElementById('wb-prt-list');
    if (!partnerOffices.length) { container.innerHTML = '<div class="loading">No partner offices.</div>'; return; }
    var html = '';
    partnerOffices.forEach(function(o) {
      var key = 'partner:' + o.office + ':';
      html += '<div class="wb-office-row">' +
        '<input type="checkbox" data-office="' + esc(o.office) + '" data-staged-key="' + escAttr(key) + '" id="cb-office-' + esc(o.office) + '">' +
        '<label for="cb-office-' + esc(o.office) + '" style="flex:1;display:flex;align-items:center;gap:10px;cursor:pointer;">' +
          '<span class="wb-office-name">' + esc(o.office) + '</span>' +
          '<span class="wb-office-emails">' + o.emails.length + ' email' + (o.emails.length !== 1 ? 's' : '') + '</span>' +
        '</label>' +
      '</div>';
    });
    container.innerHTML = html;

    container.querySelectorAll('input[data-office]').forEach(function(cb) {
      cb.addEventListener('change', function() {
        var office = cb.dataset.office;
        var key = stagedKey({ type: 'partner', office: office, shift: null });
        if (cb.checked) {
          stageConfig({ type: 'partner', office: office, shift: null, name: office });
        } else {
          unstageConfig(key);
        }
      });
    });
  }

  function toast(msg, type) {
    var el = document.createElement('div');
    el.className = 'toast ' + (type || 'info');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function() { el.remove(); }, 4000);
  }

  function btnLoad(btn, text) { btn.disabled = true; btn.textContent = text; }
  function btnDone(btn, text) { btn.disabled = false; btn.textContent = text; }

  // Select/deselect all
  document.getElementById('wb-int-sel-all').addEventListener('click', function() {
    document.querySelectorAll('input[data-role="dept"]').forEach(function(cb) {
      if (!cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
    });
  });
  document.getElementById('wb-int-desel-all').addEventListener('click', function() {
    document.querySelectorAll('input[data-role="dept"]').forEach(function(cb) {
      if (cb.checked) { cb.checked = false; cb.dispatchEvent(new Event('change')); }
    });
  });
  document.getElementById('wb-prt-sel-all').addEventListener('click', function() {
    document.querySelectorAll('input[data-office]').forEach(function(cb) {
      if (!cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
    });
  });
  document.getElementById('wb-prt-desel-all').addEventListener('click', function() {
    document.querySelectorAll('input[data-office]').forEach(function(cb) {
      if (cb.checked) { cb.checked = false; cb.dispatchEvent(new Event('change')); }
    });
  });
  document.getElementById('wb-clear-all').addEventListener('click', function() {
    staged.clear(); manuallyRemoved.clear();
    document.querySelectorAll('input[data-role="dept"]').forEach(function(cb) { cb.checked = false; });
    document.querySelectorAll('.wb-shift-row').forEach(function(r) { r.classList.remove('open'); });
    document.querySelectorAll('input[data-office]').forEach(function(cb) { cb.checked = false; });
    renderStaged();
  });

  // Send all to test email
  document.getElementById('wb-send-btn').addEventListener('click', function() {
    var email = document.getElementById('wb-test-email').value.trim();
    if (!email) { toast('Enter a test email address', 'error'); return; }
    if (staged.size === 0) { toast('No configs staged', 'error'); return; }
    var btn = this;
    if (!confirm('Send ' + staged.size + ' report(s) to ' + email + '?')) return;
    btnLoad(btn, 'Sending...');
    fetch('/admin/weekly-builder/test-send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testEmail: email, configs: Array.from(staged.values()) }),
    })
      .then(function(r) { return r.json(); })
      .then(function(res) {
        btnDone(btn, '\u25B6 Send All to Test');
        if (res.errors && res.errors.length) {
          toast(res.sent + ' sent, ' + res.errors.length + ' failed', 'error');
        } else {
          toast(res.sent + ' report(s) sent to ' + email, 'success');
        }
      })
      .catch(function(e) { btnDone(btn, '\u25B6 Send All to Test'); toast(e.message, 'error'); });
  });

  // Publish
  document.getElementById('wb-publish-btn').addEventListener('click', function() {
    if (staged.size === 0) return;
    var hasDups = Array.from(staged.values()).some(isDuplicate);
    var msg = 'Publish ' + staged.size + ' config(s) as inactive?';
    if (hasDups) msg += ' Duplicates will be skipped.';
    if (!confirm(msg)) return;
    var btn = this;
    btnLoad(btn, 'Publishing...');
    fetch('/admin/weekly-builder/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ configs: Array.from(staged.values()) }),
    })
      .then(function(r) { return r.json(); })
      .then(function(res) {
        btnDone(btn, 'Publish All as Inactive');
        var msg = res.created + ' config(s) created as inactive.';
        if (res.skipped && res.skipped.length) msg += ' ' + res.skipped.length + ' skipped (already exist).';
        toast(msg, res.created > 0 ? 'success' : 'info');
        // Refresh existing configs so duplicate indicators update
        fetch('/admin/email-reports').then(function(r) { return r.json(); }).then(function(d) {
          existingConfigs = d; renderStaged();
        });
      })
      .catch(function(e) { btnDone(btn, 'Publish All as Inactive'); toast(e.message, 'error'); });
  });

  // Load data
  Promise.all([
    fetch('/admin/audit-dimensions').then(function(r) { return r.json(); }),
    fetch('/admin/weekly-builder/data').then(function(r) { return r.json(); }),
  ]).then(function(results) {
    auditDims = results[0];
    var data = results[1];
    partnerDims = data.partnerDims;
    managerScopes = data.managerScopes;
    bypassCfg = data.bypassCfg;
    existingConfigs = data.existingConfigs;
    buildLists();
    renderInternalList();
    renderPartnerList();
  }).catch(function(e) {
    document.getElementById('wb-int-list').innerHTML = '<div class="loading">Failed to load: ' + e.message + '</div>';
  });
})();
</script>
</body>
</html>`;
}
