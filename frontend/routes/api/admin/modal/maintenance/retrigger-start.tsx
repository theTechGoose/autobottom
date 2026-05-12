/** Chunked Cleanup re-trigger — phase 2 confirmation handler.
 *
 *  Transitions a pending job to running (copies matches → remaining)
 *  and returns the first tickable RetriggerProgress fragment. */

import { define } from "../../../../../lib/define.ts";
import { renderToString } from "preact-render-to-string";
import type { VNode } from "preact";
import { startRetriggerJob } from "../../../../../lib/retrigger-job-store.ts";
import { RetriggerProgress } from "../../../../../components/RetriggerProgress.tsx";

export const handler = define.handlers({
  POST(ctx) {
    const url = new URL(ctx.req.url);
    const jobId = url.searchParams.get("jobId") ?? "";
    const job = startRetriggerJob(jobId);
    if (!job) {
      return new Response(
        renderToString(
          <div class="error-text" style="font-size:11px;padding:10px;border:1px solid var(--red);border-radius:6px;">
            Re-trigger job not found (likely an isolate restart). Re-scan to start over.
          </div>,
        ),
        { headers: { "content-type": "text/html" } },
      );
    }
    return html(
      <RetriggerProgress
        jobId={jobId}
        phase={job.phase}
        total={job.allFids.length}
        scanned={job.allFids.length}
        matched={job.matches.length}
        rejectedFinished={job.rejectedFinished}
        rejectedOutOfRange={job.rejectedOutOfRange}
        rejectedMissing={job.rejectedMissing}
        requeued={0}
        failed={[]}
        remaining={job.remaining.length}
        elapsedMs={0}
        since={new Date(job.sinceMs).toISOString().slice(0, 10)}
        until={new Date(job.untilMs).toISOString().slice(0, 10)}
      />,
    );
  },
});

function html(el: VNode): Response {
  return new Response(renderToString(el), { headers: { "content-type": "text/html" } });
}
