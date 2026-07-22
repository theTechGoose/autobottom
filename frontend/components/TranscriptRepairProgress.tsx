/** Progress + result fragment for the chunked "Transcript Repair" flow.
 *
 *  Rendered by /transcript-repair-start (initial) and /transcript-repair-tick
 *  (per-batch). Self-replaces via HTMX: while done=false it auto-triggers the
 *  next tick; when done=true the trigger is dropped and this becomes the
 *  terminal result card. Mirrors components/ChargebackBackfillProgress.tsx.
 *
 *  In `scan` mode the terminal card grows the two things the operator actually
 *  needs: the table of impacted audits (including who already reviewed one off
 *  the bad text) and a "Repair" button — so counting and changing stay two
 *  deliberate, separate actions. */

import type { VNode } from "preact";
import type { TranscriptRepairJob } from "../lib/transcript-repair-job-store.ts";

function fmtDate(ms?: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "short", timeStyle: "short" });
}

function pct(n?: number): string {
  return n == null ? "—" : `${Math.round(n * 100)}%`;
}

export function TranscriptRepairProgress(props: {
  jobId: string;
  job: TranscriptRepairJob;
  done: boolean;
  elapsedMs: number;
}): VNode {
  const { jobId, job, done, elapsedMs } = props;
  const isScan = job.mode === "scan";
  const processed = job.total - job.remaining.length;
  const progress = job.total === 0 ? 100 : Math.round((processed / job.total) * 100);
  const elapsedSec = Math.round(elapsedMs / 1000);
  const nothingFound = done && job.contaminated === 0;

  const accent = nothingFound ? "var(--green)" : done ? (isScan ? "var(--yellow)" : "var(--green)") : "var(--text-bright)";
  const headerLabel = !done
    ? (isScan ? "Scanning transcripts…" : "Repairing transcripts…")
    : nothingFound
    ? "✓ No contaminated transcripts in this window"
    : isScan
    ? `⚠ ${job.contaminated} contaminated transcript${job.contaminated === 1 ? "" : "s"} found`
    : `✓ Repaired ${job.repaired} transcript${job.repaired === 1 ? "" : "s"}`;

  const reviewedImpacted = job.contaminatedFids.filter((f) => job.meta.get(f)?.reviewedBy);

  return (
    <div
      {...(done
        ? {}
        : {
          "hx-post": `/api/admin/modal/maintenance/transcript-repair-tick?jobId=${jobId}`,
          "hx-target": "#transcript-repair-msg",
          "hx-swap": "innerHTML",
          "hx-trigger": "load delay:300ms",
        })}
      style={`padding:14px 16px;border:1px solid ${done && !nothingFound && isScan ? "var(--yellow)" : done ? "var(--green)" : "var(--border)"};border-radius:6px;background:var(--bg);`}
    >
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px;gap:12px;">
        <div style={`font-size:12px;font-weight:700;color:${accent};text-transform:uppercase;letter-spacing:0.5px;`}>
          {headerLabel}
        </div>
        <div style="font-size:11px;color:var(--text-dim);font-family:var(--mono);white-space:nowrap;">
          {processed} / {job.total} ({progress}%) · {elapsedSec}s
        </div>
      </div>

      <div style="height:6px;background:var(--bg-raised);border-radius:3px;overflow:hidden;margin-bottom:10px;">
        <div style={`height:100%;width:${progress}%;background:${done ? accent : "var(--accent)"};transition:width 300ms linear;`}></div>
      </div>

      <div style="font-size:11px;color:var(--text-dim);display:flex;gap:14px;flex-wrap:wrap;">
        <span><span style="color:var(--text-dim);">●</span> Scanned: <strong style="color:var(--text-bright);">{job.scanned}</strong></span>
        <span><span style="color:var(--green);">●</span> Clean: <strong style="color:var(--text-bright);">{job.clean}</strong></span>
        <span><span style="color:var(--red);">●</span> Contaminated: <strong style="color:var(--text-bright);">{job.contaminated}</strong></span>
        {job.contaminated > 0 && (
          <span style="color:var(--text-dim);">
            (fence-salvage {job.fenced} · line-filter {job.filtered} · unsalvageable {job.reverted})
          </span>
        )}
        {!isScan && <span><span style="color:var(--blue);">●</span> Repaired: <strong style="color:var(--text-bright);">{job.repaired}</strong></span>}
        {job.missing > 0 && <span style="color:var(--text-dim);">No transcript: {job.missing}</span>}
        {job.errors > 0 && <span style="color:var(--red);">Errors: {job.errors}</span>}
        {!done && <span><span style="color:var(--text-dim);">●</span> Remaining: <strong style="color:var(--text-bright);">{job.remaining.length}</strong></span>}
      </div>

      {done && job.contaminated > 0 && (
        <>
          {reviewedImpacted.length > 0 && (
            <div style="margin-top:12px;padding:8px 12px;border:1px solid var(--yellow);border-radius:4px;background:var(--bg-2);font-size:11px;color:var(--text-dim);line-height:1.5;">
              <strong style="color:var(--yellow);">{reviewedImpacted.length}</strong> of these were already
              reviewed by a human, who was looking at the contaminated text when they graded. Repairing fixes
              the record; whether those verdicts need a second look is a judgement call — the reviewer and
              score are in the table below.
            </div>
          )}

          <div style="margin-top:12px;max-height:260px;overflow:auto;border:1px solid var(--border);border-radius:4px;">
            <table style="width:100%;border-collapse:collapse;font-size:11px;">
              <thead>
                <tr style="position:sticky;top:0;background:var(--bg-raised);">
                  <th style="text-align:left;padding:6px 8px;color:var(--text-dim);font-weight:600;">Finding</th>
                  <th style="text-align:left;padding:6px 8px;color:var(--text-dim);font-weight:600;">Completed (ET)</th>
                  <th style="text-align:left;padding:6px 8px;color:var(--text-dim);font-weight:600;">Team member</th>
                  <th style="text-align:right;padding:6px 8px;color:var(--text-dim);font-weight:600;">Score</th>
                  <th style="text-align:left;padding:6px 8px;color:var(--text-dim);font-weight:600;">Reviewed by</th>
                </tr>
              </thead>
              <tbody>
                {job.contaminatedFids.map((fid) => {
                  const m = job.meta.get(fid);
                  return (
                    <tr key={fid} style="border-top:1px solid var(--border);">
                      <td style="padding:5px 8px;font-family:var(--mono);">
                        <a href={`/audit/report?id=${encodeURIComponent(fid)}`} target="_blank" style="color:var(--blue);text-decoration:none;">{fid}</a>
                      </td>
                      <td style="padding:5px 8px;color:var(--text-dim);">{fmtDate(m?.completedAt)}</td>
                      <td style="padding:5px 8px;color:var(--text-dim);">{m?.voName ?? "—"}</td>
                      <td style="padding:5px 8px;text-align:right;color:var(--text-bright);">{m?.score == null ? "—" : `${m.score}%`}</td>
                      <td style={`padding:5px 8px;color:${m?.reviewedBy ? "var(--yellow)" : "var(--text-dim)"};`}>{m?.reviewedBy ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {job.samples.length > 0 && (
            <details style="margin-top:10px;">
              <summary style="cursor:pointer;font-size:11px;color:var(--text-dim);">
                Show what was stored ({job.samples.length} sample{job.samples.length === 1 ? "" : "s"}) — eyeball before repairing
              </summary>
              {job.samples.map((s) => (
                <div key={s.findingId} style="margin-top:8px;border:1px solid var(--border);border-radius:4px;padding:8px;">
                  <div style="font-size:10px;color:var(--text-dim);font-family:var(--mono);margin-bottom:6px;">
                    {s.findingId} · {s.method} · {s.storedLen} → {s.repairedLen} chars · fidelity {pct(s.precision)} precision / {pct(s.recall)} recall
                  </div>
                  <pre style="margin:0;font-size:10px;line-height:1.4;color:var(--text-dim);white-space:pre-wrap;word-break:break-word;max-height:220px;overflow:auto;">{s.excerpt}</pre>
                </div>
              ))}
            </details>
          )}

          {isScan && (
            <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border);display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
              <button
                class="sf-btn primary"
                style="padding:8px 16px;"
                hx-post="/api/admin/modal/maintenance/transcript-repair-start"
                hx-vals={JSON.stringify({ mode: "repair", sinceMs: String(job.since), untilMs: String(job.until) })}
                hx-target="#transcript-repair-msg"
                hx-swap="innerHTML"
                hx-confirm={`Repair ${job.contaminated} contaminated transcript${job.contaminated === 1 ? "" : "s"}? The commentary is stripped and the speaker turns kept (or the raw transcript restored when nothing is salvageable). Idempotent — safe to re-run.`}
              >Repair {job.contaminated} impacted</button>
              <span style="font-size:10px;color:var(--text-dim);">
                Re-scans the same window and writes only the contaminated rows. The raw transcript is never touched.
              </span>
            </div>
          )}
        </>
      )}

      {done && !isScan && (
        <div style="font-size:10px;color:var(--text-dim);margin-top:10px;line-height:1.4;">
          Re-run the Scan to confirm the window now reports 0 contaminated. Reports and queues also sanitize
          on read, so any row this sweep can't reach still renders clean.
        </div>
      )}
    </div>
  );
}
