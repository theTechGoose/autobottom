/**
 * StoreIsland — user-facing cosmetic store.
 * Fetches /api/store for items, balance, purchased.
 * Renders sidebar category nav, wallet bar, and rarity card grid.
 */

import { useSignal, useComputed } from "@preact/signals";
import { useEffect } from "preact/hooks";

const CATEGORY_ORDER = [
  "title",
  "avatar_frame",
  "name_color",
  "bubble_font",
  "bubble_color",
  "animation",
  "theme",
  "flair",
  "font",
];

const CATEGORY_META: Record<string, { label: string; desc: string }> = {
  title: {
    label: "Titles",
    desc: "Displayed beside your name on leaderboards, dashboards, and profiles.",
  },
  avatar_frame: {
    label: "Avatar Frames",
    desc: "Decorative borders around your avatar.",
  },
  name_color: {
    label: "Name Colors",
    desc: "Change the color of your display name. Supports solid colors and animated gradients.",
  },
  bubble_font: {
    label: "Bubble Fonts",
    desc: "Change the typeface of the letter inside your avatar bubble.",
  },
  bubble_color: {
    label: "Bubble Colors",
    desc: "Change the color of your avatar bubble background.",
  },
  animation: {
    label: "Animations",
    desc: "Particle effects that trigger on actions like completing reviews.",
  },
  theme: { label: "Themes", desc: "Full dashboard color schemes." },
  flair: {
    label: "Flair",
    desc: "Small icons displayed next to your name. Stack them to build your identity.",
  },
  font: { label: "Fonts", desc: "Custom typefaces for your display name across the platform." },
};

const RARITY_LABELS: Record<string, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
};

interface StoreItem {
  id: string;
  name: string;
  type: string;
  icon: string;
  description?: string;
  price: number;
  rarity?: string;
  preview?: string;
}

interface StoreData {
  items: StoreItem[];
  balance: number;
  purchased: string[];
  level?: number;
  totalXp?: number;
}

export default function StoreIsland() {
  const loading = useSignal(true);
  const error = useSignal("");
  const items = useSignal<StoreItem[]>([]);
  const balance = useSignal(0);
  const purchased = useSignal<string[]>([]);
  const level = useSignal<number | null>(null);
  const totalXp = useSignal<number | null>(null);
  const activeCategory = useSignal<string>("");
  const toastMsg = useSignal("");
  const toastType = useSignal("success");
  const buying = useSignal<string | null>(null);

  const grouped = useComputed(() => {
    const g: Record<string, StoreItem[]> = {};
    items.value.forEach((item) => {
      const t = item.type || "other";
      if (!g[t]) g[t] = [];
      g[t].push(item);
    });
    return g;
  });

  const categories = useComputed(() =>
    CATEGORY_ORDER.filter((cat) => grouped.value[cat]?.length)
  );

  const activeItems = useComputed(() => {
    const cat = activeCategory.value;
    if (!cat) return [];
    return (grouped.value[cat] || []).slice().sort((a, b) => a.price - b.price);
  });

  const activeMeta = useComputed(() =>
    CATEGORY_META[activeCategory.value] || { label: activeCategory.value, desc: "" }
  );

  function showToast(msg: string, type = "success") {
    toastMsg.value = msg;
    toastType.value = type;
    setTimeout(() => { toastMsg.value = ""; }, 2800);
  }

  async function init() {
    try {
      const res = await fetch("/api/store");
      if (!res.ok) {
        if (res.status === 401) {
          globalThis.location.href = "/login";
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const data: StoreData = await res.json();
      items.value = data.items || [];
      balance.value = data.balance || 0;
      purchased.value = data.purchased || [];
      level.value = data.level ?? null;
      totalXp.value = data.totalXp ?? null;
      loading.value = false;

      // Set default active category
      const firstCat = CATEGORY_ORDER.find((c) => grouped.value[c]?.length);
      if (firstCat) activeCategory.value = firstCat;
    } catch (err) {
      error.value = `Failed to load store: ${(err as Error).message}`;
      loading.value = false;
    }
  }

  async function buyItem(itemId: string) {
    buying.value = itemId;
    try {
      const res = await fetch("/api/store/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Purchase failed");
      purchased.value = [...purchased.value, itemId];
      balance.value = data.newBalance;
      showToast(`Unlocked! New balance: ${data.newBalance.toLocaleString()} tokens`);
    } catch (err) {
      showToast((err as Error).message, "error");
    } finally {
      buying.value = null;
    }
  }

  useEffect(() => {
    init();
  }, []);

  if (loading.value) {
    return <div class="loading">Loading store...</div>;
  }

  if (error.value) {
    return <div class="loading">{error.value}</div>;
  }

  return (
    <div class="store-layout">
      {/* Sidebar */}
      <div class="store-sidebar">
        <div class="ss-heading">Categories</div>
        {categories.value.map((cat) => {
          const meta = CATEGORY_META[cat] || { label: cat };
          const count = grouped.value[cat]?.length || 0;
          return (
            <button
              key={cat}
              class={`ss-item${activeCategory.value === cat ? " active" : ""}`}
              onClick={() => { activeCategory.value = cat; }}
            >
              <span class="ss-icon" />
              {meta.label}
              <span class="ss-count">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Main */}
      <div class="store-main">
        {/* Wallet bar */}
        <div class="store-wallet">
          <div class="sw-coin-wrap">
            <div class="sw-coin">T</div>
            <div class="sw-coin-ring" />
          </div>
          <div>
            <div class="sw-balance">{balance.value.toLocaleString()}</div>
            <div class="sw-label">tokens</div>
          </div>
          <div class="sw-divider" />
          <div>
            <div class="sw-stat-val">{level.value ?? "--"}</div>
            <div class="sw-stat-lbl">Level</div>
          </div>
          <div>
            <div class="sw-stat-val">{totalXp.value != null ? totalXp.value.toLocaleString() : "--"}</div>
            <div class="sw-stat-lbl">Total XP</div>
          </div>
        </div>

        {/* Category header */}
        {activeCategory.value && (
          <div class="s-cat-header">
            <div class="s-cat-header-row">
              <span class="s-cat-header-title">{activeMeta.value.label}</span>
              <span class="s-cat-header-count">{activeItems.value.length} items</span>
            </div>
            <div class="s-cat-header-desc">{activeMeta.value.desc}</div>
          </div>
        )}

        {/* Card grid */}
        {activeItems.value.length === 0
          ? (
            <div class="s-empty">
              <div class="s-empty-text">No items in this category yet.</div>
            </div>
          )
          : (
            <div class="s-grid">
              {activeItems.value.map((item) => {
                const owned = purchased.value.includes(item.id);
                const canAfford = balance.value >= item.price;
                const r = item.rarity || "common";
                const rl = RARITY_LABELS[r] || r;
                const isBuying = buying.value === item.id;
                const isColorType = item.type === "name_color" || item.type === "bubble_color";

                return (
                  <div
                    key={item.id}
                    class={`s-card${owned ? " owned" : ""}`}
                    data-r={r}
                  >
                    <div class="s-card-top">
                      <span class="s-rarity" data-r={r}>{rl}</span>
                      <span class="s-icon">{item.icon}</span>
                      {isColorType && item.preview && (
                        <div
                          class="s-preview-swatch"
                          style={
                            item.preview.includes("gradient")
                              ? { backgroundImage: item.preview }
                              : { background: item.preview }
                          }
                        />
                      )}
                    </div>
                    <div class="s-card-bot">
                      <div class="s-name">{item.name}</div>
                      <div class="s-desc">{item.description || ""}</div>
                      <div class="s-buy-row">
                        <div class="s-price">
                          <span class="s-price-coin">&#129529;</span>
                          {item.price.toLocaleString()}
                        </div>
                        {owned
                          ? (
                            <button class="s-buy owned-state" disabled>
                              Owned
                            </button>
                          )
                          : !canAfford
                          ? (
                            <button class="s-buy locked" disabled>
                              Need {(item.price - balance.value).toLocaleString()} more
                            </button>
                          )
                          : (
                            <button
                              class="s-buy buyable"
                              disabled={isBuying}
                              onClick={() => buyItem(item.id)}
                            >
                              {isBuying ? "..." : "Buy"}
                            </button>
                          )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
      </div>

      {/* Toast */}
      {toastMsg.value && (
        <div class={`store-toast show${toastType.value === "error" ? " error" : " success"}`}>
          {toastMsg.value}
        </div>
      )}
    </div>
  );
}
