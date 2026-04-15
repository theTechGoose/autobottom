/** Modal content: Office bypass. */
import { define } from "../../../../lib/define.ts";
import { apiFetch } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

export const handler = define.handlers({
  async GET(ctx) {
    let config = { patterns: [] as string[] };
    try { config = await apiFetch("/admin/office-bypass", ctx.req); } catch {}
    const html = renderToString(
      <form hx-post="/api/admin/config-save" hx-vals='{"endpoint":"/admin/office-bypass"}' hx-target="#off-msg" hx-swap="innerHTML">
        <div style="margin-bottom:12px;"><label class="sf-label">Bypass Patterns (one per line)</label><textarea name="patterns" rows={6} class="sf-input" style="font-family:var(--mono);font-size:11px;resize:vertical;">{config.patterns?.join("\n") ?? ""}</textarea></div>
        <div style="display:flex;gap:6px;align-items:center;"><button type="submit" class="btn btn-primary" style="padding:5px 14px;font-size:11px;">Save</button><span id="off-msg"></span></div>
      </form>
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
