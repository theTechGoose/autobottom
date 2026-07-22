/** Chunked "Transcript Repair" — per-batch worker.
 *
 *  Pops the next chunk of fids off the in-memory job, POSTs them to the backend
 *  /admin/transcript-repair-process (classify, and in repair mode write the
 *  extracted transcript back), folds the tallies in, and re-renders the progress
 *  fragment. Self-triggers the next tick until remaining is empty. */

import { define } from "../../../../../lib/define.ts";
import { apiPost } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import {
  deleteTranscriptRepairJob,
  getTranscriptRepairJob,
  MAX_TRACKED_FIDS,
  MAX_TRACKED_SAMPLES,
  type TranscriptRepairSample,
} from "../../../../../lib/transcript-repair-job-store.ts";
import { TranscriptRepairProgress } from "../../../../../components/TranscriptRepairProgress.tsx";

// The backend fans out ~20-concurrent transcript reads per batch, so 100
// findings/request still finishes in a few seconds.
const BATCH_SIZE = 100;

interface ProcessResp {
  ok?: boolean;
  scanned?: number;
  clean?: number;
  contaminated?: number;
  fenced?: number;
  filtered?: number;
  reverted?: number;
  repaired?: number;
  missing?: number;
  errors?: number;
  samples?: TranscriptRepairSample[];
  error?: string;
}

export const handler = define.handlers({
  async POST(ctx) {
    const url = new URL(ctx.req.url);
    const jobId = url.searchParams.get("jobId") ?? "";
    const job = getTranscriptRepairJob(jobId);
    if (!job) {
      return new Response(
        renderToString(
          <div class="error-text" style="font-size:11px;padding:10px;border:1px solid var(--red);border-radius:6px;">
            Transcript Repair job not found (likely an isolate restart). Nothing is lost — a scan writes
            nothing, and a repair is idempotent. Re-run to finish the rest.
          </div>,
        ),
        { headers: { "content-type": "text/html" } },
      );
    }

    const batch = job.remaining.splice(0, BATCH_SIZE);
    if (batch.length > 0) {
      let r: ProcessResp;
      try {
        r = await apiPost<ProcessResp>("/admin/transcript-repair-process", ctx.req, { fids: batch, mode: job.mode });
      } catch (err) {
        // Don't re-queue — a re-run picks them up. Keep the loop moving.
        console.warn(`⚠️ [TRANSCRIPT-REPAIR-TICK] jobId=${jobId} batch failed:`, err);
        r = {};
      }
      job.scanned += r.scanned ?? 0;
      job.clean += r.clean ?? 0;
      job.contaminated += r.contaminated ?? 0;
      job.fenced += r.fenced ?? 0;
      job.filtered += r.filtered ?? 0;
      job.reverted += r.reverted ?? 0;
      job.repaired += r.repaired ?? 0;
      job.missing += r.missing ?? 0;
      job.errors += r.errors ?? 0;
      for (const s of r.samples ?? []) {
        if (job.contaminatedFids.length < MAX_TRACKED_FIDS) job.contaminatedFids.push(s.findingId);
        if (job.samples.length < MAX_TRACKED_SAMPLES) job.samples.push(s);
      }
      console.log(`📊 [TRANSCRIPT-REPAIR-TICK] jobId=${jobId} mode=${job.mode} batch=${batch.length} contaminated=${job.contaminated} repaired=${job.repaired} remaining=${job.remaining.length}`);
    }

    const done = job.remaining.length === 0;
    const elapsedMs = Date.now() - job.startedAt;
    const fragment = renderToString(
      <TranscriptRepairProgress jobId={jobId} job={job} done={done} elapsedMs={elapsedMs} />,
    );
    if (done) {
      console.log(`✅ [TRANSCRIPT-REPAIR-TICK] jobId=${jobId} DONE mode=${job.mode} total=${job.total} contaminated=${job.contaminated} repaired=${job.repaired} elapsed=${Math.round(elapsedMs / 1000)}s`);
      // NOT deleted while a scan is showing its result — the "Repair" button on
      // that card re-lists from scratch, but the card itself is re-rendered from
      // this job on any late tick. The TTL sweeper reclaims it.
      if (job.mode === "repair") deleteTranscriptRepairJob(jobId);
    }
    return new Response(fragment, { headers: { "content-type": "text/html" } });
  },
});
