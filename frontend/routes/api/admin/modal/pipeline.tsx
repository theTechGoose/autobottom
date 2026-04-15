/** Modal content: Pipeline config — retries, delays, parallelism. */
import { define } from "../../../../lib/define.ts";
import { apiFetch } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

export const handler = define.handlers({
  async GET(ctx) {
    let config = { maxRetries: 0, retryDelaySeconds: 0, parallelism: 0 };
    let para = { parallelism: 0 };
    try { config = await apiFetch("/admin/pipeline-config", ctx.req); } catch {}
    try { para = await apiFetch("/admin/parallelism", ctx.req); } catch {}
    const html = renderToString(
      <div>
        <form hx-post="/api/admin/config-save" hx-vals='{"endpoint":"/admin/pipeline-config"}' hx-target="#pipe-msg" hx-swap="innerHTML">
          <div style="display:flex;gap:16px;margin-bottom:12px;">
            <div><label class="sf-label">Max Retries</label><input type="number" name="maxRetries" value={String(config.maxRetries)} class="sf-input num" /></div>
            <div><label class="sf-label">Retry Delay (s)</label><input type="number" name="retryDelaySeconds" value={String(config.retryDelaySeconds)} class="sf-input num" /></div>
          </div>
          <div style="display:flex;gap:6px;align-items:center;margin-bottom:16px;"><button type="submit" class="btn btn-primary" style="padding:5px 14px;font-size:11px;">Save Pipeline</button><span id="pipe-msg"></span></div>
        </form>
        <div style="border-top:1px solid var(--border);padding-top:12px;">
          <form hx-post="/api/admin/config-save" hx-vals='{"endpoint":"/admin/parallelism"}' hx-target="#para-msg" hx-swap="innerHTML">
            <div><label class="sf-label">Parallelism</label><input type="number" name="parallelism" value={String(para.parallelism)} class="sf-input num" /></div>
            <div style="display:flex;gap:6px;align-items:center;margin-top:8px;"><button type="submit" class="btn btn-primary" style="padding:5px 14px;font-size:11px;">Save</button><span id="para-msg"></span></div>
          </form>
        </div>
      </div>
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
