/** "Genie Retry" bulk re-run — per-poll worker.
 *
 *  Delegates one tick to the backend (poll in-flight → retire → top up to 5)
 *  and re-renders the progress fragment from the returned snapshot. All run
 *  state lives in Firestore, so it does not matter which isolate serves this
 *  request — the reason this replaced the old in-memory job that failed with
 *  "job not found" on every tick. */

import { define } from "../../../../../lib/define.ts";
import { apiPost } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import type { GenieRetrySnapshot } from "../../../../../lib/genie-retry-job-store.ts";
import { GenieRetryProgress } from "../../../../../components/GenieRetryProgress.tsx";

interface AdvanceResp { ok?: boolean; snapshot?: GenieRetrySnapshot; error?: string }

export const handler = define.handlers({
  async POST(ctx) {
    const url = new URL(ctx.req.url);
    const jobId = url.searchParams.get("jobId") ?? "";

    let r: AdvanceResp;
    try {
      r = await apiPost<AdvanceResp>("/admin/genie-retry-advance", ctx.req, { jobId });
    } catch (err) {
      // A transient backend failure must not kill the run — re-emit a polling
      // fragment that ticks again in a moment. We can't render a fresh snapshot,
      // so fall through to the not-found message only when the job is truly gone.
      console.warn(`⚠️ [GENIE-RETRY-TICK] jobId=${jobId} advance failed:`, err);
      r = {};
    }

    if (!r.snapshot) {
      // Either the job expired (TTL) or a transient error above. Either way the
      // run isn't recoverable from here — tell the operator to re-run. This is
      // now rare: the job is persisted, so it survives isolate swaps.
      return new Response(
        renderToString(
          <div class="error-text" style="font-size:11px;padding:10px;border:1px solid var(--red);border-radius:6px;">
            Genie Retry run not found — it likely expired (runs are kept for 2 hours). Audits already
            re-queued keep running on their own. Re-run the tool on the same window to pick up whatever is
            still invalid.
          </div>,
        ),
        { headers: { "content-type": "text/html" } },
      );
    }

    const elapsedMs = Date.now() - r.snapshot.startedAt;
    return new Response(
      renderToString(<GenieRetryProgress snap={r.snapshot} elapsedMs={elapsedMs} />),
      { headers: { "content-type": "text/html" } },
    );
  },
});
