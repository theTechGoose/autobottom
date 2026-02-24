/**
 * Badge Editor page -- admin-only store catalog management.
 * Sidebar + scrollable main layout for managing built-in and custom store items.
 */

import * as icons from "./icons.ts";

export function getBadgeEditorPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Store Catalog - Auto-Bot</title>
<style>
  :root {
    --bg: #0b0f15; --bg-raised: #111620; --bg-surface: #161c28;
    --border: #1c2333; --border-hover: #2a3346;
    --text: #c9d1d9; --text-muted: #6e7681; --text-dim: #484f58; --text-bright: #e6edf3;
    --cyan: #39d0d8; --cyan-bg: rgba(57,208,216,0.10); --cyan-dim: rgba(57,208,216,0.25);
    --green: #3fb950; --red: #f85149; --yellow: #d29922; --purple: #bc8cff;
    --blue: #58a6ff; --blue-bg: rgba(31,111,235,0.10); --green-bg: rgba(63,185,80,0.10);
    --red-bg: rgba(248,81,73,0.10); --yellow-bg: rgba(210,153,34,0.10); --purple-bg: rgba(139,92,246,0.10);
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; min-height: 100vh; display: flex; }

  /* Sidebar */
  .sidebar {
    width: 240px; min-width: 240px; height: 100vh; position: fixed; left: 0; top: 0;
    background: var(--bg-raised); border-right: 1px solid var(--border);
    display: flex; flex-direction: column; z-index: 40;
  }
  .sidebar-brand {
    padding: 20px 20px 6px; border-bottom: 1px solid var(--border);
  }
  .sidebar-brand h1 { font-size: 15px; font-weight: 800; color: var(--text-bright); letter-spacing: -0.3px; }
  .sidebar-brand p { font-size: 11px; color: var(--text-muted); margin-top: 2px; padding-bottom: 14px; }

  .sidebar-nav { flex: 1; padding: 12px 10px; display: flex; flex-direction: column; gap: 2px; }
  .sidebar-nav a {
    display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 8px;
    font-size: 13px; font-weight: 500; color: var(--text-muted); text-decoration: none; transition: all 0.15s;
  }
  .sidebar-nav a:hover { background: var(--bg-surface); color: var(--text); }
  .sidebar-nav a.active { background: var(--cyan-bg); color: var(--cyan); }
  .sidebar-nav a svg { flex-shrink: 0; }

  .sidebar-footer {
    padding: 14px 16px; border-top: 1px solid var(--border);
    display: flex; align-items: center; gap: 10px;
  }
  .sidebar-footer .sf-avatar {
    width: 30px; height: 30px; border-radius: 50%; background: var(--bg-surface); border: 1px solid var(--border);
    display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; color: var(--cyan);
  }
  .sidebar-footer .sf-info { flex: 1; overflow: hidden; }
  .sidebar-footer .sf-name { font-size: 12px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sidebar-footer .sf-role { font-size: 10px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; }
  .sidebar-footer .sf-logout {
    background: none; border: 1px solid var(--border); border-radius: 6px; padding: 5px 10px;
    font-size: 11px; color: var(--text-muted); cursor: pointer; transition: all 0.15s;
  }
  .sidebar-footer .sf-logout:hover { border-color: var(--red); color: var(--red); }

  /* Main area */
  .main {
    margin-left: 240px; flex: 1; min-height: 100vh; overflow-y: auto; display: flex; flex-direction: column;
  }

  /* Header */
  .header {
    display: flex; align-items: center; justify-content: space-between; padding: 20px 28px;
    border-bottom: 1px solid var(--border); background: var(--bg-raised); position: sticky; top: 0; z-index: 30;
  }
  .header h2 { font-size: 18px; font-weight: 800; color: var(--text-bright); letter-spacing: -0.3px; }
  .btn-new-item {
    display: inline-flex; align-items: center; gap: 6px; padding: 8px 18px; border-radius: 8px;
    font-size: 13px; font-weight: 600; cursor: pointer; border: 1px solid var(--cyan);
    background: var(--cyan-bg); color: var(--cyan); transition: all 0.15s;
  }
  .btn-new-item:hover { background: var(--cyan-dim); }

  /* Filter tabs */
  .filter-bar {
    display: flex; gap: 0; padding: 0 28px; border-bottom: 1px solid var(--border); background: var(--bg-raised);
    overflow-x: auto; flex-shrink: 0;
  }
  .filter-tab {
    padding: 10px 16px; font-size: 12px; font-weight: 600; color: var(--text-muted); cursor: pointer;
    border-bottom: 2px solid transparent; transition: all 0.15s; white-space: nowrap;
  }
  .filter-tab:hover { color: var(--text); }
  .filter-tab.active { color: var(--cyan); border-bottom-color: var(--cyan); }

  /* Table */
  .table-wrap { flex: 1; padding: 20px 28px; overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; min-width: 700px; }
  thead th {
    text-align: left; padding: 10px 12px; font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.8px; color: var(--text-dim); border-bottom: 1px solid var(--border);
  }
  tbody tr { border-bottom: 1px solid var(--border); transition: background 0.1s; }
  tbody tr:hover { background: var(--bg-surface); }
  tbody td { padding: 10px 12px; font-size: 13px; vertical-align: middle; }

  .item-icon { font-size: 20px; width: 36px; text-align: center; }

  /* Pills */
  .pill {
    display: inline-block; padding: 2px 10px; border-radius: 10px; font-size: 10px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.5px;
  }
  .pill-type { background: var(--bg-surface); color: var(--text-muted); border: 1px solid var(--border); }
  .pill-rarity { border: 1px solid currentColor; }

  .pill-source-builtin { background: var(--bg-surface); color: var(--text-dim); border: 1px solid var(--border); font-size: 10px; padding: 2px 8px; border-radius: 10px; font-weight: 600; }
  .pill-source-custom { background: var(--cyan-bg); color: var(--cyan); border: 1px solid var(--cyan-dim); font-size: 10px; padding: 2px 8px; border-radius: 10px; font-weight: 600; }

  .token-price { display: inline-flex; align-items: center; gap: 4px; font-weight: 600; font-size: 13px; }
  .token-symbol {
    display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px;
    border-radius: 50%; background: var(--yellow-bg); color: var(--yellow); font-size: 9px; font-weight: 800;
  }

  .actions-cell { display: flex; gap: 6px; }
  .btn-action {
    padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer;
    border: 1px solid var(--border); background: var(--bg-surface); color: var(--text-muted); transition: all 0.12s;
  }
  .btn-action:hover { border-color: var(--border-hover); color: var(--text); }
  .btn-action.delete { color: var(--red); }
  .btn-action.delete:hover { background: var(--red-bg); border-color: rgba(248,81,73,0.3); }

  .empty-state { text-align: center; padding: 60px 20px; color: var(--text-dim); font-size: 13px; }

  /* Modal overlay */
  .modal-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 100;
    display: flex; align-items: center; justify-content: center;
    opacity: 0; visibility: hidden; transition: opacity 0.2s, visibility 0.2s;
  }
  .modal-overlay.open { opacity: 1; visibility: visible; }

  .modal {
    background: var(--bg-raised); border: 1px solid var(--border); border-radius: 14px;
    width: 520px; max-width: 95vw; max-height: 90vh; overflow-y: auto;
    transform: translateY(12px); transition: transform 0.2s;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
  }
  .modal-overlay.open .modal { transform: translateY(0); }

  .modal-header {
    display: flex; align-items: center; justify-content: space-between; padding: 18px 22px;
    border-bottom: 1px solid var(--border);
  }
  .modal-header h3 { font-size: 15px; font-weight: 700; color: var(--text-bright); }
  .modal-close {
    background: none; border: none; color: var(--text-dim); font-size: 20px; cursor: pointer;
    padding: 4px 8px; border-radius: 6px; transition: color 0.15s;
  }
  .modal-close:hover { color: var(--text); }

  .modal-body { padding: 20px 22px; }

  .form-field { margin-bottom: 16px; }
  .form-field label {
    display: block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.7px;
    color: var(--text-dim); margin-bottom: 6px;
  }
  .form-field input, .form-field select, .form-field textarea {
    width: 100%; padding: 9px 12px; background: var(--bg-surface); border: 1px solid var(--border);
    border-radius: 8px; color: var(--text); font-size: 13px; font-family: inherit; outline: none;
    transition: border-color 0.15s;
  }
  .form-field input:focus, .form-field select:focus, .form-field textarea:focus { border-color: var(--cyan); }
  .form-field input[readonly] { opacity: 0.6; cursor: not-allowed; }
  .form-field textarea { resize: vertical; min-height: 60px; }

  .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

  .rarity-live {
    display: inline-flex; align-items: center; gap: 8px; margin-top: 4px;
  }
  .rarity-live .pill { font-size: 11px; }

  .color-preview-strip {
    height: 24px; border-radius: 6px; border: 1px solid var(--border); margin-top: 6px;
    display: none;
  }

  .modal-footer {
    display: flex; justify-content: flex-end; gap: 10px; padding: 16px 22px;
    border-top: 1px solid var(--border);
  }
  .btn-modal {
    padding: 8px 20px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;
    border: 1px solid var(--border); transition: all 0.15s;
  }
  .btn-cancel { background: var(--bg-surface); color: var(--text-muted); }
  .btn-cancel:hover { background: var(--bg); border-color: var(--border-hover); color: var(--text); }
  .btn-save { background: var(--cyan); color: #000; border-color: var(--cyan); font-weight: 700; }
  .btn-save:hover { filter: brightness(1.1); }
  .btn-save:disabled { opacity: 0.5; cursor: default; filter: none; }

  /* Toast */
  .toast-wrap { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); z-index: 200; pointer-events: none; }
  .toast {
    padding: 8px 20px; border-radius: 8px; font-size: 12px; font-weight: 600;
    backdrop-filter: blur(12px); box-shadow: 0 4px 20px rgba(0,0,0,0.4);
    opacity: 0; transition: opacity 0.2s;
  }
  .toast.show { opacity: 1; }
  .toast.success { background: rgba(11,15,21,0.95); color: var(--green); border: 1px solid rgba(63,185,80,0.15); }
  .toast.error { background: rgba(11,15,21,0.95); color: var(--red); border: 1px solid rgba(248,81,73,0.15); }
</style>
</head>
<body>

<div class="sidebar">
  <div class="sidebar-brand">
    <h1>Auto-Bot</h1>
    <p>Store Catalog</p>
  </div>
  <nav class="sidebar-nav">
    <a href="/admin/dashboard" id="dashboard-link">${icons.layoutDashboard} Dashboard</a>
    <a href="/chat">${icons.messageCircle24} Chat</a>
    <a href="/gamification">${icons.trophy} Gamification</a>
    <a href="/store" class="active">${icons.shoppingBag} Store</a>
  </nav>
  <div class="sidebar-footer">
    <div class="sf-avatar" id="sf-avatar">--</div>
    <div class="sf-info">
      <div class="sf-name" id="sf-name">Loading...</div>
      <div class="sf-role" id="sf-role">--</div>
    </div>
    <button class="sf-logout" onclick="window.location.href='/logout'">Logout</button>
  </div>
</div>

<div class="main">
  <div class="header">
    <h2>Store Catalog</h2>
    <button class="btn-new-item" id="btn-new-item">+ New Item</button>
  </div>

  <div class="filter-bar">
    <div class="filter-tab active" data-filter="all">All</div>
    <div class="filter-tab" data-filter="title">Titles</div>
    <div class="filter-tab" data-filter="avatar_frame">Frames</div>
    <div class="filter-tab" data-filter="name_color">Colors</div>
    <div class="filter-tab" data-filter="flair">Flair</div>
    <div class="filter-tab" data-filter="font">Fonts</div>
    <div class="filter-tab" data-filter="animation">Animations</div>
    <div class="filter-tab" data-filter="theme">Themes</div>
  </div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th style="width:50px">Icon</th>
          <th>Name</th>
          <th>Type</th>
          <th>Rarity</th>
          <th>Price</th>
          <th>Source</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody id="items-tbody">
        <tr><td colspan="7" class="empty-state">Loading items...</td></tr>
      </tbody>
    </table>
  </div>
</div>

<!-- Modal -->
<div class="modal-overlay" id="modal-overlay">
  <div class="modal">
    <div class="modal-header">
      <h3 id="modal-title">New Item</h3>
      <button class="modal-close" id="modal-close">&times;</button>
    </div>
    <div class="modal-body">
      <div class="form-row">
        <div class="form-field">
          <label>ID</label>
          <input type="text" id="field-id" readonly placeholder="Auto-generated from name">
        </div>
        <div class="form-field">
          <label>Name</label>
          <input type="text" id="field-name" placeholder="Item name">
        </div>
      </div>
      <div class="form-row">
        <div class="form-field">
          <label>Type</label>
          <select id="field-type">
            <option value="title">Title</option>
            <option value="avatar_frame">Avatar Frame</option>
            <option value="name_color">Name Color</option>
            <option value="animation">Animation</option>
            <option value="theme">Theme</option>
            <option value="flair">Flair</option>
            <option value="font">Font</option>
            <option value="bubble_font">Bubble Font</option>
            <option value="bubble_color">Bubble Color</option>
          </select>
        </div>
        <div class="form-field">
          <label>Price</label>
          <input type="number" id="field-price" min="0" value="0" placeholder="0">
          <div class="rarity-live">
            <span style="font-size:11px;color:var(--text-dim);">Rarity:</span>
            <span class="pill pill-rarity" id="rarity-pill" style="color:#6b7280;">Common</span>
          </div>
        </div>
      </div>
      <div class="form-row">
        <div class="form-field">
          <label>Icon</label>
          <input type="text" id="field-icon" placeholder="Emoji or text icon">
        </div>
        <div class="form-field">
          <label>Preview (CSS value)</label>
          <input type="text" id="field-preview" placeholder="e.g. #ff0 or linear-gradient(...)">
          <div class="color-preview-strip" id="color-preview-strip"></div>
        </div>
      </div>
      <div class="form-field">
        <label>Description</label>
        <textarea id="field-description" placeholder="Brief description of this item"></textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-modal btn-cancel" id="modal-cancel">Cancel</button>
      <button class="btn-modal btn-save" id="modal-save">Save</button>
    </div>
  </div>
</div>

<div class="toast-wrap"><div class="toast" id="toast"></div></div>

<script>
(function() {
  var allItems = [];
  var activeFilter = 'all';
  var editMode = false;
  var editingId = null;
  var userRole = 'admin';

  var RARITY_COLORS = {
    common: '#6b7280',
    uncommon: '#22c55e',
    rare: '#3b82f6',
    epic: '#a855f7',
    legendary: '#f59e0b'
  };

  var TYPE_LABELS = {
    title: 'Title', avatar_frame: 'Frame', name_color: 'Color', animation: 'Animation',
    theme: 'Theme', flair: 'Flair', font: 'Font', bubble_font: 'Bubble Font', bubble_color: 'Bubble Color'
  };

  var COLOR_TYPES = ['name_color', 'bubble_color', 'avatar_frame'];

  // -- Utility --
  function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

  function slugify(name) {
    return name.toLowerCase().replace(/[^a-z0-9\\s]/g, '').replace(/\\s+/g, '_').replace(/^_+|_+$/g, '');
  }

  function priceToRarity(price) {
    if (price >= 1000) return 'legendary';
    if (price >= 700) return 'epic';
    if (price >= 400) return 'rare';
    if (price >= 200) return 'uncommon';
    return 'common';
  }

  function toast(msg, type) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast ' + (type || 'success') + ' show';
    clearTimeout(toast._t);
    toast._t = setTimeout(function() { el.classList.remove('show'); }, 2500);
  }

  // -- Data loading --
  function loadItems() {
    fetch('/admin/badge-editor/items')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var builtIn = (data.builtIn || []).map(function(item) { item._source = 'builtin'; return item; });
        var custom = (data.custom || []).map(function(item) { item._source = 'custom'; return item; });
        allItems = builtIn.concat(custom);
        renderTable();
      })
      .catch(function(err) {
        document.getElementById('items-tbody').innerHTML = '<tr><td colspan="7" class="empty-state">Failed to load items.</td></tr>';
      });
  }

  function loadUser() {
    fetch('/admin/api/me')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        userRole = data.role || 'admin';
        var name = data.name || data.email || 'Admin';
        document.getElementById('sf-name').textContent = name;
        document.getElementById('sf-role').textContent = userRole;
        document.getElementById('sf-avatar').textContent = name.charAt(0).toUpperCase();

        if (userRole === 'admin') {
          document.getElementById('dashboard-link').href = '/admin/dashboard';
        } else {
          document.getElementById('dashboard-link').href = '/judge/dashboard';
        }
      })
      .catch(function() {});
  }

  // -- Render --
  function renderTable() {
    var tbody = document.getElementById('items-tbody');
    var filtered = activeFilter === 'all'
      ? allItems
      : allItems.filter(function(item) { return item.type === activeFilter; });

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No items found.</td></tr>';
      return;
    }

    var html = '';
    for (var i = 0; i < filtered.length; i++) {
      var item = filtered[i];
      var rarity = item.rarity || priceToRarity(item.price || 0);
      var rarityColor = RARITY_COLORS[rarity] || RARITY_COLORS.common;
      var typeLabel = TYPE_LABELS[item.type] || item.type;
      var isBuiltIn = item._source === 'builtin';

      html += '<tr>';
      html += '<td class="item-icon">' + esc(item.icon || '') + '</td>';
      html += '<td style="font-weight:600;color:var(--text-bright);">' + esc(item.name || item.id) + '</td>';
      html += '<td><span class="pill pill-type">' + esc(typeLabel) + '</span></td>';
      html += '<td><span class="pill pill-rarity" style="color:' + rarityColor + ';border-color:' + rarityColor + ';">' + esc(rarity) + '</span></td>';
      html += '<td><span class="token-price"><span class="token-symbol">T</span>' + (item.price || 0) + '</span></td>';

      if (isBuiltIn) {
        html += '<td><span class="pill-source-builtin">Built-in</span></td>';
        html += '<td></td>';
      } else {
        html += '<td><span class="pill-source-custom">Custom</span></td>';
        html += '<td><div class="actions-cell">';
        html += '<button class="btn-action edit" data-id="' + esc(item.id) + '">Edit</button>';
        html += '<button class="btn-action delete" data-id="' + esc(item.id) + '">Delete</button>';
        html += '</div></td>';
      }
      html += '</tr>';
    }

    tbody.innerHTML = html;

    // Attach edit/delete handlers
    tbody.querySelectorAll('.btn-action.edit').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var id = btn.getAttribute('data-id');
        var item = allItems.find(function(it) { return it.id === id; });
        if (item) openEditModal(item);
      });
    });
    tbody.querySelectorAll('.btn-action.delete').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var id = btn.getAttribute('data-id');
        if (confirm('Delete this item? This cannot be undone.')) {
          deleteItem(id);
        }
      });
    });
  }

  // -- Filter tabs --
  document.querySelectorAll('.filter-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      document.querySelectorAll('.filter-tab').forEach(function(t) { t.classList.remove('active'); });
      tab.classList.add('active');
      activeFilter = tab.getAttribute('data-filter');
      renderTable();
    });
  });

  // -- Modal --
  var overlay = document.getElementById('modal-overlay');

  function openCreateModal() {
    editMode = false;
    editingId = null;
    document.getElementById('modal-title').textContent = 'New Item';
    document.getElementById('field-id').value = '';
    document.getElementById('field-id').removeAttribute('readonly');
    document.getElementById('field-name').value = '';
    document.getElementById('field-type').value = 'title';
    document.getElementById('field-price').value = '0';
    document.getElementById('field-icon').value = '';
    document.getElementById('field-preview').value = '';
    document.getElementById('field-description').value = '';
    updateRarityPill();
    updateColorPreview();
    overlay.classList.add('open');
  }

  function openEditModal(item) {
    editMode = true;
    editingId = item.id;
    document.getElementById('modal-title').textContent = 'Edit Item';
    document.getElementById('field-id').value = item.id;
    document.getElementById('field-id').setAttribute('readonly', 'readonly');
    document.getElementById('field-name').value = item.name || '';
    document.getElementById('field-type').value = item.type || 'title';
    document.getElementById('field-price').value = item.price || 0;
    document.getElementById('field-icon').value = item.icon || '';
    document.getElementById('field-preview').value = item.preview || '';
    document.getElementById('field-description').value = item.description || '';
    updateRarityPill();
    updateColorPreview();
    overlay.classList.add('open');
  }

  function closeModal() {
    overlay.classList.remove('open');
  }

  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) closeModal();
  });

  document.getElementById('btn-new-item').addEventListener('click', openCreateModal);

  // -- Name -> ID slug (create mode only) --
  document.getElementById('field-name').addEventListener('input', function() {
    if (!editMode) {
      document.getElementById('field-id').value = slugify(this.value);
    }
  });

  // -- Price -> Rarity pill --
  function updateRarityPill() {
    var price = parseInt(document.getElementById('field-price').value) || 0;
    var rarity = priceToRarity(price);
    var pill = document.getElementById('rarity-pill');
    pill.textContent = rarity.charAt(0).toUpperCase() + rarity.slice(1);
    pill.style.color = RARITY_COLORS[rarity];
    pill.style.borderColor = RARITY_COLORS[rarity];
  }
  document.getElementById('field-price').addEventListener('input', updateRarityPill);

  // -- Preview -> Color strip --
  function updateColorPreview() {
    var type = document.getElementById('field-type').value;
    var preview = document.getElementById('field-preview').value.trim();
    var strip = document.getElementById('color-preview-strip');

    if (COLOR_TYPES.indexOf(type) !== -1 && preview) {
      strip.style.display = 'block';
      strip.style.background = preview;
    } else {
      strip.style.display = 'none';
    }
  }
  document.getElementById('field-preview').addEventListener('input', updateColorPreview);
  document.getElementById('field-type').addEventListener('change', updateColorPreview);

  // -- Save --
  document.getElementById('modal-save').addEventListener('click', function() {
    var btn = this;
    var payload = {
      id: document.getElementById('field-id').value.trim(),
      name: document.getElementById('field-name').value.trim(),
      type: document.getElementById('field-type').value,
      price: parseInt(document.getElementById('field-price').value) || 0,
      icon: document.getElementById('field-icon').value.trim(),
      preview: document.getElementById('field-preview').value.trim(),
      description: document.getElementById('field-description').value.trim()
    };

    if (!payload.id || !payload.name) {
      toast('ID and Name are required', 'error');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Saving...';

    fetch('/admin/badge-editor/item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function(r) {
        if (!r.ok) throw new Error('Save failed');
        return r.json();
      })
      .then(function() {
        toast('Item saved');
        closeModal();
        loadItems();
      })
      .catch(function(err) { toast(err.message, 'error'); })
      .finally(function() { btn.disabled = false; btn.textContent = 'Save'; });
  });

  // -- Delete --
  function deleteItem(id) {
    fetch('/admin/badge-editor/item/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id })
    })
      .then(function(r) {
        if (!r.ok) throw new Error('Delete failed');
        return r.json();
      })
      .then(function() {
        toast('Item deleted');
        loadItems();
      })
      .catch(function(err) { toast(err.message, 'error'); });
  }

  // -- Init --
  loadItems();
  loadUser();
})();
<\/script>
</body>
</html>`;
}
