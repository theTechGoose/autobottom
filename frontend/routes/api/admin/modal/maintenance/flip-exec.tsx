/** HTMX fragment: execute bulk-flip on the submitted findingIds. */
import { define } from "../../../../../lib/define.ts";
import { apiPost } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import type { VNode } from "preact";

interface FlipResp { ok?: boolean; flipped?: number; total?: number; error?: string; }

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const checkedIds = form.getAll("findingId").map((v) => String(v)).filter(Boolean);
    // Hidden fields emitted by flip-pull.tsx for every row in the table —
    // used by "Flip All" so we don't depend on every checkbox being checked.
    const allIds = form.getAll("allFindingId").map((v) => String(v)).filter(Boolean);
    const mode = form.get("mode")?.toString() ?? "selected";
    // "all" → use the hidden full-list; "selected" → use only the checked rows.
    const ids = mode === "all" ? allIds : checkedIds;
    if (ids.length === 0) {
      const msg = mode === "all" ? "No audits in the result table to flip." : "No rows selected.";
      return html(<div class="error-text" style="font-size:11px;">{msg}</div>);
    }
    // flippedBy = the admin's email so the judge view can show who flipped
    // these audits when agents later appeal them.
    const flippedBy = ctx.state.user?.email ?? "admin";
    let r: FlipResp;
    try {
      r = await apiPost<FlipResp>("/admin/bulk-flip", ctx.req, { findingIds: ids, flippedBy });
    } catch (e) {
      return html(<div class="error-text" style="font-size:11px;">Flip failed: {String(e)}</div>);
    }
    if (r.error) return html(<div class="error-text" style="font-size:11px;">{r.error}</div>);
    return html(
      <div style="border:1px solid var(--green);border-radius:6px;padding:10px;background:var(--bg);">
        <div style="font-size:12px;font-weight:700;color:var(--green);margin-bottom:4px;">FLIPPED</div>
        <div style="font-size:11px;color:var(--text-dim);">
          Successfully flipped {r.flipped ?? 0} of {r.total ?? ids.length} audits to 100%.
        </div>
      </div>,
    );
  },
});

function html(el: VNode): Response {
  return new Response(renderToString(el), { headers: { "content-type": "text/html" } });
}
