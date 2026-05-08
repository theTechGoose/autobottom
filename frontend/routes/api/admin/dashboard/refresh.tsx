/** HTMX fragment — returns fresh dashboard tables (Active, Errors, Recently Completed).
 *  All three tables always render (empty-row when no data) so new audits become visible
 *  within one refresh cycle. Wrapped in a 5s per-isolate fragment cache so
 *  parallel panel polls collapse into a single backend round-trip. */
import { define } from "../../../../lib/define.ts";
import { apiFetch } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import { DashboardTables, computeLogsBase, type ActiveItem, type ErrorItem, type CompletedItem } from "../../../../components/DashboardTables.tsx";
import { withFragmentCache } from "../../../../lib/fragment-cache.ts";

interface DashboardData {
  pipeline: { active?: ActiveItem[]; errors?: ErrorItem[]; paused?: boolean };
  recentCompleted: CompletedItem[];
}

export const handler = define.handlers({
  async GET(ctx) {
    try {
      const logsBase = computeLogsBase(ctx.req.url);
      const html = await withFragmentCache(`dashboard-refresh:${logsBase}`, async () => {
        try {
          const data = await apiFetch<DashboardData>("/admin/dashboard/data", ctx.req);
          return renderToString(
            <DashboardTables
              recent={data.recentCompleted ?? []}
              active={data.pipeline?.active ?? []}
              errors={data.pipeline?.errors ?? []}
              logsBase={logsBase}
              paused={data.pipeline?.paused}
            />
          );
        } catch (e) {
          return `<div style="color:var(--red);font-size:12px;padding:12px;">Refresh failed: ${(e as Error).message}</div>`;
        }
      });
      return new Response(html, { headers: { "content-type": "text/html" } });
    } catch (e) {
      // Belt-and-suspenders: renderer + fragment-cache both have their
      // own catches, but if anything still escapes (e.g. unhandled
      // rejection deep in the SSR), return a soft "refreshing…" fragment
      // so the panel keeps polling instead of going red with a 500.
      console.warn(`[FRAGMENT] dashboard-refresh fell through to fallback:`, e);
      return new Response(
        `<div style="color:var(--text-dim);font-size:11px;padding:12px;">refreshing…</div>`,
        { headers: { "content-type": "text/html" } },
      );
    }
  },
});
