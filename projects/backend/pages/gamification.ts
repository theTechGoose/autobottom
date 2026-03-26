/**
 * Gamification settings page.
 * Standalone authenticated page (admin + judge) with two tabs:
 *   1. Streak & Combo settings
 *   2. Sound Packs (pack manager + editor with S3 upload)
 */

import * as icons from "./icons.ts";
import { STORE_CSS, STORE_JS } from "./store-ui.ts";

export function getGamificationPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Gamification Settings</title>
<script src="/js/sound-engine.js"><\/script>
<style>
  :root {
    --bg: #0d1117; --bg-surface: #161b22; --bg-raised: #1c2128;
    --border: #30363d; --border-hover: #484f58;
    --text: #e6edf3; --text-muted: #8b949e; --text-dim: #484f58;
    --green: #3fb950; --green-bg: rgba(63,185,80,0.12);
    --blue: #58a6ff; --blue-bg: rgba(88,166,255,0.12);
    --red: #f85149; --red-bg: rgba(248,81,73,0.12);
    --pink: #ec4899; --pink-bg: rgba(236,72,153,0.12);
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; min-height: 100vh; }

  /* Top bar */
  .topbar { display: flex; align-items: center; gap: 12px; padding: 12px 24px; border-bottom: 1px solid var(--border); }
  .topbar a { color: var(--text-muted); text-decoration: none; display: flex; align-items: center; gap: 6px; font-size: 13px; transition: color 0.15s; }
  .topbar a:hover { color: var(--text); }
  .topbar h1 { font-size: 16px; font-weight: 600; margin-left: auto; }

  /* Tabs */
  .tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border); padding: 0 24px; }
  .tab { padding: 12px 20px; font-size: 13px; font-weight: 600; color: var(--text-muted); cursor: pointer; border-bottom: 2px solid transparent; transition: all 0.15s; }
  .tab:hover { color: var(--text); }
  .tab.active { color: var(--green); border-bottom-color: var(--green); }

  /* Content area */
  .content { max-width: 900px; margin: 0 auto; padding: 24px; }
  .tab-panel { display: none; }
  .tab-panel.active { display: block; }

  /* Settings form */
  .field { margin-bottom: 20px; }
  .field-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-dim); font-weight: 600; margin-bottom: 6px; }
  .field-desc { font-size: 12px; color: var(--text-muted); margin-bottom: 8px; }
  .field input[type="number"], .field select { width: 200px; padding: 8px 12px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 13px; outline: none; }
  .field input:focus, .field select:focus { border-color: var(--blue); }

  /* Toggle */
  .toggle-wrap { display: flex; align-items: center; gap: 10px; }
  .toggle { width: 40px; height: 22px; border-radius: 11px; background: var(--border); position: relative; cursor: pointer; transition: background 0.2s; }
  .toggle.on { background: var(--green); }
  .toggle-dot { width: 16px; height: 16px; border-radius: 50%; background: #fff; position: absolute; top: 3px; left: 3px; transition: transform 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
  .toggle.on .toggle-dot { transform: translateX(18px); }
  .toggle-label { font-size: 13px; color: var(--text); }

  /* Button styles */
  .btn { padding: 8px 16px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; border: 1px solid var(--border); transition: all 0.12s; }
  .btn:disabled { opacity: 0.5; cursor: default; }
  .btn-primary { background: var(--green); color: #fff; border-color: var(--green); }
  .btn-primary:hover:not(:disabled) { filter: brightness(1.1); }
  .btn-secondary { background: var(--bg-surface); color: var(--text); }
  .btn-secondary:hover:not(:disabled) { background: var(--bg-raised); border-color: var(--border-hover); }
  .btn-danger { background: var(--red-bg); color: var(--red); border-color: rgba(248,81,73,0.3); }
  .btn-danger:hover:not(:disabled) { background: rgba(248,81,73,0.2); }
  .btn-sm { padding: 4px 10px; font-size: 11px; }

  /* Role indicator */
  .role-badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 6px; font-size: 12px; color: var(--text-muted); margin-bottom: 20px; }

  /* Pack list + editor panels */
  .packs-layout { display: grid; grid-template-columns: 280px 1fr; gap: 20px; }
  @media (max-width: 700px) { .packs-layout { grid-template-columns: 1fr; } }

  .pack-list { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
  .pack-list-header { padding: 12px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
  .pack-list-header span { font-size: 13px; font-weight: 600; color: var(--text-muted); }
  .pack-item { padding: 10px 16px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border); transition: background 0.1s; }
  .pack-item:last-child { border-bottom: none; }
  .pack-item:hover { background: var(--bg-raised); }
  .pack-item.active { background: var(--blue-bg); border-left: 3px solid var(--blue); }
  .pack-item .name { font-size: 13px; font-weight: 500; }
  .pack-item .count { font-size: 11px; color: var(--text-dim); }
  .pack-item.builtin .name { font-style: italic; color: var(--text-muted); }

  .pack-editor { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 10px; padding: 20px; }
  .pack-editor h3 { font-size: 15px; font-weight: 600; margin-bottom: 16px; }
  .pack-name-input { width: 100%; padding: 8px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 14px; outline: none; margin-bottom: 16px; }
  .pack-name-input:focus { border-color: var(--blue); }

  .slot-row { display: grid; grid-template-columns: 90px 1fr 70px 36px; gap: 8px; align-items: center; margin-bottom: 8px; }
  .slot-label { font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: capitalize; }
  .slot-file { font-size: 11px; color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .slot-file.filled { color: var(--green); }

  .play-btn { width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; color: var(--text-muted); cursor: pointer; transition: all 0.1s; }
  .play-btn:hover { background: var(--bg-raised); border-color: var(--border-hover); color: var(--text); }

  .editor-actions { display: flex; gap: 8px; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border); }

  /* Empty state */
  .empty-editor { text-align: center; padding: 40px 20px; color: var(--text-dim); }
  .empty-editor p { font-size: 13px; margin-top: 8px; }

  /* Badge catalog */
  .badge-role-group { margin-bottom: 24px; }
  .badge-role-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted); margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px solid var(--border); }
  .badge-grid { display: flex; flex-wrap: wrap; gap: 10px; }
  .badge-card {
    display: flex; align-items: center; gap: 10px; padding: 10px 16px;
    background: var(--bg-surface); border: 1px solid var(--border); border-radius: 10px;
    font-size: 12px; min-width: 220px; transition: border-color 0.15s;
  }
  .badge-card:hover { border-color: var(--border-hover); }
  .badge-card .bc-icon { font-size: 22px; flex-shrink: 0; }
  .badge-card .bc-info { display: flex; flex-direction: column; gap: 2px; }
  .badge-card .bc-name { font-weight: 700; color: var(--text); }
  .badge-card .bc-desc { font-size: 11px; color: var(--text-muted); }
  .badge-card .bc-tier { font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700; }
  .badge-card.locked { opacity: 0.35; }
  .badge-card.locked .bc-icon { filter: grayscale(1); }
  .badge-card.earned { border-width: 2px; }

  .badge-summary { display: flex; gap: 16px; align-items: center; margin-bottom: 20px; padding: 14px 18px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 10px; }
  .badge-summary .bs-count { font-size: 24px; font-weight: 700; color: var(--text); }
  .badge-summary .bs-label { font-size: 12px; color: var(--text-muted); }
  .badge-summary .bs-xp { font-size: 13px; font-weight: 600; color: var(--green); margin-left: auto; }

  /* Store (imported from store-ui.ts) */
  ${STORE_CSS}

  /* Toast */
  .toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: var(--green); color: #fff; padding: 8px 20px; border-radius: 6px; font-size: 13px; opacity: 0; transition: opacity 0.2s; pointer-events: none; z-index: 100; }
  .toast.error { background: var(--red); }
  .toast.show { opacity: 1; }
</style>
</head>
<body>

<div class="topbar">
  <a href="/admin/dashboard" id="back-link">${icons.arrowLeft} Back to Dashboard</a>
  <h1>Gamification</h1>
</div>

<div class="tabs">
  <div class="tab active" data-tab="settings">Streak &amp; Combo</div>
  <div class="tab" data-tab="packs">Sound Packs</div>
  <div class="tab" data-tab="badges">Badges</div>
  <div class="tab" data-tab="store">Store</div>
</div>

<div class="content">
  <!-- Tab 1: Streak & Combo -->
  <div class="tab-panel active" id="panel-settings">
    <div class="role-badge" id="role-badge">Loading...</div>

    <div class="field">
      <div class="field-label">Threshold</div>
      <div class="field-desc">Seconds per question for streak mode (0 = flat timeout mode)</div>
      <input type="number" id="gs-threshold" value="0" min="0">
    </div>

    <div class="field">
      <div class="field-label">Combo Timeout</div>
      <div class="field-desc">Milliseconds for flat timeout mode (default 10000)</div>
      <input type="number" id="gs-timeout" value="10000" min="1000" step="1000">
    </div>

    <div class="field">
      <div class="field-label">Enabled</div>
      <div class="field-desc">XP, combos, streaks, and sound effects</div>
      <div class="toggle-wrap">
        <div class="toggle on" id="gs-enabled-toggle"><div class="toggle-dot"></div></div>
        <span class="toggle-label" id="gs-enabled-label">On</span>
      </div>
    </div>

    <div class="field">
      <div class="field-label">Active Sound Pack</div>
      <div class="field-desc">Select which pack plays during reviews</div>
      <select id="gs-active-pack">
        <option value="synth">Built-in: Synth</option>
      </select>
    </div>

    <div style="margin-top: 24px;">
      <button class="btn btn-primary" id="gs-save">Save Settings</button>
    </div>
  </div>

  <!-- Tab 2: Sound Packs -->
  <div class="tab-panel" id="panel-packs">
    <div style="display:flex;gap:8px;margin-bottom:16px;">
      <button class="btn btn-secondary" id="new-pack-btn">+ New Pack</button>
      <button class="btn btn-secondary" id="seed-btn">Seed Built-in Packs</button>
    </div>

    <div class="packs-layout">
      <div class="pack-list">
        <div class="pack-list-header">
          <span>Packs</span>
        </div>
        <div id="pack-list-items">
          <div class="pack-item builtin" data-pack="synth">
            <div><div class="name">Built-in: Synth</div><div class="count">8/8 slots (Web Audio)</div></div>
          </div>
        </div>
      </div>

      <div class="pack-editor" id="pack-editor">
        <div class="empty-editor" id="empty-editor">
          <div style="font-size:24px;color:var(--text-dim);">${icons.music}</div>
          <p>Select a pack to edit, or create a new one</p>
        </div>
        <div id="editor-content" style="display:none;">
          <input class="pack-name-input" id="editor-name" placeholder="Pack name...">
          <div id="slot-rows"></div>
          <div class="editor-actions">
            <button class="btn btn-primary btn-sm" id="editor-set-active">Set as Active</button>
            <button class="btn btn-danger btn-sm" id="editor-delete" style="margin-left:auto;">Delete Pack</button>
          </div>
        </div>
        <!-- Synth preview (read-only) -->
        <div id="synth-preview" style="display:none;">
          <h3 style="font-size:14px;font-weight:600;margin-bottom:12px;">Built-in: Synth (Web Audio)</h3>
          <div id="synth-slots"></div>
        </div>
      </div>
    </div>
  </div>

  <!-- Tab 3: Badges -->
  <div class="tab-panel" id="panel-badges">
    <div class="badge-summary">
      <div><div class="bs-count" id="badges-earned-count">0</div><div class="bs-label">badges earned</div></div>
      <div class="bs-xp" id="badges-xp-earned">+0 XP from badges</div>
    </div>
    <div id="badge-catalog"></div>
  </div>

  <!-- Tab 4: Store -->
  <div class="tab-panel" id="panel-store">
    <div class="store-wallet">
      <div class="sw-coin-wrap">
        <div class="sw-coin">T</div>
        <div class="sw-coin-ring"></div>
      </div>
      <div>
        <div class="sw-balance" id="sw-balance">--</div>
        <div class="sw-label">tokens</div>
      </div>
      <div class="sw-divider"></div>
      <div><div class="sw-stat-val" id="sw-level">--</div><div class="sw-stat-lbl">Level</div></div>
      <div><div class="sw-stat-val" id="sw-xp">--</div><div class="sw-stat-lbl">Total XP</div></div>
    </div>
    <div class="store-intro">
      Spend tokens on cosmetics that show across your profile, leaderboards, and dashboards.
      Higher rarity items glow brighter. Everything is cosmetic -- your flex, your way.
    </div>
    <div id="store-container"></div>
  </div>
  <div class="store-toast" id="store-toast"></div>
</div>

<div class="toast" id="toast"></div>
<input type="file" id="file-input" accept=".mp3,audio/mpeg" style="display:none;">

<script>
(function() {
  var SLOTS = ['ping', 'double', 'triple', 'mega', 'ultra', 'rampage', 'godlike', 'levelup'];
  var packs = [];
  var selectedPackId = null;
  var userRole = null;
  var gsEnabled = true;
  var currentOrgId = '';

  // -- Tabs --
  document.querySelectorAll('.tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
      document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
      tab.classList.add('active');
      var tabName = tab.getAttribute('data-tab');
      document.getElementById('panel-' + tabName).classList.add('active');
      if (tabName === 'badges') loadBadges();
      if (tabName === 'store') loadStore();
    });
  });

  // -- Toast --
  function toast(msg, type) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast' + (type === 'error' ? ' error' : '') + ' show';
    setTimeout(function() { el.classList.remove('show'); }, 2000);
  }

  // -- Settings Tab --
  var gsToggle = document.getElementById('gs-enabled-toggle');
  gsToggle.addEventListener('click', function() {
    gsEnabled = !gsEnabled;
    gsToggle.classList.toggle('on', gsEnabled);
    document.getElementById('gs-enabled-label').textContent = gsEnabled ? 'On' : 'Off';
  });

  function loadSettings() {
    fetch('/gamification/api/settings').then(function(r) { return r.json(); }).then(function(data) {
      userRole = data.role;
      if (data.orgId) currentOrgId = data.orgId;
      var s = data.settings || {};
      document.getElementById('gs-threshold').value = s.threshold != null ? s.threshold : 0;
      document.getElementById('gs-timeout').value = s.comboTimeoutMs != null ? s.comboTimeoutMs : 10000;
      gsEnabled = s.enabled !== false;
      gsToggle.classList.toggle('on', gsEnabled);
      document.getElementById('gs-enabled-label').textContent = gsEnabled ? 'On' : 'Off';

      var badge = document.getElementById('role-badge');
      if (data.role === 'admin') {
        badge.textContent = 'Setting as: Admin (org defaults)';
        document.getElementById('back-link').href = '/admin/dashboard';
      } else {
        badge.textContent = 'Setting as: Judge (team overrides)';
        document.getElementById('back-link').href = '/judge/dashboard';
      }

      var activePack = 'synth';
      if (s.sounds) {
        var vals = Object.values(s.sounds);
        if (vals.length > 0 && vals[0]) activePack = vals[0];
      }
      updatePackSelect(activePack);

      if (data.role !== 'admin') {
        document.getElementById('seed-btn').style.display = 'none';
      }
    }).catch(function() {});
  }

  function updatePackSelect(active) {
    var sel = document.getElementById('gs-active-pack');
    sel.innerHTML = '<option value="synth">Built-in: Synth</option>';
    packs.forEach(function(p) {
      var opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      sel.appendChild(opt);
    });
    sel.value = active || 'synth';
  }

  document.getElementById('gs-save').addEventListener('click', function() {
    var btn = this;
    var threshold = parseInt(document.getElementById('gs-threshold').value) || 0;
    var comboTimeoutMs = parseInt(document.getElementById('gs-timeout').value) || 10000;
    var pack = document.getElementById('gs-active-pack').value;
    var sounds = pack === 'synth' ? {} : {};
    if (pack !== 'synth') {
      SLOTS.forEach(function(s) { sounds[s] = pack; });
    }
    var payload = { threshold: threshold, comboTimeoutMs: comboTimeoutMs, enabled: gsEnabled, sounds: sounds };
    btn.disabled = true;
    btn.textContent = 'Saving...';
    fetch('/gamification/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function(r) { if (!r.ok) throw new Error('Save failed'); return r.json(); })
      .then(function() { toast('Settings saved'); })
      .catch(function(err) { toast(err.message, 'error'); })
      .finally(function() { btn.disabled = false; btn.textContent = 'Save Settings'; });
  });

  // -- Sound Packs Tab --
  function loadPacks() {
    fetch('/gamification/api/packs').then(function(r) { return r.json(); }).then(function(data) {
      packs = data || [];
      renderPackList();
      updatePackSelect(document.getElementById('gs-active-pack').value);
    }).catch(function() {});
  }

  function renderPackList() {
    var container = document.getElementById('pack-list-items');
    container.innerHTML = '<div class="pack-item builtin' + (selectedPackId === 'synth' ? ' active' : '') + '" data-pack="synth"><div><div class="name">Built-in: Synth</div><div class="count">8/8 slots (Web Audio)</div></div></div>';
    packs.forEach(function(p) {
      var filled = SLOTS.filter(function(s) { return p.slots && p.slots[s]; }).length;
      var div = document.createElement('div');
      div.className = 'pack-item' + (selectedPackId === p.id ? ' active' : '');
      div.setAttribute('data-pack', p.id);
      div.innerHTML = '<div><div class="name">' + escHtml(p.name) + '</div><div class="count">' + filled + '/8 slots</div></div>';
      container.appendChild(div);
    });

    container.querySelectorAll('.pack-item').forEach(function(item) {
      item.addEventListener('click', function() {
        selectPack(item.getAttribute('data-pack'));
      });
    });
  }

  function selectPack(packId) {
    selectedPackId = packId;
    renderPackList();
    if (packId === 'synth') {
      showSynthPreview();
    } else {
      var pack = packs.find(function(p) { return p.id === packId; });
      if (pack) showPackEditor(pack);
    }
  }

  function showSynthPreview() {
    document.getElementById('empty-editor').style.display = 'none';
    document.getElementById('editor-content').style.display = 'none';
    document.getElementById('synth-preview').style.display = 'block';
    var container = document.getElementById('synth-slots');
    container.innerHTML = '';
    SLOTS.forEach(function(slot) {
      var row = document.createElement('div');
      row.className = 'slot-row';
      row.style.gridTemplateColumns = '90px 1fr 36px';
      row.innerHTML = '<div class="slot-label">' + slot + '</div><div class="slot-file filled">Web Audio synth</div>';
      var btn = document.createElement('button');
      btn.className = 'play-btn';
      btn.innerHTML = '${icons.playSmall.replace(/'/g, "\\'")}';
      btn.addEventListener('click', function() { SoundEngine.getSynths()[slot](); });
      row.appendChild(btn);
      container.appendChild(row);
    });
  }

  function showPackEditor(pack) {
    document.getElementById('empty-editor').style.display = 'none';
    document.getElementById('synth-preview').style.display = 'none';
    document.getElementById('editor-content').style.display = 'block';
    document.getElementById('editor-name').value = pack.name;
    renderSlotRows(pack);
  }

  function renderSlotRows(pack) {
    var container = document.getElementById('slot-rows');
    container.innerHTML = '';
    SLOTS.forEach(function(slot) {
      var filename = pack.slots && pack.slots[slot] ? pack.slots[slot] : null;
      var row = document.createElement('div');
      row.className = 'slot-row';
      var label = document.createElement('div');
      label.className = 'slot-label';
      label.textContent = slot;
      var fileLabel = document.createElement('div');
      fileLabel.className = 'slot-file' + (filename ? ' filled' : '');
      fileLabel.textContent = filename || 'empty';
      var uploadBtn = document.createElement('button');
      uploadBtn.className = 'btn btn-secondary btn-sm';
      uploadBtn.textContent = 'Upload';
      uploadBtn.addEventListener('click', function() { triggerUpload(pack.id, slot); });
      var playBtn = document.createElement('button');
      playBtn.className = 'play-btn';
      playBtn.innerHTML = '${icons.playSmall.replace(/'/g, "\\'")}';
      playBtn.addEventListener('click', function() {
        if (filename) {
          var url = '/sounds/' + encodeURIComponent(currentOrgId) + '/' + encodeURIComponent(pack.id) + '/' + slot + '.mp3';
          SoundEngine.playFile(url);
        } else {
          toast('No file uploaded for this slot', 'error');
        }
      });
      row.appendChild(label);
      row.appendChild(fileLabel);
      row.appendChild(uploadBtn);
      row.appendChild(playBtn);
      container.appendChild(row);
    });
  }

  var pendingUpload = { packId: null, slot: null };
  function triggerUpload(packId, slot) {
    pendingUpload = { packId: packId, slot: slot };
    document.getElementById('file-input').click();
  }

  document.getElementById('file-input').addEventListener('change', function() {
    var file = this.files[0];
    if (!file || !pendingUpload.packId) return;
    if (file.size > 2 * 1024 * 1024) { toast('File too large (max 2MB)', 'error'); return; }
    var fd = new FormData();
    fd.append('packId', pendingUpload.packId);
    fd.append('slot', pendingUpload.slot);
    fd.append('file', file);
    toast('Uploading...');
    fetch('/gamification/api/upload-sound', { method: 'POST', body: fd })
      .then(function(r) { if (!r.ok) throw new Error('Upload failed'); return r.json(); })
      .then(function() { toast('Uploaded ' + file.name); loadPacks(); setTimeout(function() { selectPack(pendingUpload.packId); }, 300); })
      .catch(function(err) { toast(err.message, 'error'); });
    this.value = '';
  });

  // New Pack
  document.getElementById('new-pack-btn').addEventListener('click', function() {
    var name = prompt('Pack name:');
    if (!name) return;
    fetch('/gamification/api/pack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name }) })
      .then(function(r) { return r.json(); })
      .then(function(pack) { toast('Created ' + pack.name); loadPacks(); setTimeout(function() { selectPack(pack.id); }, 300); })
      .catch(function(err) { toast(err.message, 'error'); });
  });

  // Delete Pack
  document.getElementById('editor-delete').addEventListener('click', function() {
    if (!selectedPackId || selectedPackId === 'synth') return;
    if (!confirm('Delete this pack? This cannot be undone.')) return;
    fetch('/gamification/api/pack/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: selectedPackId }) })
      .then(function(r) { if (!r.ok) throw new Error('Delete failed'); return r.json(); })
      .then(function() { toast('Pack deleted'); selectedPackId = null; loadPacks(); document.getElementById('editor-content').style.display = 'none'; document.getElementById('empty-editor').style.display = 'block'; })
      .catch(function(err) { toast(err.message, 'error'); });
  });

  // Set as Active
  document.getElementById('editor-set-active').addEventListener('click', function() {
    if (!selectedPackId || selectedPackId === 'synth') return;
    document.getElementById('gs-active-pack').value = selectedPackId;
    // Switch to settings tab and save
    document.querySelectorAll('.tab')[0].click();
    toast('Pack set as active - click Save Settings to apply');
  });

  // Save pack name on blur
  document.getElementById('editor-name').addEventListener('blur', function() {
    if (!selectedPackId || selectedPackId === 'synth') return;
    var name = this.value.trim();
    if (!name) return;
    fetch('/gamification/api/pack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: selectedPackId, name: name }) })
      .then(function(r) { return r.json(); })
      .then(function() { loadPacks(); })
      .catch(function() {});
  });

  // Seed
  document.getElementById('seed-btn').addEventListener('click', function() {
    var btn = this;
    btn.disabled = true;
    btn.textContent = 'Seeding...';
    fetch('/gamification/api/seed', { method: 'POST' })
      .then(function(r) { if (!r.ok) throw new Error('Seed failed'); return r.json(); })
      .then(function(d) { toast('Seeded ' + d.uploaded + ' files across ' + d.packs + ' packs'); loadPacks(); })
      .catch(function(err) { toast(err.message, 'error'); })
      .finally(function() { btn.disabled = false; btn.textContent = 'Seed Built-in Packs'; });
  });

  function escHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  // -- Badges --
  var TIER_COLORS = { common: '#6b7280', uncommon: '#22c55e', rare: '#3b82f6', epic: '#a855f7', legendary: '#f59e0b' };
  var BADGE_ROLES = ['reviewer', 'judge', 'manager', 'agent'];
  var ROLE_LABELS = { reviewer: 'Reviewer', judge: 'Judge', manager: 'Manager', agent: 'Agent' };

  var ALL_BADGES = [
    { id: 'rev_first_blood', role: 'reviewer', tier: 'common', name: 'First Blood', icon: '\\u{1FA78}', description: 'Complete your first review', xpReward: 25 },
    { id: 'rev_centurion', role: 'reviewer', tier: 'uncommon', name: 'Centurion', icon: '\\u{1F6E1}', description: 'Complete 100 reviews', xpReward: 100 },
    { id: 'rev_grinder', role: 'reviewer', tier: 'rare', name: 'The Grinder', icon: '\\u{2699}', description: 'Complete 1,000 reviews', xpReward: 500 },
    { id: 'rev_speed_demon', role: 'reviewer', tier: 'uncommon', name: 'Speed Demon', icon: '\\u{26A1}', description: 'Average under 8s (50+ reviews)', xpReward: 150 },
    { id: 'rev_streak_7', role: 'reviewer', tier: 'uncommon', name: 'Week Warrior', icon: '\\u{1F4C5}', description: '7-day streak', xpReward: 75 },
    { id: 'rev_streak_30', role: 'reviewer', tier: 'rare', name: 'Iron Will', icon: '\\u{1F525}', description: '30-day streak', xpReward: 300 },
    { id: 'rev_combo_10', role: 'reviewer', tier: 'uncommon', name: 'Combo Breaker', icon: '\\u{1F4A5}', description: '10x combo', xpReward: 50 },
    { id: 'rev_combo_20', role: 'reviewer', tier: 'rare', name: 'Unstoppable', icon: '\\u{1F32A}', description: '20x combo', xpReward: 150 },
    { id: 'rev_combo_50', role: 'reviewer', tier: 'epic', name: 'Beyond Godlike', icon: '\\u{1F451}', description: '50x combo', xpReward: 500 },
    { id: 'rev_level_10', role: 'reviewer', tier: 'legendary', name: 'Max Level', icon: '\\u{1F48E}', description: 'Reach level 10', xpReward: 1000 },
    { id: 'jdg_first_verdict', role: 'judge', tier: 'common', name: 'First Verdict', icon: '\\u{2696}', description: 'Judge your first question', xpReward: 25 },
    { id: 'jdg_arbiter', role: 'judge', tier: 'uncommon', name: 'The Arbiter', icon: '\\u{1F3DB}', description: 'Judge 100 questions', xpReward: 100 },
    { id: 'jdg_supreme', role: 'judge', tier: 'rare', name: 'Supreme Court', icon: '\\u{1F3DB}', description: 'Judge 1,000 questions', xpReward: 500 },
    { id: 'jdg_overturn_10', role: 'judge', tier: 'uncommon', name: 'Objection!', icon: '\\u{1F504}', description: 'Overturn 10 decisions', xpReward: 75 },
    { id: 'jdg_overturn_50', role: 'judge', tier: 'rare', name: 'Court of Appeals', icon: '\\u{1F504}', description: 'Overturn 50 decisions', xpReward: 250 },
    { id: 'jdg_uphold_20', role: 'judge', tier: 'uncommon', name: 'Stamp of Approval', icon: '\\u{2705}', description: 'Uphold 20 in a row', xpReward: 100 },
    { id: 'jdg_combo_10', role: 'judge', tier: 'uncommon', name: 'Swift Justice', icon: '\\u{26A1}', description: '10x combo', xpReward: 50 },
    { id: 'jdg_streak_14', role: 'judge', tier: 'rare', name: 'Fortnight Judge', icon: '\\u{1F525}', description: '14-day streak', xpReward: 200 },
    { id: 'jdg_level_10', role: 'judge', tier: 'legendary', name: 'Grand Magistrate', icon: '\\u{1F48E}', description: 'Reach level 10', xpReward: 1000 },
    { id: 'mgr_first_fix', role: 'manager', tier: 'common', name: 'First Response', icon: '\\u{1F527}', description: 'First remediation', xpReward: 25 },
    { id: 'mgr_fifty', role: 'manager', tier: 'uncommon', name: 'Firefighter', icon: '\\u{1F692}', description: 'Remediate 50', xpReward: 100 },
    { id: 'mgr_two_hundred', role: 'manager', tier: 'rare', name: 'Zero Tolerance', icon: '\\u{1F3AF}', description: 'Remediate 200', xpReward: 500 },
    { id: 'mgr_fast_24h', role: 'manager', tier: 'uncommon', name: 'Rapid Response', icon: '\\u{23F1}', description: '10 within 24h', xpReward: 150 },
    { id: 'mgr_fast_1h', role: 'manager', tier: 'rare', name: 'Lightning Manager', icon: '\\u{26A1}', description: '5 within 1h', xpReward: 300 },
    { id: 'mgr_clear_queue', role: 'manager', tier: 'rare', name: 'Queue Slayer', icon: '\\u{1F5E1}', description: 'Clear queue to zero', xpReward: 250 },
    { id: 'mgr_streak_5', role: 'manager', tier: 'uncommon', name: 'Consistent Manager', icon: '\\u{1F4C5}', description: '5-day streak', xpReward: 75 },
    { id: 'mgr_streak_20', role: 'manager', tier: 'rare', name: 'Relentless', icon: '\\u{1F525}', description: '20-day streak', xpReward: 300 },
    { id: 'mgr_mentor', role: 'manager', tier: 'epic', name: 'Team Builder', icon: '\\u{1F31F}', description: 'All agents above 80%', xpReward: 500 },
    { id: 'agt_first_audit', role: 'agent', tier: 'common', name: 'Rookie', icon: '\\u{1F393}', description: 'First audit', xpReward: 25 },
    { id: 'agt_fifty', role: 'agent', tier: 'uncommon', name: 'Seasoned Agent', icon: '\\u{1F3C5}', description: '50 audits', xpReward: 100 },
    { id: 'agt_hundred', role: 'agent', tier: 'rare', name: 'Road Warrior', icon: '\\u{1F6E1}', description: '100 audits', xpReward: 500 },
    { id: 'agt_perfect_10', role: 'agent', tier: 'rare', name: 'Perfect Ten', icon: '\\u{1F4AF}', description: '100% on 10 audits', xpReward: 300 },
    { id: 'agt_honor_roll', role: 'agent', tier: 'uncommon', name: 'Honor Roll', icon: '\\u{1F4DC}', description: '90%+ avg (20+ audits)', xpReward: 200 },
    { id: 'agt_comeback', role: 'agent', tier: 'uncommon', name: 'Comeback Kid', icon: '\\u{1F4C8}', description: 'Weekly avg +15 pts', xpReward: 150 },
    { id: 'agt_consistent', role: 'agent', tier: 'rare', name: 'Consistent Performer', icon: '\\u{1F4CA}', description: '5 weeks above 80%', xpReward: 300 },
  ];

  var badgesLoaded = false;
  function loadBadges() {
    if (badgesLoaded) return;
    badgesLoaded = true;
    fetch('/api/badges', { credentials: 'same-origin' })
      .then(function(r) { return r.json(); })
      .then(function(data) { renderBadgeCatalog(data.earned || []); })
      .catch(function() { renderBadgeCatalog([]); });
  }

  function renderBadgeCatalog(earnedIds) {
    var earnedSet = {};
    for (var i = 0; i < earnedIds.length; i++) earnedSet[earnedIds[i]] = true;

    var totalEarned = 0;
    var totalXp = 0;
    var container = document.getElementById('badge-catalog');
    var html = '';

    for (var r = 0; r < BADGE_ROLES.length; r++) {
      var role = BADGE_ROLES[r];
      var roleBadges = ALL_BADGES.filter(function(b) { return b.role === role; });
      html += '<div class="badge-role-group">';
      html += '<div class="badge-role-title">' + escHtml(ROLE_LABELS[role]) + ' (' + roleBadges.length + ')</div>';
      html += '<div class="badge-grid">';
      for (var j = 0; j < roleBadges.length; j++) {
        var b = roleBadges[j];
        var isEarned = !!earnedSet[b.id];
        if (isEarned) { totalEarned++; totalXp += b.xpReward; }
        var tierColor = TIER_COLORS[b.tier] || '#6e7681';
        html += '<div class="badge-card' + (isEarned ? ' earned' : ' locked') + '"' +
          (isEarned ? ' style="border-color:' + tierColor + '"' : '') + '>' +
          '<span class="bc-icon">' + b.icon + '</span>' +
          '<div class="bc-info">' +
          '<span class="bc-name">' + escHtml(b.name) + '</span>' +
          '<span class="bc-desc">' + escHtml(b.description) + '</span>' +
          '<span class="bc-tier" style="color:' + tierColor + '">' + escHtml(b.tier) + ' &middot; +' + b.xpReward + ' XP</span>' +
          '</div></div>';
      }
      html += '</div></div>';
    }
    container.innerHTML = html;
    document.getElementById('badges-earned-count').textContent = totalEarned;
    document.getElementById('badges-xp-earned').textContent = '+' + totalXp + ' XP from badges';
  }

  // -- Store --
  ${STORE_JS}

  var storeLoaded = false;
  var _storeItems = [];
  var _storeBalance = 0;
  var _storePurchased = [];

  function loadStore() {
    if (storeLoaded) return;
    storeLoaded = true;
    fetch('/api/store', { credentials: 'same-origin' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        _storeItems = data.items || [];
        _storeBalance = data.balance || 0;
        _storePurchased = data.purchased || [];
        document.getElementById('sw-balance').textContent = _storeBalance.toLocaleString();
        if (data.level != null) document.getElementById('sw-level').textContent = data.level;
        if (data.totalXp != null) document.getElementById('sw-xp').textContent = data.totalXp.toLocaleString();
        renderStoreCards(document.getElementById('store-container'), _storeItems, _storeBalance, _storePurchased);
      })
      .catch(function() {
        document.getElementById('store-container').innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-dim);">Failed to load store.</div>';
      });
  }

  // Init
  loadSettings();
  loadPacks();
})();
<\/script>
</body>
</html>`;
}
