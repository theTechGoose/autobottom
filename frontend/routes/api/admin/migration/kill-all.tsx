/** HTMX fragment: kill-all running migration jobs. Big red button. */
import { define } from "../../../../lib/define.ts";
import { apiPost } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import type { VNode } from "preact";

interface KillAllResponse {
  ok: boolean;
  killed?: number;
  message?: string;
  error?: string;
}

export const handler = define.handlers({
  async POST(ctx) {
    let r: KillAllResponse;
    try {
      r = await apiPost<KillAllResponse>("/admin/migration/kill-all", ctx.req, {});
    } catch (e) {
      return html(<div class="error-text">kill-all failed: {String(e)}</div>);
    }
    if (!r.ok) return html(<div class="error-text">{r.error ?? "unknown"}</div>);
    const killed = r.killed ?? 0;
    return html(
      <div style={`color:${killed > 0 ? "var(--red)" : "var(--text-dim)"};`}>
        {killed > 0 ? `🛑 killed ${killed} running job(s)` : "no running jobs to kill"}
      </div>,
    );
  },
});

function html(el: VNode): Response {
  return new Response(renderToString(el), { headers: { "content-type": "text/html" } });
}
