/** HTMX fragment — returns refreshed stat cards HTML for dashboard auto-refresh.
 *  Uses the shared <StatGrid> component so the refresh layout matches SSR exactly.
 *  Wrapped in a 5s per-isolate fragment cache so parallel panel polls collapse
 *  into a single backend round-trip. */
import { define } from "../../../lib/define.ts";
import { apiFetch } from "../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import { StatGrid, type PipelineStatsShape } from "../../../components/StatGrid.tsx";
import { withFragmentCache } from "../../../lib/fragment-cache.ts";

export const handler = define.handlers({
  async GET(ctx) {
    try {
      const html = await withFragmentCache("dashboard-stats", async () => {
        try {
          const data = await apiFetch<{ pipeline: PipelineStatsShape }>(
            "/admin/dashboard/data", ctx.req,
          );
          return renderToString(<StatGrid p={data.pipeline ?? {}} />);
        } catch {
          return `<div class="stat-grid"><div class="placeholder-card">Failed to load stats</div></div>`;
        }
      });
      return new Response(html, { headers: { "content-type": "text/html" } });
    } catch (e) {
      console.warn(`[FRAGMENT] dashboard-stats fell through to fallback:`, e);
      return new Response(
        `<div class="stat-grid"><div class="placeholder-card">refreshing…</div></div>`,
        { headers: { "content-type": "text/html" } },
      );
    }
  },
});
