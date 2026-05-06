/** Super Admin — org management page. Access gated by _middleware.ts
 *  (email check for `ai@monsterrg.com`). */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import SuperAdminPanel from "../../islands/SuperAdminPanel.tsx";

export default define.page(function SuperAdminPage(ctx) {
  const user = ctx.state.user!;
  return (
    <Layout title="Super Admin" section="admin" user={user} hideSidebar>
      <div style="padding:20px 24px 8px;max-width:1100px;margin:0 auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-size:10px;color:var(--red);text-transform:uppercase;letter-spacing:1.5px;font-weight:700;">Super Admin</div>
            <h1 style="font-size:22px;color:var(--text-bright);margin-top:4px;">Org Management</h1>
          </div>
          <a href="/admin/dashboard" class="sf-btn ghost" style="text-decoration:none;font-size:11px;">&larr; Admin Dashboard</a>
        </div>
      </div>
      <SuperAdminPanel />
    </Layout>
  );
});
