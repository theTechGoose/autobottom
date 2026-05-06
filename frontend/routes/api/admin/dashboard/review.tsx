/** HTMX fragment — returns fresh Review Queue panel HTML. */
import { define } from "../../../../lib/define.ts";
import { apiFetch } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import { ReviewQueuePanel, type ReviewStatsShape } from "../../../../components/ReviewQueuePanel.tsx";

export const handler = define.handlers({
  async GET(ctx) {
    let r: ReviewStatsShape = {};
    try {
      const data = await apiFetch<{ review: ReviewStatsShape }>("/admin/dashboard/data", ctx.req);
      r = data.review ?? {};
    } catch { /* use empty defaults */ }
    const html = renderToString(<ReviewQueuePanel r={r} />);
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
