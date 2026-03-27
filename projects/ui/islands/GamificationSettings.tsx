/**
 * GamificationSettings island — Streak & Combo + Sound Packs tabs.
 * Fetches from /api/gamification/settings and /api/gamification/packs.
 * Saves via POST to same endpoints.
 */

import { useSignal, useComputed } from "@preact/signals";
import { useEffect } from "preact/hooks";

const SLOTS = ["ping", "double", "triple", "mega", "ultra", "rampage", "godlike", "levelup"];

interface SoundPack {
  id: string;
  name: string;
  slots?: Record<string, string>;
}

interface GamificationSettingsData {
  role: string;
  orgId?: string;
  settings: {
    threshold?: number;
    comboTimeoutMs?: number;
    enabled?: boolean;
    sounds?: Record<string, string>;
  };
}

export default function GamificationSettings() {
  const tab = useSignal<"settings" | "packs">("settings");

  // Settings form
  const threshold = useSignal(0);
  const comboTimeoutMs = useSignal(10000);
  const gsEnabled = useSignal(true);
  const activePack = useSignal("synth");
  const role = useSignal("");
  const saving = useSignal(false);
  const toastMsg = useSignal("");
  const toastType = useSignal("success");

  // Packs
  const packs = useSignal<SoundPack[]>([]);
  const selectedPackId = useSignal<string | null>(null);
  const editorName = useSignal("");
  const editorSlots = useSignal<Record<string, string>>({});
  const uploading = useSignal<Record<string, boolean>>({});
  const packSaving = useSignal(false);
  const seedingPacks = useSignal(false);

  const packOptions = useComputed(() => [
    { id: "synth", name: "Built-in: Synth" },
    ...packs.value,
  ]);

  function showToast(msg: string, type = "success") {
    toastMsg.value = msg;
    toastType.value = type;
    setTimeout(() => { toastMsg.value = ""; }, 2000);
  }

  async function loadSettings() {
    try {
      const res = await fetch("/api/gamification/settings");
      if (!res.ok) return;
      const data: GamificationSettingsData = await res.json();
      role.value = data.role || "";
      const s = data.settings || {};
      threshold.value = s.threshold ?? 0;
      comboTimeoutMs.value = s.comboTimeoutMs ?? 10000;
      gsEnabled.value = s.enabled !== false;
      if (s.sounds) {
        const vals = Object.values(s.sounds);
        if (vals.length > 0 && vals[0]) activePack.value = vals[0];
      }
    } catch {
      // silently ignore
    }
  }

  async function loadPacks() {
    try {
      const res = await fetch("/api/gamification/packs");
      if (!res.ok) return;
      packs.value = await res.json() || [];
    } catch {
      // silently ignore
    }
  }

  async function saveSettings() {
    saving.value = true;
    try {
      const pack = activePack.value;
      const sounds: Record<string, string> = {};
      if (pack !== "synth") {
        SLOTS.forEach((s) => { sounds[s] = pack; });
      }
      const payload = {
        threshold: threshold.value,
        comboTimeoutMs: comboTimeoutMs.value,
        enabled: gsEnabled.value,
        sounds,
      };
      const res = await fetch("/api/gamification/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Save failed");
      showToast("Settings saved");
    } catch (err) {
      showToast((err as Error).message, "error");
    } finally {
      saving.value = false;
    }
  }

  function selectPack(packId: string) {
    selectedPackId.value = packId;
    if (packId === "synth") {
      editorName.value = "Built-in: Synth";
      editorSlots.value = {};
    } else {
      const pack = packs.value.find((p) => p.id === packId);
      if (pack) {
        editorName.value = pack.name;
        editorSlots.value = { ...(pack.slots || {}) };
      }
    }
  }

  async function uploadSlot(slot: string, file: File) {
    uploading.value = { ...uploading.value, [slot]: true };
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("packId", selectedPackId.value!);
      form.append("slot", slot);
      const res = await fetch("/api/gamification/packs/upload", { method: "POST", body: form });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      editorSlots.value = { ...editorSlots.value, [slot]: data.url };
      // Refresh pack list
      await loadPacks();
      showToast(`${slot} uploaded`);
    } catch (err) {
      showToast((err as Error).message, "error");
    } finally {
      uploading.value = { ...uploading.value, [slot]: false };
    }
  }

  async function savePackName() {
    if (!selectedPackId.value || selectedPackId.value === "synth") return;
    packSaving.value = true;
    try {
      const res = await fetch(`/api/gamification/packs/${selectedPackId.value}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editorName.value }),
      });
      if (!res.ok) throw new Error("Save failed");
      await loadPacks();
      showToast("Pack saved");
    } catch (err) {
      showToast((err as Error).message, "error");
    } finally {
      packSaving.value = false;
    }
  }

  async function setPackActive() {
    if (!selectedPackId.value) return;
    activePack.value = selectedPackId.value;
    await saveSettings();
  }

  async function deletePack() {
    if (!selectedPackId.value || selectedPackId.value === "synth") return;
    if (!confirm("Delete this sound pack? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/gamification/packs/${selectedPackId.value}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      selectedPackId.value = null;
      editorName.value = "";
      editorSlots.value = {};
      await loadPacks();
      showToast("Pack deleted");
    } catch (err) {
      showToast((err as Error).message, "error");
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
      await loadPacks();
      selectPack(newPack.id);
    } catch (err) {
      showToast((err as Error).message, "error");
    }
  }

  async function seedBuiltinPacks() {
    seedingPacks.value = true;
    try {
      const res = await fetch("/api/gamification/packs/seed", { method: "POST" });
      if (!res.ok) throw new Error("Seed failed");
      await loadPacks();
      showToast("Built-in packs seeded");
    } catch (err) {
      showToast((err as Error).message, "error");
    } finally {
      seedingPacks.value = false;
    }
  }

  useEffect(() => {
    loadSettings();
    loadPacks();
  }, []);

  const roleBadgeText = role.value === "admin"
    ? "Setting as: Admin (org defaults)"
    : role.value
    ? "Setting as: Judge (team overrides)"
    : "";

  return (
    <div>
      <div class="tabs">
        <button
          class={`tab${tab.value === "settings" ? " active" : ""}`}
          onClick={() => { tab.value = "settings"; }}
        >
          Streak &amp; Combo
        </button>
        <button
          class={`tab${tab.value === "packs" ? " active" : ""}`}
          onClick={() => { tab.value = "packs"; }}
        >
          Sound Packs
        </button>
      </div>

      <div class="content">
        {/* Tab: Streak & Combo */}
        {tab.value === "settings" && (
          <div>
            {roleBadgeText && (
              <div class="role-badge">{roleBadgeText}</div>
            )}

            <div class="field">
              <div class="field-label">Threshold</div>
              <div class="field-desc">Seconds per question for streak mode (0 = flat timeout mode)</div>
              <input
                type="number"
                value={threshold.value}
                min={0}
                onInput={(e) => { threshold.value = parseInt((e.target as HTMLInputElement).value) || 0; }}
              />
            </div>

            <div class="field">
              <div class="field-label">Combo Timeout</div>
              <div class="field-desc">Milliseconds for flat timeout mode (default 10000)</div>
              <input
                type="number"
                value={comboTimeoutMs.value}
                min={1000}
                step={1000}
                onInput={(e) => { comboTimeoutMs.value = parseInt((e.target as HTMLInputElement).value) || 10000; }}
              />
            </div>

            <div class="field">
              <div class="field-label">Enabled</div>
              <div class="field-desc">XP, combos, streaks, and sound effects</div>
              <div class="toggle-wrap">
                <div
                  class={`toggle${gsEnabled.value ? " on" : ""}`}
                  onClick={() => { gsEnabled.value = !gsEnabled.value; }}
                >
                  <div class="toggle-dot" />
                </div>
                <span class="toggle-label">{gsEnabled.value ? "On" : "Off"}</span>
              </div>
            </div>

            <div class="field">
              <div class="field-label">Active Sound Pack</div>
              <div class="field-desc">Select which pack plays during reviews</div>
              <select
                value={activePack.value}
                onChange={(e) => { activePack.value = (e.target as HTMLSelectElement).value; }}
              >
                {packOptions.value.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div style={{ marginTop: "24px" }}>
              <button class="btn btn-primary" onClick={saveSettings} disabled={saving.value}>
                {saving.value ? "Saving..." : "Save Settings"}
              </button>
            </div>
          </div>
        )}

        {/* Tab: Sound Packs */}
        {tab.value === "packs" && (
          <div>
            <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
              <button class="btn btn-secondary" onClick={createPack}>+ New Pack</button>
              {role.value === "admin" && (
                <button class="btn btn-secondary" onClick={seedBuiltinPacks} disabled={seedingPacks.value}>
                  {seedingPacks.value ? "Seeding..." : "Seed Built-in Packs"}
                </button>
              )}
            </div>

            <div class="packs-layout">
              {/* Pack list */}
              <div class="pack-list">
                <div class="pack-list-header"><span>Packs</span></div>
                <div>
                  <div
                    class={`pack-item builtin${selectedPackId.value === "synth" ? " active" : ""}`}
                    onClick={() => selectPack("synth")}
                  >
                    <div>
                      <div class="name">Built-in: Synth</div>
                      <div class="count">8/8 slots (Web Audio)</div>
                    </div>
                  </div>
                  {packs.value.map((p) => {
                    const filled = SLOTS.filter((s) => p.slots && p.slots[s]).length;
                    return (
                      <div
                        key={p.id}
                        class={`pack-item${selectedPackId.value === p.id ? " active" : ""}`}
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
              </div>

              {/* Pack editor */}
              <div class="pack-editor">
                {!selectedPackId.value && (
                  <div class="empty-editor">
                    <p>Select a pack to edit, or create a new one</p>
                  </div>
                )}

                {selectedPackId.value === "synth" && (
                  <div>
                    <h3>Built-in: Synth (Web Audio)</h3>
                    {SLOTS.map((slot) => (
                      <div key={slot} class="slot-row" style={{ gridTemplateColumns: "90px 1fr 36px" }}>
                        <div class="slot-label">{slot}</div>
                        <div class="slot-file filled">Web Audio synth</div>
                        <button
                          class="play-btn"
                          onClick={() => {
                            // Play synth preview — requires SoundEngine on window
                            const eng = (globalThis as unknown as { SoundEngine?: { getSynths(): Record<string, () => void> } }).SoundEngine;
                            if (eng) eng.getSynths()[slot]?.();
                          }}
                          title={`Preview ${slot}`}
                        >
                          &#9654;
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {selectedPackId.value && selectedPackId.value !== "synth" && (
                  <div>
                    <input
                      class="pack-name-input"
                      value={editorName.value}
                      onInput={(e) => { editorName.value = (e.target as HTMLInputElement).value; }}
                      placeholder="Pack name..."
                      onBlur={savePackName}
                    />
                    {SLOTS.map((slot) => {
                      const slotUrl = editorSlots.value[slot];
                      return (
                        <div key={slot} class="slot-row">
                          <div class="slot-label">{slot}</div>
                          <div class={`slot-file${slotUrl ? " filled" : ""}`}>
                            {slotUrl
                              ? slotUrl.split("/").pop() || slotUrl
                              : "No file"}
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
                          {slotUrl && (
                            <button
                              class="play-btn"
                              onClick={() => {
                                const eng = (globalThis as unknown as { SoundEngine?: { playFile(url: string): void } }).SoundEngine;
                                if (eng) eng.playFile(slotUrl);
                                else new Audio(slotUrl).play();
                              }}
                              title={`Preview ${slot}`}
                            >
                              &#9654;
                            </button>
                          )}
                        </div>
                      );
                    })}
                    <div class="editor-actions">
                      <button class="btn btn-primary btn-sm" onClick={setPackActive}>
                        Set as Active
                      </button>
                      <button
                        class="btn btn-danger btn-sm"
                        style={{ marginLeft: "auto" }}
                        onClick={deletePack}
                      >
                        Delete Pack
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Toast */}
      {toastMsg.value && (
        <div class={`toast show${toastType.value === "error" ? " error" : ""}`}>
          {toastMsg.value}
        </div>
      )}
    </div>
  );
}
