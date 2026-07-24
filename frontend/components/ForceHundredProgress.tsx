/** Progress + result fragment for the "Force to 100%" tool.
 *
 *  Rendered by /force-hundred-start (initial) and /force-hundred-tick (per
 *  batch), straight from the backend snapshot. Self-replaces via HTMX: while
 *  not done it re-triggers the next batch; when done the trigger is dropped and
 *  this becomes the terminal result card. Mirrors GenieRetryProgress but
 *  simpler — flipping is instant, so there is no in-flight state. */

import type { VNode } from "preact";
import { type ForceHundredSnapshot, processedCount } from "../lib/force-hundred.ts";

function fmtDate(ms?: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "short", timeStyle: "short" });
}

function fmtElapsed(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, "0")}s`;
}

function Stat(props: { dot: string; label: string; value: number; hint?: string }): VNode {
  return (
    <div style="display:flex;flex-direction:column;gap:2px;min-width:100px;">
      <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.4px;">
        <span style={`color:${props.dot};`}>●</span> {props.label}
      </div>
      <div style="font-size:18px;font-weight:700;color:var(--text-bright);font-family:var(--mono);line-height:1.1;">
        {props.value}
      </div>
      {props.hint && <div style="font-size:9px;color:var(--text-dim);">{props.hint}</div>}
    </div>
  );
}

export function ForceHundredProgress(props: {
  snap: ForceHundredSnapshot;
  elapsedMs: number;
}): VNode {
  const { snap, elapsedMs } = props;
  const done = snap.done;
  const processed = processedCount(snap);
  const progress = snap.total === 0 ? 100 : Math.round((processed / snap.total) * 100);

  const accent = !done ? "var(--text-bright)" : snap.failed > 0 ? "var(--yellow)" : "var(--green)";
  const headerLabel = !done
    ? "Forcing audits to 100%…"
    : snap.failed > 0
    ? `Done — ${snap.flipped} flipped, ${snap.failed} couldn't`
    : `✓ Flipped ${snap.flipped} audit${snap.flipped === 1 ? "" : "s"} to 100%`;

  return (
    <div
      {...(done
        ? {}
        : {
          "hx-post": `/api/admin/modal/maintenance/force-hundred-tick?jobId=${snap.jobId}`,
          "hx-target": "#force-hundred-msg",
          "hx-swap": "innerHTML",
          "hx-trigger": "load delay:800ms",
        })}
      style={`padding:14px 16px;border:1px solid ${done ? accent : "var(--border)"};border-radius:6px;background:var(--bg);`}
    >
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px;gap:12px;">
        <div style={`font-size:12px;font-weight:700;color:${accent};text-transform:uppercase;letter-spacing:0.5px;`}>
          {headerLabel}
        </div>
        <div style="font-size:11px;color:var(--text-dim);font-family:var(--mono);white-space:nowrap;">
          {processed} / {snap.total} ({progress}%) · {fmtElapsed(elapsedMs)}
        </div>
      </div>

      <div style="height:6px;background:var(--bg-raised);border-radius:3px;overflow:hidden;margin-bottom:14px;">
        <div style={`height:100%;width:${progress}%;background:${done ? accent : "var(--accent)"};transition:width 300ms linear;`}></div>
      </div>

      <div style="display:flex;gap:22px;flex-wrap:wrap;">
        <Stat dot="var(--text-dim)" label="Found" value={snap.total} hint={snap.pendingCount > 0 ? `${snap.pendingCount} to go` : undefined} />
        <Stat dot="var(--green)" label="Flipped to 100%" value={snap.flipped} />
        {snap.failed > 0 && <Stat dot="var(--red)" label="Couldn't flip" value={snap.failed} />}
      </div>

      {!done && (
        <div style="font-size:10px;color:var(--text-dim);margin-top:12px;line-height:1.4;">
          Each audit's answers are set to Yes, its score to 100%, and its 0% chargeback/wire rows are dropped
          — the same result as a reviewer flipping it. The run is on the server, so you can close this modal
          and re-open the tool to check back in.
        </div>
      )}

      {done && snap.results.length > 0 && (
        <>
          <div style="margin-top:14px;max-height:280px;overflow:auto;border:1px solid var(--border);border-radius:4px;">
            <table style="width:100%;border-collapse:collapse;font-size:11px;">
              <thead>
                <tr style="position:sticky;top:0;background:var(--bg-raised);">
                  <th style="text-align:left;padding:6px 8px;color:var(--text-dim);font-weight:600;">Finding</th>
                  <th style="text-align:left;padding:6px 8px;color:var(--text-dim);font-weight:600;">Record</th>
                  <th style="text-align:left;padding:6px 8px;color:var(--text-dim);font-weight:600;">Genie</th>
                  <th style="text-align:left;padding:6px 8px;color:var(--text-dim);font-weight:600;">Team member</th>
                  <th style="text-align:left;padding:6px 8px;color:var(--text-dim);font-weight:600;">Was failed</th>
                  <th style="text-align:left;padding:6px 8px;color:var(--text-dim);font-weight:600;">Result</th>
                </tr>
              </thead>
              <tbody>
                {snap.results.map((r) => (
                  <tr key={r.findingId} style="border-top:1px solid var(--border);">
                    <td style="padding:5px 8px;font-family:var(--mono);">
                      <a href={`/audit/report?id=${encodeURIComponent(r.findingId)}`} target="_blank" style="color:var(--blue);text-decoration:none;">{r.findingId}</a>
                    </td>
                    <td style="padding:5px 8px;color:var(--text-dim);font-family:var(--mono);">{r.recordId ?? "—"}</td>
                    <td style="padding:5px 8px;color:var(--text-dim);font-family:var(--mono);">{r.recordingId ?? "—"}</td>
                    <td style="padding:5px 8px;color:var(--text-dim);">{r.voName ?? "—"}</td>
                    <td style="padding:5px 8px;color:var(--text-dim);">{fmtDate(r.completedAt)}</td>
                    <td style={`padding:5px 8px;color:${r.ok ? "var(--green)" : "var(--red)"};`}>{r.ok ? "→ 100%" : "Failed"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {snap.results.length >= 500 && (
            <div style="font-size:10px;color:var(--text-dim);margin-top:6px;">
              Table caps at 500 rows — the counters above cover the whole run.
            </div>
          )}
        </>
      )}

      {done && (
        <div style="font-size:10px;color:var(--text-dim);margin-top:10px;line-height:1.4;">
          These now read as 100% reviewed passes and are out of the failure reports and payroll deductions.
          {snap.failed > 0 ? " The ones that couldn't flip are usually already-deleted audits — re-run to retry them." : ""}
        </div>
      )}
    </div>
  );
}
