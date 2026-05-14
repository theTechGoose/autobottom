/** Chunked bulk-flip — per-batch worker.
 *
 *  Pulls the next 50 IDs off the in-memory job, POSTs them to the backend
 *  /admin/bulk-flip (which now parallelizes internally with 10 in flight),
 *  updates the job's flipped/failed counters, and returns the same
 *  FlipProgress fragment with updated numbers. The fragment self-triggers
 *  the next tick until job.remaining is empty.
 *
 *  When the job finishes, this handler also sets `HX-Trigger: flip-complete`
 *  on the response. The Pull Unreviewed form (in maintenance.tsx) listens
 *  for that event via `hx-trigger="submit, flip-complete from:body"` and
 *  auto-refires its GET — the table refreshes to show the remaining
 *  unreviewed audits (or "no matches" if everything got flipped). */

import { define } from "../../../../../lib/define.ts";
import { apiPost } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import type { VNode } from "preact";
import { getFlipJob, deleteFlipJob } from "../../../../../lib/flip-job-store.ts";
import { FlipProgress } from "../../../../../components/FlipProgress.tsx";

const BATCH_SIZE = 50;

interface FlipResp {
  ok?: boolean;
  flipped?: number;
  total?: number;
  failed?: string[];
  error?: string;
}

export const handler = define.handlers({
  async POST(ctx) {
    const url = new URL(ctx.req.url);
    const jobId = url.searchParams.get("jobId") ?? "";
    const job = getFlipJob(jobId);
    if (!job) {
      // Job missing — most likely an isolate restart mid-run. Return a
      // terminal error fragment with the refresh trigger so the table
      // reloads (whatever flips DID land are durable in audit-finding).
      return new Response(
        renderToString(
          <div class="error-text" style="font-size:11px;padding:10px;border:1px solid var(--red);border-radius:6px;">
            Flip job not found (likely an isolate restart). Any successful flips are saved. Refreshing…
          </div>,
        ),
        { headers: { "content-type": "text/html", "HX-Trigger": "flip-complete" } },
      );
    }

    // Pop next batch and process it. flippedBy = the admin's email so the
    // judge view can show who flipped these audits when agents appeal them.
    const flippedBy = ctx.state.user?.email ?? "admin";
    const batch = job.remaining.splice(0, BATCH_SIZE);
    if (batch.length > 0) {
      let r: FlipResp;
      try {
        r = await apiPost<FlipResp>("/admin/bulk-flip", ctx.req, { findingIds: batch, flippedBy });
      } catch (err) {
        console.warn(`⚠️ [FLIP-TICK] jobId=${jobId} batch failed:`, err);
        r = { ok: false, failed: batch };
      }
      if (r.error) {
        console.warn(`⚠️ [FLIP-TICK] jobId=${jobId} backend error: ${r.error}`);
        job.failed.push(...batch);
      } else {
        job.flipped += (r.flipped ?? 0);
        if (Array.isArray(r.failed)) job.failed.push(...r.failed);
      }
      console.log(`📊 [FLIP-TICK] jobId=${jobId} batch=${batch.length} cumulative flipped=${job.flipped} failed=${job.failed.length} remaining=${job.remaining.length}`);
    }

    const done = job.remaining.length === 0;
    const elapsedMs = Date.now() - job.startedAt;
    const fragment = renderToString(
      <FlipProgress
        jobId={jobId}
        total={job.total}
        flipped={job.flipped}
        failed={job.failed}
        done={done}
        elapsedMs={elapsedMs}
      />,
    );
    const headers: Record<string, string> = { "content-type": "text/html" };
    if (done) {
      // Final tick: trigger the outer Pull Unreviewed form to re-fire
      // and refresh the table. Then evict the job from memory.
      headers["HX-Trigger"] = "flip-complete";
      console.log(`✅ [FLIP-TICK] jobId=${jobId} DONE flipped=${job.flipped}/${job.total} failed=${job.failed.length} elapsed=${Math.round(elapsedMs / 1000)}s`);
      deleteFlipJob(jobId);
    }
    return new Response(fragment, { headers });
  },
});
