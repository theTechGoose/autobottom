/** Chunked bulk-flip — kickoff endpoint.
 *
 *  Replaces flip-exec.tsx's "POST all the IDs at once" flow that 503'd at
 *  the edge timeout for any reasonably-sized batch (>~100). Reads the
 *  findingIds from the form, creates a server-side job, and returns an
 *  HTMX progress fragment that auto-triggers /flip-tick to process each
 *  50-audit batch. The progress fragment swaps itself in place with the
 *  updated counts after each tick.
 *
 *  Button-lock UX is intrinsic: this response replaces #flip-results
 *  (the container that held the Flip All / Flip Selected buttons), so
 *  there are no buttons left to click until the run completes and the
 *  outer Pull Unreviewed form auto-refreshes the table. */

import { define } from "../../../../../lib/define.ts";
import { renderToString } from "preact-render-to-string";
import type { VNode } from "preact";
import { createFlipJob } from "../../../../../lib/flip-job-store.ts";
import { FlipProgress } from "../../../../../components/FlipProgress.tsx";

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const checkedIds = form.getAll("findingId").map((v) => String(v)).filter(Boolean);
    const allIds = form.getAll("allFindingId").map((v) => String(v)).filter(Boolean);
    const mode = form.get("mode")?.toString() ?? "selected";
    const ids = mode === "all" ? allIds : checkedIds;
    if (ids.length === 0) {
      const msg = mode === "all" ? "No audits in the result table to flip." : "No rows selected.";
      return html(<div class="error-text" style="font-size:11px;">{msg}</div>);
    }

    const { jobId } = createFlipJob(ids);
    console.log(`🚀 [FLIP-START] jobId=${jobId} total=${ids.length} mode=${mode}`);
    // Return an initial progress fragment that auto-triggers the first tick.
    return html(<FlipProgress jobId={jobId} total={ids.length} flipped={0} failed={[]} done={false} elapsedMs={0} />);
  },
});

function html(el: VNode): Response {
  return new Response(renderToString(el), { headers: { "content-type": "text/html" } });
}
