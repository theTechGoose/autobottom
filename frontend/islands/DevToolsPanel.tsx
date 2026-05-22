/** Dev Tools panel — seeds test users, wipes KV. Wipe requires the admin
 *  to type the literal word WIPE to avoid accidental clicks. */
import { useEffect, useState } from "preact/hooks";

export default function DevToolsPanel() {
  const [seedMsg, setSeedMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [wipeMsg, setWipeMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [wipeConfirm, setWipeConfirm] = useState("");
  const [busy, setBusy] = useState<"seed" | "wipe" | "killswitch" | null>(null);
  const [killSwitchEnabled, setKillSwitchEnabled] = useState<boolean | null>(null);
  const [killSwitchMsg, setKillSwitchMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => { void loadKillSwitch(); }, []);
  async function loadKillSwitch() {
    try {
      const res = await fetch("/admin/email-reports/killswitch", { credentials: "include" });
      const d = await res.json().catch(() => ({} as Record<string, unknown>));
      setKillSwitchEnabled(d.enabled !== false);
    } catch { setKillSwitchEnabled(null); }
  }

  async function toggleKillSwitch() {
    if (killSwitchEnabled === null) return;
    const next = !killSwitchEnabled;
    if (!confirm(next ? "Re-enable the Email Reports cron?" : "Disable the Email Reports cron? Scheduled sends will stop within ~60 seconds.")) return;
    setBusy("killswitch");
    setKillSwitchMsg(null);
    try {
      const res = await fetch("/admin/email-reports/killswitch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ enabled: next }),
      });
      const d = await res.json().catch(() => ({} as Record<string, unknown>));
      if ((d as { ok?: boolean }).ok === false || (d as { error?: string }).error) {
        throw new Error((d as { error?: string }).error ?? "Toggle failed");
      }
      setKillSwitchEnabled(next);
      setKillSwitchMsg({ kind: "ok", text: next ? "Cron enabled — fires resume within ~60s." : "Cron disabled — fires stop within ~60s." });
    } catch (e) {
      setKillSwitchMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

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
      {/* Email Reports cron kill-switch */}
      <div style={rowStyle}>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
          <div style="font-size:13px;font-weight:600;color:var(--text-bright);">Email Reports Cron</div>
          {killSwitchEnabled !== null && (
            <span class={`pill pill-${killSwitchEnabled ? "green" : "red"}`} style="font-size:10px;">
              {killSwitchEnabled ? "● ENABLED" : "○ DISABLED"}
            </span>
          )}
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;">
          Per-minute cron that fires scheduled email reports. Flipping this here takes effect across every
          isolate within ≤60 seconds (the in-isolate cache TTL). Use as a kill-switch if a misconfigured
          report starts spamming, without needing a redeploy.
        </div>
        <button
          type="button"
          class={`sf-btn ${killSwitchEnabled ? "danger" : "primary"}`}
          style="font-size:11px;"
          onClick={toggleKillSwitch}
          disabled={busy !== null || killSwitchEnabled === null}
        >
          {busy === "killswitch"
            ? "Updating…"
            : (killSwitchEnabled === null ? "Loading…" : (killSwitchEnabled ? "Disable cron" : "Enable cron"))}
        </button>
        {killSwitchMsg && (
          <div style={`margin-top:8px;font-size:11px;color:${killSwitchMsg.kind === "ok" ? "var(--green)" : "var(--red)"};`}>
            {killSwitchMsg.text}
          </div>
        )}
      </div>

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
