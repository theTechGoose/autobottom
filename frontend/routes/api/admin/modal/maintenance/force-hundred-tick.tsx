/** "Force to 100%" — per-batch worker.
 *
 *  Delegates one batch to the backend (flip up to 20 audits to 100%) and
 *  re-renders the fragment from the returned snapshot. All run state lives in
 *  Firestore, so any isolate can serve any tick. */

import { define } from "../../../../../lib/define.ts";
import { apiPost } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import type { ForceHundredSnapshot } from "../../../../../lib/force-hundred.ts";
import { ForceHundredProgress } from "../../../../../components/ForceHundredProgress.tsx";

interface AdvanceResp { ok?: boolean; snapshot?: ForceHundredSnapshot; error?: string }

export const handler = define.handlers({
  async POST(ctx) {
    const url = new URL(ctx.req.url);
    const jobId = url.searchParams.get("jobId") ?? "";

    let r: AdvanceResp;
    try {
      r = await apiPost<AdvanceResp>("/admin/force-hundred-advance", ctx.req, { jobId });
    } catch (err) {
      console.warn(`⚠️ [FORCE-100-TICK] jobId=${jobId} advance failed:`, err);
      r = {};
    }

    if (!r.snapshot) {
      return new Response(
        renderToString(
          <div class="error-text" style="font-size:11px;padding:10px;border:1px solid var(--red);border-radius:6px;">
            Force-to-100 run not found — it likely expired (runs are kept for 2 hours). Anything already
            flipped stays at 100%. Re-run the tool on the same window to finish the rest.
          </div>,
        ),
        { headers: { "content-type": "text/html" } },
      );
    }

    const elapsedMs = Date.now() - r.snapshot.startedAt;
    return new Response(
      renderToString(<ForceHundredProgress snap={r.snapshot} elapsedMs={elapsedMs} />),
      { headers: { "content-type": "text/html" } },
    );
  },
});
