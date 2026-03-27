/**
 * SoundPackEditor island — standalone sound pack CRUD (used outside gamification settings).
 * Manages the full list of sound packs with upload per slot.
 * Fetches from /api/gamification/packs.
 */

import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";

const SLOTS = ["ping", "double", "triple", "mega", "ultra", "rampage", "godlike", "levelup"];

interface SoundPack {
  id: string;
  name: string;
  slots?: Record<string, string>;
}

export default function SoundPackEditor() {
  const packs = useSignal<SoundPack[]>([]);
  const selectedId = useSignal<string | null>(null);
  const packName = useSignal("");
  const slotUrls = useSignal<Record<string, string>>({});
  const uploading = useSignal<Record<string, boolean>>({});
  const saving = useSignal(false);
  const toastMsg = useSignal("");
  const toastType = useSignal("success");

  function showToast(msg: string, type = "success") {
    toastMsg.value = msg;
    toastType.value = type;
    setTimeout(() => { toastMsg.value = ""; }, 2000);
  }

  async function load() {
    try {
      const res = await fetch("/api/gamification/packs");
      if (!res.ok) return;
      packs.value = await res.json() || [];
    } catch {
      // ignore
    }
  }

  function selectPack(id: string) {
    selectedId.value = id;
    const p = packs.value.find((x) => x.id === id);
    if (p) {
      packName.value = p.name;
      slotUrls.value = { ...(p.slots || {}) };
    }
  }

  async function createPack() {
    try {
      const res = await fetch("/api/gamification/packs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Pack" }),
      });
      if (!res.ok) throw new Error("Create failed");
      const newPack: SoundPack = await res.json();
      await load();
      selectPack(newPack.id);
    } catch (err) {
      showToast((err as Error).message, "error");
    }
  }

  async function saveName() {
    if (!selectedId.value) return;
    saving.value = true;
    try {
      const res = await fetch(`/api/gamification/packs/${selectedId.value}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: packName.value }),
      });
      if (!res.ok) throw new Error("Save failed");
      await load();
      showToast("Pack saved");
    } catch (err) {
      showToast((err as Error).message, "error");
    } finally {
      saving.value = false;
    }
  }

  async function deletePack() {
    if (!selectedId.value) return;
    if (!confirm("Delete this sound pack?")) return;
    try {
      const res = await fetch(`/api/gamification/packs/${selectedId.value}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      selectedId.value = null;
      packName.value = "";
      slotUrls.value = {};
      await load();
      showToast("Pack deleted");
    } catch (err) {
      showToast((err as Error).message, "error");
    }
  }

  async function uploadSlot(slot: string, file: File) {
    uploading.value = { ...uploading.value, [slot]: true };
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("packId", selectedId.value!);
      form.append("slot", slot);
      const res = await fetch("/api/gamification/packs/upload", { method: "POST", body: form });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      slotUrls.value = { ...slotUrls.value, [slot]: data.url };
      await load();
      showToast(`${slot} uploaded`);
    } catch (err) {
      showToast((err as Error).message, "error");
    } finally {
      uploading.value = { ...uploading.value, [slot]: false };
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div>
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
        <button class="btn btn-secondary" onClick={createPack}>+ New Pack</button>
      </div>

      <div class="packs-layout">
        <div class="pack-list">
          <div class="pack-list-header"><span>Packs</span></div>
          {packs.value.length === 0 && (
            <div style={{ padding: "16px", fontSize: "12px", color: "var(--text-dim)" }}>
              No custom packs yet.
            </div>
          )}
          {packs.value.map((p) => {
            const filled = SLOTS.filter((s) => p.slots && p.slots[s]).length;
            return (
              <div
                key={p.id}
                class={`pack-item${selectedId.value === p.id ? " active" : ""}`}
                onClick={() => selectPack(p.id)}
              >
                <div>
                  <div class="name">{p.name}</div>
                  <div class="count">{filled}/8 slots</div>
                </div>
              </div>
            );
          })}
        </div>

        <div class="pack-editor">
          {!selectedId.value && (
            <div class="empty-editor">
              <p>Select a pack to edit, or create a new one</p>
            </div>
          )}

          {selectedId.value && (
            <div>
              <input
                class="pack-name-input"
                value={packName.value}
                onInput={(e) => { packName.value = (e.target as HTMLInputElement).value; }}
                placeholder="Pack name..."
                onBlur={saveName}
              />
              {SLOTS.map((slot) => {
                const url = slotUrls.value[slot];
                return (
                  <div key={slot} class="slot-row">
                    <div class="slot-label">{slot}</div>
                    <div class={`slot-file${url ? " filled" : ""}`}>
                      {url ? url.split("/").pop() || url : "No file"}
                    </div>
                    <label class="btn btn-secondary btn-sm" style={{ cursor: "pointer" }}>
                      {uploading.value[slot] ? "..." : "Upload"}
                      <input
                        type="file"
                        accept=".mp3,audio/mpeg"
                        style={{ display: "none" }}
                        onChange={(e) => {
                          const file = (e.target as HTMLInputElement).files?.[0];
                          if (file) uploadSlot(slot, file);
                        }}
                      />
                    </label>
                    {url && (
                      <button
                        class="play-btn"
                        onClick={() => { new Audio(url).play(); }}
                        title={`Preview ${slot}`}
                      >
                        &#9654;
                      </button>
                    )}
                  </div>
                );
              })}
              <div class="editor-actions">
                <button class="btn btn-danger btn-sm" style={{ marginLeft: "auto" }} onClick={deletePack}>
                  Delete Pack
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {toastMsg.value && (
        <div class={`toast show${toastType.value === "error" ? " error" : ""}`}>
          {toastMsg.value}
        </div>
      )}
    </div>
  );
}
