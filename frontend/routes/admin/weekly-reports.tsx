/** Weekly Reports — full-page view. Popped out from the Reports modal's
 *  "Open full report ↗" link. Same config list + Preview / Send-Live buttons as
 *  the modal, with more room for the inline email preview. The Preview/Send
 *  buttons are plain HTMX (POST to /api/admin/modal/reports/{preview,send-now},
 *  swap into the per-row slots) — they work identically on this page.
 *
 *  Registered in FRONTEND_EXACT_PAGES so browser nav reaches Fresh; the
 *  page-side apiFetch targets /admin/email-reports (a distinct backend path). */

import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { apiFetch } from "../../lib/api.ts";
import { WeeklyReportsList, type EmailReportConfig, type StatusEntry } from "../../components/WeeklyReportsList.tsx";

export default define.page(async function WeeklyReportsPage(ctx) {
  const url = new URL(ctx.req.url);

  let configs: EmailReportConfig[] = [];
  let statuses: Record<string, StatusEntry> = {};
  try {
    const c = await apiFetch<{ configs?: EmailReportConfig[] }>("/admin/email-reports", ctx.req);
    configs = c.configs ?? [];
  } catch (e) { console.error("[weekly-reports] configs load:", e); }
  try {
    const s = await apiFetch<{ statuses?: Record<string, StatusEntry> }>("/admin/email-reports/all-status", ctx.req);
    statuses = s.statuses ?? {};
  } catch (e) { console.error("[weekly-reports] statuses load:", e); }

  return (
    <Layout title="Weekly Reports" section="admin" user={ctx.state.user!} pathname={url.pathname} hideSidebar>
      <div class="ql-topbar">
        <div class="ql-topbar-title">
          <span class="ql-topbar-icon" aria-hidden="true">📨</span>
          <h1>Weekly Reports</h1>
        </div>
        <a href="/admin/dashboard" class="ql-topbar-back">← Dashboard</a>
      </div>

      <div class="ql-page-body">
        <WeeklyReportsList configs={configs} statuses={statuses} />
      </div>
    </Layout>
  );
});
