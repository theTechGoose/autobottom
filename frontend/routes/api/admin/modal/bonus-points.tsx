/** Modal content: Bonus points config. */
import { define } from "../../../../lib/define.ts";
import { apiFetch } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

export const handler = define.handlers({
  async GET(ctx) {
    let config = { internalBonusPoints: 0, partnerBonusPoints: 0 };
    try { config = await apiFetch("/admin/bonus-points-config", ctx.req); } catch {}
    const html = renderToString(
      <form hx-post="/api/admin/config-save" hx-vals='{"endpoint":"/admin/bonus-points-config"}' hx-target="#bp-msg" hx-swap="innerHTML">
        <div style="display:flex;gap:16px;margin-bottom:12px;">
          <div><label class="sf-label">Internal Bonus Points</label><input type="number" name="internalBonusPoints" value={String(config.internalBonusPoints)} class="sf-input num" /></div>
          <div><label class="sf-label">Partner Bonus Points</label><input type="number" name="partnerBonusPoints" value={String(config.partnerBonusPoints)} class="sf-input num" /></div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;"><button type="submit" class="btn btn-primary" style="padding:5px 14px;font-size:11px;">Save</button><span id="bp-msg"></span></div>
      </form>
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
