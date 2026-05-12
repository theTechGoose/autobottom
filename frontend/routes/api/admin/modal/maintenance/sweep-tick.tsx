/** Chunked Cleanup sweep — per-batch worker.
 *
 *  Pops the next 25 fids off the in-memory job, POSTs them to the backend
 *  /admin/sweep-orphaned-process (which invalidates cache + getFinding +
 *  resetFindingDerivedState per orphan), updates the job's counters, and
 *  re-renders the SweepProgress fragment. Self-triggers the next tick
 *  until job.remaining is empty. */

import { define } from "../../../../../lib/define.ts";
import { apiPost } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import type { VNode } from "preact";
import { getSweepJob, deleteSweepJob } from "../../../../../lib/sweep-job-store.ts";
import { SweepProgress } from "../../../../../components/SweepProgress.tsx";

const BATCH_SIZE = 25;

interface ProcessResp {
  ok?: boolean;
  swept?: number;
  healthy?: number;
  missing?: number;
  drained?: string[];
  error?: string;
}

export const handler = define.handlers({
  async POST(ctx) {
    const url = new URL(ctx.req.url);
    const jobId = url.searchParams.get("jobId") ?? "";
    const job = getSweepJob(jobId);
    if (!job) {
      return new Response(
        renderToString(
          <div class="error-text" style="font-size:11px;padding:10px;border:1px solid var(--red);border-radius:6px;">
            Sweep job not found (likely an isolate restart). Drains already applied are durable — re-click Run Sweep to continue.
          </div>,
        ),
        { headers: { "content-type": "text/html" } },
      );
    }

    const batch = job.remaining.splice(0, BATCH_SIZE);
    if (batch.length > 0) {
      let r: ProcessResp;
      try {
        r = await apiPost<ProcessResp>("/admin/sweep-orphaned-process", ctx.req, { fids: batch });
      } catch (err) {
        console.warn(`⚠️ [SWEEP-TICK] jobId=${jobId} batch failed:`, err);
        // Treat as healthy/skip rather than re-queue — re-running picks
        // them up on the next sweep.
        r = {};
      }
      job.swept += r.swept ?? 0;
      job.healthy += r.healthy ?? 0;
      job.missing += r.missing ?? 0;
      if (Array.isArray(r.drained)) job.drained.push(...r.drained);
      console.log(`📊 [SWEEP-TICK] jobId=${jobId} batch=${batch.length} swept=${job.swept} healthy=${job.healthy} missing=${job.missing} remaining=${job.remaining.length}`);
    }

    const done = job.remaining.length === 0;
    const elapsedMs = Date.now() - job.startedAt;
    const fragment = renderToString(
      <SweepProgress
        jobId={jobId}
        total={job.total}
        swept={job.swept}
        healthy={job.healthy}
        missing={job.missing}
        drained={job.drained}
        remaining={job.remaining.length}
        done={done}
        elapsedMs={elapsedMs}
      />,
    );
    if (done) {
      console.log(`✅ [SWEEP-TICK] jobId=${jobId} DONE total=${job.total} swept=${job.swept} healthy=${job.healthy} missing=${job.missing} elapsed=${Math.round(elapsedMs / 1000)}s`);
      deleteSweepJob(jobId);
    }
    return new Response(fragment, { headers: { "content-type": "text/html" } });
  },
});

function html(el: VNode): Response {
  return new Response(renderToString(el), { headers: { "content-type": "text/html" } });
}
