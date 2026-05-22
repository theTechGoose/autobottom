/** Reset all question-fail counter state. Wipes question-fail-stat buckets +
 *  question-fail-counted dedup marks for this org. Use when prior backfill
 *  state is corrupt and you want a clean slate before re-running chunks. */

import { define } from "../../../../../lib/define.ts";
import { apiFetch } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

interface Resp {
  ok?: boolean;
  statsDeleted?: number;
  marksDeleted?: number;
  tookMs?: number;
  error?: string;
}

export const handler = define.handlers({
  async POST(ctx) {
    let r: Resp;
    try {
      r = await apiFetch<Resp>("/admin/question-failures-reset", ctx.req, { method: "POST" });
    } catch (e) {
      const html = renderToString(
        <div class="error-text" style="font-size:11px;padding:10px;border:1px solid var(--red);border-radius:6px;">
          Reset failed: {String((e as Error).message ?? e)}
        </div>,
      );
      return new Response(html, { headers: { "content-type": "text/html" } });
    }

    if (!r.ok) {
      const html = renderToString(
        <div class="error-text" style="font-size:11px;padding:10px;border:1px solid var(--red);border-radius:6px;">
          Backend rejected: {r.error ?? "unknown"}
        </div>,
      );
      return new Response(html, { headers: { "content-type": "text/html" } });
    }

    const fmt = (n: number | undefined) => (n ?? 0).toLocaleString();
    const html = renderToString(
      <div style="border:1px solid var(--border);border-radius:6px;padding:12px;background:var(--bg);">
        <div style="font-size:12px;font-weight:700;color:var(--green);margin-bottom:8px;">
          ✓ Counter state wiped
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:11px;color:var(--text-dim);">
          <div>Buckets deleted: <strong style="color:var(--text-bright);">{fmt(r.statsDeleted)}</strong></div>
          <div>Marks deleted: <strong style="color:var(--text-bright);">{fmt(r.marksDeleted)}</strong></div>
          <div>Took: <strong style="color:var(--text-bright);">{fmt(r.tookMs)}ms</strong></div>
        </div>
        <div style="font-size:10px;color:var(--text-dim);margin-top:8px;">
          Re-run your backfill date ranges above. Adjacent chunks will now compose correctly instead of wiping each other.
        </div>
      </div>,
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
