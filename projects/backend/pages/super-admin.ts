/** Super Admin page - god-mode org management for development. */

import * as icons from "./icons.ts";

export function getSuperAdminPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Super Admin</title>
<style>
  :root {
    --bg: #0d1117; --bg-surface: #161b22; --bg-raised: #1c2128;
    --border: #30363d; --border-hover: #484f58;
    --text: #e6edf3; --text-muted: #8b949e; --text-dim: #484f58;
    --green: #3fb950; --green-bg: rgba(63,185,80,0.12);
    --blue: #58a6ff; --blue-bg: rgba(88,166,255,0.12);
    --red: #f85149; --red-bg: rgba(248,81,73,0.12);
    --yellow: #d29922; --yellow-bg: rgba(210,153,34,0.12);
    --purple: #bc8cff; --purple-bg: rgba(139,92,246,0.12);
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; min-height: 100vh; }

  .topbar { display: flex; align-items: center; gap: 12px; padding: 12px 24px; border-bottom: 1px solid var(--border); }
  .topbar a { color: var(--text-muted); text-decoration: none; display: flex; align-items: center; gap: 6px; font-size: 13px; transition: color 0.15s; }
  .topbar a:hover { color: var(--text); }
  .topbar h1 { font-size: 16px; font-weight: 600; margin-left: auto; display: flex; align-items: center; gap: 8px; }

  .layout { display: flex; min-height: calc(100vh - 49px); }
  .sidebar { width: 340px; min-width: 340px; border-right: 1px solid var(--border); padding: 16px; overflow-y: auto; }
  .panel { flex: 1; padding: 24px; overflow-y: auto; }

  .create-row { display: flex; gap: 8px; margin-bottom: 16px; }
  .create-row input { flex: 1; padding: 8px 12px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 13px; outline: none; }
  .create-row input:focus { border-color: var(--blue); }

  .org-card { padding: 12px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 8px; cursor: pointer; transition: border-color 0.15s; }
  .org-card:hover { border-color: var(--border-hover); }
  .org-card.active { border-color: var(--blue); background: var(--bg-raised); }
  .org-name { font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 2px; }
  .org-slug { font-size: 11px; color: var(--text-dim); margin-bottom: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .org-badges { display: flex; gap: 8px; }
  .badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 600; }
  .badge.users { background: var(--purple-bg); color: var(--purple); }
  .badge.findings { background: var(--blue-bg); color: var(--blue); }

  .panel-empty { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-dim); font-size: 14px; }
  .panel-title { font-size: 18px; font-weight: 700; margin-bottom: 4px; }
  .panel-sub { font-size: 12px; color: var(--text-muted); margin-bottom: 20px; font-family: monospace; }

  .action-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  @media (max-width: 900px) { .action-grid { grid-template-columns: 1fr; } }
  .action-card { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 10px; padding: 16px; }
  .action-card h3 { font-size: 13px; font-weight: 600; margin-bottom: 4px; display: flex; align-items: center; gap: 8px; }
  .action-card h3 .ac-icon { width: 22px; height: 22px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 11px; }
  .action-card p { font-size: 11px; color: var(--text-muted); margin-bottom: 12px; line-height: 1.4; }

  .btn { padding: 7px 14px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; border: 1px solid var(--border); transition: all 0.12s; display: inline-flex; align-items: center; gap: 6px; }
  .btn:disabled { opacity: 0.5; cursor: default; }
  .btn-primary { background: var(--green); color: #fff; border-color: var(--green); }
  .btn-primary:hover:not(:disabled) { filter: brightness(1.1); }
  .btn-blue { background: var(--blue); color: #fff; border-color: var(--blue); }
  .btn-blue:hover:not(:disabled) { filter: brightness(1.1); }
  .btn-danger { background: var(--red-bg); color: var(--red); border-color: rgba(248,81,73,0.3); }
  .btn-danger:hover:not(:disabled) { background: rgba(248,81,73,0.2); }

  .pack-checks { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
  .pack-check { display: flex; align-items: center; gap: 8px; font-size: 12px; cursor: pointer; }
  .pack-check input { accent-color: var(--green); }

  .t-wrap { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); z-index: 200; display: flex; flex-direction: column-reverse; gap: 6px; align-items: center; pointer-events: none; }
  .t-toast { padding: 7px 16px; border-radius: 8px; font-size: 11px; font-weight: 600; backdrop-filter: blur(12px); box-shadow: 0 4px 20px rgba(0,0,0,0.5); animation: tIn 0.2s ease, tOut 0.3s ease 2s forwards; display: flex; align-items: center; gap: 6px; }
  @keyframes tIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
  @keyframes tOut { from { opacity: 1; } to { opacity: 0; } }
  .t-toast.success { background: rgba(17,22,32,0.95); color: var(--green); border: 1px solid rgba(63,185,80,0.15); }
  .t-toast.success .t-dot { background: var(--green); }
  .t-toast.error { background: rgba(17,22,32,0.95); color: var(--red); border: 1px solid rgba(248,81,73,0.15); }
  .t-toast.error .t-dot { background: var(--red); }
  .t-toast.info { background: rgba(17,22,32,0.95); color: var(--text-muted); border: 1px solid var(--border); }
  .t-toast.info .t-dot { background: var(--blue); }
  .t-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
</style>
</head>
<body>

<div class="topbar">
  <a href="/admin/dashboard?local">${icons.arrowLeft} Dashboard</a>
  <h1>${icons.shield} Super Admin</h1>
</div>

<div class="layout">
  <div class="sidebar">
    <div class="create-row">
      <input type="text" id="new-org-name" placeholder="New org name...">
      <button class="btn btn-primary" id="create-org-btn">Create</button>
    </div>
    <div id="org-list"></div>
  </div>

  <div class="panel" id="panel">
    <div class="panel-empty" id="panel-empty">Select an org to manage</div>
    <div id="panel-content" style="display:none;">
      <div class="panel-title" id="panel-org-name"></div>
      <div class="panel-sub" id="panel-org-id"></div>

      <div class="action-grid">
        <div class="action-card">
          <h3><span class="ac-icon" style="background:var(--green-bg);color:var(--green);">${icons.barChart}</span> Seed Test Data</h3>
          <p>Populate users, findings, reviews, judge appeals, manager queue, and question lab.</p>
          <button class="btn btn-primary" id="btn-seed">Seed Test Data</button>
        </div>

        <div class="action-card">
          <h3><span class="ac-icon" style="background:var(--blue-bg);color:var(--blue);">${icons.play16}</span> Seed Sound Packs</h3>
          <p>Upload built-in sound packs to S3 for this org.</p>
          <div class="pack-checks" id="pack-checks">
            <label class="pack-check"><input type="checkbox" value="smite" checked> SMITE Announcer</label>
            <label class="pack-check"><input type="checkbox" value="opengameart"> OpenGameArt CC0</label>
            <label class="pack-check"><input type="checkbox" value="mixkit-punchy"> Mixkit Punchy</label>
            <label class="pack-check"><input type="checkbox" value="mixkit-epic"> Mixkit Epic</label>
          </div>
          <button class="btn btn-blue" id="btn-seed-sounds">Seed Selected</button>
        </div>

        <div class="action-card">
          <h3><span class="ac-icon" style="background:var(--yellow-bg);color:var(--yellow);">${icons.alertTriangle}</span> Wipe Org Data</h3>
          <p>Delete all KV entries scoped to this org. Org record stays.</p>
          <button class="btn btn-danger" id="btn-wipe">Wipe Data</button>
        </div>

        <div class="action-card">
          <h3><span class="ac-icon" style="background:var(--red-bg);color:var(--red);">${icons.trash}</span> Delete Org</h3>
          <p>Wipe all data AND remove the org record. Cannot be undone.</p>
          <button class="btn btn-danger" id="btn-delete">Delete Org</button>
        </div>

        <div class="action-card" style="grid-column: 1 / -1;">
          <h3><span class="ac-icon" style="background:var(--purple-bg);color:var(--purple);">${icons.shield}</span> Impersonate</h3>
          <p>Create an admin session for this org and jump to the dashboard.</p>
          <button class="btn btn-primary" id="btn-impersonate">Impersonate as Admin</button>
        </div>
      </div>
    </div>
  </div>
</div>

<div class="t-wrap" id="toasts"></div>

<script>
(function() {
  var selectedOrg = null;

  function api(path, opts) {
    return fetch('/super-admin/api' + path, opts || {});
  }

  function toast(msg, type) {
    var el = document.createElement('div');
    el.className = 't-toast ' + (type || 'info');
    el.innerHTML = '<span class="t-dot"><\\/span>' + msg;
    document.getElementById('toasts').appendChild(el);
    setTimeout(function() { el.remove(); }, 2400);
  }

  function btnLoad(b, t) { b.disabled = true; b.textContent = t || 'Working...'; }
  function btnDone(b, t) { b.disabled = false; b.textContent = t; }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  function loadOrgs() {
    api('/orgs').then(function(r) { return r.json(); }).then(function(orgs) {
      var container = document.getElementById('org-list');
      container.innerHTML = '';
      orgs.forEach(function(org) {
        var card = document.createElement('div');
        card.className = 'org-card' + (selectedOrg && selectedOrg.id === org.id ? ' active' : '');
        card.innerHTML = '<div class="org-name">' + esc(org.name) + '</div>'
          + '<div class="org-slug">' + esc(org.slug) + ' &middot; ' + esc(org.id.slice(0, 8)) + '</div>'
          + '<div class="org-badges">'
          + '<span class="badge users">' + org.userCount + ' users</span>'
          + '<span class="badge findings">' + org.findingCount + ' findings</span>'
          + '</div>';
        card.addEventListener('click', function() { selectOrg(org); });
        container.appendChild(card);
      });
      if (selectedOrg) {
        var updated = orgs.find(function(o) { return o.id === selectedOrg.id; });
        if (updated) selectOrg(updated);
        else { selectedOrg = null; showEmpty(); }
      }
    }).catch(function(e) { toast('Failed to load orgs: ' + e.message, 'error'); });
  }

  function selectOrg(org) {
    selectedOrg = org;
    document.getElementById('panel-empty').style.display = 'none';
    document.getElementById('panel-content').style.display = '';
    document.getElementById('panel-org-name').textContent = org.name;
    document.getElementById('panel-org-id').textContent = org.id;
    var cards = document.querySelectorAll('.org-card');
    for (var i = 0; i < cards.length; i++) {
      cards[i].classList.toggle('active', cards[i].querySelector('.org-name').textContent === org.name);
    }
  }

  function showEmpty() {
    document.getElementById('panel-empty').style.display = '';
    document.getElementById('panel-content').style.display = 'none';
  }

  function postAction(path, body, btn, label, successMsg) {
    btnLoad(btn);
    api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
      .then(function(res) {
        if (!res.ok) throw new Error(res.data.error || 'Request failed');
        toast(successMsg, 'success');
        btnDone(btn, label);
        loadOrgs();
      })
      .catch(function(e) { toast(e.message, 'error'); btnDone(btn, label); });
  }

  document.getElementById('create-org-btn').addEventListener('click', function() {
    var name = document.getElementById('new-org-name').value.trim();
    if (!name) { toast('Enter an org name', 'error'); return; }
    postAction('/org', { name: name }, this, 'Create', 'Org created');
    document.getElementById('new-org-name').value = '';
  });

  document.getElementById('new-org-name').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') document.getElementById('create-org-btn').click();
  });

  document.getElementById('btn-seed').addEventListener('click', function() {
    if (!selectedOrg) return;
    postAction('/org/seed', { orgId: selectedOrg.id }, this, 'Seed Test Data', 'Test data seeded');
  });

  document.getElementById('btn-seed-sounds').addEventListener('click', function() {
    if (!selectedOrg) return;
    var checks = document.querySelectorAll('#pack-checks input:checked');
    var packIds = [];
    for (var i = 0; i < checks.length; i++) packIds.push(checks[i].value);
    if (!packIds.length) { toast('Select at least one pack', 'error'); return; }
    postAction('/org/seed-sounds', { orgId: selectedOrg.id, packIds: packIds }, this, 'Seed Selected', 'Sound packs uploaded');
  });

  document.getElementById('btn-wipe').addEventListener('click', function() {
    if (!selectedOrg) return;
    if (!confirm('Wipe all data for "' + selectedOrg.name + '"? This cannot be undone.')) return;
    postAction('/org/wipe', { orgId: selectedOrg.id }, this, 'Wipe Data', 'Org data wiped');
  });

  document.getElementById('btn-delete').addEventListener('click', function() {
    if (!selectedOrg) return;
    if (!confirm('DELETE org "' + selectedOrg.name + '"? This removes all data AND the org record.')) return;
    var btn = this;
    btnLoad(btn);
    api('/org/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orgId: selectedOrg.id }) })
      .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
      .then(function(res) {
        if (!res.ok) throw new Error(res.data.error || 'Delete failed');
        toast('Org deleted', 'success');
        btnDone(btn, 'Delete Org');
        selectedOrg = null;
        showEmpty();
        loadOrgs();
      })
      .catch(function(e) { toast(e.message, 'error'); btnDone(btn, 'Delete Org'); });
  });

  document.getElementById('btn-impersonate').addEventListener('click', function() {
    if (!selectedOrg) return;
    var btn = this;
    btnLoad(btn, 'Creating session...');
    api('/org/impersonate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orgId: selectedOrg.id }) })
      .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
      .then(function(res) {
        if (!res.ok) throw new Error(res.data.error || 'Impersonate failed');
        window.location.href = res.data.redirect;
      })
      .catch(function(e) { toast(e.message, 'error'); btnDone(btn, 'Impersonate as Admin'); });
  });

  loadOrgs();
})();
<\/script>
</body>
</html>`;
}
