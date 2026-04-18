/** Bulk Audit runner — paste a list of RIDs, pick type, pick stagger.
 *  Iterates sequentially with setTimeout(stagger*1000) between calls so
 *  we don't hammer QuickBase or QStash. Max 200 RIDs per run. */
import { useState } from "preact/hooks";

type RowStatus = "pending" | "running" | "ok" | "error";
interface Row { rid: string; status: RowStatus; findingId?: string; error?: string; }

const MAX_RIDS = 200;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export default function BulkAuditRunner() {
  const [raw, setRaw] = useState("");
  const [type, setType] = useState<"internal" | "partner">("internal");
  const [stagger, setStagger] = useState(5);
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function parseRids(): string[] {
    return raw
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, MAX_RIDS);
  }

  async function run() {
    setErr(null);
    const rids = parseRids();
    if (!rids.length) { setErr("Paste at least one record ID."); return; }
    if (stagger < 0 || stagger > 30) { setErr("Stagger must be 0–30 seconds."); return; }

    const initial: Row[] = rids.map((rid) => ({ rid, status: "pending" as RowStatus }));
    setRows(initial);
    setRunning(true);

    for (let i = 0; i < initial.length; i++) {
      const rid = initial[i].rid;
      setRows((cur) => cur.map((r, idx) => idx === i ? { ...r, status: "running" } : r));
      try {
        const res = await fetch(`/api/admin/bulk-audit-fire?rid=${encodeURIComponent(rid)}&type=${type}`, {
          method: "POST",
          credentials: "include",
        });
        const data = await res.json().catch(() => ({} as Record<string, unknown>));
        const d = data as { error?: string; findingId?: string; jobId?: string };
        if (d.error || (!d.findingId && !d.jobId)) {
          setRows((cur) => cur.map((r, idx) => idx === i ? { ...r, status: "error", error: String(d.error ?? `HTTP ${res.status}`) } : r));
        } else {
          setRows((cur) => cur.map((r, idx) => idx === i ? { ...r, status: "ok", findingId: d.findingId ?? d.jobId } : r));
        }
      } catch (e) {
        setRows((cur) => cur.map((r, idx) => idx === i ? { ...r, status: "error", error: (e as Error).message } : r));
      }
      if (i < initial.length - 1 && stagger > 0) await sleep(stagger * 1000);
    }

    setRunning(false);
  }

  function copyFailed() {
    const failed = rows.filter((r) => r.status === "error").map((r) => r.rid);
    if (!failed.length) return;
    navigator.clipboard.writeText(failed.join("\n")).catch(() => {});
  }

  const parsedCount = parseRids().length;
  const okCount = rows.filter((r) => r.status === "ok").length;
  const errCount = rows.filter((r) => r.status === "error").length;
  const pendingCount = rows.filter((r) => r.status === "pending" || r.status === "running").length;

  return (
    <div style="padding:16px 20px 20px;">
      <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;">Record IDs (comma or newline)</label>
      <textarea
        value={raw}
        onInput={(e) => setRaw((e.target as HTMLTextAreaElement).value)}
        placeholder="1805427&#10;1805428&#10;1805429..."
        rows={6}
        disabled={running}
        style="width:100%;box-sizing:border-box;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text-bright);padding:10px 12px;font-size:13px;font-family:var(--mono);resize:vertical;outline:none;"
      />
      <div style="font-size:10px;color:var(--text-dim);margin-top:3px;">
        {parsedCount} record{parsedCount === 1 ? "" : "s"} parsed · max {MAX_RIDS}
      </div>

      <div style="display:flex;gap:10px;margin-top:12px;">
        <div style="flex:1;">
          <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;">Audit Type</label>
          <select
            value={type}
            onChange={(e) => setType((e.target as HTMLSelectElement).value as "internal" | "partner")}
            disabled={running}
            style="width:100%;height:36px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text-bright);padding:0 10px;font-size:13px;"
          >
            <option value="internal">Internal (Date Leg)</option>
            <option value="partner">Partner (Package)</option>
          </select>
        </div>
        <div style="flex:1;">
          <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;">Stagger (seconds)</label>
          <input
            type="number"
            min={0}
            max={30}
            value={stagger}
            onInput={(e) => setStagger(Number((e.target as HTMLInputElement).value) || 0)}
            disabled={running}
            style="width:100%;height:36px;box-sizing:border-box;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text-bright);padding:0 10px;font-size:13px;font-family:var(--mono);"
          />
        </div>
      </div>

      {err && <div style="margin-top:10px;font-size:11px;color:var(--red);background:var(--red-bg);border:1px solid rgba(248,81,73,0.2);border-radius:6px;padding:7px 10px;">{err}</div>}

      <div style="display:flex;gap:10px;margin-top:14px;justify-content:flex-end;">
        <button
          type="button"
          onClick={run}
          disabled={running || parsedCount === 0}
          style="padding:9px 20px;border:none;border-radius:7px;background:var(--blue);color:#fff;font-weight:700;font-size:12px;cursor:pointer;font-family:inherit;"
        >
          {running ? `Running… (${okCount + errCount}/${rows.length})` : `Queue ${parsedCount} Audit${parsedCount === 1 ? "" : "s"}`}
        </button>
      </div>

      {rows.length > 0 && (
        <div style="margin-top:16px;border-top:1px solid var(--border);padding-top:12px;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;">
            <div style="font-size:11px;color:var(--text-muted);">
              <span style="color:var(--green);">{okCount} queued</span>
              {errCount > 0 && <span style="margin-left:10px;color:var(--red);">{errCount} failed</span>}
              {pendingCount > 0 && <span style="margin-left:10px;color:var(--text-dim);">{pendingCount} pending</span>}
            </div>
            {errCount > 0 && !running && (
              <button type="button" onClick={copyFailed} style="background:transparent;border:0;color:var(--blue);font-size:11px;cursor:pointer;font-family:inherit;">
                Copy failed RIDs
              </button>
            )}
          </div>
          <div style="max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;background:var(--bg);">
            {rows.map((r, i) => (
              <div
                key={i}
                style="display:flex;gap:10px;align-items:center;padding:6px 10px;border-bottom:1px solid var(--border);font-size:12px;"
              >
                <span style="font-family:var(--mono);color:var(--text-dim);font-size:10px;width:28px;text-align:right;">{i + 1}</span>
                <span style="font-family:var(--mono);color:var(--text-bright);">{r.rid}</span>
                <span style={`flex:1;text-align:right;font-size:10px;color:${
                  r.status === "ok" ? "var(--green)"
                  : r.status === "error" ? "var(--red)"
                  : r.status === "running" ? "var(--yellow)"
                  : "var(--text-dim)"
                };`}>
                  {r.status === "ok" && r.findingId && (
                    <a href={`/audit/report?id=${r.findingId}`} target="_blank" rel="noopener" style="color:var(--green);text-decoration:underline;">{r.findingId}</a>
                  )}
                  {r.status === "error" && (r.error ?? "error")}
                  {r.status === "running" && "starting…"}
                  {r.status === "pending" && "pending"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
