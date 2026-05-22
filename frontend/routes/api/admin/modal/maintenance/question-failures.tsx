/** Question Failures report — POST handler that calls /admin/question-failures
 *  with the form's from/to month inputs (YYYYMM, defaults to current month
 *  on the backend) and an optional configKey filter, then renders the
 *  result as a sortable summary table. Bounded reads — one collection scan
 *  over `question-fail-stat`, filtered by month range. */

import { define } from "../../../../../lib/define.ts";
import { apiFetch } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

interface Row {
  configKey: string;
  questionKey: string;
  headerSample: string;
  failed: number;
  flippedToPass: number;
  flippedToFail: number;
  netFailRate: number;
  sampleFindingIds: string[];
  lastFailedAt: number | null;
  months: string[];
}

interface Resp {
  ok?: boolean;
  range?: { from: string; to: string };
  rows?: Row[];
  tookMs?: number;
  error?: string;
}

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const fromMonth = String(form.get("from") ?? "").trim();
    const toMonth = String(form.get("to") ?? "").trim();
    const configKey = String(form.get("configKey") ?? "").trim();
    const qs = new URLSearchParams();
    if (fromMonth) qs.set("from", fromMonth);
    if (toMonth) qs.set("to", toMonth);
    if (configKey) qs.set("configKey", configKey);

    let r: Resp;
    try {
      r = await apiFetch<Resp>(`/admin/question-failures?${qs.toString()}`, ctx.req);
    } catch (e) {
      const html = renderToString(
        <div class="error-text" style="font-size:11px;padding:10px;border:1px solid var(--red);border-radius:6px;">
          Question Failures failed: {String((e as Error).message ?? e)}
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

    const rows = r.rows ?? [];
    const totalFailed = rows.reduce((s, x) => s + x.failed, 0);
    const totalFlippedPass = rows.reduce((s, x) => s + x.flippedToPass, 0);
    const totalFlippedFail = rows.reduce((s, x) => s + x.flippedToFail, 0);
    const fmt = (n: number) => n.toLocaleString();
    const fmtTime = (ms: number | null) =>
      ms ? new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
    const rangeLabel = r.range ? `${r.range.from} → ${r.range.to}` : "—";

    const html = renderToString(
      <div style="border:1px solid var(--border);border-radius:6px;padding:12px;background:var(--bg);">
        <div style="font-size:12px;font-weight:700;color:var(--text-bright);margin-bottom:8px;">
          Question Failures — {rangeLabel}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:12px;">
          <SummaryStat label="Questions" value={fmt(rows.length)} />
          <SummaryStat label="Total Failed" value={fmt(totalFailed)} color="var(--red)" />
          <SummaryStat label="Flipped → Pass" value={fmt(totalFlippedPass)} color="var(--green)" />
          <SummaryStat label="Flipped → Fail" value={fmt(totalFlippedFail)} color="var(--yellow)" />
        </div>
        {rows.length === 0 ? (
          <div style="text-align:center;color:var(--text-dim);font-size:12px;padding:18px;">
            No counter data in this range. If you expect data, try Backfill below first.
          </div>
        ) : (
          <table class="data-table" style="width:100%;font-size:11px;">
            <thead>
              <tr style="text-align:left;color:var(--text-dim);font-size:10px;text-transform:uppercase;letter-spacing:1px;">
                <th style="padding:6px 8px;">Question</th>
                <th style="padding:6px 8px;">Config</th>
                <th style="padding:6px 8px;width:80px;">Failed</th>
                <th style="padding:6px 8px;width:120px;">Flipped→Pass</th>
                <th style="padding:6px 8px;width:120px;">Flipped→Fail</th>
                <th style="padding:6px 8px;width:130px;">Last Failed</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 200).map((row) => (
                <tr key={`${row.configKey}::${row.questionKey}`} style="border-top:1px solid var(--border);">
                  <td style="padding:6px 8px;color:var(--text-bright);">{row.headerSample || row.questionKey}</td>
                  <td style="padding:6px 8px;color:var(--text-dim);font-family:var(--mono);">{row.configKey}</td>
                  <td style="padding:6px 8px;color:var(--red);font-weight:600;">{fmt(row.failed)}</td>
                  <td style="padding:6px 8px;color:var(--green);">{fmt(row.flippedToPass)}</td>
                  <td style="padding:6px 8px;color:var(--yellow);">{fmt(row.flippedToFail)}</td>
                  <td style="padding:6px 8px;color:var(--text-dim);">{fmtTime(row.lastFailedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {rows.length > 200 && (
          <div style="margin-top:6px;font-size:10px;color:var(--text-dim);">Showing top 200 of {fmt(rows.length)} — tighten the range or set a configKey filter to narrow further.</div>
        )}
        <div style="font-size:10px;color:var(--text-dim);margin-top:8px;">Total {fmt(r.tookMs ?? 0)}ms.</div>
      </div>,
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});

function SummaryStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style="border:1px solid var(--border);border-radius:6px;padding:10px;background:var(--bg-2);">
      <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">{label}</div>
      <div style={`font-size:18px;font-weight:700;color:${color ?? "var(--text-bright)"};`}>{value}</div>
    </div>
  );
}
