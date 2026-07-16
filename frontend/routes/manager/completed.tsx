/** Manager Completed — remediated queue items for the manager's team, newest
 *  first. Same scoped data as the Queue tab; rows open the finding-detail
 *  modal (rendered inline below — HTMX-injected markup never hydrates, see
 *  frontend/CLAUDE.md Gotcha #1). No remediate modal here: everything on
 *  this page is already done.
 *
 *  `?as=<email>` is threaded into the fragment URL so an admin impersonating
 *  a manager sees that manager's completed items. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";

export default define.page(function ManagerCompletedPage(ctx) {
  const user = ctx.state.user!;
  const url = new URL(ctx.req.url);
  const asEmail = url.searchParams.get("as") ?? "";
  const asQs = asEmail ? `?as=${encodeURIComponent(asEmail)}` : "";

  return (
    <Layout title="Completed Remediations" section="manager" user={user} gameState={ctx.state.gameState} pathname={url.pathname}>
      <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;gap:16px;">
        <div>
          <h1>Completed</h1>
          <p class="page-sub">Remediated failures — who addressed them and when</p>
        </div>
        <a href={`/manager${asQs}`} class="btn btn-ghost btn-sm">&larr; Queue</a>
      </div>

      <div class="card" style="padding:14px 18px;">
        <div class="tbl-title" style="margin-bottom:10px;">Completed Remediations</div>
        <div id="manager-completed" hx-get={`/api/manager/completed${asQs}`} hx-trigger="load" hx-swap="innerHTML">
          <div class="placeholder-card">Loading completed items…</div>
        </div>
      </div>

      {/* Finding-detail modal shell — same as the Queue page's. */}
      <div id="finding-detail-modal" class="modal-overlay">
        <div class="modal" style="width:min(720px,92vw);max-height:88vh;overflow-y:auto;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <div class="modal-title">Finding Detail</div>
            <button
              class="btn btn-ghost btn-sm"
              {...{ "hx-on:click": "this.closest('.modal-overlay').classList.remove('open')" }}
            >&times;</button>
          </div>
          <div id="finding-detail-content">
            <div class="placeholder-card">Select a finding…</div>
          </div>
        </div>
      </div>
    </Layout>
  );
});
