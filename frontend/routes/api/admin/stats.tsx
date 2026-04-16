/** HTMX fragment — returns refreshed stat cards HTML for dashboard auto-refresh.
 *  Uses the shared <StatGrid> component so the refresh layout matches SSR exactly. */
import { define } from "../../../lib/define.ts";
import { apiFetch } from "../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import { StatGrid, type PipelineStatsShape } from "../../../components/StatGrid.tsx";

export const handler = define.handlers({
  async GET(ctx) {
    try {
      const data = await apiFetch<{ pipeline: PipelineStatsShape }>(
        "/admin/dashboard/data", ctx.req,
      );
      const html = renderToString(<StatGrid p={data.pipeline ?? {}} />);
      return new Response(html, { headers: { "content-type": "text/html" } });
    } catch {
      return new Response(
        `<div class="stat-grid"><div class="placeholder-card">Failed to load stats</div></div>`,
        { headers: { "content-type": "text/html" } },
      );
    }
  },
});
