/** Email Reports admin page. Mounts the EmailReportEditor island as a real
 *  page-route island (not modal-swap) so Fresh hydrates it properly — the
 *  modal version's "+ New Report" button never fired because HTMX-injected
 *  islands don't re-trigger the page-load `boot()` hydration script. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import EmailReportEditor from "../../islands/EmailReportEditor.tsx";

export default define.page(function EmailReportsPage(ctx) {
  const url = new URL(ctx.req.url);
  return (
    <Layout title="Email Reports" section="admin" user={ctx.state.user!} pathname={url.pathname} hideSidebar>
      <div class="ql-topbar">
        <div class="ql-topbar-title">
          <span class="ql-topbar-icon" aria-hidden="true">📧</span>
          <h1>Email Reports</h1>
        </div>
        <a href="/admin/dashboard" class="ql-topbar-back">← Dashboard</a>
      </div>
      <div class="ql-page-body">
        <EmailReportEditor />
      </div>
    </Layout>
  );
});
