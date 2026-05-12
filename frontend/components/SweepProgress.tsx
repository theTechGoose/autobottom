/** Progress fragment for the chunked Cleanup → Run Sweep flow.
 *
 *  Rendered by both /api/admin/modal/maintenance/sweep-start (initial
 *  state) and /sweep-tick (per-batch updates). Self-replaces via HTMX:
 *  when done=false, auto-triggers /sweep-tick after a short delay; when
 *  done=true, the trigger is dropped so this becomes terminal.
 *
 *  Mirrors components/FlipProgress.tsx — keep the two in sync if you
 *  redesign one. */

import type { VNode } from "preact";

export function SweepProgress(props: {
  jobId: string;
  total: number;
  swept: number;
  healthy: number;
  missing: number;
  drained: string[];
  remaining: number;
  done: boolean;
  elapsedMs: number;
}): VNode {
  const { jobId, total, swept, healthy, missing, drained, remaining, done, elapsedMs } = props;
  const processed = total - remaining;
  const pct = total === 0 ? 100 : Math.round((processed / total) * 100);
  const elapsedSec = Math.round(elapsedMs / 1000);
  const headerColor = done ? "var(--green)" : "var(--text-bright)";
  const headerLabel = done ? "Sweep complete" : "Sweeping…";

  return (
    <div
      {...(done
        ? {}
        : {
          "hx-post": `/api/admin/modal/maintenance/sweep-tick?jobId=${jobId}`,
          "hx-target": "#cleanup-msg",
          "hx-swap": "innerHTML",
          "hx-trigger": "load delay:200ms",
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
        <div style={`height:100%;width:${pct}%;background:${done ? "var(--green)" : "var(--accent)"};transition:width 200ms linear;`}></div>
      </div>

      <div style="font-size:11px;color:var(--text-dim);display:flex;gap:14px;flex-wrap:wrap;">
        <span><span style="color:var(--green);">●</span> Swept (drained): <strong style="color:var(--text-bright);">{swept}</strong></span>
        <span><span style="color:var(--blue);">●</span> Healthy: <strong style="color:var(--text-bright);">{healthy}</strong></span>
        {missing > 0 && (
          <span><span style="color:var(--yellow);">●</span> Missing findings: <strong style="color:var(--text-bright);">{missing}</strong></span>
        )}
        {!done && (
          <span><span style="color:var(--text-dim);">●</span> Remaining: <strong style="color:var(--text-bright);">{remaining}</strong></span>
        )}
      </div>

      {done && drained.length > 0 && (
        <details style="margin-top:10px;font-size:11px;">
          <summary style="cursor:pointer;color:var(--text-bright);">Show {drained.length} drained finding ID(s)</summary>
          <pre style="margin-top:6px;padding:8px;background:var(--bg-raised);border-radius:4px;font-size:10px;max-height:200px;overflow:auto;color:var(--text-dim);">
            {drained.join("\n")}
          </pre>
        </details>
      )}
    </div>
  );
}
