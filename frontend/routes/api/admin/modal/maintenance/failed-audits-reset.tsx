/** Wipe the failed-finding index for the org (clean re-backfill). */

import { define } from "../../../../../lib/define.ts";
import { apiFetch } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

interface Resp { ok?: boolean; message?: string; error?: string }

export const handler = define.handlers({
  async POST(ctx) {
    let r: Resp;
    try {
      r = await apiFetch<Resp>("/admin/failed-audits/reset", ctx.req, {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
      });
    } catch (e) {
      const html = renderToString(
        <div class="error-text" style="font-size:11px;padding:10px;border:1px solid var(--red);border-radius:6px;">Reset failed: {String((e as Error).message ?? e)}</div>,
      );
      return new Response(html, { headers: { "content-type": "text/html" } });
    }
    const html = renderToString(
      <div style="border:1px solid var(--border);border-radius:6px;padding:12px;background:var(--bg);">
        <div style="font-size:12px;font-weight:700;color:var(--green);margin-bottom:6px;">✓ Failed Audits index reset</div>
        <div style="font-size:11px;color:var(--text-dim);">{r.message ?? "done"}</div>
      </div>,
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
