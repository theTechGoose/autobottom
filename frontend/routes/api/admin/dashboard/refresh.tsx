/** HTMX fragment — returns fresh dashboard tables (Recently Completed, Active, Errors).
 *  Uses shared <DashboardTables> so SSR and refresh render identically. */
import { define } from "../../../../lib/define.ts";
import { apiFetch } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import { DashboardTables, type ActiveItem, type ErrorItem, type CompletedItem } from "../../../../components/DashboardTables.tsx";

interface DashboardData {
  pipeline: { active?: ActiveItem[]; errors?: ErrorItem[] };
  recentCompleted: CompletedItem[];
}

export const handler = define.handlers({
  async GET(ctx) {
    try {
      const data = await apiFetch<DashboardData>("/admin/dashboard/data", ctx.req);
      const html = renderToString(
        <DashboardTables
          recent={data.recentCompleted ?? []}
          active={data.pipeline?.active ?? []}
          errors={data.pipeline?.errors ?? []}
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
