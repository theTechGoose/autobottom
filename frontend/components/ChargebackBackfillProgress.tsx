/** Progress fragment for the chunked "Backfill Chargeback Entries" flow.
 *
 *  Rendered by /chargeback-backfill-start (initial) and /chargeback-backfill-tick
 *  (per-batch). Self-replaces via HTMX: while done=false it auto-triggers the
 *  next tick after a short delay; when done=true the trigger is dropped so this
 *  becomes the terminal result card. Mirrors components/SweepProgress.tsx. */

import type { VNode } from "preact";

export function ChargebackBackfillProgress(props: {
  jobId: string;
  total: number;
  scanned: number;
  cbUpdated: number;
  cbDeleted: number;
  wireUpdated: number;
  wireDeleted: number;
  remaining: number;
  done: boolean;
  elapsedMs: number;
}): VNode {
  const { jobId, total, scanned, cbUpdated, cbDeleted, wireUpdated, wireDeleted, remaining, done, elapsedMs } = props;
  const processed = total - remaining;
  const pct = total === 0 ? 100 : Math.round((processed / total) * 100);
  const elapsedSec = Math.round(elapsedMs / 1000);
  const removed = cbDeleted + wireDeleted;
  const rewritten = cbUpdated + wireUpdated;
  const headerColor = done ? "var(--green)" : "var(--text-bright)";
  const headerLabel = done ? "✓ Chargeback backfill complete" : "Repairing chargeback / wire entries…";

  return (
    <div
      {...(done
        ? {}
        : {
          "hx-post": `/api/admin/modal/maintenance/chargeback-backfill-tick?jobId=${jobId}`,
          "hx-target": "#cb-backfill-msg",
          "hx-swap": "innerHTML",
          "hx-trigger": "load delay:300ms",
        })}
      style={`padding:14px 16px;border:1px solid ${done ? "var(--green)" : "var(--border)"};border-radius:6px;background:var(--bg);`}
    >
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px;">
        <div style={`font-size:12px;font-weight:700;color:${headerColor};text-transform:uppercase;letter-spacing:0.5px;`}>
          {headerLabel}
        </div>
        <div style="font-size:11px;color:var(--text-dim);font-family:var(--mono);">
          {processed} / {total} ({pct}%) · {elapsedSec}s
        </div>
      </div>

      <div style="height:6px;background:var(--bg-raised);border-radius:3px;overflow:hidden;margin-bottom:10px;">
        <div style={`height:100%;width:${pct}%;background:${done ? "var(--green)" : "var(--accent)"};transition:width 300ms linear;`}></div>
      </div>

      <div style="font-size:11px;color:var(--text-dim);display:flex;gap:14px;flex-wrap:wrap;">
        <span><span style="color:var(--green);">●</span> Stale fails removed: <strong style="color:var(--text-bright);">{removed}</strong></span>
        <span><span style="color:var(--blue);">●</span> Rewritten: <strong style="color:var(--text-bright);">{rewritten}</strong></span>
        <span><span style="color:var(--text-dim);">●</span> Scanned: <strong style="color:var(--text-bright);">{scanned}</strong></span>
        {!done && (
          <span><span style="color:var(--text-dim);">●</span> Remaining: <strong style="color:var(--text-bright);">{remaining}</strong></span>
        )}
      </div>

      {done && (
        <div style="font-size:10px;color:var(--text-dim);margin-top:10px;line-height:1.4;">
          "Removed" = audits that now pass on review and are no longer chargeable. The live Failed
          Audits report reflects this immediately; re-run the weekly export to refresh the Google Sheet.
        </div>
      )}
    </div>
  );
}
