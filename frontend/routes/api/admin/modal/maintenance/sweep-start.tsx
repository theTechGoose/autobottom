/** Chunked Cleanup sweep — kickoff endpoint.
 *
 *  Calls the backend /admin/sweep-orphaned-list-fids (a single fast
 *  listStoredWithKeysAll scan over completed-audit-stat that returns just
 *  the unique findingIds), stores the list as an in-memory job, and
 *  returns a SweepProgress fragment. The fragment auto-triggers
 *  /sweep-tick which chews through the job a chunk at a time so no
 *  single HTTP request has to do the full per-fid getFinding loop. */

import { define } from "../../../../../lib/define.ts";
import { apiPost } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import type { VNode } from "preact";
import { createSweepJob } from "../../../../../lib/sweep-job-store.ts";
import { SweepProgress } from "../../../../../components/SweepProgress.tsx";

interface ListResp { ok?: boolean; fids?: string[]; error?: string }

export const handler = define.handlers({
  async POST(ctx) {
    let r: ListResp;
    try {
      r = await apiPost<ListResp>("/admin/sweep-orphaned-list-fids", ctx.req, {});
    } catch (e) {
      return html(<div class="error-text" style="font-size:11px;">Failed to list fids: {String(e)}</div>);
    }
    if (r.error) return html(<div class="error-text" style="font-size:11px;">{r.error}</div>);
    const fids = r.fids ?? [];
    if (fids.length === 0) {
      return html(
        <div style="font-size:12px;color:var(--green);padding:10px;border:1px solid var(--green);border-radius:6px;">
          Nothing to scan — completed-audit-stat is empty.
        </div>,
      );
    }
    const { jobId } = createSweepJob(fids);
    console.log(`🚀 [SWEEP-START] jobId=${jobId} total=${fids.length}`);
    return html(
      <SweepProgress
        jobId={jobId}
        total={fids.length}
        swept={0}
        healthy={0}
        missing={0}
        drained={[]}
        remaining={fids.length}
        done={false}
        elapsedMs={0}
      />,
    );
  },
});

function html(el: VNode): Response {
  return new Response(renderToString(el), { headers: { "content-type": "text/html" } });
}
