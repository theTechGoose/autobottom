/** HTMX fragment: capture cutover snapshot, return result. */
import { define } from "../../../../lib/define.ts";
import { apiPost } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import type { VNode } from "preact";

interface SnapResp {
  ok: boolean;
  error?: string;
  snapshot?: { capturedAt: number; versionstamp: string; sampleKey: string };
}

export const handler = define.handlers({
  async POST(ctx) {
    let r: SnapResp;
    try {
      r = await apiPost<SnapResp>("/admin/migration/snapshot", ctx.req, {});
    } catch (e) {
      return html(<div class="error-text">snapshot failed: {String(e)}</div>);
    }
    if (!r.ok || !r.snapshot) {
      return html(<div class="error-text">{r.error ?? "snapshot failed"}</div>);
    }
    return html(
      <div style="border:1px solid var(--green);border-radius:6px;padding:10px;background:var(--bg);">
        <div style="font-size:11px;color:var(--green);margin-bottom:4px;font-weight:700;">SNAPSHOT CAPTURED</div>
        <div style="font-size:11px;color:var(--text-dim);">Captured at {new Date(r.snapshot.capturedAt).toLocaleString()}</div>
        <div style="font-family:monospace;font-size:11px;margin-top:4px;">
          Versionstamp: <span id="mig-snap-vs" style="color:var(--text-bright);">{r.snapshot.versionstamp}</span>
        </div>
        <div style="font-size:10px;color:var(--text-dim);margin-top:6px;">
          Use this versionstamp in the "Run delta" form below to migrate only entries changed after this point.
        </div>
      </div>,
    );
  },
});

function html(el: VNode): Response {
  return new Response(renderToString(el), { headers: { "content-type": "text/html" } });
}
