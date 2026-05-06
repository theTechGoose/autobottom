/** Weekly Builder page — admin tool to stage + publish per-dept / per-office
 *  weekly email-report configs. Mirrors prod main:weekly-builder/page.ts:
 *  full-width (no sidebar) layout with top bar, two-pane body. All
 *  interactivity lives in the island. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import WeeklyBuilderEditor from "../../islands/WeeklyBuilderEditor.tsx";

export default define.page(function WeeklyBuilder(ctx) {
  const url = new URL(ctx.req.url);
  return (
    <Layout title="Weekly Builder" section="admin" user={ctx.state.user!} pathname={url.pathname} hideSidebar>
      <div class="ql-topbar">
        <div class="ql-topbar-title">
          <span class="ql-topbar-icon" aria-hidden="true">📅</span>
          <h1>Weekly Builder</h1>
        </div>
        <a href="/admin/dashboard" class="ql-topbar-back">← Dashboard</a>
      </div>
      <div class="ql-page-body">
        <WeeklyBuilderEditor />
      </div>
    </Layout>
  );
});
