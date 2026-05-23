/** Weekly Report preview — POSTs to backend /admin/email-reports/preview
 *  (which generates + stores the HTML), then returns an iframe pointing to
 *  /admin/email-reports/preview-view?configId=X for safe rendering. */

import { define } from "../../../../../lib/define.ts";
import { apiFetch } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

interface PreviewResp { html?: string; error?: string }

export const handler = define.handlers({
  async POST(ctx) {
    const configId = (new URL(ctx.req.url).searchParams.get("configId") ?? "").trim();
    if (!configId) {
      const html = renderToString(
        <div style="font-size:11px;color:var(--red);padding:8px;border:1px solid var(--red);border-radius:6px;">
          configId required
        </div>,
      );
      return new Response(html, { headers: { "content-type": "text/html" } });
    }

    let r: PreviewResp;
    try {
      r = await apiFetch<PreviewResp>("/admin/email-reports/preview", ctx.req, {
        method: "POST",
        body: JSON.stringify({ id: configId }),
        headers: { "content-type": "application/json" },
      });
    } catch (e) {
      const html = renderToString(
        <div style="font-size:11px;color:var(--red);padding:8px;border:1px solid var(--red);border-radius:6px;">
          Preview generation failed: {String((e as Error).message ?? e)}
        </div>,
      );
      return new Response(html, { headers: { "content-type": "text/html" } });
    }

    if (r.error) {
      const html = renderToString(
        <div style="font-size:11px;color:var(--red);padding:8px;border:1px solid var(--red);border-radius:6px;">
          Backend rejected: {r.error}
        </div>,
      );
      return new Response(html, { headers: { "content-type": "text/html" } });
    }

    const previewHtml = r.html ?? "";
    // Use srcdoc so the iframe renders the HTML in an isolated document
    // (own styles, no leakage in either direction). The preview HTML is
    // already saved in Firestore via the /admin/email-reports/preview-view
    // endpoint for future deep-linking, but we embed inline here to keep
    // the request count down and avoid a second round-trip.
    const html = renderToString(
      <div style="border:1px solid var(--border);border-radius:8px;background:var(--bg-2);overflow:hidden;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:var(--bg);border-bottom:1px solid var(--border);">
          <span style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;">Preview</span>
          <button
            type="button"
            class="sf-btn ghost"
            style="font-size:10px;padding:2px 8px;"
            hx-get={`/api/admin/modal/reports/preview-close?configId=${encodeURIComponent(configId)}`}
            hx-target={`#wr-preview-${configId}`}
            hx-swap="innerHTML"
          >Close</button>
        </div>
        <iframe
          srcdoc={previewHtml}
          style="display:block;width:100%;height:600px;border:0;background:#fff;"
          title={`Preview of ${configId}`}
        ></iframe>
      </div>,
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
