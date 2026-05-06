/** Dev Tools panel — seeds test users, wipes KV. Wipe requires the admin
 *  to type the literal word WIPE to avoid accidental clicks. */
import { useState } from "preact/hooks";

export default function DevToolsPanel() {
  const [seedMsg, setSeedMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [wipeMsg, setWipeMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [wipeConfirm, setWipeConfirm] = useState("");
  const [busy, setBusy] = useState<"seed" | "wipe" | null>(null);

  async function runSeed() {
    setBusy("seed");
    setSeedMsg(null);
    try {
      const res = await fetch("/api/admin/seed", { method: "POST", credentials: "include" });
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok || (data as { error?: string }).error) {
        throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const d = data as { created?: string[]; skipped?: string[] };
      const c = d.created?.length ?? 0;
      const s = d.skipped?.length ?? 0;
      setSeedMsg({ kind: "ok", text: `Seeded ${c} user${c === 1 ? "" : "s"}${s ? `, skipped ${s} that already existed` : ""}. Password: 0000` });
    } catch (e) {
      setSeedMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function runWipe() {
    if (wipeConfirm.trim().toUpperCase() !== "WIPE") {
      setWipeMsg({ kind: "err", text: "Type WIPE to confirm." });
      return;
    }
    setBusy("wipe");
    setWipeMsg(null);
    try {
      const res = await fetch("/api/admin/wipe-kv", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ confirm: "YES" }),
      });
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok || (data as { error?: string }).error) {
        throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      setWipeMsg({ kind: "ok", text: String((data as { message?: string }).message ?? "Wiped.") });
      setWipeConfirm("");
    } catch (e) {
      setWipeMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const rowStyle = "padding:14px 0;border-bottom:1px solid var(--border);";

  return (
    <div>
      {/* Seed */}
      <div style={rowStyle}>
        <div style="font-size:13px;font-weight:600;color:var(--text-bright);margin-bottom:4px;">Seed Test Users</div>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;">
          Creates 6 users in the current org (admin, judge, manager, 2 reviewers, agent) with password <code>0000</code>.
          Idempotent — existing users are skipped.
        </div>
        <button
          type="button"
          class="sf-btn primary"
          style="font-size:11px;"
          onClick={runSeed}
          disabled={busy !== null}
        >{busy === "seed" ? "Seeding…" : "Seed Test Users"}</button>
        {seedMsg && (
          <div style={`margin-top:8px;font-size:11px;color:${seedMsg.kind === "ok" ? "var(--green)" : "var(--red)"};`}>
            {seedMsg.text}
          </div>
        )}
      </div>

      {/* Wipe */}
      <div style="padding:14px 0;">
        <div style="font-size:13px;font-weight:600;color:var(--red);margin-bottom:4px;">Wipe Org KV</div>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;">
          Deletes every KV entry in the current org — findings, queues, stats, users, everything.
          Irreversible. Type <strong style="color:var(--red);">WIPE</strong> to enable.
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <input
            type="text"
            placeholder="Type WIPE"
            value={wipeConfirm}
            onInput={(e) => setWipeConfirm((e.target as HTMLInputElement).value)}
            disabled={busy !== null}
            style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:7px 10px;color:var(--text-bright);font-family:var(--mono);font-size:12px;outline:none;"
          />
          <button
            type="button"
            class="sf-btn danger"
            style="font-size:11px;"
            onClick={runWipe}
            disabled={busy !== null || wipeConfirm.trim().toUpperCase() !== "WIPE"}
          >{busy === "wipe" ? "Wiping…" : "Wipe KV"}</button>
        </div>
        {wipeMsg && (
          <div style={`margin-top:8px;font-size:11px;color:${wipeMsg.kind === "ok" ? "var(--green)" : "var(--red)"};`}>
            {wipeMsg.text}
          </div>
        )}
      </div>
    </div>
  );
}
