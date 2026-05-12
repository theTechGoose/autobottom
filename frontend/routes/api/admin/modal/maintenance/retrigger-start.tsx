/** Chunked Cleanup re-trigger — phase 2: confirm + start ticking.
 *
 *  Transitions a pending job to running and returns the first tickable
 *  RetriggerProgress fragment. The fragment self-triggers /retrigger-tick
 *  which chews 25 fids per batch until the job is empty. */

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
        phase="running"
        total={job.total}
        requeued={0}
        failed={[]}
        remaining={job.remaining.length}
        elapsedMs={0}
        since=""
        until=""
      />,
    );
  },
});

function html(el: VNode): Response {
  return new Response(renderToString(el), { headers: { "content-type": "text/html" } });
}
