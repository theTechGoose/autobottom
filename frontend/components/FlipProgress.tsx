/** Progress fragment for the chunked bulk-flip flow.
 *
 *  Rendered by both /api/admin/modal/maintenance/flip-start (initial
 *  state) and /api/admin/modal/maintenance/flip-tick (per-batch updates)
 *  so the visual stays consistent through the entire run. Self-replaces
 *  via HTMX: when done=false, the fragment auto-triggers /flip-tick with
 *  a short delay; when done=true, the trigger is dropped so this
 *  fragment becomes terminal. The outer Pull Unreviewed form refreshes
 *  via the `flip-complete` event sent in the final tick's HX-Trigger
 *  response header. */

import type { VNode } from "preact";

export function FlipProgress(props: {
  jobId: string;
  total: number;
  flipped: number;
  failed: string[];
  done: boolean;
  elapsedMs: number;
}): VNode {
  const { jobId, total, flipped, failed, done, elapsedMs } = props;
  const processed = flipped + failed.length;
  const remaining = Math.max(0, total - processed);
  const pct = total === 0 ? 0 : Math.round((processed / total) * 100);
  const elapsedSec = Math.round(elapsedMs / 1000);

  return (
    <div
      {...(done
        ? {}
        : {
          "hx-post": `/api/admin/modal/maintenance/flip-tick?jobId=${jobId}`,
          "hx-target": "#flip-results",
          "hx-swap": "innerHTML",
          "hx-trigger": "load delay:200ms",
        })}
      style={`padding:14px 16px;border:1px solid ${done && failed.length === 0 ? "var(--green)" : done ? "var(--yellow)" : "var(--border)"};border-radius:6px;background:var(--bg);`}
    >
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px;">
        <div style={`font-size:12px;font-weight:700;color:${done && failed.length === 0 ? "var(--green)" : done ? "var(--yellow)" : "var(--text-bright)"};text-transform:uppercase;letter-spacing:0.5px;`}>
          {done ? (failed.length === 0 ? "Flip complete" : "Flip complete (with failures)") : "Flipping…"}
        </div>
        <div style="font-size:11px;color:var(--text-dim);font-family:var(--mono);">
          {processed} / {total} ({pct}%) · {elapsedSec}s
        </div>
      </div>

      <div style="height:6px;background:var(--bg-raised);border-radius:3px;overflow:hidden;margin-bottom:10px;">
        <div style={`height:100%;width:${pct}%;background:${done && failed.length === 0 ? "var(--green)" : done ? "var(--yellow)" : "var(--accent)"};transition:width 200ms linear;`}></div>
      </div>

      <div style="font-size:11px;color:var(--text-dim);display:flex;gap:14px;flex-wrap:wrap;">
        <span><span style="color:var(--green);">●</span> Flipped: <strong style="color:var(--text-bright);">{flipped}</strong></span>
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
          <pre style="margin-top:6px;padding:8px;background:var(--bg-raised);border-radius:4px;font-size:10px;max-height:120px;overflow:auto;color:var(--text-dim);">
            {failed.join("\n")}
          </pre>
        </details>
      )}

      {done && (
        <div style="margin-top:10px;font-size:10px;color:var(--text-dim);">
          Table refreshing automatically…
        </div>
      )}
    </div>
  );
}
