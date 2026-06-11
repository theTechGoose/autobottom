/** Manager Portal — the manager's home: queue of confirmed failures awaiting
 *  remediation, live stat cards, and the finding-detail / remediate modals.
 *
 *  Stats + queue load via HTMX from `/api/manager/stats` and
 *  `/api/manager/queue`. The two modal shells are rendered INLINE here (not
 *  via an HTMX swap) so the queue fragment's inline `classList.add('open')`
 *  has a real element to toggle and a real container to swap detail into —
 *  see frontend/CLAUDE.md Gotcha #1 (HTMX-injected markup never hydrates).
 *
 *  `?as=<email>` is threaded into the Audit-History link only: queue + stats
 *  are org-scoped (not team-scoped), so impersonation doesn't change them. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";

export default define.page(function ManagerPortalPage(ctx) {
  const user = ctx.state.user!;
  const url = new URL(ctx.req.url);
  const asEmail = url.searchParams.get("as") ?? "";
  const auditsHref = asEmail
    ? `/manager/audits?as=${encodeURIComponent(asEmail)}`
    : "/manager/audits";

  return (
    <Layout title="Manager Portal" section="manager" user={user} gameState={ctx.state.gameState} pathname={url.pathname}>
      <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;gap:16px;">
        <div>
          <h1>Manager Portal</h1>
          <p class="page-sub">Confirmed failures awaiting remediation</p>
        </div>
        <a href={auditsHref} class="btn btn-ghost btn-sm">Audit History &rarr;</a>
      </div>

      {/* Stat strip — Total / Pending / Remediated / Agents, refreshed every 10s. */}
      <div id="manager-stats" hx-get="/api/manager/stats" hx-trigger="load, every 10s" hx-swap="innerHTML" style="margin-bottom:18px;">
        <div class="stat-grid"><div class="placeholder-card">Loading stats…</div></div>
      </div>

      {/* Queue table — initial load + reloaded by the remediate flow's HX-Redirect. */}
      <div class="card" style="padding:14px 18px;">
        <div class="tbl-title" style="margin-bottom:10px;">Remediation Queue</div>
        <div id="manager-queue" hx-get="/api/manager/queue" hx-trigger="load" hx-swap="innerHTML">
          <div class="placeholder-card">Loading queue…</div>
        </div>
      </div>

      {/* ===== Modal shells (plain HTML — NOT islands). The queue fragment
          toggles `.open` (CSS: .modal-overlay.open{display:flex}) and swaps
          detail into #finding-detail-content / sets #rem-findingId. ===== */}
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

      <div id="remediate-modal" class="modal-overlay">
        <div class="modal" style="width:min(520px,92vw);">
          <div class="modal-title">Remediate Failure</div>
          <div class="modal-sub" style="margin-bottom:14px;">Record how this failure was addressed with the agent.</div>
          <form hx-post="/api/manager/remediate" hx-swap="none">
            <input type="hidden" id="rem-findingId" name="findingId" value="" />
            {/* username → remediatedBy on the queue item + gamification credit */}
            <input type="hidden" name="username" value={user.email} />
            <div class="form-group">
              <label>Remediation notes</label>
              <textarea name="notes" rows={5} required placeholder="What was discussed / corrected with the agent…"></textarea>
            </div>
            <div class="modal-actions">
              <button
                type="button"
                class="btn btn-ghost"
                {...{ "hx-on:click": "this.closest('.modal-overlay').classList.remove('open')" }}
              >Cancel</button>
              <button type="submit" class="btn btn-primary">Submit</button>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  );
});
