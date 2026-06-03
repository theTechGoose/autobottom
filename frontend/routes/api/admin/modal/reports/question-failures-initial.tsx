/** Initial load for the Question Failures panel — fires when the modal
 *  opens (hx-trigger="load"). Shows the default "This Month" view so the
 *  operator sees data immediately without having to click a preset. */

import { define } from "../../../../../lib/define.ts";
import { apiFetch } from "../../../../../lib/api.ts";
import { resolveQfRange } from "../../../../../lib/qf-range.ts";
import { QuestionFailuresStatsAndTable, type QfRow } from "../../../../../components/QuestionFailuresTable.tsx";
import { renderToString } from "preact-render-to-string";

interface Resp {
  ok?: boolean;
  range?: { from: string; to: string };
  rows?: QfRow[];
  tookMs?: number;
  error?: string;
}

export const handler = define.handlers({
  async GET(ctx) {
    const { from, to } = resolveQfRange("this-month", "", "");
    let r: Resp;
    try {
      r = await apiFetch<Resp>(`/admin/question-failures?from=${from}&to=${to}`, ctx.req);
    } catch (e) {
      const html = renderToString(
        <div style="font-size:11px;color:var(--text-dim);padding:18px;text-align:center;">
          Failed to load: {String((e as Error).message ?? e)}
        </div>,
      );
      return new Response(html, { headers: { "content-type": "text/html" } });
    }
    const rows = r.rows ?? [];
    const popoutHref = `/admin/question-failures?from=${from}&to=${to}`;

    const html = renderToString(
      <div style="border:1px solid var(--border);border-radius:6px;padding:12px;background:var(--bg);">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;">
          <div style="font-size:12px;font-weight:700;color:var(--text-bright);">
            Question Failures — This Month
          </div>
          <a href={popoutHref} target="_blank" rel="noopener" class="sf-btn ghost"
            style="font-size:11px;padding:4px 10px;text-decoration:none;white-space:nowrap;">Open full report ↗</a>
        </div>
        <QuestionFailuresStatsAndTable
          rows={rows}
          tookMs={r.tookMs}
          rangeFrom={r.range?.from}
          rangeTo={r.range?.to}
          emptyHint="No counter data for this month yet. Live audits finalizing will populate counters automatically."
        />
      </div>,
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
