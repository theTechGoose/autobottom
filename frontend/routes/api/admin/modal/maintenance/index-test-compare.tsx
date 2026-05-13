/** Count-comparison runner for an indexed query.
 *
 *  Fires /admin/index-test-compare?name=<n> and renders a result fragment
 *  that surfaces both the indexed count and the brute-force-scan count
 *  on the same 30-day window. The delta (legacyInWindow - indexedCount)
 *  and legacyMissingField count are the two numbers worth eyeballing:
 *
 *  - delta=0, legacyMissingField=0 → indexed query is exactly equivalent
 *    to the brute-force scan. Production swap is safe with zero
 *    behavior change.
 *
 *  - delta>0 or legacyMissingField>0 → there are docs in the store the
 *    indexed query is silently excluding. Need a backfill or fallback
 *    before swapping that callsite. */

import { define } from "../../../../../lib/define.ts";
import { apiPost } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import type { VNode } from "preact";

interface Resp {
  ok?: boolean;
  type?: string;
  fieldName?: string;
  windowSinceMs?: number;
  windowUntilMs?: number;
  indexedCount?: number;
  indexedError?: string;
  indexedTookMs?: number;
  legacyTotalScanned?: number;
  legacyInWindow?: number;
  legacyMissingField?: number;
  missingSample?: string[];
  delta?: number;
  legacyTookMs?: number;
  tookMs?: number;
  skipped?: boolean;
  skipReason?: string;
  error?: string;
}

export const handler = define.handlers({
  async POST(ctx) {
    const url = new URL(ctx.req.url);
    const name = url.searchParams.get("name") ?? "";
    if (!name) return html(<div class="error-text" style="font-size:11px;">missing ?name=</div>);

    let r: Resp;
    try {
      r = await apiPost<Resp>(`/admin/index-test-compare?name=${encodeURIComponent(name)}`, ctx.req, {});
    } catch (e) {
      return html(<div class="error-text" style="font-size:11px;">Request failed: {String(e)}</div>);
    }

    if (r.error) return html(<div class="error-text" style="font-size:11px;">{r.error}</div>);

    if (r.skipped) {
      return html(
        <div style="padding:8px 10px;border:1px solid var(--text-dim);border-radius:4px;font-size:11px;color:var(--text-dim);">
          <strong>Skipped.</strong> {r.skipReason}
        </div>,
      );
    }

    const isClean = (r.delta ?? 0) === 0 && (r.legacyMissingField ?? 0) === 0;
    const borderColor = r.indexedError
      ? "var(--red)"
      : isClean
      ? "var(--green)"
      : "var(--yellow)";
    const headerColor = borderColor;
    const fmtDate = (ms?: number) => ms ? new Date(ms).toISOString().slice(0, 10) : "?";

    return html(
      <div style={`padding:10px 12px;border:1px solid ${borderColor};border-radius:4px;background:rgba(255,255,255,0.02);font-size:11px;`}>
        <div style={`font-weight:600;color:${headerColor};margin-bottom:6px;`}>
          {isClean ? "✓ Counts match" : r.indexedError ? "❌ Indexed query failed" : "⚠️ Mismatch"} — {r.type} by {r.fieldName}
        </div>
        <div style="display:grid;grid-template-columns:max-content 1fr;gap:4px 14px;color:var(--text-dim);">
          <span>Window:</span><span><strong style="color:var(--text-bright);">{fmtDate(r.windowSinceMs)} → {fmtDate(r.windowUntilMs)}</strong> (30 days)</span>
          <span>Indexed:</span><span><strong style="color:var(--text-bright);">{r.indexedCount}</strong> row(s) in {r.indexedTookMs}ms</span>
          <span>Legacy scan:</span><span><strong style="color:var(--text-bright);">{r.legacyTotalScanned}</strong> total · <strong>{r.legacyInWindow}</strong> in window · <strong style={`color:${(r.legacyMissingField ?? 0) > 0 ? "var(--yellow)" : "var(--text-bright)"};`}>{r.legacyMissingField}</strong> missing field — in {r.legacyTookMs}ms</span>
          <span>Delta:</span><span><strong style={`color:${(r.delta ?? 0) === 0 ? "var(--green)" : "var(--yellow)"};`}>{r.delta}</strong> (legacyInWindow - indexed)</span>
        </div>
        {r.indexedError && (
          <pre style="margin-top:8px;padding:6px;background:var(--bg-raised);border-radius:3px;font-size:10px;max-height:120px;overflow:auto;color:var(--red);white-space:pre-wrap;">{r.indexedError}</pre>
        )}
        {(r.legacyMissingField ?? 0) > 0 && r.missingSample && r.missingSample.length > 0 && (
          <details style="margin-top:8px;">
            <summary style="cursor:pointer;color:var(--yellow);">Sample missing-field doc IDs ({r.missingSample.length} of {r.legacyMissingField})</summary>
            <pre style="margin-top:4px;padding:6px;background:var(--bg-raised);border-radius:3px;font-size:10px;color:var(--text-dim);">
              {r.missingSample.join("\n")}
            </pre>
          </details>
        )}
      </div>,
    );
  },
});

function html(el: VNode): Response {
  return new Response(renderToString(el), { headers: { "content-type": "text/html" } });
}
