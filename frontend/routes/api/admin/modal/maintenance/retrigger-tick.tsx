/** Chunked Cleanup re-trigger — per-batch worker.
 *
 *  Pops the next 25 fids off the running job, POSTs them to backend
 *  /admin/retrigger-fids-batch (which calls publishStep("init", ...) for
 *  each), updates the requeued/failed counters, and re-renders the
 *  RetriggerProgress fragment. Self-triggers until empty. */

import { define } from "../../../../../lib/define.ts";
import { apiPost } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import type { VNode } from "preact";
import { getRetriggerJob, deleteRetriggerJob } from "../../../../../lib/retrigger-job-store.ts";
import { RetriggerProgress } from "../../../../../components/RetriggerProgress.tsx";

const BATCH_SIZE = 25;

interface BatchResp { ok?: boolean; requeued?: number; failed?: string[]; error?: string }

export const handler = define.handlers({
  async POST(ctx) {
    const url = new URL(ctx.req.url);
    const jobId = url.searchParams.get("jobId") ?? "";
    const job = getRetriggerJob(jobId);
    if (!job) {
      return new Response(
        renderToString(
          <div class="error-text" style="font-size:11px;padding:10px;border:1px solid var(--red);border-radius:6px;">
            Re-trigger job not found (likely an isolate restart). Some fids may have already been re-queued. Re-scan to see what's left.
          </div>,
        ),
        { headers: { "content-type": "text/html" } },
      );
    }

    const batch = job.remaining.splice(0, BATCH_SIZE);
    if (batch.length > 0) {
      let r: BatchResp;
      try {
        r = await apiPost<BatchResp>("/admin/retrigger-fids-batch", ctx.req, { fids: batch });
      } catch (err) {
        console.warn(`⚠️ [RETRIGGER-TICK] jobId=${jobId} batch failed:`, err);
        r = { failed: batch };
      }
      job.requeued += r.requeued ?? 0;
      if (Array.isArray(r.failed)) job.failed.push(...r.failed);
      console.log(`📊 [RETRIGGER-TICK] jobId=${jobId} batch=${batch.length} requeued=${job.requeued} failed=${job.failed.length} remaining=${job.remaining.length}`);
    }

    const done = job.remaining.length === 0;
    if (done) job.phase = "done";
    const elapsedMs = Date.now() - job.startedAt;
    const fragment = renderToString(
      <RetriggerProgress
        jobId={jobId}
        phase={job.phase}
        total={job.total}
        requeued={job.requeued}
        failed={job.failed}
        remaining={job.remaining.length}
        elapsedMs={elapsedMs}
        since=""
        until=""
      />,
    );
    if (done) {
      console.log(`✅ [RETRIGGER-TICK] jobId=${jobId} DONE total=${job.total} requeued=${job.requeued} failed=${job.failed.length} elapsed=${Math.round(elapsedMs / 1000)}s`);
      deleteRetriggerJob(jobId);
    }
    return new Response(fragment, { headers: { "content-type": "text/html" } });
  },
});

function html(el: VNode): Response {
  return new Response(renderToString(el), { headers: { "content-type": "text/html" } });
}
