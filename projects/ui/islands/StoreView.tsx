import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";

interface StoreItem {
  id: string;
  name: string;
  icon?: string;
  price: number;
}

interface StoreData {
  balance: number;
  items: StoreItem[];
  purchased: string[];
}

interface Toast {
  msg: string;
  type: "success" | "error";
  id: number;
}

export default function StoreView() {
  const storeData = useSignal<StoreData | null>(null);
  const loading = useSignal(true);
  const error = useSignal("");
  const toasts = useSignal<Toast[]>([]);
  let toastId = 0;

  function showToast(msg: string, type: "success" | "error") {
    const id = ++toastId;
    toasts.value = [...toasts.value, { msg, type, id }];
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id);
    }, 2400);
  }

  async function loadStore() {
    loading.value = true;
    try {
      const res = await fetch("/agent/api/store", { credentials: "same-origin" });
      if (!res.ok) {
        if (res.status === 401) { window.location.href = "/login"; return; }
        throw new Error("Failed to load store");
      }
      storeData.value = await res.json();
    } catch (err) {
      error.value = (err as Error).message;
    } finally {
      loading.value = false;
    }
  }

  async function buyItem(itemId: string) {
    try {
      const res = await fetch("/agent/api/store/buy", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Purchase failed");
      showToast("Purchased! New balance: " + result.newBalance, "success");
      loadStore();
    } catch (err) {
      showToast((err as Error).message, "error");
    }
  }

  useEffect(() => {
    loadStore();
  }, []);

  return (
    <div>
      <style>{`
        .store-section { margin-bottom: 28px; }
        .section-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
        .section-title { font-size: 13px; font-weight: 700; color: var(--text-bright); text-transform: uppercase; letter-spacing: 0.8px; }
        .section-badge { font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 10px; background: var(--accent-bg); color: var(--accent); }
        .store-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
        .store-item { background: var(--bg-raised); border: 1px solid var(--border); border-radius: 10px; padding: 16px; text-align: center; transition: border-color 0.15s; }
        .store-item:hover { border-color: var(--border-hover); }
        .si-icon { font-size: 28px; margin-bottom: 6px; }
        .si-name { font-size: 13px; font-weight: 700; color: var(--text-bright); margin-bottom: 4px; }
        .si-price { font-size: 11px; color: var(--yellow); font-weight: 600; margin-bottom: 10px; }
        .si-btn { padding: 6px 18px; border-radius: 8px; font-size: 11px; font-weight: 600; cursor: pointer; border: none; transition: all 0.15s; }
        .si-btn.buy { background: linear-gradient(135deg, var(--accent-dim), var(--accent)); color: #fff; }
        .si-btn.buy:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(249,115,22,0.3); }
        .si-btn.buy:disabled { opacity: 0.5; cursor: not-allowed; }
        .si-btn.owned { background: var(--green-bg); color: var(--green); cursor: default; }
        .loading-wrap { display: flex; align-items: center; justify-content: center; padding: 60px; color: var(--text-dim); font-size: 13px; }
        .error-msg { padding: 12px 16px; background: var(--red-bg); color: var(--red); border-radius: 8px; font-size: 13px; margin-bottom: 16px; }
        .toast-container { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); z-index: 1000; display: flex; flex-direction: column-reverse; gap: 6px; align-items: center; pointer-events: none; }
        .toast { padding: 8px 20px; border-radius: 10px; font-size: 13px; font-weight: 600; backdrop-filter: blur(16px); box-shadow: 0 8px 32px rgba(0,0,0,0.5); display: flex; align-items: center; gap: 8px; }
        .toast.success { background: rgba(17,24,32,0.95); color: var(--green); border: 1px solid rgba(63,185,80,0.2); }
        .toast.error { background: rgba(17,24,32,0.95); color: var(--red); border: 1px solid rgba(248,81,73,0.2); }
        .toast-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
        .toast.success .toast-dot { background: var(--green); }
        .toast.error .toast-dot { background: var(--red); }
        @media (max-width: 900px) { .store-grid { grid-template-columns: 1fr; } }
      `}</style>

      {loading.value ? (
        <div class="loading-wrap">Loading store...</div>
      ) : error.value ? (
        <div class="error-msg">{error.value}</div>
      ) : storeData.value ? (
        <div class="store-section">
          <div class="section-head">
            <span class="section-title">AutoBot Store</span>
            <span class="section-badge">{storeData.value.balance} tokens</span>
          </div>
          <div class="store-grid">
            {(storeData.value.items || []).map((item) => {
              const owned = (storeData.value!.purchased || []).includes(item.id);
              const canBuy = !owned && storeData.value!.balance >= item.price;
              return (
                <div class="store-item" key={item.id}>
                  {item.icon && <div class="si-icon">{item.icon}</div>}
                  <div class="si-name">{item.name}</div>
                  <div class="si-price">{item.price} tokens</div>
                  {owned ? (
                    <button class="si-btn owned">Owned</button>
                  ) : (
                    <button
                      class="si-btn buy"
                      disabled={!canBuy}
                      onClick={() => buyItem(item.id)}
                    >
                      Buy
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div class="toast-container">
        {toasts.value.map((t) => (
          <div class={`toast ${t.type}`} key={t.id}>
            <span class="toast-dot" />
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
