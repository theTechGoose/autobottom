/** Super Admin panel — lists orgs, create new, per-org Seed/Wipe/Delete.
 *  Every destructive action requires typed confirmation. */
import { useEffect, useState } from "preact/hooks";

interface Org {
  id: string;
  name: string;
  slug: string;
  createdAt: number;
  users: number;
  findings: number;
}

export default function SuperAdminPanel() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [selected, setSelected] = useState<Org | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // New org form
  const [newName, setNewName] = useState("");
  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [newAdminPassword, setNewAdminPassword] = useState("");

  // Destructive confirms
  const [wipeConfirm, setWipeConfirm] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch("/api/super-admin/orgs", { credentials: "include" });
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok || (data as { error?: string }).error) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
      const list = ((data as { orgs?: Org[] }).orgs ?? []).sort((a, b) => b.createdAt - a.createdAt);
      setOrgs(list);
      if (selected) {
        const updated = list.find((o) => o.id === selected.id);
        setSelected(updated ?? null);
      }
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(t);
  }, [msg]);

  async function postAction(action: string, body: Record<string, unknown>) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/super-admin/org-action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action, ...body }),
      });
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok || (data as { error?: string }).error) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
      setMsg({ kind: "ok", text: String((data as { message?: string }).message ?? "Done.") });
      await refresh();
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function createOrg() {
    if (!newName.trim()) { setMsg({ kind: "err", text: "Org name required." }); return; }
    await postAction("create", { name: newName.trim(), adminEmail: newAdminEmail.trim() || undefined, adminPassword: newAdminPassword.trim() || undefined });
    setNewName(""); setNewAdminEmail(""); setNewAdminPassword("");
  }

  async function seedOrg() {
    if (!selected) return;
    await postAction("seed", { orgId: selected.id });
  }

  async function wipeOrg() {
    if (!selected) return;
    if (wipeConfirm.trim().toUpperCase() !== "WIPE") { setMsg({ kind: "err", text: "Type WIPE to confirm." }); return; }
    await postAction("wipe", { orgId: selected.id, confirm: "YES" });
    setWipeConfirm("");
  }

  async function deleteOrg() {
    if (!selected) return;
    if (deleteConfirm.trim().toUpperCase() !== "DELETE") { setMsg({ kind: "err", text: "Type DELETE to confirm." }); return; }
    await postAction("delete", { orgId: selected.id, confirm: "DELETE" });
    setDeleteConfirm("");
    setSelected(null);
  }

  return (
    <div style="display:grid;grid-template-columns:320px 1fr;gap:20px;max-width:1100px;margin:30px auto;padding:0 20px;">
      {/* Left — org list + create form */}
      <div>
        <div style="font-size:13px;font-weight:700;color:var(--text-bright);margin-bottom:10px;">Organizations</div>
        <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:16px;">
          {loading && <div style="padding:12px;font-size:11px;color:var(--text-dim);">Loading…</div>}
          {!loading && orgs.length === 0 && <div style="padding:12px;font-size:11px;color:var(--text-dim);">No orgs yet.</div>}
          {orgs.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setSelected(o)}
              style={`display:block;width:100%;text-align:left;background:${selected?.id === o.id ? "var(--blue-bg)" : "transparent"};border:none;border-bottom:1px solid var(--border);padding:10px 12px;cursor:pointer;color:var(--text-bright);font-family:inherit;`}
            >
              <div style="font-size:13px;font-weight:600;">{o.name}</div>
              <div style="font-size:10px;color:var(--text-dim);font-family:var(--mono);">
                {o.users} users · {o.findings} findings
              </div>
            </button>
          ))}
        </div>

        <div style="font-size:13px;font-weight:700;color:var(--text-bright);margin-bottom:10px;">Create Org</div>
        <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:14px;">
          <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:4px;">Name</label>
          <input value={newName} onInput={(e) => setNewName((e.target as HTMLInputElement).value)} style="width:100%;box-sizing:border-box;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:7px 10px;color:var(--text-bright);font-size:12px;margin-bottom:8px;outline:none;" />
          <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:4px;">Admin Email (optional)</label>
          <input value={newAdminEmail} onInput={(e) => setNewAdminEmail((e.target as HTMLInputElement).value)} style="width:100%;box-sizing:border-box;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:7px 10px;color:var(--text-bright);font-size:12px;margin-bottom:8px;outline:none;" />
          <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:4px;">Admin Password (optional)</label>
          <input type="password" value={newAdminPassword} onInput={(e) => setNewAdminPassword((e.target as HTMLInputElement).value)} style="width:100%;box-sizing:border-box;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:7px 10px;color:var(--text-bright);font-size:12px;margin-bottom:10px;outline:none;" />
          <button type="button" class="sf-btn primary" style="font-size:11px;width:100%;" onClick={createOrg} disabled={busy}>Create Org</button>
        </div>
      </div>

      {/* Right — selected org actions */}
      <div>
        {!selected && (
          <div style="padding:40px;text-align:center;color:var(--text-dim);font-size:12px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;">
            Select an org from the left to manage it.
          </div>
        )}
        {selected && (
          <div>
            <div style="margin-bottom:14px;">
              <div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;font-weight:700;">Selected Org</div>
              <div style="font-size:18px;font-weight:700;color:var(--text-bright);">{selected.name}</div>
              <div style="font-size:11px;color:var(--text-muted);font-family:var(--mono);">{selected.id}</div>
              <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">
                {selected.users} users · {selected.findings} findings · created {new Date(selected.createdAt).toLocaleDateString()}
              </div>
            </div>

            <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:16px;margin-bottom:12px;">
              <div style="font-size:13px;font-weight:600;color:var(--text-bright);margin-bottom:4px;">Seed Test Users</div>
              <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;">Creates admin/judge/manager/reviewer×2/agent with password 0000.</div>
              <button type="button" class="sf-btn primary" style="font-size:11px;" onClick={seedOrg} disabled={busy}>Seed Users</button>
            </div>

            <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:16px;margin-bottom:12px;">
              <div style="font-size:13px;font-weight:600;color:var(--red);margin-bottom:4px;">Wipe Org KV</div>
              <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;">Deletes every KV entry in this org. Users + findings gone. Type WIPE to enable.</div>
              <div style="display:flex;gap:8px;">
                <input value={wipeConfirm} onInput={(e) => setWipeConfirm((e.target as HTMLInputElement).value)} placeholder="Type WIPE" style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:7px 10px;color:var(--text-bright);font-family:var(--mono);font-size:12px;outline:none;" />
                <button type="button" class="sf-btn danger" style="font-size:11px;" onClick={wipeOrg} disabled={busy || wipeConfirm.trim().toUpperCase() !== "WIPE"}>Wipe KV</button>
              </div>
            </div>

            <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:16px;">
              <div style="font-size:13px;font-weight:600;color:var(--red);margin-bottom:4px;">Delete Org</div>
              <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;">Removes the org record, every user, and all KV data. Type DELETE to enable.</div>
              <div style="display:flex;gap:8px;">
                <input value={deleteConfirm} onInput={(e) => setDeleteConfirm((e.target as HTMLInputElement).value)} placeholder="Type DELETE" style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:7px 10px;color:var(--text-bright);font-family:var(--mono);font-size:12px;outline:none;" />
                <button type="button" class="sf-btn danger" style="font-size:11px;" onClick={deleteOrg} disabled={busy || deleteConfirm.trim().toUpperCase() !== "DELETE"}>Delete Org</button>
              </div>
            </div>
          </div>
        )}
        {msg && (
          <div style={`margin-top:16px;padding:10px 12px;border-radius:6px;font-size:12px;background:${msg.kind === "ok" ? "var(--green-bg)" : "var(--red-bg)"};color:${msg.kind === "ok" ? "var(--green)" : "var(--red)"};border:1px solid ${msg.kind === "ok" ? "rgba(63,185,80,0.3)" : "rgba(248,81,73,0.3)"};`}>
            {msg.text}
          </div>
        )}
      </div>
    </div>
  );
}
