/** GET: render the list of current assignments matching this config. */
import { define } from "../../../../lib/define.ts";
import { apiFetch } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import { escapeHtml } from "../../../../lib/qlab-render.tsx";

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const type = url.searchParams.get("type") ?? "internal";
    const configName = url.searchParams.get("configName") ?? "";
    let internal: Record<string, string> = {};
    let partner: Record<string, string> = {};
    try {
      const r = await apiFetch<{ internal: Record<string, string>; partner: Record<string, string> }>(
        "/api/qlab-assignments",
        ctx.req,
      );
      internal = r.internal ?? {};
      partner = r.partner ?? {};
    } catch (e) {
      return new Response(`<div style="color:var(--red);font-size:11px;">Load failed: ${escapeHtml((e as Error).message)}</div>`, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    const map = type === "internal" ? internal : partner;
    const matching = Object.entries(map).filter(([_k, v]) => v === configName);

    const html = renderToString(
      matching.length === 0 ? (
        <div style="color:var(--text-dim);font-size:11px;">No bindings for "{configName}".</div>
      ) : (
        <ul style="list-style:none;padding:0;margin:0;font-size:11px;">
          {matching.map(([k, _v]) => (
            <li key={k} style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px;border-bottom:1px solid var(--border);">
              <span style="font-family:var(--mono);color:var(--text);">{k}</span>
              <button
                class="sf-btn danger"
                style="font-size:9px;"
                hx-post={`/api/qlab/assignments/clear?type=${type}&key=${encodeURIComponent(k)}&configName=${encodeURIComponent(configName)}`}
                hx-target="closest li"
                hx-swap="outerHTML"
              >Unbind</button>
            </li>
          ))}
        </ul>
      ),
    );
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  },
});
