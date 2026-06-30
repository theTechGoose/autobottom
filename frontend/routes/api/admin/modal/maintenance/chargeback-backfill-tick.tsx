/** Chunked "Backfill Chargeback Entries" — per-batch worker.
 *
 *  Pops the next 25 fids off the in-memory job, POSTs them to the backend
 *  /admin/chargeback-backfill-process (re-reads each finding + rewrites/deletes
 *  its chargeback or wire entry), updates the job tallies, and re-renders the
 *  progress fragment. Self-triggers the next tick until remaining is empty. */

import { define } from "../../../../../lib/define.ts";
import { apiPost } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import { getCbBackfillJob, deleteCbBackfillJob } from "../../../../../lib/chargeback-backfill-job-store.ts";
import { ChargebackBackfillProgress } from "../../../../../components/ChargebackBackfillProgress.tsx";

// The backend processes each batch ~20-concurrent, so 100 findings/request still
// finishes in ~3-4s — far fewer round-trips, whole job done in ~2 min.
const BATCH_SIZE = 100;

interface ProcessResp {
  ok?: boolean;
  scanned?: number;
  cbUpdated?: number;
  cbDeleted?: number;
  wireUpdated?: number;
  wireDeleted?: number;
  error?: string;
}

export const handler = define.handlers({
  async POST(ctx) {
    const url = new URL(ctx.req.url);
    const jobId = url.searchParams.get("jobId") ?? "";
    const job = getCbBackfillJob(jobId);
    if (!job) {
      return new Response(
        renderToString(
          <div class="error-text" style="font-size:11px;padding:10px;border:1px solid var(--red);border-radius:6px;">
            Backfill job not found (likely an isolate restart). Already-processed entries are saved — re-run to finish the rest.
          </div>,
        ),
        { headers: { "content-type": "text/html" } },
      );
    }

    const batch = job.remaining.splice(0, BATCH_SIZE);
    if (batch.length > 0) {
      let r: ProcessResp;
      try {
        r = await apiPost<ProcessResp>("/admin/chargeback-backfill-process", ctx.req, { fids: batch });
      } catch (err) {
        // Don't re-queue — a re-run picks them up. Keep the loop moving.
        console.warn(`⚠️ [CB-BACKFILL-TICK] jobId=${jobId} batch failed:`, err);
        r = {};
      }
      job.scanned += r.scanned ?? 0;
      job.cbUpdated += r.cbUpdated ?? 0;
      job.cbDeleted += r.cbDeleted ?? 0;
      job.wireUpdated += r.wireUpdated ?? 0;
      job.wireDeleted += r.wireDeleted ?? 0;
      console.log(`📊 [CB-BACKFILL-TICK] jobId=${jobId} batch=${batch.length} removed=${job.cbDeleted + job.wireDeleted} rewritten=${job.cbUpdated + job.wireUpdated} remaining=${job.remaining.length}`);
    }

    const done = job.remaining.length === 0;
    const elapsedMs = Date.now() - job.startedAt;
    const fragment = renderToString(
      <ChargebackBackfillProgress
        jobId={jobId}
        total={job.total}
        scanned={job.scanned}
        cbUpdated={job.cbUpdated}
        cbDeleted={job.cbDeleted}
        wireUpdated={job.wireUpdated}
        wireDeleted={job.wireDeleted}
        remaining={job.remaining.length}
        done={done}
        elapsedMs={elapsedMs}
      />,
    );
    if (done) {
      console.log(`✅ [CB-BACKFILL-TICK] jobId=${jobId} DONE total=${job.total} removed=${job.cbDeleted + job.wireDeleted} rewritten=${job.cbUpdated + job.wireUpdated} elapsed=${Math.round(elapsedMs / 1000)}s`);
      deleteCbBackfillJob(jobId);
    }
    return new Response(fragment, { headers: { "content-type": "text/html" } });
  },
});
