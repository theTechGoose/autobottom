/** Badge Editor — admin-only store catalog management.
 *  Two-pane (280px sidebar + flex detail) full-width admin tool. Built-in items
 *  render read-only; custom items can be created, edited, deleted via HTMX. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { apiFetch } from "../../lib/api.ts";
import { BadgeEditorDetail, type StoreItem } from "../../components/BadgeEditor.tsx";

const RARITIES = ["common", "uncommon", "rare", "epic", "legendary"] as const;
type Rarity = typeof RARITIES[number];

const RARITY_COLORS: Record<Rarity, string> = {
  common: "#6b7280",
  uncommon: "#22c55e",
  rare: "#3b82f6",
  epic: "#a855f7",
  legendary: "#f59e0b",
};

function rarityOf(item: StoreItem): Rarity {
  if (item.rarity && (RARITIES as readonly string[]).includes(item.rarity)) return item.rarity as Rarity;
  const p = item.price ?? 0;
  if (p >= 1000) return "legendary";
  if (p >= 700) return "epic";
  if (p >= 400) return "rare";
  if (p >= 200) return "uncommon";
  return "common";
}

export default define.page(async function BadgeEditorPage(ctx) {
  const user = ctx.state.user!;
  if (user.role !== "admin") {
    return new Response(null, { status: 302, headers: { location: "/agent" } });
  }

  const url = new URL(ctx.req.url);
  const selectedId = url.searchParams.get("id") ?? "";

  let items: StoreItem[] = [];
  try {
    const data = await apiFetch<{ items: StoreItem[] }>("/admin/badge-editor/items", ctx.req);
    items = data.items ?? [];
  } catch (e) {
    console.error("[badge-editor] list error:", e);
  }

  // Determine the selected item (default to first item if any, else "new" mode)
  let selected: StoreItem | null = null;
  if (selectedId) {
    selected = items.find((it) => it.id === selectedId) ?? null;
  }

  return (
    <Layout title="Badge Editor" section="admin" user={user} pathname={url.pathname}>
      <div class="ql-topbar">
        <div class="ql-topbar-title">
          <span class="ql-topbar-icon" aria-hidden="true">🛍️</span>
          <h1>Badge Editor</h1>
          <span style="margin-left:10px;color:var(--text-dim);font-size:12px;">Admin · Store Catalog</span>
        </div>
        <a href="/admin/dashboard" class="ql-topbar-back">← Dashboard</a>
      </div>

      <div class="ql-page-body" style="padding:0;">
        <div style="display:flex;height:calc(100vh - 120px);min-height:500px;">

          {/* Left pane — item list */}
          <aside style="width:280px;min-width:280px;border-right:1px solid var(--border);background:var(--bg-raised);overflow-y:auto;display:flex;flex-direction:column;">
            <div style="padding:14px 16px;border-bottom:1px solid var(--border);">
              <a
                href="/admin/badge-editor?id=new"
                class="sf-btn primary"
                style="width:100%;text-decoration:none;font-size:12px;padding:8px 12px;"
              >+ New Item</a>
            </div>
            <div style="flex:1;padding:8px 0;">
              {items.length === 0 ? (
                <div style="padding:18px 16px;color:var(--text-dim);font-size:12px;text-align:center;">
                  No items yet. Click <strong>+ New Item</strong> to create one.
                </div>
              ) : (
                items.map((item) => {
                  const r = rarityOf(item);
                  const isActive = selectedId === item.id;
                  return (
                    <a
                      key={item.id}
                      href={`/admin/badge-editor?id=${encodeURIComponent(item.id)}`}
                      class="be-item-row"
                      data-active={isActive ? "true" : "false"}
                      style={`display:flex;align-items:center;gap:8px;padding:9px 16px;text-decoration:none;color:var(--text);border-left:3px solid ${isActive ? RARITY_COLORS[r] : "transparent"};background:${isActive ? "var(--bg-surface)" : "transparent"};font-size:12px;`}
                    >
                      <span style="font-size:16px;width:20px;text-align:center;">{item.icon || "•"}</span>
                      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;">
                        {item.name || item.id}
                      </span>
                      <span
                        class="pill"
                        style={`color:${RARITY_COLORS[r]};border:1px solid ${RARITY_COLORS[r]};font-size:9px;text-transform:uppercase;padding:1px 6px;border-radius:8px;letter-spacing:0.5px;font-weight:700;`}
                      >{r}</span>
                    </a>
                  );
                })
              )}
            </div>
          </aside>

          {/* Right pane — detail / form */}
          <section
            id="item-detail"
            style="flex:1;overflow-y:auto;padding:20px 28px;background:var(--bg);"
          >
            {selectedId === "new" ? (
              <BadgeEditorDetail item={null} mode="new" />
            ) : selected ? (
              <BadgeEditorDetail item={selected} mode="edit" />
            ) : (
              <div style="text-align:center;color:var(--text-dim);padding:60px 20px;font-size:13px;">
                {items.length === 0 ? "Create an item to get started." : "Select an item from the list, or click + New Item."}
              </div>
            )}
          </section>

        </div>
        <div id="item-toast" style="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:200;"></div>
      </div>
    </Layout>
  );
});
