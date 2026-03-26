/**
 * Shared store CSS + JS used by both gamification-page.ts (store tab)
 * and store-page.ts (standalone /store page).
 *
 * Exports raw CSS string and JS string to be embedded into template literals.
 */

export const STORE_CSS = `
  /* ── Store Design System ── */
  :root {
    --r-common: #6b7280; --r-common-bg: rgba(107,114,128,0.08);
    --r-uncommon: #22c55e; --r-uncommon-bg: rgba(34,197,94,0.08);
    --r-rare: #3b82f6; --r-rare-bg: rgba(59,130,246,0.08);
    --r-epic: #a855f7; --r-epic-bg: rgba(168,85,247,0.10);
    --r-legendary: #f59e0b; --r-legendary-bg: rgba(245,158,11,0.10);
    --coin: #fbbf24;
    --store-surface: #12161e; --store-card: #171c26; --store-border: #1e2432;
  }

  @keyframes store-shimmer {
    0% { background-position: -200% center; }
    100% { background-position: 200% center; }
  }
  @keyframes store-pulse {
    0%, 100% { opacity: 0.7; }
    50% { opacity: 1; }
  }
  @keyframes store-float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-4px); }
  }
  /* Smooth breathing glow -- long duration, subtle delta, no jarring snap */
  @keyframes store-glow-epic {
    0%, 100% { box-shadow: 0 0 8px rgba(168,85,247,0.12), 0 0 20px rgba(168,85,247,0.05); }
    50% { box-shadow: 0 0 14px rgba(168,85,247,0.2), 0 0 36px rgba(168,85,247,0.08); }
  }
  @keyframes store-glow-legend {
    0%, 100% { box-shadow: 0 0 10px rgba(245,158,11,0.15), 0 0 24px rgba(245,158,11,0.06); }
    50% { box-shadow: 0 0 18px rgba(245,158,11,0.25), 0 0 44px rgba(245,158,11,0.1); }
  }
  @keyframes store-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  /* ── Sidebar + Main layout ── */
  .store-layout { display: flex; gap: 0; min-height: calc(100vh - 60px); }

  .store-sidebar {
    width: 220px; min-width: 220px; background: var(--bg-raised, #111620);
    border-right: 1px solid var(--store-border); padding: 20px 0;
    position: sticky; top: 0; height: calc(100vh - 60px); overflow-y: auto;
    display: flex; flex-direction: column;
  }
  .store-sidebar::-webkit-scrollbar { width: 3px; }
  .store-sidebar::-webkit-scrollbar-thumb { background: var(--store-border); border-radius: 3px; }

  .ss-heading {
    font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px;
    color: var(--text-dim, #484f58); padding: 0 16px; margin-bottom: 8px;
  }
  .ss-item {
    display: flex; align-items: center; gap: 10px; padding: 9px 16px;
    cursor: pointer; transition: all 0.12s; border: none; background: none;
    width: 100%; text-align: left; color: var(--text-muted, #6e7681);
    font-size: 12px; font-weight: 600; font-family: inherit;
    border-left: 3px solid transparent;
  }
  .ss-item:hover { background: rgba(255,255,255,0.03); color: var(--text, #c9d1d9); }
  .ss-item.active {
    background: rgba(88,166,255,0.06); color: var(--text-bright, #e6edf3);
    border-left-color: var(--r-rare);
  }
  .ss-item .ss-icon { font-size: 16px; flex-shrink: 0; width: 20px; text-align: center; }
  .ss-item .ss-count {
    margin-left: auto; font-size: 10px; font-weight: 700; color: var(--text-dim, #484f58);
    background: rgba(255,255,255,0.04); padding: 2px 6px; border-radius: 8px;
  }

  .store-main { flex: 1; min-width: 0; padding: 28px 32px; }

  /* ── Wallet bar ── */
  .store-wallet {
    display: flex; align-items: center; gap: 24px;
    padding: 18px 24px; margin-bottom: 24px;
    background: linear-gradient(135deg, rgba(251,191,36,0.06), rgba(168,85,247,0.04));
    border: 1px solid rgba(251,191,36,0.15); border-radius: 16px;
    position: relative; overflow: hidden;
  }
  .store-wallet::after {
    content: ''; position: absolute; inset: 0; pointer-events: none;
    background: linear-gradient(90deg, transparent, rgba(251,191,36,0.04), transparent);
    background-size: 200% 100%; animation: store-shimmer 8s ease infinite;
  }
  .sw-coin-wrap {
    position: relative; width: 52px; height: 52px; flex-shrink: 0;
  }
  .sw-coin {
    width: 52px; height: 52px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    background: conic-gradient(from 0deg, #f59e0b, #fbbf24, #f59e0b);
    font-size: 22px; font-weight: 900; color: #451a03; font-family: Georgia, serif;
    box-shadow: 0 4px 12px rgba(245,158,11,0.35), inset 0 -2px 4px rgba(0,0,0,0.2);
    position: relative; z-index: 1;
  }
  .sw-coin-ring {
    position: absolute; inset: -3px; border-radius: 50%;
    border: 2px solid rgba(251,191,36,0.3);
    animation: store-spin 12s linear infinite;
    border-top-color: transparent; border-left-color: transparent;
  }
  .sw-balance { font-size: 32px; font-weight: 900; color: var(--coin); letter-spacing: -1px; font-variant-numeric: tabular-nums; }
  .sw-label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; font-weight: 700; }
  .sw-divider { width: 1px; height: 36px; background: var(--store-border); margin: 0 4px; }
  .sw-stat-val { font-size: 18px; font-weight: 700; }
  .sw-stat-lbl { font-size: 10px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; }

  .store-intro { font-size: 12px; color: var(--text-dim); line-height: 1.6; margin-bottom: 28px; max-width: 640px; }

  /* ── Category header in main area ── */
  .s-cat-header { margin-bottom: 24px; }
  .s-cat-header-row { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; }
  .s-cat-header-icon { font-size: 28px; }
  .s-cat-header-title { font-size: 22px; font-weight: 800; color: var(--text-bright, #e6edf3); letter-spacing: -0.3px; }
  .s-cat-header-count {
    font-size: 11px; font-weight: 700; color: var(--text-dim);
    background: rgba(255,255,255,0.04); padding: 3px 10px; border-radius: 10px;
    margin-left: 4px;
  }
  .s-cat-header-desc {
    font-size: 13px; color: var(--text-muted, #6e7681); line-height: 1.6; max-width: 600px;
  }

  /* ── Card grid ── */
  .s-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }

  /* ── Card ── */
  .s-card {
    position: relative; border-radius: 14px; overflow: hidden;
    background: var(--store-card); border: 1px solid var(--store-border);
    transition: transform 0.3s cubic-bezier(0.23, 1, 0.32, 1), box-shadow 0.3s ease;
    display: flex; flex-direction: column;
  }
  .s-card:hover { transform: translateY(-4px); }

  /* Card top: icon showcase area */
  .s-card-top {
    position: relative; padding: 24px 16px 18px; text-align: center;
    display: flex; flex-direction: column; align-items: center; gap: 4px;
  }
  .s-card-top .s-icon {
    font-size: 44px; line-height: 1; display: block;
    transition: transform 0.4s cubic-bezier(0.23, 1, 0.32, 1);
    position: relative; z-index: 1;
  }
  .s-card:hover .s-icon { transform: translateY(-3px) scale(1.08); }

  /* Rarity-colored gradient behind icon */
  .s-card[data-r="common"] .s-card-top { background: var(--r-common-bg); }
  .s-card[data-r="uncommon"] .s-card-top { background: linear-gradient(180deg, var(--r-uncommon-bg), transparent); }
  .s-card[data-r="rare"] .s-card-top { background: linear-gradient(180deg, var(--r-rare-bg), transparent); }
  .s-card[data-r="epic"] .s-card-top { background: linear-gradient(180deg, var(--r-epic-bg), transparent); }
  .s-card[data-r="legendary"] .s-card-top {
    background: linear-gradient(180deg, var(--r-legendary-bg), transparent);
  }
  .s-card[data-r="legendary"] .s-card-top::after {
    content: ''; position: absolute; inset: 0; pointer-events: none;
    background: linear-gradient(90deg, transparent 20%, rgba(251,191,36,0.05) 50%, transparent 80%);
    background-size: 200% 100%; animation: store-shimmer 5s ease infinite;
  }

  /* Rarity badge */
  .s-rarity {
    position: absolute; top: 8px; left: 10px;
    font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.8px;
    padding: 3px 8px; border-radius: 6px;
  }
  .s-rarity[data-r="common"]   { background: rgba(107,114,128,0.15); color: var(--r-common); }
  .s-rarity[data-r="uncommon"] { background: rgba(34,197,94,0.12);   color: var(--r-uncommon); }
  .s-rarity[data-r="rare"]     { background: rgba(59,130,246,0.12);  color: var(--r-rare); }
  .s-rarity[data-r="epic"]     { background: rgba(168,85,247,0.15);  color: var(--r-epic); }
  .s-rarity[data-r="legendary"]{
    background: linear-gradient(90deg, rgba(245,158,11,0.2), rgba(234,179,8,0.15));
    color: var(--r-legendary);
  }

  /* Preview swatch for name_color items */
  .s-preview-swatch {
    width: 80%; height: 6px; border-radius: 3px; margin-top: 8px;
  }

  /* Card bottom: details */
  .s-card-bot {
    padding: 14px 16px 16px; flex: 1;
    display: flex; flex-direction: column;
  }
  .s-name { font-size: 14px; font-weight: 800; color: var(--text, #c9d1d9); margin-bottom: 4px; }
  .s-desc { font-size: 11px; color: var(--text-muted); line-height: 1.5; margin-bottom: auto; padding-bottom: 12px; }

  /* Price + buy row */
  .s-buy-row { display: flex; align-items: center; justify-content: space-between; margin-top: auto; }
  .s-price { display: flex; align-items: center; gap: 5px; font-size: 14px; font-weight: 800; color: var(--coin); }
  .s-price-coin { font-size: 16px; }

  .s-buy {
    padding: 7px 18px; border-radius: 8px; font-size: 11px; font-weight: 700;
    border: none; cursor: pointer; transition: all 0.15s; text-transform: uppercase; letter-spacing: 0.6px;
    color: #fff;
  }
  .s-buy.buyable {
    background: linear-gradient(135deg, #ec4899, #a855f7);
    box-shadow: 0 2px 8px rgba(168,85,247,0.25);
  }
  .s-buy.buyable:hover { transform: scale(1.06); box-shadow: 0 4px 16px rgba(168,85,247,0.35); }
  .s-buy.buyable:active { transform: scale(0.97); }
  .s-buy.locked {
    background: rgba(107,114,128,0.15); color: var(--text-dim); cursor: default;
    font-size: 10px;
  }
  .s-buy.owned-state {
    background: rgba(34,197,94,0.15); color: var(--r-uncommon); cursor: default;
    font-size: 10px;
  }

  /* ── Rarity card borders + glow effects ── */
  .s-card[data-r="common"]   { border-color: rgba(107,114,128,0.15); }
  .s-card[data-r="common"]:hover { box-shadow: 0 8px 24px rgba(0,0,0,0.3); }

  .s-card[data-r="uncommon"] { border-color: rgba(34,197,94,0.15); }
  .s-card[data-r="uncommon"]:hover { box-shadow: 0 8px 24px rgba(34,197,94,0.12); border-color: rgba(34,197,94,0.3); }

  .s-card[data-r="rare"]     { border-color: rgba(59,130,246,0.15); }
  .s-card[data-r="rare"]:hover { box-shadow: 0 8px 24px rgba(59,130,246,0.15); border-color: rgba(59,130,246,0.35); }

  .s-card[data-r="epic"] {
    border-color: rgba(168,85,247,0.18);
    animation: store-glow-epic 5s ease-in-out infinite;
  }
  .s-card[data-r="epic"]:hover { border-color: rgba(168,85,247,0.45); }

  .s-card[data-r="legendary"] {
    border-color: rgba(245,158,11,0.2);
    animation: store-glow-legend 6s ease-in-out infinite;
    background: linear-gradient(135deg, var(--store-card) 0%, rgba(245,158,11,0.03) 100%);
  }
  .s-card[data-r="legendary"]::before {
    content: ''; position: absolute; inset: 0; border-radius: 14px; pointer-events: none; z-index: 0;
    background: linear-gradient(90deg, transparent 30%, rgba(251,191,36,0.04) 50%, transparent 70%);
    background-size: 200% 100%; animation: store-shimmer 6s ease infinite;
  }
  .s-card[data-r="legendary"]:hover { border-color: rgba(245,158,11,0.5); }

  /* Owned overlay */
  .s-card.owned { opacity: 0.55; pointer-events: none; }
  .s-card.owned .s-card-top::before {
    content: '\\2705'; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
    font-size: 36px; z-index: 5; filter: drop-shadow(0 2px 6px rgba(0,0,0,0.7));
  }

  /* ── Empty state ── */
  .s-empty {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 60px 20px; color: var(--text-dim); text-align: center;
  }
  .s-empty-icon { font-size: 48px; margin-bottom: 12px; opacity: 0.5; }
  .s-empty-text { font-size: 13px; }

  /* Store toast */
  .store-toast {
    position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%) translateY(20px);
    padding: 12px 28px; border-radius: 12px; font-size: 13px; font-weight: 700;
    opacity: 0; transition: all 0.3s ease; pointer-events: none; z-index: 200;
    color: #fff; backdrop-filter: blur(8px);
  }
  .store-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
  .store-toast.success { background: rgba(34,197,94,0.9); }
  .store-toast.error { background: rgba(248,81,73,0.9); }

  /* ── Legacy compat: flat mode (gamification tab embed) ── */
  .store-flat .s-cat-header { margin-bottom: 20px; }
  .store-flat .s-cat-header-title { font-size: 18px; }
  .store-flat .s-category { margin-bottom: 32px; }
`;

export const STORE_JS = `
  var CATEGORY_ORDER = ['title','avatar_frame','name_color','bubble_font','bubble_color','animation','theme','flair','font'];
  var CATEGORY_META = {
    title:        { label: 'Titles',        icon: '\\u{1F3C6}', desc: 'Displayed beside your name on leaderboards, dashboards, and profiles. Flex your rank.' },
    avatar_frame: { label: 'Avatar Frames', icon: '\\u{1F5BC}', desc: 'Decorative borders around your avatar. Visible everywhere your profile picture appears.' },
    name_color:   { label: 'Name Colors',   icon: '\\u{1F3A8}', desc: 'Change the color of your display name. Supports solid colors and animated gradients.' },
    bubble_font:  { label: 'Bubble Fonts',  icon: '\\u{1F520}', desc: 'Change the typeface of the letter inside your avatar bubble.' },
    bubble_color: { label: 'Bubble Colors', icon: '\\u{1F3A8}', desc: 'Change the color of your avatar bubble background. Solid or gradient.' },
    animation:    { label: 'Animations',    icon: '\\u{2728}',  desc: 'Particle effects that trigger on actions like completing reviews or earning streaks.' },
    theme:        { label: 'Themes',        icon: '\\u{1F3A8}', desc: 'Full dashboard color schemes that change the look of your entire workspace.' },
    flair:        { label: 'Flair',         icon: '\\u{2B50}',  desc: 'Small icons displayed next to your name. Stack them to build your identity.' },
    font:         { label: 'Fonts',         icon: '\\u{1F4DD}', desc: 'Custom typefaces for your display name across the platform.' },
  };
  var RARITY_LABELS = {common:'Common',uncommon:'Uncommon',rare:'Rare',epic:'Epic',legendary:'Legendary'};

  function storeToast(msg, type) {
    var el = document.getElementById('store-toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'store-toast ' + (type || 'success') + ' show';
    setTimeout(function() { el.classList.remove('show'); }, 2800);
  }

  function escH(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

  var _storeGrouped = {};
  var _storeBalance = 0;
  var _storePurchased = [];
  var _storeContainer = null;
  var _storeAllItems = [];

  function renderStoreCards(container, items, balance, purchased, activeCategory) {
    _storeContainer = container;
    _storeAllItems = items;
    _storeBalance = balance;
    _storePurchased = purchased;

    var grouped = {};
    items.forEach(function(item) {
      var t = item.type || 'other';
      if (!grouped[t]) grouped[t] = [];
      grouped[t].push(item);
    });
    _storeGrouped = grouped;

    // Build sidebar if store-sidebar exists
    var sidebar = document.getElementById('store-sidebar');
    if (sidebar) {
      var shtml = '';
      CATEGORY_ORDER.forEach(function(type, i) {
        if (!grouped[type]) return;
        var meta = CATEGORY_META[type] || { label: type, icon: '', desc: '' };
        var isActive = activeCategory ? type === activeCategory : i === 0 && !activeCategory;
        if (!activeCategory && isActive) activeCategory = type;
        shtml += '<button class="ss-item' + (isActive ? ' active' : '') + '" data-cat="' + type + '">';
        shtml += '<span class="ss-icon">' + meta.icon + '</span>';
        shtml += escH(meta.label);
        shtml += '<span class="ss-count">' + grouped[type].length + '</span>';
        shtml += '</button>';
      });
      sidebar.innerHTML = '<div class="ss-heading">Categories</div>' + shtml;

      sidebar.querySelectorAll('.ss-item').forEach(function(btn) {
        btn.addEventListener('click', function() {
          sidebar.querySelectorAll('.ss-item').forEach(function(b) { b.classList.remove('active'); });
          this.classList.add('active');
          renderCategoryCards(container, grouped, this.getAttribute('data-cat'), balance, purchased);
        });
      });
    }

    // If no activeCategory set, default to first available
    if (!activeCategory) {
      for (var k = 0; k < CATEGORY_ORDER.length; k++) {
        if (grouped[CATEGORY_ORDER[k]]) { activeCategory = CATEGORY_ORDER[k]; break; }
      }
    }

    // If no sidebar (flat/embedded mode), render all categories
    if (!sidebar) {
      renderAllCategories(container, grouped, balance, purchased);
    } else {
      renderCategoryCards(container, grouped, activeCategory, balance, purchased);
    }
  }

  function renderAllCategories(container, grouped, balance, purchased) {
    var html = '';
    CATEGORY_ORDER.forEach(function(type) {
      if (!grouped[type]) return;
      var meta = CATEGORY_META[type] || { label: type, icon: '', desc: '' };
      var list = grouped[type].slice().sort(function(a, b) { return a.price - b.price; });
      html += '<div class="s-category">';
      html += '<div class="s-cat-header"><div class="s-cat-header-row">';
      html += '<span class="s-cat-header-icon">' + meta.icon + '</span>';
      html += '<span class="s-cat-header-title">' + escH(meta.label) + '</span>';
      html += '<span class="s-cat-header-count">' + list.length + ' items</span>';
      html += '</div><div class="s-cat-header-desc">' + escH(meta.desc) + '</div></div>';
      html += '<div class="s-grid">';
      html += buildCardHtml(list, balance, purchased);
      html += '</div></div>';
    });
    container.innerHTML = html;
    bindBuyButtons(container);
  }

  function renderCategoryCards(container, grouped, type, balance, purchased) {
    var meta = CATEGORY_META[type] || { label: type, icon: '', desc: '' };
    var list = (grouped[type] || []).slice().sort(function(a, b) { return a.price - b.price; });

    var html = '<div class="s-cat-header"><div class="s-cat-header-row">';
    html += '<span class="s-cat-header-icon">' + meta.icon + '</span>';
    html += '<span class="s-cat-header-title">' + escH(meta.label) + '</span>';
    html += '<span class="s-cat-header-count">' + list.length + ' items</span>';
    html += '</div><div class="s-cat-header-desc">' + escH(meta.desc) + '</div></div>';

    if (list.length === 0) {
      html += '<div class="s-empty"><div class="s-empty-icon">' + meta.icon + '</div><div class="s-empty-text">No items in this category yet.</div></div>';
    } else {
      html += '<div class="s-grid">';
      html += buildCardHtml(list, balance, purchased);
      html += '</div>';
    }

    container.innerHTML = html;
    bindBuyButtons(container);
  }

  function buildCardHtml(list, balance, purchased) {
    var html = '';
    list.forEach(function(item) {
      var owned = purchased.indexOf(item.id) !== -1;
      var canAfford = balance >= item.price;
      var r = item.rarity || 'common';
      var rl = RARITY_LABELS[r] || r;

      html += '<div class="s-card' + (owned ? ' owned' : '') + '" data-r="' + r + '">';
      html += '<div class="s-card-top">';
      html += '<span class="s-rarity" data-r="' + r + '">' + escH(rl) + '</span>';
      html += '<span class="s-icon">' + item.icon + '</span>';
      if ((item.type === 'name_color' || item.type === 'bubble_color') && item.preview) {
        var bg = item.preview.indexOf('gradient') !== -1
          ? 'background-image:' + item.preview
          : 'background:' + item.preview;
        html += '<div class="s-preview-swatch" style="' + bg + '"></div>';
      }
      html += '</div>';
      html += '<div class="s-card-bot">';
      html += '<div class="s-name">' + escH(item.name) + '</div>';
      html += '<div class="s-desc">' + escH(item.description || '') + '</div>';
      html += '<div class="s-buy-row">';
      html += '<div class="s-price"><span class="s-price-coin">\\u{1FA99}</span>' + item.price.toLocaleString() + '</div>';
      if (owned) {
        html += '<button class="s-buy owned-state" disabled>\\u{2705} Owned</button>';
      } else if (!canAfford) {
        html += '<button class="s-buy locked" disabled>Need ' + (item.price - balance).toLocaleString() + ' more</button>';
      } else {
        html += '<button class="s-buy buyable" data-item="' + item.id + '">Buy</button>';
      }
      html += '</div></div></div>';
    });
    return html;
  }

  function bindBuyButtons(container) {
    container.querySelectorAll('.s-buy[data-item]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var itemId = this.getAttribute('data-item');
        var el = this;
        el.disabled = true;
        el.textContent = '...';
        fetch('/api/store/buy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: itemId }) })
          .then(function(r) { return r.json().then(function(d) { if (!r.ok) throw new Error(d.error || 'Purchase failed'); return d; }); })
          .then(function(data) {
            storeToast('Unlocked! New balance: ' + data.newBalance.toLocaleString() + ' tokens');
            _storePurchased.push(itemId);
            _storeBalance = data.newBalance;
            var balEl = document.getElementById('sw-balance');
            if (balEl) balEl.textContent = _storeBalance.toLocaleString();
            // Find current active category
            var activeSidebar = document.querySelector('.ss-item.active');
            var activeCat = activeSidebar ? activeSidebar.getAttribute('data-cat') : null;
            renderStoreCards(_storeContainer, _storeAllItems, _storeBalance, _storePurchased, activeCat);
          })
          .catch(function(err) { storeToast(err.message, 'error'); el.disabled = false; el.textContent = 'Buy'; });
      });
    });
  }
`;
