/** Badge Editor detail pane — pure server-rendered form fragment.
 *  Used by both /admin/badge-editor (the page) and /api/admin/badge-editor/item
 *  (the HTMX swap target). For built-in items the form renders read-only and
 *  the Save / Delete actions are hidden. */

export interface StoreItem {
  id: string;
  name: string;
  description?: string;
  price: number;
  rarity?: string;
  category?: string;
  icon?: string;
  image?: string;
  isBuiltIn?: boolean;
}

const CATEGORIES = [
  "title",
  "avatar_frame",
  "name_color",
  "animation",
  "theme",
  "flair",
  "font",
  "bubble_font",
  "bubble_color",
  "cosmetics",
];

const RARITIES = ["common", "uncommon", "rare", "epic", "legendary"] as const;

const RARITY_COLORS: Record<string, string> = {
  common: "#6b7280",
  uncommon: "#22c55e",
  rare: "#3b82f6",
  epic: "#a855f7",
  legendary: "#f59e0b",
};

interface Props {
  item: StoreItem | null;
  mode: "new" | "edit";
  /** Optional success or error message — rendered as a small banner at the top
   *  of the form (e.g. "Saved" after a POST, "Name required" on validation). */
  notice?: { type: "success" | "error"; message: string };
}

export function BadgeEditorDetail({ item, mode, notice }: Props) {
  const isNew = mode === "new" || !item;
  const readOnly = !isNew && !!item?.isBuiltIn;
  const safeItem: StoreItem = item ?? { id: "", name: "", description: "", price: 0, rarity: "common", category: "title", icon: "", image: "" };
  const rarity = (safeItem.rarity ?? "common");
  const rarityColor = RARITY_COLORS[rarity] ?? RARITY_COLORS.common;

  return (
    <div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px;">
        <div>
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.2px;color:var(--text-dim);font-weight:700;">
            {isNew ? "New Item" : (readOnly ? "Built-In Item (read only)" : "Edit Item")}
          </div>
          <h2 style="font-size:18px;color:var(--text-bright);margin:4px 0 0;">
            {isNew ? "Create item" : (safeItem.name || safeItem.id)}
          </h2>
        </div>
        {!isNew && (
          <span
            class="pill"
            style={`color:${rarityColor};border:1px solid ${rarityColor};font-size:10px;text-transform:uppercase;padding:2px 10px;border-radius:10px;letter-spacing:0.5px;font-weight:700;`}
          >{rarity}</span>
        )}
      </div>

      {notice && (
        <div
          role="status"
          style={`margin-bottom:14px;padding:9px 12px;border-radius:6px;font-size:12px;border:1px solid ${notice.type === "success" ? "rgba(63,185,80,0.3)" : "rgba(248,81,73,0.3)"};background:${notice.type === "success" ? "rgba(63,185,80,0.10)" : "rgba(248,81,73,0.10)"};color:${notice.type === "success" ? "var(--green)" : "var(--red)"};`}
        >{notice.message}</div>
      )}

      <form
        id="badge-editor-form"
        hx-post="/api/admin/badge-editor/save"
        hx-target="#item-detail"
        hx-swap="innerHTML"
        style="display:flex;flex-direction:column;gap:14px;max-width:680px;"
      >
        <input type="hidden" name="mode" value={isNew ? "new" : "edit"} />
        <input type="hidden" name="originalId" value={safeItem.id ?? ""} />
        <input type="hidden" name="isBuiltIn" value={safeItem.isBuiltIn ? "true" : "false"} />

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:0.7px;font-weight:700;color:var(--text-dim);margin-bottom:6px;">ID</label>
            <input
              class="sf-input"
              type="text"
              name="id"
              value={safeItem.id}
              placeholder="unique slug, e.g. badge_gold_star"
              readOnly={!isNew || readOnly}
              required={isNew}
              style={`font-size:12px;${(!isNew || readOnly) ? "opacity:0.6;cursor:not-allowed;" : ""}`}
            />
          </div>
          <div>
            <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:0.7px;font-weight:700;color:var(--text-dim);margin-bottom:6px;">Name *</label>
            <input
              class="sf-input"
              type="text"
              name="name"
              value={safeItem.name}
              placeholder="Display name"
              readOnly={readOnly}
              required
              style={`font-size:12px;${readOnly ? "opacity:0.6;cursor:not-allowed;" : ""}`}
            />
          </div>
        </div>

        <div>
          <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:0.7px;font-weight:700;color:var(--text-dim);margin-bottom:6px;">Description</label>
          <textarea
            class="sf-input"
            name="description"
            placeholder="Brief description of this item"
            rows={3}
            readOnly={readOnly}
            style={`font-size:12px;height:auto;min-height:64px;${readOnly ? "opacity:0.6;cursor:not-allowed;" : ""}`}
          >{safeItem.description ?? ""}</textarea>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
          <div>
            <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:0.7px;font-weight:700;color:var(--text-dim);margin-bottom:6px;">Price (tokens) *</label>
            <input
              class="sf-input"
              type="number"
              name="price"
              value={String(safeItem.price ?? 0)}
              min="0"
              step="1"
              readOnly={readOnly}
              required
              style={`font-size:12px;${readOnly ? "opacity:0.6;cursor:not-allowed;" : ""}`}
            />
          </div>
          <div>
            <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:0.7px;font-weight:700;color:var(--text-dim);margin-bottom:6px;">Rarity *</label>
            <select
              class="sf-input"
              name="rarity"
              disabled={readOnly}
              style={`font-size:12px;${readOnly ? "opacity:0.6;cursor:not-allowed;" : ""}`}
            >
              {RARITIES.map((r) => (
                <option key={r} value={r} selected={r === rarity}>{r}</option>
              ))}
            </select>
          </div>
          <div>
            <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:0.7px;font-weight:700;color:var(--text-dim);margin-bottom:6px;">Category</label>
            <select
              class="sf-input"
              name="category"
              disabled={readOnly}
              style={`font-size:12px;${readOnly ? "opacity:0.6;cursor:not-allowed;" : ""}`}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c} selected={c === (safeItem.category || "title")}>{c}</option>
              ))}
            </select>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:0.7px;font-weight:700;color:var(--text-dim);margin-bottom:6px;">Icon (emoji or text)</label>
            <input
              class="sf-input"
              type="text"
              name="icon"
              value={safeItem.icon ?? ""}
              placeholder="e.g. 🏆"
              readOnly={readOnly}
              style={`font-size:12px;${readOnly ? "opacity:0.6;cursor:not-allowed;" : ""}`}
            />
          </div>
          <div>
            <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:0.7px;font-weight:700;color:var(--text-dim);margin-bottom:6px;">Image URL or asset key</label>
            <input
              class="sf-input"
              type="text"
              name="image"
              value={safeItem.image ?? ""}
              placeholder="https://… or asset key"
              readOnly={readOnly}
              style={`font-size:12px;${readOnly ? "opacity:0.6;cursor:not-allowed;" : ""}`}
            />
          </div>
        </div>

        {!readOnly && (
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;border-top:1px solid var(--border);padding-top:14px;margin-top:6px;">
            <div>
              {!isNew && (
                <button
                  type="button"
                  class="sf-btn danger"
                  style="font-size:12px;"
                  hx-post="/api/admin/badge-editor/delete"
                  hx-vals={JSON.stringify({ id: safeItem.id })}
                  hx-confirm={`Delete "${safeItem.name || safeItem.id}"? This cannot be undone.`}
                >Delete</button>
              )}
            </div>
            <div style="display:flex;gap:8px;">
              <a href="/admin/badge-editor" class="sf-btn ghost" style="text-decoration:none;font-size:12px;">Cancel</a>
              <button type="submit" class="sf-btn primary" style="font-size:12px;">{isNew ? "Create" : "Save"}</button>
            </div>
          </div>
        )}

        {readOnly && (
          <div style="border-top:1px solid var(--border);padding-top:14px;margin-top:6px;color:var(--text-dim);font-size:11px;">
            Built-in items are managed in code and cannot be edited or deleted from this UI.
          </div>
        )}
      </form>
    </div>
  );
}
