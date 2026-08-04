/** Progress + result fragment for the chunked "Error-Answer Cleanup" flow.
 *
 *  Rendered by /error-flip-start (initial) and /error-flip-tick (per-batch).
 *  Self-replaces via HTMX: while done=false it auto-triggers the next tick; when
 *  done=true the trigger is dropped and this becomes the terminal result card.
 *  Mirrors components/TranscriptRepairProgress.tsx.
 *
 *  In `scan` mode the terminal card grows the two things the operator needs
 *  before writing: the table of impacted audits (flagging the ones a human
 *  already reviewed) and — because this tool forces the WHOLE audit to 100 —
 *  a prominent count of the genuine failures the flip will also erase. Then the
 *  Flip button, so counting and changing stay two deliberate, separate actions. */

import type { VNode } from "preact";
import type { ErrorFlipJob } from "../lib/error-flip-job-store.ts";

function fmtDate(ms?: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "short", timeStyle: "short" });
}

export function ErrorFlipProgress(props: {
  jobId: string;
  job: ErrorFlipJob;
  done: boolean;
  elapsedMs: number;
}): VNode {
  const { jobId, job, done, elapsedMs } = props;
  const isScan = job.mode === "scan";
  const processed = job.total - job.remaining.length;
  const progress = job.total === 0 ? 100 : Math.round((processed / job.total) * 100);
  const elapsedSec = Math.round(elapsedMs / 1000);
  const nothingFound = done && job.impacted === 0;

  const accent = nothingFound ? "var(--green)" : done ? (isScan ? "var(--yellow)" : "var(--green)") : "var(--text-bright)";
  const headerLabel = !done
    ? (isScan ? "Scanning for error answers…" : "Flipping audits to 100%…")
    : nothingFound
    ? "✓ No error answers in this window"
    : isScan
    ? `⚠ ${job.impacted} audit${job.impacted === 1 ? "" : "s"} with an error answer`
    : `✓ Flipped ${job.flipped} audit${job.flipped === 1 ? "" : "s"} to 100%`;

  const reviewedImpacted = job.impactedFids.filter((f) => job.meta.get(f)?.reviewedBy);

  return (
    <div
      {...(done
        ? {}
        : {
          "hx-post": `/api/admin/modal/maintenance/error-flip-tick?jobId=${jobId}`,
          "hx-target": "#error-flip-msg",
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
        <span><span style="color:var(--green);">●</span> No errors: <strong style="color:var(--text-bright);">{job.clean}</strong></span>
        <span><span style="color:var(--yellow);">●</span> With errors: <strong style="color:var(--text-bright);">{job.impacted}</strong></span>
        {job.impacted > 0 && (
          <span style="color:var(--text-dim);">({job.errorQuestions} ungraded question{job.errorQuestions === 1 ? "" : "s"})</span>
        )}
        {!isScan && <span><span style="color:var(--blue);">●</span> Flipped: <strong style="color:var(--text-bright);">{job.flipped}</strong></span>}
        {job.missing > 0 && <span style="color:var(--text-dim);">No answers: {job.missing}</span>}
        {job.errors > 0 && <span style="color:var(--red);">Errors: {job.errors}</span>}
        {!done && <span><span style="color:var(--text-dim);">●</span> Remaining: <strong style="color:var(--text-bright);">{job.remaining.length}</strong></span>}
      </div>

      {done && job.impacted > 0 && (
        <>
          {/* The cost of forcing the whole audit to 100. These are real "No"
              verdicts on the same audits — the flip turns them into passes and
              drops their payroll deduction rows. Shown before the button. */}
          {job.realFails > 0 && (
            <div style="margin-top:12px;padding:8px 12px;border:1px solid var(--red);border-radius:4px;background:var(--bg-2);font-size:11px;color:var(--text-dim);line-height:1.5;">
              These audits also carry <strong style="color:var(--red);">{job.realFails}</strong> genuine failed
              question{job.realFails === 1 ? "" : "s"} that the bot graded correctly. Flipping to 100% marks
              {job.realFails === 1 ? " it" : " them"} as passed too and removes those audits' payroll deduction
              rows. Only the {job.errorQuestions} ungraded question{job.errorQuestions === 1 ? "" : "s"}
              {job.errorQuestions === 1 ? " is" : " are"} a bot error.
            </div>
          )}

          {reviewedImpacted.length > 0 && (
            <div style="margin-top:10px;padding:8px 12px;border:1px solid var(--yellow);border-radius:4px;background:var(--bg-2);font-size:11px;color:var(--text-dim);line-height:1.5;">
              <strong style="color:var(--yellow);">{reviewedImpacted.length}</strong> of these were already
              reviewed by a human. Flipping overwrites their verdict and re-stamps the audit as reviewed by you.
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
                {job.impactedFids.map((fid) => {
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
                Show which questions errored ({job.samples.length} sample{job.samples.length === 1 ? "" : "s"})
              </summary>
              {job.samples.map((s) => (
                <div key={s.findingId} style="margin-top:8px;border:1px solid var(--border);border-radius:4px;padding:8px;">
                  <div style="font-size:10px;color:var(--text-dim);font-family:var(--mono);margin-bottom:6px;">
                    {s.findingId} · {s.errorCount} ungraded of {s.totalQuestions} · {s.realFailCount} genuine fail{s.realFailCount === 1 ? "" : "s"}
                  </div>
                  <ul style="margin:0;padding-left:16px;font-size:10px;line-height:1.5;color:var(--text-dim);">
                    {s.errorHeaders.map((h, i) => <li key={i}>{h}</li>)}
                  </ul>
                </div>
              ))}
            </details>
          )}

          {isScan && (
            <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border);display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
              <button
                class="sf-btn primary"
                style="padding:8px 16px;"
                hx-post="/api/admin/modal/maintenance/error-flip-start"
                hx-vals={JSON.stringify({ mode: "flip", sinceMs: String(job.since), untilMs: String(job.until) })}
                hx-target="#error-flip-msg"
                hx-swap="innerHTML"
                hx-confirm={`Force ${job.impacted} audit${job.impacted === 1 ? "" : "s"} to a 100% reviewed pass? This also passes ${job.realFails} genuine failed question${job.realFails === 1 ? "" : "s"} and drops those audits' payroll deduction rows. Attributed to you. Cannot be undone in bulk.`}
              >Flip {job.impacted} to 100%</button>
              <span style="font-size:10px;color:var(--text-dim);">
                Re-scans the same window and flips only the audits that still carry an error answer.
              </span>
            </div>
          )}
        </>
      )}

      {done && !isScan && (
        <div style="font-size:10px;color:var(--text-dim);margin-top:10px;line-height:1.4;">
          Re-run the Scan to confirm the window now reports 0. New audits can still hit the same Groq quota
          limit and produce fresh error answers, so this window can go non-zero again later.
        </div>
      )}
    </div>
  );
}
