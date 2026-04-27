/** Gamification settings + sound pack manager island.
 *  Two tabs (Settings / Sound Packs). Sound pack tab supports per-slot file
 *  upload to S3 via the multipart endpoint at /gamification/api/upload-sound. */
import { useEffect, useRef, useState } from "preact/hooks";

interface Pack { id: string; name: string; slots: Record<string, string>; createdAt: number; createdBy: string; }
interface Settings { threshold?: number | null; comboTimeoutMs?: number | null; enabled?: boolean | null; sounds?: Record<string, string> | null; }

const SLOTS = ["decision", "perfect", "level-up", "badge-earned", "purchase", "combo-3", "combo-5"];

export default function GamificationPanel() {
  const [tab, setTab] = useState<"settings" | "packs">("settings");
  const [packs, setPacks] = useState<Pack[]>([]);
  const [settings, setSettings] = useState<Settings>({});
  const [editingPackId, setEditingPackId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function loadPacks() {
    const res = await fetch("/api/gamification/packs", { credentials: "include" });
    const data = await res.json().catch(() => ({}));
    setPacks((data as { packs?: Pack[] }).packs ?? []);
  }
  async function loadSettings() {
    const res = await fetch("/api/gamification/settings", { credentials: "include" });
    const data = await res.json().catch(() => ({}));
    setSettings(data as Settings);
  }

  useEffect(() => { loadPacks(); loadSettings(); }, []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(t);
  }, [msg]);

  async function call(path: string, body?: unknown, method = "POST") {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(path, {
        method,
        ...(body != null ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
        credentials: "include",
      });
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok || (data as { error?: string }).error) {
        throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      return data;
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings(patch: Partial<Settings>) {
    try {
      await call("/api/gamification/settings", { ...settings, ...patch });
      setSettings({ ...settings, ...patch });
      setMsg({ kind: "ok", text: "Settings saved." });
    } catch (e) { setMsg({ kind: "err", text: (e as Error).message }); }
  }

  async function seedPacks() {
    try {
      const data = await call("/api/gamification/seed");
      setMsg({ kind: "ok", text: String((data as { message?: string }).message ?? "seeded.") });
      await loadPacks();
    } catch (e) { setMsg({ kind: "err", text: (e as Error).message }); }
  }

  async function deletePack(packId: string) {
    if (!confirm(`Delete sound pack "${packId}"?`)) return;
    try {
      await call("/api/gamification/pack/delete", { packId });
      await loadPacks();
      setMsg({ kind: "ok", text: `Deleted ${packId}.` });
    } catch (e) { setMsg({ kind: "err", text: (e as Error).message }); }
  }

  async function renamePack(p: Pack, name: string) {
    try {
      await call("/api/gamification/pack", { ...p, name });
      await loadPacks();
      setMsg({ kind: "ok", text: "Pack renamed." });
    } catch (e) { setMsg({ kind: "err", text: (e as Error).message }); }
  }

  return (
    <div>
      <div style="display:flex;border-bottom:1px solid var(--border);margin-bottom:18px;">
        <button
          type="button"
          onClick={() => setTab("settings")}
          style={`background:none;border:none;padding:10px 18px;font-size:12px;font-weight:600;cursor:pointer;color:${tab === "settings" ? "var(--green)" : "var(--text-muted)"};border-bottom:2px solid ${tab === "settings" ? "var(--green)" : "transparent"};margin-bottom:-1px;font-family:inherit;`}
        >Streak & Combo</button>
        <button
          type="button"
          onClick={() => setTab("packs")}
          style={`background:none;border:none;padding:10px 18px;font-size:12px;font-weight:600;cursor:pointer;color:${tab === "packs" ? "var(--green)" : "var(--text-muted)"};border-bottom:2px solid ${tab === "packs" ? "var(--green)" : "transparent"};margin-bottom:-1px;font-family:inherit;`}
        >Sound Packs</button>
      </div>

      {msg && (
        <div style={`margin-bottom:14px;padding:10px 12px;border-radius:6px;font-size:12px;background:${msg.kind === "ok" ? "var(--green-bg)" : "var(--red-bg)"};color:${msg.kind === "ok" ? "var(--green)" : "var(--red)"};border:1px solid ${msg.kind === "ok" ? "rgba(63,185,80,0.3)" : "rgba(248,81,73,0.3)"};`}>{msg.text}</div>
      )}

      {tab === "settings" && (
        <SettingsTab settings={settings} onSave={saveSettings} busy={busy} />
      )}

      {tab === "packs" && (
        <PacksTab
          packs={packs}
          editingPackId={editingPackId}
          setEditingPackId={setEditingPackId}
          onSeed={seedPacks}
          onDelete={deletePack}
          onRename={renamePack}
          onReload={loadPacks}
          busy={busy}
        />
      )}
    </div>
  );
}

function SettingsTab({ settings, onSave, busy }: { settings: Settings; onSave: (p: Partial<Settings>) => void; busy: boolean }) {
  const [enabled, setEnabled] = useState<boolean>(settings.enabled ?? true);
  const [threshold, setThreshold] = useState<number>(settings.threshold ?? 0);
  const [comboMs, setComboMs] = useState<number>(settings.comboTimeoutMs ?? 10000);

  useEffect(() => {
    setEnabled(settings.enabled ?? true);
    setThreshold(settings.threshold ?? 0);
    setComboMs(settings.comboTimeoutMs ?? 10000);
  }, [settings]);

  return (
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:20px;max-width:560px;">
      <label style="display:flex;align-items:center;gap:10px;margin-bottom:18px;font-size:13px;color:var(--text-bright);">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled((e.target as HTMLInputElement).checked)} style="accent-color:var(--green);" />
        Gamification enabled (sounds, streaks, combo banners)
      </label>
      <div style="margin-bottom:14px;">
        <label style="display:block;font-size:11px;color:var(--text-dim);margin-bottom:4px;">Score threshold for celebration sound</label>
        <input type="number" min={0} max={100} value={threshold} onInput={(e) => setThreshold(Number((e.target as HTMLInputElement).value) || 0)} style="width:120px;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:7px 10px;color:var(--text-bright);font-family:var(--mono);font-size:12px;outline:none;" />
        <span style="margin-left:6px;font-size:11px;color:var(--text-dim);">% (default 0 = play on any complete)</span>
      </div>
      <div style="margin-bottom:18px;">
        <label style="display:block;font-size:11px;color:var(--text-dim);margin-bottom:4px;">Combo reset timeout (ms)</label>
        <input type="number" min={1000} value={comboMs} onInput={(e) => setComboMs(Number((e.target as HTMLInputElement).value) || 10000)} style="width:120px;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:7px 10px;color:var(--text-bright);font-family:var(--mono);font-size:12px;outline:none;" />
        <span style="margin-left:6px;font-size:11px;color:var(--text-dim);">how long before a combo streak resets</span>
      </div>
      <button type="button" class="sf-btn primary" disabled={busy} onClick={() => onSave({ enabled, threshold, comboTimeoutMs: comboMs })}>Save Settings</button>
    </div>
  );
}

function PacksTab(props: {
  packs: Pack[];
  editingPackId: string | null;
  setEditingPackId: (id: string | null) => void;
  onSeed: () => void;
  onDelete: (id: string) => void;
  onRename: (p: Pack, name: string) => void;
  onReload: () => void;
  busy: boolean;
}) {
  const { packs, editingPackId, setEditingPackId, onSeed, onDelete, onReload, busy } = props;

  return (
    <div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <div style="font-size:13px;color:var(--text-muted);">{packs.length} pack{packs.length === 1 ? "" : "s"}</div>
        <button type="button" class="sf-btn ghost" onClick={onSeed} disabled={busy}>Seed Default Packs</button>
      </div>

      {packs.length === 0 && (
        <div style="background:var(--bg-card);border:1px dashed var(--border);border-radius:10px;padding:30px;text-align:center;color:var(--text-dim);font-size:12px;">
          No sound packs yet. Click <strong>Seed Default Packs</strong> to add the 5 built-ins.
        </div>
      )}

      <div style="display:flex;flex-direction:column;gap:10px;">
        {packs.map((p) => (
          <div key={p.id} style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;overflow:hidden;">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border);">
              <div>
                <div style="font-size:13px;font-weight:700;color:var(--text-bright);">{p.name}</div>
                <div style="font-size:10px;color:var(--text-dim);font-family:var(--mono);">{p.id} · {Object.keys(p.slots).length}/{SLOTS.length} slots</div>
              </div>
              <div style="display:flex;gap:8px;">
                <button type="button" class="sf-btn ghost" style="font-size:10px;" onClick={() => setEditingPackId(editingPackId === p.id ? null : p.id)}>{editingPackId === p.id ? "Close" : "Edit Slots"}</button>
                <button type="button" class="sf-btn danger" style="font-size:10px;" onClick={() => onDelete(p.id)}>Delete</button>
              </div>
            </div>
            {editingPackId === p.id && (
              <PackSlotEditor pack={p} onChange={onReload} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function PackSlotEditor({ pack, onChange }: { pack: Pack; onChange: () => void }) {
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function upload(slot: string, file: File) {
    setErr(null);
    setUploading(slot);
    try {
      const fd = new FormData();
      fd.append("packId", pack.id);
      fd.append("slot", slot);
      fd.append("file", file);
      const res = await fetch("/api/gamification/upload-sound", { method: "POST", body: fd, credentials: "include" });
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok || (data as { error?: string }).error) {
        throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      onChange();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setUploading(null);
    }
  }

  return (
    <div style="padding:14px 16px;display:flex;flex-direction:column;gap:8px;">
      {SLOTS.map((slot) => {
        const filled = !!pack.slots[slot];
        return (
          <div key={slot} style="display:flex;align-items:center;gap:10px;padding:6px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;">
            <span style={`width:8px;height:8px;border-radius:50%;background:${filled ? "var(--green)" : "var(--border)"};flex-shrink:0;`}></span>
            <span style="font-family:var(--mono);font-size:11px;color:var(--text-bright);min-width:120px;">{slot}</span>
            <span style="flex:1;font-size:10px;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{pack.slots[slot] ?? "—"}</span>
            <input
              ref={(el) => { fileRefs.current[slot] = el; }}
              type="file"
              accept="audio/mpeg,audio/mp3,audio/*"
              style="display:none"
              onChange={(e) => {
                const f = (e.target as HTMLInputElement).files?.[0];
                if (f) upload(slot, f);
              }}
            />
            <button
              type="button"
              class="sf-btn ghost"
              style="font-size:10px;"
              disabled={uploading === slot}
              onClick={() => fileRefs.current[slot]?.click()}
            >{uploading === slot ? "Uploading…" : (filled ? "Replace" : "Upload")}</button>
          </div>
        );
      })}
      {err && <div style="font-size:11px;color:var(--red);margin-top:4px;">{err}</div>}
    </div>
  );
}
