/** "Genie Retry" bulk re-run — per-poll worker.
 *
 *  One tick does three things, in this order:
 *    1. POLL   the in-flight audits and retire the ones that reached a verdict
 *              (or that have been waiting past STALL_TIMEOUT_MS).
 *    2. TOP UP the in-flight set back to MAX_IN_FLIGHT from the pending queue,
 *              requeueing exactly as many as just freed up.
 *    3. RENDER the progress fragment, which self-triggers the next tick.
 *
 *  Polling BEFORE topping up is what makes the concurrency gate real: slots are
 *  only handed out to audits that are genuinely finished. */

import { define } from "../../../../../lib/define.ts";
import { apiPost } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import {
  deleteGenieRetryJob,
  getGenieRetryJob,
  isDone,
  MAX_IN_FLIGHT,
  MAX_TRACKED_RESULTS,
  processedCount,
  STALL_TIMEOUT_MS,
  type GenieRetryJob,
  type GenieRetryResult,
} from "../../../../../lib/genie-retry-job-store.ts";
import { GenieRetryProgress } from "../../../../../components/GenieRetryProgress.tsx";

interface Outcome {
  findingId: string;
  state: "running" | "valid" | "invalid" | "missing";
  score?: number;
  transcriptChars?: number;
}
interface StatusResp { ok?: boolean; outcomes?: Outcome[]; error?: string }
interface RequeueResp { ok?: boolean; requeued?: string[]; failed?: string[]; error?: string }

/** Record a terminal verdict: bump its counter and keep a capped result row. */
function retire(job: GenieRetryJob, result: GenieRetryResult): void {
  job.inFlight.delete(result.findingId);
  if (result.state === "valid") job.valid++;
  else if (result.state === "invalid") job.invalid++;
  else if (result.state === "missing") job.missing++;
  else job.stalled++;
  if (job.results.length < MAX_TRACKED_RESULTS) job.results.push(result);
}

export const handler = define.handlers({
  async POST(ctx) {
    const url = new URL(ctx.req.url);
    const jobId = url.searchParams.get("jobId") ?? "";
    const job = getGenieRetryJob(jobId);
    if (!job) {
      return new Response(
        renderToString(
          <div class="error-text" style="font-size:11px;padding:10px;border:1px solid var(--red);border-radius:6px;">
            Genie Retry job not found (likely an isolate restart). Audits already re-queued keep running on
            their own — re-run the tool on the same window to pick up whatever is still invalid.
          </div>,
        ),
        { headers: { "content-type": "text/html" } },
      );
    }

    // ── 1. Poll the in-flight audits ────────────────────────────────────────
    if (job.inFlight.size > 0) {
      const watching = [...job.inFlight.keys()];
      let s: StatusResp;
      try {
        s = await apiPost<StatusResp>("/admin/genie-retry-status", ctx.req, { fids: watching });
      } catch (err) {
        // Treat a failed poll as "still running" — the next tick re-asks. Never
        // turn a transient read error into a verdict.
        console.warn(`⚠️ [GENIE-RETRY-TICK] jobId=${jobId} status poll failed:`, err);
        s = {};
      }
      for (const o of s.outcomes ?? []) {
        if (o.state === "running") continue;
        retire(job, { findingId: o.findingId, state: o.state, score: o.score, transcriptChars: o.transcriptChars });
      }
      // Anything still in flight past the timeout gets its slot back so one
      // wedged audit can't hold the whole run hostage. It is reported as
      // stalled, not silently dropped.
      const now = Date.now();
      for (const [fid, startedAt] of [...job.inFlight.entries()]) {
        if (now - startedAt < STALL_TIMEOUT_MS) continue;
        console.warn(`⚠️ [GENIE-RETRY-TICK] jobId=${jobId} fid=${fid} stalled after ${Math.round((now - startedAt) / 60000)}m — freeing slot`);
        retire(job, { findingId: fid, state: "stalled" });
      }
    }

    // ── 2. Top the in-flight set back up ────────────────────────────────────
    const slots = MAX_IN_FLIGHT - job.inFlight.size;
    if (slots > 0 && job.pending.length > 0) {
      const batch = job.pending.splice(0, slots);
      let r: RequeueResp;
      try {
        r = await apiPost<RequeueResp>("/admin/genie-retry-requeue", ctx.req, { fids: batch });
      } catch (err) {
        console.warn(`⚠️ [GENIE-RETRY-TICK] jobId=${jobId} requeue failed:`, err);
        r = { failed: batch };
      }
      const startedAt = Date.now();
      for (const fid of r.requeued ?? []) {
        job.inFlight.set(fid, startedAt);
        job.queued++;
      }
      // A finding that couldn't be re-queued never enters the in-flight set, so
      // it can't be polled — count it terminally here or the run never ends.
      for (const fid of r.failed ?? []) job.failed++;
    }

    const done = isDone(job);
    const elapsedMs = Date.now() - job.startedAt;
    console.log(`📊 [GENIE-RETRY-TICK] jobId=${jobId} queued=${job.queued} inFlight=${job.inFlight.size} pending=${job.pending.length} valid=${job.valid} invalid=${job.invalid} stalled=${job.stalled} failed=${job.failed}`);

    const fragment = renderToString(
      <GenieRetryProgress jobId={jobId} job={job} done={done} elapsedMs={elapsedMs} />,
    );
    if (done) {
      console.log(`✅ [GENIE-RETRY-TICK] jobId=${jobId} DONE total=${job.total} processed=${processedCount(job)} valid=${job.valid} invalid=${job.invalid} elapsed=${Math.round(elapsedMs / 1000)}s`);
      deleteGenieRetryJob(jobId);
    }
    return new Response(fragment, { headers: { "content-type": "text/html" } });
  },
});
