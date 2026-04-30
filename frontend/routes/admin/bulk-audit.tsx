/** Bulk Audit admin page. Mounts the BulkAuditRunner island on a real page
 *  route, not a modal HTMX swap, so Fresh's boot script hydrates it (see
 *  frontend/CLAUDE.md Gotcha #1 — HTMX-injected islands don't hydrate). */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import BulkAuditRunner from "../../islands/BulkAuditRunner.tsx";

export default define.page(function BulkAuditPage(ctx) {
  const url = new URL(ctx.req.url);
  return (
    <Layout title="Bulk Audit" section="admin" user={ctx.state.user!} pathname={url.pathname} hideSidebar>
      <div class="ql-topbar">
        <div class="ql-topbar-title">
          <span class="ql-topbar-icon" aria-hidden="true">📊</span>
          <h1>Bulk Audit</h1>
        </div>
        <a href="/admin/dashboard" class="ql-topbar-back">← Dashboard</a>
      </div>
      <div class="ql-page-body">
        <div style="margin-bottom:16px;">
          <div style="font-size:13px;color:var(--text-muted);max-width:720px;">
            Paste a list of QuickBase record IDs — each will be queued as a real audit with the stagger below. Maximum 200 RIDs per run.
          </div>
        </div>
        <BulkAuditRunner />
      </div>
    </Layout>
  );
});
