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
        <p style="font-size:12px;color:var(--text-dim);line-height:1.7;margin:0 0 16px;">
          Each weekly report covers the current week so far — Monday through today, in Eastern time. It
          sends every morning and grows as the week fills in: Monday shows Monday's audits, Tuesday shows
          Monday + Tuesday, and so on through Sunday, then it resets when the next Monday begins. Each
          department's report goes to that department's managers.
        </p>
        <WeeklyBuilderEditor />
      </div>
    </Layout>
  );
});
