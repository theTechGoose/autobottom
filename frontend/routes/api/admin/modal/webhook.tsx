/** Modal content: Webhook config — 7 event types. */
import { define } from "../../../../lib/define.ts";
import { apiFetch } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

const KINDS = ["terminate", "appeal", "manager", "review", "judge", "judge-finish", "re-audit-receipt"];

export const handler = define.handlers({
  async GET(ctx) {
    const configs: Record<string, { postUrl?: string; postHeaders?: unknown }> = {};
    for (const k of KINDS) { try { configs[k] = await apiFetch(`/admin/settings/${k}`, ctx.req); } catch { configs[k] = {}; } }
    const html = renderToString(
      <div style="max-height:60vh;overflow-y:auto;">
        {KINDS.map((kind) => (
          <div key={kind} style="margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--border);">
            <div style="font-size:13px;font-weight:700;color:var(--text-bright);text-transform:capitalize;margin-bottom:8px;">{kind.replace(/-/g, " ")}</div>
            <form hx-post={`/api/admin/webhook-save?kind=${kind}`} hx-target={`#wh-${kind}`} hx-swap="innerHTML">
              <div style="display:flex;gap:8px;margin-bottom:6px;"><label class="sf-label" style="min-width:50px;">URL</label><input type="url" name="postUrl" value={configs[kind]?.postUrl ?? ""} placeholder="https://..." class="sf-input" style="flex:1;" /></div>
              <div style="display:flex;gap:8px;margin-bottom:6px;"><label class="sf-label" style="min-width:50px;">Headers</label><textarea name="postHeaders" rows={2} class="sf-input" style="flex:1;font-family:var(--mono);font-size:11px;resize:vertical;">{JSON.stringify(configs[kind]?.postHeaders ?? {}, null, 2)}</textarea></div>
              <div style="display:flex;gap:6px;align-items:center;"><button type="submit" class="btn btn-primary" style="padding:4px 12px;font-size:11px;">Save</button><span id={`wh-${kind}`}></span></div>
            </form>
          </div>
        ))}
      </div>
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
