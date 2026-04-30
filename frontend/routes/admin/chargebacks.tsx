/** Chargebacks & Omissions / Wire Deductions admin page. The ChargebacksToolbar
 *  island owns the tab state, Pull Report, Download (CSV/XLSX), and Post-to-Sheet
 *  behaviour — and must mount on a real page route, not a modal HTMX swap, so
 *  Fresh's boot script hydrates it (see frontend/CLAUDE.md Gotcha #1). */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import ChargebacksToolbar from "../../islands/ChargebacksToolbar.tsx";

export default define.page(function ChargebacksPage(ctx) {
  const url = new URL(ctx.req.url);
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

  return (
    <Layout title="Chargebacks & Omissions" section="admin" user={ctx.state.user!} pathname={url.pathname} hideSidebar>
      <div class="ql-topbar">
        <div class="ql-topbar-title">
          <span class="ql-topbar-icon" aria-hidden="true">📋</span>
          <h1>Chargebacks & Omissions</h1>
        </div>
        <a href="/admin/dashboard" class="ql-topbar-back">← Dashboard</a>
      </div>
      <div style="display:flex;flex-direction:column;height:calc(100vh - 56px);">
        {/* Tab bar — ChargebacksToolbar's TabBarPortal effect renders the buttons here */}
        <div id="cb-tabs" style="display:flex;align-items:center;gap:0;padding:0 24px;border-bottom:1px solid var(--border);flex-shrink:0;background:var(--bg-surface);" />

        {/* Controls — island owns Pull/Download/Post */}
        <div style="display:flex;align-items:center;gap:10px;padding:12px 24px;border-bottom:1px solid var(--border);flex-shrink:0;flex-wrap:wrap;">
          <label style="font-size:11px;color:var(--text-dim);font-weight:600;">From</label>
          <input type="date" id="cb-date-from" class="sf-input" style="font-size:11px;padding:5px 8px;width:auto;cursor:pointer;" value={weekAgo} />
          <label style="font-size:11px;color:var(--text-dim);font-weight:600;">To</label>
          <input type="date" id="cb-date-to" class="sf-input" style="font-size:11px;padding:5px 8px;width:auto;cursor:pointer;" value={today} />
          <ChargebacksToolbar initialTab="cb" />
        </div>

        {/* Body — island renders into this via BodyRenderer's portal effect */}
        <div id="cb-body" style="flex:1;overflow-y:auto;padding:20px 24px;">
          <div style="color:var(--text-dim);font-size:12px;text-align:center;padding:60px 0;">Select a date range and pull the report.</div>
        </div>
      </div>
    </Layout>
  );
});
