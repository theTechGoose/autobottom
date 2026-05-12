/** Progress fragment for the chunked Cleanup → Re-trigger flow.
 *
 *  Four phases:
 *  - "scanning": ticking through pasted fids, per-fid date+status check.
 *                Self-triggers /retrigger-scan-tick.
 *  - "pending":  scan done. Renders count + Re-trigger / Cancel buttons.
 *                No auto-tick; waits for operator confirmation.
 *  - "running":  publishing step-init per match. Self-triggers /retrigger-tick.
 *  - "done":     terminal. */

import type { VNode } from "preact";

export function RetriggerProgress(props: {
  jobId: string;
  phase: "scanning" | "pending" | "running" | "done";
  total: number;
  scanned: number;
  matched: number;
  rejectedFinished: number;
  rejectedOutOfRange: number;
  rejectedMissing: number;
  requeued: number;
  failed: string[];
  remaining: number;
  elapsedMs: number;
  since: string;
  until: string;
}): VNode {
  const {
    jobId, phase, total,
    scanned, matched, rejectedFinished, rejectedOutOfRange, rejectedMissing,
    requeued, failed, remaining, elapsedMs, since, until,
  } = props;
  const elapsedSec = Math.round(elapsedMs / 1000);

  if (phase === "scanning") {
    const pct = total === 0 ? 0 : Math.round((scanned / total) * 100);
    return (
      <div
        hx-post={`/api/admin/modal/maintenance/retrigger-scan-tick?jobId=${jobId}`}
        hx-target="#cleanup-msg"
        hx-swap="innerHTML"
        hx-trigger="load delay:200ms"
        style="padding:14px 16px;border:1px solid var(--border);border-radius:6px;background:var(--bg);"
      >
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px;">
          <div style="font-size:12px;font-weight:700;color:var(--text-bright);text-transform:uppercase;letter-spacing:0.5px;">Scanning candidates…</div>
          <div style="font-size:11px;color:var(--text-dim);font-family:var(--mono);">{scanned} / {total} ({pct}%) · {elapsedSec}s</div>
        </div>
        <div style="height:6px;background:var(--bg-raised);border-radius:3px;overflow:hidden;margin-bottom:10px;">
          <div style={`height:100%;width:${pct}%;background:var(--accent);transition:width 200ms linear;`}></div>
        </div>
        <div style="font-size:11px;color:var(--text-dim);display:flex;gap:14px;flex-wrap:wrap;">
          <span><span style="color:var(--green);">●</span> Matched: <strong style="color:var(--text-bright);">{matched}</strong></span>
          <span><span style="color:var(--text-dim);">●</span> Finished (skip): <strong>{rejectedFinished}</strong></span>
          <span><span style="color:var(--text-dim);">●</span> Out of range: <strong>{rejectedOutOfRange}</strong></span>
          <span><span style="color:var(--text-dim);">●</span> Missing: <strong>{rejectedMissing}</strong></span>
        </div>
      </div>
    );
  }

  if (phase === "pending") {
    return (
      <div style="padding:14px 16px;border:1px solid var(--accent);border-radius:6px;background:var(--bg);">
        <div style="font-size:12px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">
          Scan complete — confirm to re-trigger
        </div>
        <div style="font-size:12px;color:var(--text-bright);margin-bottom:4px;">
          <strong>{matched}</strong> of {total} pasted fid(s) match: status ≠ "finished" AND startedAt between {since} and {until}.
        </div>
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:12px;display:flex;gap:14px;flex-wrap:wrap;">
          <span>Already finished (skipped): {rejectedFinished}</span>
          <span>Outside date range: {rejectedOutOfRange}</span>
          <span>Missing finding doc: {rejectedMissing}</span>
        </div>
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:12px;">
          Clicking the button below re-publishes step-init for each match. QStash queue parallelism throttles the resulting load. Same findingId, runs through transcribe → prepare → ask-all → finalize fresh.
        </div>
        <div style="display:flex;gap:8px;">
          <button
            class="sf-btn primary"
            style="padding:8px 16px;font-size:11px;"
            hx-post={`/api/admin/modal/maintenance/retrigger-start?jobId=${jobId}`}
            hx-target="#cleanup-msg"
            hx-swap="innerHTML"
            hx-confirm={`Re-trigger ${matched} audit(s) via step-init?`}
            disabled={matched === 0}
          >Re-trigger {matched} audit{matched === 1 ? "" : "s"}</button>
          <button
            type="button"
            class="sf-btn ghost"
            style="padding:8px 16px;font-size:11px;"
            hx-get="/api/admin/modal/maintenance?tab=cleanup"
            hx-target="#maint-shell"
            hx-swap="outerHTML"
          >Cancel</button>
        </div>
      </div>
    );
  }

  // running / done
  const done = phase === "done";
  const processed = matched - remaining;
  const pct = matched === 0 ? 100 : Math.round((processed / matched) * 100);
  return (
    <div
      {...(done
        ? {}
        : {
          "hx-post": `/api/admin/modal/maintenance/retrigger-tick?jobId=${jobId}`,
          "hx-target": "#cleanup-msg",
          "hx-swap": "innerHTML",
          "hx-trigger": "load delay:200ms",
        })}
      style={`padding:14px 16px;border:1px solid ${done ? "var(--green)" : "var(--border)"};border-radius:6px;background:var(--bg);`}
    >
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px;">
        <div style={`font-size:12px;font-weight:700;color:${done ? "var(--green)" : "var(--text-bright)"};text-transform:uppercase;letter-spacing:0.5px;`}>
          {done ? "Re-trigger complete" : "Re-triggering…"}
        </div>
        <div style="font-size:11px;color:var(--text-dim);font-family:var(--mono);">
          {processed} / {matched} ({pct}%) · {elapsedSec}s
        </div>
      </div>
      <div style="height:6px;background:var(--bg-raised);border-radius:3px;overflow:hidden;margin-bottom:10px;">
        <div style={`height:100%;width:${pct}%;background:${done ? "var(--green)" : "var(--accent)"};transition:width 200ms linear;`}></div>
      </div>
      <div style="font-size:11px;color:var(--text-dim);display:flex;gap:14px;flex-wrap:wrap;">
        <span><span style="color:var(--green);">●</span> Re-queued: <strong style="color:var(--text-bright);">{requeued}</strong></span>
        {failed.length > 0 && (
          <span><span style="color:var(--red);">●</span> Failed: <strong style="color:var(--red);">{failed.length}</strong></span>
        )}
        {!done && (
          <span><span style="color:var(--text-dim);">●</span> Remaining: <strong style="color:var(--text-bright);">{remaining}</strong></span>
        )}
      </div>
      {done && failed.length > 0 && (
        <details style="margin-top:10px;font-size:11px;">
          <summary style="cursor:pointer;color:var(--red);">Show {failed.length} failed finding ID(s)</summary>
          <pre style="margin-top:6px;padding:8px;background:var(--bg-raised);border-radius:4px;font-size:10px;max-height:200px;overflow:auto;color:var(--text-dim);">
            {failed.join("\n")}
          </pre>
        </details>
      )}
    </div>
  );
}
