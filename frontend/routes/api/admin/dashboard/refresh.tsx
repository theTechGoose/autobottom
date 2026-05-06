/** HTMX fragment — returns fresh dashboard tables (Active, Errors, Recently Completed).
 *  All three tables always render (empty-row when no data) so new audits become visible
 *  within one refresh cycle. */
import { define } from "../../../../lib/define.ts";
import { apiFetch } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import { DashboardTables, computeLogsBase, type ActiveItem, type ErrorItem, type CompletedItem } from "../../../../components/DashboardTables.tsx";

interface DashboardData {
  pipeline: { active?: ActiveItem[]; errors?: ErrorItem[]; paused?: boolean };
  recentCompleted: CompletedItem[];
}

export const handler = define.handlers({
  async GET(ctx) {
    try {
      const data = await apiFetch<DashboardData>("/admin/dashboard/data", ctx.req);
      const logsBase = computeLogsBase(ctx.req.url);
      const html = renderToString(
        <DashboardTables
          recent={data.recentCompleted ?? []}
          active={data.pipeline?.active ?? []}
          errors={data.pipeline?.errors ?? []}
          logsBase={logsBase}
          paused={data.pipeline?.paused}
        />
      );
      return new Response(html, { headers: { "content-type": "text/html" } });
    } catch (e) {
      return new Response(
        `<div style="color:var(--red);font-size:12px;padding:12px;">Refresh failed: ${(e as Error).message}</div>`,
        { headers: { "content-type": "text/html" } },
      );
    }
  },
});
