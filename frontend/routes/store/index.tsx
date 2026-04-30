/** Gamification store — browse and purchase cosmetics. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { apiFetch } from "../../lib/api.ts";

interface StoreItem { id: string; name: string; description?: string; price: number; rarity?: string; category?: string; }

export default define.page(async function StorePage(ctx) {
  const user = ctx.state.user!;
  const url = new URL(ctx.req.url);

  let items: StoreItem[] = [];
  try {
    const data = await apiFetch<{ items: StoreItem[] }>("/api/store", ctx.req);
    items = data.items ?? [];
  } catch (e) { console.error("Store data error:", e); }

  const rarityColors: Record<string, string> = {
    common: "blue", uncommon: "green", rare: "purple", epic: "yellow", legendary: "red",
  };

  return (
    <Layout title="Store" section="admin" user={user} pathname={url.pathname}>
      <div class="page-header">
        <h1>Store</h1>
        <p class="page-sub">Spend your earned tokens on cosmetics and badges</p>
      </div>

      {items.length === 0 ? (
        <div class="placeholder-card">
          <div style="font-size:48px;opacity:0.3;margin-bottom:12px;">🏆</div>
          <p>No items in the store yet. Check back later!</p>
        </div>
      ) : (
        <div class="store-grid">
          {items.map((item) => (
            <div key={item.id} class="store-card">
              <div class="store-card-header">
                <span class="store-card-name">{item.name}</span>
                {item.rarity && <span class={`pill pill-${rarityColors[item.rarity] ?? "blue"}`}>{item.rarity}</span>}
              </div>
              {item.description && <div class="store-card-desc">{item.description}</div>}
              <div class="store-card-footer">
                <span class="store-card-price">{item.price} tokens</span>
                <button
                  class="btn btn-primary btn-sm"
                  hx-post="/api/store/buy"
                  hx-vals={JSON.stringify({ email: user.email, itemId: item.id, price: item.price })}
                  hx-swap="none"
                  hx-confirm={`Buy ${item.name} for ${item.price} tokens?`}
                >Buy</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
});
