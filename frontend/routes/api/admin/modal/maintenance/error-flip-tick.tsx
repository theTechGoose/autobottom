/** Chunked "Error-Answer Cleanup" — per-batch worker.
 *
 *  Pops the next chunk of fids off the in-memory job, POSTs them to the backend
 *  /admin/error-flip-process (classify, and in flip mode force each impacted
 *  audit to a 100% reviewed pass), folds the tallies in, and re-renders the
 *  progress fragment. Self-triggers the next tick until remaining is empty. */

import { define } from "../../../../../lib/define.ts";
import { apiPost } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import {
  deleteErrorFlipJob,
  type ErrorFlipSample,
  getErrorFlipJob,
  MAX_TRACKED_FIDS,
  MAX_TRACKED_SAMPLES,
} from "../../../../../lib/error-flip-job-store.ts";
import { ErrorFlipProgress } from "../../../../../components/ErrorFlipProgress.tsx";

/** Scanning is a bounded per-finding read fanned out ~20-concurrent, so 100
 *  findings/request finishes in a few seconds. Flipping runs a full
 *  adminFlipFinding per impacted audit (queue scans + several writes), so it
 *  takes a much smaller bite to stay inside the request budget. */
const SCAN_BATCH = 100;
const FLIP_BATCH = 25;

interface ProcessResp {
  ok?: boolean;
  scanned?: number;
  clean?: number;
  impacted?: number;
  errorQuestions?: number;
  realFails?: number;
  flipped?: number;
  missing?: number;
  errors?: number;
  impactedFids?: string[];
  samples?: ErrorFlipSample[];
  error?: string;
}

export const handler = define.handlers({
  async POST(ctx) {
    const url = new URL(ctx.req.url);
    const jobId = url.searchParams.get("jobId") ?? "";
    const job = getErrorFlipJob(jobId);
    if (!job) {
      return new Response(
        renderToString(
          <div class="error-text" style="font-size:11px;padding:10px;border:1px solid var(--red);border-radius:6px;">
            Error-Answer Cleanup job not found (likely an isolate restart). Nothing is lost — a scan writes
            nothing, and a flip is idempotent. Re-run to finish the rest.
          </div>,
        ),
        { headers: { "content-type": "text/html" } },
      );
    }

    const batch = job.remaining.splice(0, job.mode === "flip" ? FLIP_BATCH : SCAN_BATCH);
    if (batch.length > 0) {
      let r: ProcessResp;
      try {
        r = await apiPost<ProcessResp>("/admin/error-flip-process", ctx.req, {
          fids: batch,
          mode: job.mode,
          flippedBy: job.flippedBy,
        });
      } catch (err) {
        // Don't re-queue — a re-run picks them up. Keep the loop moving.
        console.warn(`⚠️ [ERROR-FLIP-TICK] jobId=${jobId} batch failed:`, err);
        r = {};
      }
      job.scanned += r.scanned ?? 0;
      job.clean += r.clean ?? 0;
      job.impacted += r.impacted ?? 0;
      job.errorQuestions += r.errorQuestions ?? 0;
      job.realFails += r.realFails ?? 0;
      job.flipped += r.flipped ?? 0;
      job.missing += r.missing ?? 0;
      job.errors += r.errors ?? 0;
      for (const fid of r.impactedFids ?? []) {
        if (job.impactedFids.length < MAX_TRACKED_FIDS) job.impactedFids.push(fid);
      }
      for (const s of r.samples ?? []) {
        if (job.samples.length < MAX_TRACKED_SAMPLES) job.samples.push(s);
      }
      console.log(`📊 [ERROR-FLIP-TICK] jobId=${jobId} mode=${job.mode} batch=${batch.length} impacted=${job.impacted} flipped=${job.flipped} remaining=${job.remaining.length}`);
    }

    const done = job.remaining.length === 0;
    const elapsedMs = Date.now() - job.startedAt;
    const fragment = renderToString(
      <ErrorFlipProgress jobId={jobId} job={job} done={done} elapsedMs={elapsedMs} />,
    );
    if (done) {
      console.log(`✅ [ERROR-FLIP-TICK] jobId=${jobId} DONE mode=${job.mode} total=${job.total} impacted=${job.impacted} flipped=${job.flipped} elapsed=${Math.round(elapsedMs / 1000)}s`);
      // NOT deleted while a scan is showing its result — the "Flip" button on
      // that card re-lists from scratch, but the card itself is re-rendered from
      // this job on any late tick. The TTL sweeper reclaims it.
      if (job.mode === "flip") deleteErrorFlipJob(jobId);
    }
    return new Response(fragment, { headers: { "content-type": "text/html" } });
  },
});
