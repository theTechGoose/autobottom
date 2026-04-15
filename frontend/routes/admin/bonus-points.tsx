/** Bonus points configuration. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { apiFetch } from "../../lib/api.ts";

export default define.page(async function BonusPointsPage(ctx) {
  const user = ctx.state.user!;
  let config = { internalBonusPoints: 0, partnerBonusPoints: 0 };
  try { config = await apiFetch("/admin/bonus-points-config", ctx.req); } catch {}

  return (
    <Layout title="Bonus Points" section="admin" user={user}>
      <div class="page-header"><h1>Bonus Points</h1><p class="page-sub">Configure bonus point awards for audit types</p></div>
      <div class="card">
        <form hx-post="/api/admin/config-save" hx-vals='{"endpoint":"/admin/bonus-points-config"}' hx-target="#bp-result" hx-swap="innerHTML">
          <div style="display:flex;gap:16px;flex-wrap:wrap;">
            <div class="form-group" style="flex:1;min-width:150px;"><label>Internal Bonus Points</label><input type="number" name="internalBonusPoints" value={String(config.internalBonusPoints)} /></div>
            <div class="form-group" style="flex:1;min-width:150px;"><label>Partner Bonus Points</label><input type="number" name="partnerBonusPoints" value={String(config.partnerBonusPoints)} /></div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;"><button class="btn btn-primary" type="submit">Save</button><span id="bp-result"></span></div>
        </form>
      </div>
    </Layout>
  );
});
