/** Modal content: Bonus points config. */
import { define } from "../../../../lib/define.ts";
import { apiFetch } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

export const handler = define.handlers({
  async GET(ctx) {
    let config = { internalBonusPoints: 0, partnerBonusPoints: 0 };
    try { config = await apiFetch("/admin/bonus-points-config", ctx.req); } catch {}
    const html = renderToString(
      <div>
        <div class="modal-sub">Configure bonus points that automatically flip the first eligible failed question(s) to pass. Egregious questions are immune.</div>
        <form hx-post="/api/admin/config-save" hx-vals='{"endpoint":"/admin/bonus-points-config"}' hx-target="#bp-msg" hx-swap="innerHTML">
          <div class="sf" style="margin-bottom:14px;">
            <label class="sf-label">Internal (Date-Leg)</label>
            <input type="number" name="internalBonusPoints" value={String(config.internalBonusPoints)} class="sf-input num" min="0" />
          </div>
          <div class="sf" style="margin-bottom:14px;">
            <label class="sf-label">Partner (Package)</label>
            <input type="number" name="partnerBonusPoints" value={String(config.partnerBonusPoints)} class="sf-input num" min="0" />
          </div>
          <div style="font-size:11px;color:var(--text-dim);line-height:1.5;margin-bottom:4px;">Set to 0 to disable. Points are consumed by question weight (default 5 per question).</div>
          <div class="modal-actions" style="margin-top:12px;">
            <button type="button" class="sf-btn secondary" data-close-modal="bonus-points-modal">Cancel</button>
            <button type="submit" class="sf-btn primary">Save</button>
          </div>
        </form>
        <span id="bp-msg"></span>
      </div>
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
