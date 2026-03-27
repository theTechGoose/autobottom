/**
 * BadgeEditor island — admin store catalog management.
 * Lists built-in and custom store items. Supports creating, editing, and deleting custom items.
 * Fetches from /admin/badge-editor/items.
 */

import { useSignal, useComputed } from "@preact/signals";
import { useEffect } from "preact/hooks";

interface StoreItem {
  id: string;
  name: string;
  type: string;
  icon: string;
  description?: string;
  price: number;
  rarity?: string;
  preview?: string;
  _source?: "builtin" | "custom";
}

interface ModalState {
  open: boolean;
  editId: string | null;
}

const RARITY_COLORS: Record<string, string> = {
  common: "#6b7280",
  uncommon: "#22c55e",
  rare: "#3b82f6",
  epic: "#a855f7",
  legendary: "#f59e0b",
};

const TYPE_LABELS: Record<string, string> = {
  title: "Title",
  avatar_frame: "Frame",
  name_color: "Color",
  animation: "Animation",
  theme: "Theme",
  flair: "Flair",
  font: "Font",
  bubble_font: "Bubble Font",
  bubble_color: "Bubble Color",
};

const ALL_TYPES = Object.keys(TYPE_LABELS);

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, "_").replace(/^_+|_+$/g, "");
}

function priceToRarity(price: number): string {
  if (price >= 1000) return "legendary";
  if (price >= 700) return "epic";
  if (price >= 400) return "rare";
  if (price >= 200) return "uncommon";
  return "common";
}

export default function BadgeEditor() {
  const allItems = useSignal<StoreItem[]>([]);
  const activeFilter = useSignal("all");
  const modal = useSignal<ModalState>({ open: false, editId: null });
  const toastMsg = useSignal("");
  const toastType = useSignal("success");

  // Form fields
  const fieldId = useSignal("");
  const fieldName = useSignal("");
  const fieldType = useSignal("title");
  const fieldPrice = useSignal(0);
  const fieldIcon = useSignal("");
  const fieldPreview = useSignal("");
  const fieldDescription = useSignal("");
  const formSaving = useSignal(false);

  const filteredItems = useComputed(() =>
    activeFilter.value === "all"
      ? allItems.value
      : allItems.value.filter((item) => item.type === activeFilter.value)
  );

  const derivedRarity = useComputed(() => priceToRarity(fieldPrice.value));

  function showToast(msg: string, type = "success") {
    toastMsg.value = msg;
    toastType.value = type;
    setTimeout(() => { toastMsg.value = ""; }, 2500);
  }

  async function loadItems() {
    try {
      const res = await fetch("/admin/badge-editor/items");
      if (!res.ok) return;
      const data = await res.json();
      const builtIn: StoreItem[] = (data.builtIn || []).map((item: StoreItem) => ({ ...item, _source: "builtin" as const }));
      const custom: StoreItem[] = (data.custom || []).map((item: StoreItem) => ({ ...item, _source: "custom" as const }));
      allItems.value = [...builtIn, ...custom];
    } catch {
      // silently ignore
    }
  }

  function openNewModal() {
    modal.value = { open: true, editId: null };
    fieldId.value = "";
    fieldName.value = "";
    fieldType.value = "title";
    fieldPrice.value = 0;
    fieldIcon.value = "";
    fieldPreview.value = "";
    fieldDescription.value = "";
  }

  function openEditModal(item: StoreItem) {
    modal.value = { open: true, editId: item.id };
    fieldId.value = item.id;
    fieldName.value = item.name || item.id;
    fieldType.value = item.type;
    fieldPrice.value = item.price || 0;
    fieldIcon.value = item.icon || "";
    fieldPreview.value = item.preview || "";
    fieldDescription.value = item.description || "";
  }

  function closeModal() {
    modal.value = { open: false, editId: null };
  }

  async function saveItem() {
    formSaving.value = true;
    try {
      const isEdit = !!modal.value.editId;
      const id = isEdit ? modal.value.editId! : slugify(fieldName.value) || Date.now().toString();
      const payload: StoreItem = {
        id,
        name: fieldName.value,
        type: fieldType.value,
        icon: fieldIcon.value,
        description: fieldDescription.value,
        price: fieldPrice.value,
        preview: fieldPreview.value,
        rarity: derivedRarity.value,
      };

      const url = isEdit
        ? `/admin/badge-editor/items/${modal.value.editId}`
        : "/admin/badge-editor/items";

      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Save failed");

      closeModal();
      await loadItems();
      showToast(isEdit ? "Item updated" : "Item created");
    } catch (err) {
      showToast((err as Error).message, "error");
    } finally {
      formSaving.value = false;
    }
  }

  async function deleteItem(id: string) {
    if (!confirm("Delete this item? This cannot be undone.")) return;
    try {
      const res = await fetch(`/admin/badge-editor/items/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      await loadItems();
      showToast("Item deleted");
    } catch (err) {
      showToast((err as Error).message, "error");
    }
  }

  useEffect(() => {
    loadItems();
  }, []);

  const rarityColor = RARITY_COLORS[derivedRarity.value] || RARITY_COLORS.common;

  return (
    <div class="main">
      <div class="header">
        <h2>Store Catalog</h2>
        <button class="btn-new-item" onClick={openNewModal}>+ New Item</button>
      </div>

      {/* Filter tabs */}
      <div class="filter-bar">
        {["all", ...ALL_TYPES].map((f) => (
          <div
            key={f}
            class={`filter-tab${activeFilter.value === f ? " active" : ""}`}
            onClick={() => { activeFilter.value = f; }}
          >
            {f === "all" ? "All" : TYPE_LABELS[f] || f}
          </div>
        ))}
      </div>

      {/* Table */}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: "50px" }}>Icon</th>
              <th>Name</th>
              <th>Type</th>
              <th>Rarity</th>
              <th>Price</th>
              <th>Source</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.value.length === 0 && (
              <tr>
                <td colSpan={7} class="empty-state">No items found.</td>
              </tr>
            )}
            {filteredItems.value.map((item) => {
              const rarity = item.rarity || priceToRarity(item.price || 0);
              const rc = RARITY_COLORS[rarity] || RARITY_COLORS.common;
              const typeLabel = TYPE_LABELS[item.type] || item.type;
              const isBuiltIn = item._source === "builtin";
              return (
                <tr key={item.id}>
                  <td class="item-icon">{item.icon || ""}</td>
                  <td style={{ fontWeight: 600, color: "var(--text-bright)" }}>
                    {item.name || item.id}
                  </td>
                  <td><span class="pill pill-type">{typeLabel}</span></td>
                  <td>
                    <span class="pill pill-rarity" style={{ color: rc, borderColor: rc }}>
                      {rarity}
                    </span>
                  </td>
                  <td>
                    <span class="token-price">
                      <span class="token-symbol">T</span>
                      {item.price || 0}
                    </span>
                  </td>
                  <td>
                    {isBuiltIn
                      ? <span class="pill-source-builtin">Built-in</span>
                      : <span class="pill-source-custom">Custom</span>}
                  </td>
                  <td>
                    {!isBuiltIn && (
                      <div class="actions-cell">
                        <button class="btn-action edit" onClick={() => openEditModal(item)}>Edit</button>
                        <button class="btn-action delete" onClick={() => deleteItem(item.id)}>Delete</button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {modal.value.open && (
        <div class="modal-overlay open" onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
          <div class="modal">
            <div class="modal-header">
              <h3>{modal.value.editId ? "Edit Item" : "New Item"}</h3>
              <button class="modal-close" onClick={closeModal}>&times;</button>
            </div>
            <div class="modal-body">
              <div class="form-row">
                <div class="form-field">
                  <label>ID</label>
                  <input
                    type="text"
                    value={modal.value.editId ? fieldId.value : slugify(fieldName.value)}
                    readonly
                    placeholder="Auto-generated from name"
                  />
                </div>
                <div class="form-field">
                  <label>Name</label>
                  <input
                    type="text"
                    value={fieldName.value}
                    onInput={(e) => { fieldName.value = (e.target as HTMLInputElement).value; }}
                    placeholder="Item name"
                  />
                </div>
              </div>
              <div class="form-row">
                <div class="form-field">
                  <label>Type</label>
                  <select
                    value={fieldType.value}
                    onChange={(e) => { fieldType.value = (e.target as HTMLSelectElement).value; }}
                  >
                    {ALL_TYPES.map((t) => (
                      <option key={t} value={t}>{TYPE_LABELS[t] || t}</option>
                    ))}
                  </select>
                </div>
                <div class="form-field">
                  <label>Price</label>
                  <input
                    type="number"
                    value={fieldPrice.value}
                    min={0}
                    onInput={(e) => { fieldPrice.value = parseInt((e.target as HTMLInputElement).value) || 0; }}
                    placeholder="0"
                  />
                  <div class="rarity-live">
                    <span style={{ fontSize: "11px", color: "var(--text-dim)" }}>Rarity:</span>
                    <span class="pill pill-rarity" style={{ color: rarityColor }}>
                      {derivedRarity.value}
                    </span>
                  </div>
                </div>
              </div>
              <div class="form-row">
                <div class="form-field">
                  <label>Icon</label>
                  <input
                    type="text"
                    value={fieldIcon.value}
                    onInput={(e) => { fieldIcon.value = (e.target as HTMLInputElement).value; }}
                    placeholder="Emoji or text icon"
                  />
                </div>
                <div class="form-field">
                  <label>Preview (CSS value)</label>
                  <input
                    type="text"
                    value={fieldPreview.value}
                    onInput={(e) => { fieldPreview.value = (e.target as HTMLInputElement).value; }}
                    placeholder="e.g. #ff0 or linear-gradient(...)"
                  />
                  {fieldPreview.value && (
                    <div
                      class="color-preview-strip"
                      style={{
                        display: "block",
                        background: fieldPreview.value.includes("gradient")
                          ? undefined
                          : fieldPreview.value,
                        backgroundImage: fieldPreview.value.includes("gradient")
                          ? fieldPreview.value
                          : undefined,
                      }}
                    />
                  )}
                </div>
              </div>
              <div class="form-field">
                <label>Description</label>
                <textarea
                  value={fieldDescription.value}
                  onInput={(e) => { fieldDescription.value = (e.target as HTMLTextAreaElement).value; }}
                  placeholder="Brief description of this item"
                />
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn-modal btn-cancel" onClick={closeModal}>Cancel</button>
              <button class="btn-modal btn-save" onClick={saveItem} disabled={formSaving.value}>
                {formSaving.value ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toastMsg.value && (
        <div class={`toast show${toastType.value === "error" ? " error" : ""}`}>
          {toastMsg.value}
        </div>
      )}
    </div>
  );
}
