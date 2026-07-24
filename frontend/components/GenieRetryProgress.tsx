/** Progress + result fragment for the "Genie Retry" bulk re-run.
 *
 *  Rendered by /genie-retry-start (initial) and /genie-retry-tick (per poll),
 *  straight from the backend's snapshot — the frontend keeps no run state.
 *  Self-replaces via HTMX: while not done it re-triggers the next tick; when
 *  done the trigger is dropped and this becomes the terminal result card.
 *
 *  The bar tracks VERDICTS, not requeues — an audit counts as processed once
 *  the pipeline has finished with it, so the bar reflects real work done rather
 *  than messages posted to a queue. */

import type { VNode } from "preact";
import {
  type GenieRetrySnapshot,
  MAX_IN_FLIGHT,
  processedCount,
} from "../lib/genie-retry-job-store.ts";

function fmtDate(ms?: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "short", timeStyle: "short" });
}

function fmtElapsed(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, "0")}s`;
}

/** One counter chip. */
function Stat(props: { dot: string; label: string; value: number; hint?: string }): VNode {
  return (
    <div style="display:flex;flex-direction:column;gap:2px;min-width:96px;">
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

export function GenieRetryProgress(props: {
  snap: GenieRetrySnapshot;
  elapsedMs: number;
}): VNode {
  const { snap, elapsedMs } = props;
  const done = snap.done;
  const processed = processedCount(snap);
  const progress = snap.total === 0 ? 100 : Math.round((processed / snap.total) * 100);
  const recovered = snap.valid > 0;

  const accent = !done ? "var(--text-bright)" : recovered ? "var(--green)" : "var(--yellow)";
  const headerLabel = !done
    ? `Re-running audits… ${snap.inFlightCount} in flight`
    : recovered
    ? `✓ Recovered ${snap.valid} audit${snap.valid === 1 ? "" : "s"}`
    : "Finished — no recordings recovered";

  return (
    <div
      {...(done
        ? {}
        : {
          // 4s between polls: an audit takes a minute or two, so anything
          // faster is just Firestore reads that can't have changed yet.
          "hx-post": `/api/admin/modal/maintenance/genie-retry-tick?jobId=${snap.jobId}`,
          "hx-target": "#genie-retry-msg",
          "hx-swap": "innerHTML",
          "hx-trigger": "load delay:4s",
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
        <div style={`height:100%;width:${progress}%;background:${done ? accent : "var(--accent)"};transition:width 400ms linear;`}></div>
      </div>

      <div style="display:flex;gap:20px;flex-wrap:wrap;">
        <Stat
          dot="var(--blue)"
          label="Queued"
          value={snap.queued}
          hint={snap.pendingCount > 0 ? `${snap.pendingCount} waiting` : undefined}
        />
        <Stat
          dot="var(--text-dim)"
          label="Ran through"
          value={processed}
          hint={snap.inFlightCount > 0 ? `${snap.inFlightCount} in flight` : undefined}
        />
        <Stat dot="var(--green)" label="Genie valid" value={snap.valid} hint="recording found" />
        <Stat dot="var(--red)" label="Still invalid" value={snap.invalid} hint="no recording" />
        {snap.stalled > 0 && <Stat dot="var(--yellow)" label="Stalled" value={snap.stalled} hint="gave up waiting" />}
        {snap.missing > 0 && <Stat dot="var(--yellow)" label="Missing" value={snap.missing} hint="audit deleted" />}
        {snap.failed > 0 && <Stat dot="var(--red)" label="Failed" value={snap.failed} hint="never queued" />}
      </div>

      {!done && (
        <div style="font-size:10px;color:var(--text-dim);margin-top:12px;line-height:1.4;">
          Running {MAX_IN_FLIGHT} at a time — each audit downloads, transcribes, and re-grades, so expect
          roughly a minute or two per audit. The run lives on the server now, so you can safely close this
          modal and re-open the tool on the same window to check back in.
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
                  <th style="text-align:left;padding:6px 8px;color:var(--text-dim);font-weight:600;">Originally failed</th>
                  <th style="text-align:left;padding:6px 8px;color:var(--text-dim);font-weight:600;">Outcome</th>
                  <th style="text-align:right;padding:6px 8px;color:var(--text-dim);font-weight:600;">New score</th>
                </tr>
              </thead>
              <tbody>
                {snap.results.map((r) => {
                  const label = r.state === "valid"
                    ? "Recording found"
                    : r.state === "invalid"
                    ? "Still no recording"
                    : r.state === "stalled"
                    ? "Still running"
                    : "Audit missing";
                  const color = r.state === "valid"
                    ? "var(--green)"
                    : r.state === "invalid"
                    ? "var(--red)"
                    : "var(--yellow)";
                  return (
                    <tr key={r.findingId} style="border-top:1px solid var(--border);">
                      <td style="padding:5px 8px;font-family:var(--mono);">
                        <a href={`/audit/report?id=${encodeURIComponent(r.findingId)}`} target="_blank" style="color:var(--blue);text-decoration:none;">{r.findingId}</a>
                      </td>
                      <td style="padding:5px 8px;color:var(--text-dim);font-family:var(--mono);">{r.recordId ?? "—"}</td>
                      <td style="padding:5px 8px;color:var(--text-dim);font-family:var(--mono);">{r.recordingId ?? "—"}</td>
                      <td style="padding:5px 8px;color:var(--text-dim);">{r.voName ?? "—"}</td>
                      <td style="padding:5px 8px;color:var(--text-dim);">{fmtDate(r.completedAt)}</td>
                      <td style={`padding:5px 8px;color:${color};`}>{label}</td>
                      <td style="padding:5px 8px;text-align:right;color:var(--text-bright);">{r.score == null ? "—" : `${r.score}%`}</td>
                    </tr>
                  );
                })}
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
          Recovered audits are back in the normal flow — they re-entered the review queue (or auto-passed at
          100%) and their old 0% payroll rows were dropped at re-queue time. Anything still showing "no
          recording" really has no audio to find. Re-run this tool on the same window to retry those later.
        </div>
      )}
    </div>
  );
}
