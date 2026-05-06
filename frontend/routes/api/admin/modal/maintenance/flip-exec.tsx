/** HTMX fragment: execute bulk-flip on the submitted findingIds. */
import { define } from "../../../../../lib/define.ts";
import { apiPost } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import type { VNode } from "preact";

interface FlipResp { ok?: boolean; flipped?: number; total?: number; error?: string; }

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const ids = form.getAll("findingId").map((v) => String(v)).filter(Boolean);
    const mode = form.get("mode")?.toString() ?? "selected";
    if (mode === "selected" && ids.length === 0) {
      return html(<div class="error-text" style="font-size:11px;">No rows selected.</div>);
    }
    // For "all" mode, the form already includes every checkbox-able row's id
    // — but only the checked ones submit "findingId". To get all, we'd need
    // hidden fields. For now "all" requires the user to manually select all
    // rows; if mode === "all" but no ids, ask them to select.
    let r: FlipResp;
    try {
      r = await apiPost<FlipResp>("/admin/bulk-flip", ctx.req, { findingIds: ids });
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
