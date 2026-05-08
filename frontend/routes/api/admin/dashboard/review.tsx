/** HTMX fragment — returns fresh Review Queue panel HTML. Wrapped in a 5s
 *  per-isolate fragment cache so parallel panel polls collapse into a
 *  single backend round-trip. */
import { define } from "../../../../lib/define.ts";
import { apiFetch } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import { ReviewQueuePanel, type ReviewStatsShape } from "../../../../components/ReviewQueuePanel.tsx";
import { withFragmentCache } from "../../../../lib/fragment-cache.ts";

export const handler = define.handlers({
  async GET(ctx) {
    try {
      const html = await withFragmentCache("dashboard-review", async () => {
        let r: ReviewStatsShape = {};
        try {
          const data = await apiFetch<{ review: ReviewStatsShape }>("/admin/dashboard/data", ctx.req);
          r = data.review ?? {};
        } catch { /* use empty defaults */ }
        return renderToString(<ReviewQueuePanel r={r} />);
      });
      return new Response(html, { headers: { "content-type": "text/html" } });
    } catch (e) {
      console.warn(`[FRAGMENT] dashboard-review fell through to fallback:`, e);
      return new Response(
        `<div style="color:var(--text-dim);font-size:11px;padding:12px;">refreshing…</div>`,
        { headers: { "content-type": "text/html" } },
      );
    }
  },
});
