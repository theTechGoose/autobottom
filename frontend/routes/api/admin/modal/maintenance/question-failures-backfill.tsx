/** Backfill the per-question counter docs from historical audit-done-idx +
 *  findings. POSTs since/until as ms timestamps to the backend, which wipes
 *  the touched month buckets then re-walks the range. Idempotent. */

import { define } from "../../../../../lib/define.ts";
import { apiFetch } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

interface Resp {
  ok?: boolean;
  range?: { sinceMs: number; untilMs: number };
  monthsTouched?: string[];
  bucketsWiped?: number;
  auditsProcessed?: number;
  failsCounted?: number;
  errors?: number;
  tookMs?: number;
  error?: string;
}

function parseDateToMs(s: string, endOfDay = false): number | null {
  if (!s) return null;
  const ts = Date.parse(s + "T00:00:00Z");
  if (!Number.isFinite(ts)) return null;
  return endOfDay ? ts + 86_400_000 - 1 : ts;
}

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const sinceMs = parseDateToMs(String(form.get("since") ?? "").trim());
    const untilMs = parseDateToMs(String(form.get("until") ?? "").trim(), true);
    if (sinceMs == null || untilMs == null || untilMs <= sinceMs) {
      const html = renderToString(
        <div class="error-text" style="font-size:11px;padding:10px;border:1px solid var(--red);border-radius:6px;">
          Both From and To dates are required and To must be after From.
        </div>,
      );
      return new Response(html, { headers: { "content-type": "text/html" } });
    }

    let r: Resp;
    try {
      r = await apiFetch<Resp>("/admin/question-failures-backfill", ctx.req, {
        method: "POST",
        body: JSON.stringify({ sinceMs, untilMs }),
        headers: { "content-type": "application/json" },
      });
    } catch (e) {
      const html = renderToString(
        <div class="error-text" style="font-size:11px;padding:10px;border:1px solid var(--red);border-radius:6px;">
          Backfill failed: {String((e as Error).message ?? e)}
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
    const rangeLabel = r.range
      ? `${new Date(r.range.sinceMs).toISOString().slice(0, 10)} → ${new Date(r.range.untilMs).toISOString().slice(0, 10)}`
      : "—";

    const html = renderToString(
      <div style="border:1px solid var(--border);border-radius:6px;padding:12px;background:var(--bg);">
        <div style="font-size:12px;font-weight:700;color:var(--green);margin-bottom:8px;">
          ✓ Backfill complete — {rangeLabel}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:11px;color:var(--text-dim);">
          <div>Audits processed: <strong style="color:var(--text-bright);">{fmt(r.auditsProcessed)}</strong></div>
          <div>Fails counted: <strong style="color:var(--red);">{fmt(r.failsCounted)}</strong></div>
          <div>Buckets wiped first: <strong style="color:var(--text-bright);">{fmt(r.bucketsWiped)}</strong></div>
          <div>Months touched: <strong style="color:var(--text-bright);">{(r.monthsTouched ?? []).join(", ") || "—"}</strong></div>
          <div>Errors: <strong style={`color:${(r.errors ?? 0) > 0 ? "var(--yellow)" : "var(--green)"};`}>{fmt(r.errors)}</strong></div>
          <div>Took: <strong style="color:var(--text-bright);">{fmt(r.tookMs)}ms</strong></div>
        </div>
        <div style="font-size:10px;color:var(--text-dim);margin-top:8px;">Re-run the report above to see the new totals.</div>
      </div>,
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
