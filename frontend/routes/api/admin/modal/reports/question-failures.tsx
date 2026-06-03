/** Question Failures table fragment — POSTed from the preset bar / custom
 *  range form in /api/admin/modal/reports. Translates the chosen range to
 *  YYYYMM bounds and renders the result table inline.
 *
 *  Data is stored monthly per (configKey, questionKey, yyyymm). Sub-monthly
 *  windows get rounded up to the containing month; date-pickers snap to
 *  YYYYMM in the UI label. */

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

async function renderTable(req: Request, preset: string, customFrom: string, customTo: string, configKey: string): Promise<string> {
  const { from, to, label } = resolveQfRange(preset, customFrom, customTo);
  const qs = new URLSearchParams();
  qs.set("from", from);
  qs.set("to", to);
  if (configKey) qs.set("configKey", configKey);

  let r: Resp;
  try {
    r = await apiFetch<Resp>(`/admin/question-failures?${qs.toString()}`, req);
  } catch (e) {
    return renderToString(
      <div class="error-text" style="font-size:11px;padding:10px;border:1px solid var(--red);border-radius:6px;">
        Failed: {String((e as Error).message ?? e)}
      </div>,
    );
  }

  if (!r.ok) {
    return renderToString(
      <div class="error-text" style="font-size:11px;padding:10px;border:1px solid var(--red);border-radius:6px;">
        Backend rejected: {r.error ?? "unknown"}
      </div>,
    );
  }

  const rows = r.rows ?? [];
  const popoutHref = `/admin/question-failures?from=${from}&to=${to}${configKey ? `&configKey=${encodeURIComponent(configKey)}` : ""}`;

  return renderToString(
    <div style="border:1px solid var(--border);border-radius:6px;padding:12px;background:var(--bg);">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;">
        <div style="font-size:12px;font-weight:700;color:var(--text-bright);">
          Question Failures — {label}
        </div>
        <a href={popoutHref} target="_blank" rel="noopener" class="sf-btn ghost"
          style="font-size:11px;padding:4px 10px;text-decoration:none;white-space:nowrap;">Open full report ↗</a>
      </div>
      <QuestionFailuresStatsAndTable
        rows={rows}
        tookMs={r.tookMs}
        rangeFrom={r.range?.from}
        rangeTo={r.range?.to}
        emptyHint="No counter data in this range. If you expect data here, check Data Maintenance → Question Failures → Backfill."
      />
    </div>,
  );
}

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const preset = String(form.get("preset") ?? "this-month");
    const customFrom = String(form.get("custom-from") ?? "");
    const customTo = String(form.get("custom-to") ?? "");
    const configKey = String(form.get("configKey") ?? "").trim();
    const html = await renderTable(ctx.req, preset, customFrom, customTo, configKey);
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});

/** Sibling GET-only initial-load route lives at /reports/question-failures-initial. */
