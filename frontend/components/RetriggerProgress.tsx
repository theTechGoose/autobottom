/** Progress fragment for the chunked Cleanup → Re-trigger flow.
 *
 *  Three render modes:
 *  - phase="pending": scan complete, show count + "Re-trigger N audits"
 *    confirmation button. No auto-tick; waits for the operator.
 *  - phase="running": actively ticking. Re-renders with updated count
 *    every batch; self-triggers /retrigger-tick on a 200ms delay.
 *  - phase="done": terminal. Shows the requeued + failed totals. */

import type { VNode } from "preact";

export function RetriggerProgress(props: {
  jobId: string;
  phase: "pending" | "running" | "done";
  total: number;
  requeued: number;
  failed: string[];
  remaining: number;
  elapsedMs: number;
  since: string;
  until: string;
}): VNode {
  const { jobId, phase, total, requeued, failed, remaining, elapsedMs, since, until } = props;
  const processed = total - remaining;
  const pct = total === 0 ? 0 : Math.round((processed / total) * 100);
  const elapsedSec = Math.round(elapsedMs / 1000);

  if (phase === "pending") {
    return (
      <div style="padding:14px 16px;border:1px solid var(--accent);border-radius:6px;background:var(--bg);">
        <div style="font-size:12px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">
          Scan complete — confirm to re-trigger
        </div>
        <div style="font-size:12px;color:var(--text-bright);margin-bottom:4px;">
          <strong>{total}</strong> drained audit(s) found with startedAt between {since} and {until}.
        </div>
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:12px;">
          Clicking the button below re-publishes step-init for each. QStash queue parallelism
          throttles the resulting load — audits flow through transcribe → prepare → ask-all
          → finalize at the same rate as normal traffic. The finding doc, transcript, and
          audit-job are reused; same findingId.
        </div>
        <div style="display:flex;gap:8px;">
          <button
            class="sf-btn primary"
            style="padding:8px 16px;font-size:11px;"
            hx-post={`/api/admin/modal/maintenance/retrigger-start?jobId=${jobId}`}
            hx-target="#cleanup-msg"
            hx-swap="innerHTML"
            hx-confirm={`Re-trigger ${total} audit(s) via step-init? Cannot be cancelled once started.`}
          >Re-trigger {total} audit{total === 1 ? "" : "s"}</button>
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

  const done = phase === "done";
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
          {processed} / {total} ({pct}%) · {elapsedSec}s
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
