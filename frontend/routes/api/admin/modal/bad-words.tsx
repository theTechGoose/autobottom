/** Modal content: Bad words config. */
import { define } from "../../../../lib/define.ts";
import { apiFetch } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

export const handler = define.handlers({
  async GET(ctx) {
    let config = { enabled: false, emails: [] as string[], words: [] as unknown[] };
    try { config = await apiFetch("/admin/bad-word-config", ctx.req); } catch {}
    const html = renderToString(
      <form hx-post="/api/admin/config-save" hx-vals='{"endpoint":"/admin/bad-word-config"}' hx-target="#bw-msg" hx-swap="innerHTML">
        <div style="margin-bottom:12px;"><label class="sf-label">Enabled</label><select name="enabled" class="sf-input"><option value="true" selected={config.enabled}>Yes</option><option value="false" selected={!config.enabled}>No</option></select></div>
        <div style="margin-bottom:12px;"><label class="sf-label">Alert Emails (comma-separated)</label><input type="text" name="emails" value={config.emails?.join(", ") ?? ""} class="sf-input" placeholder="alert@company.com" /></div>
        <div style="display:flex;gap:6px;align-items:center;"><button type="submit" class="btn btn-primary" style="padding:5px 14px;font-size:11px;">Save</button><span id="bw-msg"></span></div>
      </form>
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
