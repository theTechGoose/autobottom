/** Chunked Cleanup re-trigger — scan tick.
 *
 *  Pops the next 25 fids off job.scanRemaining, posts them to backend
 *  /admin/check-fids-for-retrigger (date+status check per fid), updates
 *  counters, re-renders RetriggerProgress. When scanRemaining is empty,
 *  transitions the job to "pending" so the operator sees the count and
 *  the Re-trigger / Cancel buttons. */

import { define } from "../../../../../lib/define.ts";
import { apiPost } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import type { VNode } from "preact";
import { getRetriggerJob } from "../../../../../lib/retrigger-job-store.ts";
import { RetriggerProgress } from "../../../../../components/RetriggerProgress.tsx";

const BATCH_SIZE = 25;

interface CheckResp {
  ok?: boolean;
  matches?: string[];
  outOfRange?: number;
  finished?: number;
  missing?: number;
  error?: string;
}

export const handler = define.handlers({
  async POST(ctx) {
    const url = new URL(ctx.req.url);
    const jobId = url.searchParams.get("jobId") ?? "";
    const job = getRetriggerJob(jobId);
    if (!job) {
      return new Response(
        renderToString(
          <div class="error-text" style="font-size:11px;padding:10px;border:1px solid var(--red);border-radius:6px;">
            Re-trigger job not found (likely an isolate restart). Re-paste to start over.
          </div>,
        ),
        { headers: { "content-type": "text/html" } },
      );
    }

    const batch = job.scanRemaining.splice(0, BATCH_SIZE);
    if (batch.length > 0) {
      let r: CheckResp;
      try {
        r = await apiPost<CheckResp>("/admin/check-fids-for-retrigger", ctx.req, {
          fids: batch,
          sinceMs: job.sinceMs,
          untilMs: job.untilMs,
        });
      } catch (err) {
        console.warn(`⚠️ [RETRIGGER-SCAN-TICK] jobId=${jobId} batch failed:`, err);
        r = {};
      }
      if (Array.isArray(r.matches)) job.matches.push(...r.matches);
      job.rejectedFinished += r.finished ?? 0;
      job.rejectedOutOfRange += r.outOfRange ?? 0;
      job.rejectedMissing += r.missing ?? 0;
      console.log(`📊 [RETRIGGER-SCAN-TICK] jobId=${jobId} batch=${batch.length} matched=${job.matches.length} finished=${job.rejectedFinished} outOfRange=${job.rejectedOutOfRange} missing=${job.rejectedMissing} remaining=${job.scanRemaining.length}`);
    }

    const done = job.scanRemaining.length === 0;
    if (done) job.phase = "pending";
    const elapsedMs = Date.now() - job.startedAt;
    const scanned = job.allFids.length - job.scanRemaining.length;

    const fragment = renderToString(
      <RetriggerProgress
        jobId={jobId}
        phase={job.phase}
        total={job.allFids.length}
        scanned={scanned}
        matched={job.matches.length}
        rejectedFinished={job.rejectedFinished}
        rejectedOutOfRange={job.rejectedOutOfRange}
        rejectedMissing={job.rejectedMissing}
        requeued={0}
        failed={[]}
        remaining={job.scanRemaining.length}
        elapsedMs={elapsedMs}
        since={new Date(job.sinceMs).toISOString().slice(0, 10)}
        until={new Date(job.untilMs).toISOString().slice(0, 10)}
      />,
    );
    return new Response(fragment, { headers: { "content-type": "text/html" } });
  },
});
