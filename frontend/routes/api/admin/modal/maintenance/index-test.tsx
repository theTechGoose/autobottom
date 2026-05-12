/** Index test runner — fires /admin/index-test?name=<name> for a single
 *  named query and renders the result inline.
 *
 *  Green ✓: composite index exists; returns row count + timing.
 *  Red ❌ with createIndexUrl: composite index missing — surfaces the
 *    Firestore console URL as a clickable link. Operator clicks, Firebase
 *    UI shows the index spec pre-filled, click Create, wait for build,
 *    re-click Run.
 *  Red ❌ other: raw error in a <pre>.
 *
 *  Targeted by the IndexTestCard buttons rendered in maintenance.tsx's
 *  IndexTestsPanel (Index Tests tab). One endpoint, one route, parameterized
 *  by query name — keeps the per-card UI thin. */

import { define } from "../../../../../lib/define.ts";
import { apiPost } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import type { VNode } from "preact";

interface Resp {
  ok?: boolean;
  type?: string;
  fieldName?: string;
  rows?: number;
  tookMs?: number;
  error?: string;
  createIndexUrl?: string;
  missingIndex?: boolean;
}

export const handler = define.handlers({
  async POST(ctx) {
    const url = new URL(ctx.req.url);
    const name = url.searchParams.get("name") ?? "";
    if (!name) return html(<div class="error-text" style="font-size:11px;">missing ?name=</div>);

    let r: Resp;
    try {
      r = await apiPost<Resp>(`/admin/index-test?name=${encodeURIComponent(name)}`, ctx.req, {});
    } catch (e) {
      return html(<div class="error-text" style="font-size:11px;">Request failed: {String(e)}</div>);
    }

    if (r.ok) {
      return html(
        <div style="padding:8px 10px;border:1px solid var(--green);border-radius:4px;background:rgba(0,200,100,0.06);font-size:11px;color:var(--green);">
          <strong>✓ Index exists.</strong> {r.type} by {r.fieldName} — returned {r.rows} row(s) in {r.tookMs}ms.
        </div>,
      );
    }

    if (r.missingIndex && r.createIndexUrl) {
      return html(
        <div style="padding:10px 12px;border:1px solid var(--yellow);border-radius:4px;background:rgba(229,192,123,0.08);font-size:11px;color:var(--yellow);">
          <div style="font-weight:600;margin-bottom:6px;">⚠️ Index missing for {r.type} by {r.fieldName}</div>
          <div style="margin-bottom:8px;color:var(--text-dim);">Click the link below to create the composite index in the Firebase console, then re-run this test.</div>
          <a
            href={r.createIndexUrl}
            target="_blank"
            rel="noopener noreferrer"
            style="color:var(--accent);word-break:break-all;font-family:var(--mono);font-size:10px;"
          >{r.createIndexUrl}</a>
        </div>,
      );
    }

    return html(
      <div class="error-text" style="font-size:11px;padding:8px 10px;border:1px solid var(--red);border-radius:4px;">
        <div style="font-weight:600;margin-bottom:4px;">❌ {r.type ?? name} by {r.fieldName ?? "?"} — {r.tookMs}ms</div>
        <pre style="margin:0;font-size:10px;max-height:160px;overflow:auto;color:var(--text-dim);white-space:pre-wrap;">{r.error ?? "unknown error"}</pre>
      </div>,
    );
  },
});

function html(el: VNode): Response {
  return new Response(renderToString(el), { headers: { "content-type": "text/html" } });
}
