/** Weekly Reports modal fragment — loaded on demand when the operator clicks
 *  "Run now" on the Weekly Reports tab. Previously the configs + statuses were
 *  prefetched server-side in the reports modal GET on every tab open; gating it
 *  here keeps the modal idle until asked. Fetches the scheduled-report configs +
 *  statuses and renders the shared WeeklyReportsList. GET only. */

import { define } from "../../../../../lib/define.ts";
import { apiFetch } from "../../../../../lib/api.ts";
import { WeeklyReportsList, type EmailReportConfig, type StatusEntry } from "../../../../../components/WeeklyReportsList.tsx";
import { renderToString } from "preact-render-to-string";

export const handler = define.handlers({
  async GET(ctx) {
    let configs: EmailReportConfig[] = [];
    let statuses: Record<string, StatusEntry> = {};
    try {
      const c = await apiFetch<{ configs?: EmailReportConfig[] }>("/admin/email-reports", ctx.req);
      configs = c.configs ?? [];
    } catch (e) { console.error("[reports/weekly] configs load:", e); }
    try {
      const s = await apiFetch<{ statuses?: Record<string, StatusEntry> }>("/admin/email-reports/all-status", ctx.req);
      statuses = s.statuses ?? {};
    } catch (e) { console.error("[reports/weekly] statuses load:", e); }

    const html = renderToString(<WeeklyReportsList configs={configs} statuses={statuses} />);
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
