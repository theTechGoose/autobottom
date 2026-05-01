/** HTMX fragment: sanity-check that PROD_EXPORT_BASE_URL + KV_EXPORT_SECRET are set. */
import { define } from "../../../../lib/define.ts";
import { apiFetch } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import type { VNode } from "preact";

interface CheckResp { ok: boolean; message?: string; url?: string; }

export const handler = define.handlers({
  async GET(ctx) {
    let r: CheckResp;
    try {
      r = await apiFetch<CheckResp>("/admin/migration/config-check", ctx.req);
    } catch (e) {
      return html(<div class="error-text">{String(e)}</div>);
    }
    const c = r.ok ? "var(--green)" : "var(--red)";
    return html(
      <div style={`font-size:11px;color:${c};`}>
        {r.ok ? "✓ configured" : "⚠ not configured"} {r.message && `— ${r.message}`}
        {r.ok && r.url && <span style="color:var(--text-dim);margin-left:8px;font-family:monospace;">{r.url}</span>}
      </div>,
    );
  },
});

function html(el: VNode): Response {
  return new Response(renderToString(el), { headers: { "content-type": "text/html" } });
}
