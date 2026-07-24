/** Progress + result fragment for the "Genie Retry" bulk re-run.
 *
 *  Rendered by /genie-retry-start (initial) and /genie-retry-tick (per poll).
 *  Self-replaces via HTMX: while done=false it re-triggers the next tick; when
 *  done=true the trigger is dropped and this becomes the terminal result card.
 *  Mirrors components/TranscriptRepairProgress.tsx.
 *
 *  The bar tracks VERDICTS, not requeues — an audit only counts as processed
 *  once the pipeline has finished with it, so the bar reflects real work done
 *  rather than messages posted to a queue. */

import type { VNode } from "preact";
import {
  type GenieRetryJob,
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
  jobId: string;
  job: GenieRetryJob;
  done: boolean;
  elapsedMs: number;
}): VNode {
  const { jobId, job, done, elapsedMs } = props;
  const processed = processedCount(job);
  const progress = job.total === 0 ? 100 : Math.round((processed / job.total) * 100);
  const recovered = job.valid > 0;

  const accent = !done ? "var(--text-bright)" : recovered ? "var(--green)" : "var(--yellow)";
  const headerLabel = !done
    ? `Re-running audits… ${job.inFlight.size} in flight`
    : recovered
    ? `✓ Recovered ${job.valid} audit${job.valid === 1 ? "" : "s"}`
    : "Finished — no recordings recovered";

  return (
    <div
      {...(done
        ? {}
        : {
          // 4s between polls: an audit takes a minute or two, so anything
          // faster is just Firestore reads that can't have changed yet.
          "hx-post": `/api/admin/modal/maintenance/genie-retry-tick?jobId=${jobId}`,
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
          {processed} / {job.total} ({progress}%) · {fmtElapsed(elapsedMs)}
        </div>
      </div>

      <div style="height:6px;background:var(--bg-raised);border-radius:3px;overflow:hidden;margin-bottom:14px;">
        <div style={`height:100%;width:${progress}%;background:${done ? accent : "var(--accent)"};transition:width 400ms linear;`}></div>
      </div>

      <div style="display:flex;gap:20px;flex-wrap:wrap;">
        <Stat
          dot="var(--blue)"
          label="Queued"
          value={job.queued}
          hint={job.pending.length > 0 ? `${job.pending.length} waiting` : undefined}
        />
        <Stat
          dot="var(--text-dim)"
          label="Ran through"
          value={processed}
          hint={job.inFlight.size > 0 ? `${job.inFlight.size} in flight` : undefined}
        />
        <Stat dot="var(--green)" label="Genie valid" value={job.valid} hint="recording found" />
        <Stat dot="var(--red)" label="Still invalid" value={job.invalid} hint="no recording" />
        {job.stalled > 0 && <Stat dot="var(--yellow)" label="Stalled" value={job.stalled} hint="gave up waiting" />}
        {job.missing > 0 && <Stat dot="var(--yellow)" label="Missing" value={job.missing} hint="audit deleted" />}
        {job.failed > 0 && <Stat dot="var(--red)" label="Failed" value={job.failed} hint="never queued" />}
      </div>

      {!done && (
        <div style="font-size:10px;color:var(--text-dim);margin-top:12px;line-height:1.4;">
          Running {MAX_IN_FLIGHT} at a time — each audit downloads, transcribes, and re-grades, so expect
          roughly a minute or two per audit. Keep this modal open; closing it stops the re-queueing (audits
          already in flight still finish on their own).
        </div>
      )}

      {done && job.results.length > 0 && (
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
                {job.results.map((r) => {
                  const m = job.meta.get(r.findingId);
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
                      <td style="padding:5px 8px;color:var(--text-dim);font-family:var(--mono);">{m?.recordId ?? "—"}</td>
                      <td style="padding:5px 8px;color:var(--text-dim);font-family:var(--mono);">{m?.recordingId ?? "—"}</td>
                      <td style="padding:5px 8px;color:var(--text-dim);">{m?.voName ?? "—"}</td>
                      <td style="padding:5px 8px;color:var(--text-dim);">{fmtDate(m?.completedAt)}</td>
                      <td style={`padding:5px 8px;color:${color};`}>{label}</td>
                      <td style="padding:5px 8px;text-align:right;color:var(--text-bright);">{r.score == null ? "—" : `${r.score}%`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {job.results.length >= 500 && (
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
