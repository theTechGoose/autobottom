/** Standalone store page -- accessible to all roles at /store. */

import * as icons from "./icons.ts";
import { STORE_CSS, STORE_JS } from "./store-ui.ts";

export function getStorePage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AutoBot Store</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --bg: #0b0f15; --bg-raised: #111620; --bg-surface: #161c28;
    --border: #1c2333; --border-hover: #2a3346;
    --text: #c9d1d9; --text-muted: #6e7681; --text-dim: #484f58; --text-bright: #e6edf3;
    --green: #3fb950; --red: #f85149;
  }
  body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; min-height: 100vh; }

  .topbar {
    display: flex; align-items: center; gap: 12px; padding: 14px 24px;
    border-bottom: 1px solid var(--border); background: var(--bg-raised);
    position: sticky; top: 0; z-index: 50;
  }
  .topbar a { color: var(--text-muted); text-decoration: none; display: flex; align-items: center; gap: 6px; font-size: 13px; transition: color 0.15s; }
  .topbar a:hover { color: var(--text); }
  .topbar h1 { font-size: 18px; font-weight: 800; margin-left: auto; letter-spacing: -0.3px; color: var(--text-bright); }

  .loading { display: flex; align-items: center; justify-content: center; padding: 80px; color: var(--text-dim); font-size: 13px; }

  ${STORE_CSS}
</style>
</head>
<body>

<div class="topbar">
  <a href="javascript:history.back()" id="back-link">${icons.arrowLeft} Back</a>
  <h1>AutoBot Store</h1>
</div>

<div id="loading" class="loading">Loading store...</div>
<div id="store-wrap" style="display:none">
  <div class="store-layout">
    <div class="store-sidebar" id="store-sidebar"></div>
    <div class="store-main">
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
      <div id="store-container"></div>
    </div>
  </div>
</div>

<div class="store-toast" id="store-toast"></div>

<script>
(function() {
  ${STORE_JS}

  var items = [], balance = 0, purchased = [];

  async function init() {
    try {
      var res = await fetch('/api/store');
      if (!res.ok) {
        if (res.status === 401) { window.location.href = '/login'; return; }
        throw new Error('HTTP ' + res.status);
      }
      var data = await res.json();
      items = data.items || [];
      balance = data.balance || 0;
      purchased = data.purchased || [];

      document.getElementById('sw-balance').textContent = balance.toLocaleString();
      document.getElementById('sw-level').textContent = data.level != null ? data.level : '--';
      document.getElementById('sw-xp').textContent = data.totalXp != null ? data.totalXp.toLocaleString() : '--';

      document.getElementById('loading').style.display = 'none';
      document.getElementById('store-wrap').style.display = 'block';
      renderStoreCards(document.getElementById('store-container'), items, balance, purchased);
    } catch (err) {
      document.getElementById('loading').textContent = 'Failed to load store: ' + err.message;
    }
  }

  init();
})();
<\/script>
</body>
</html>`;
}
