/** Initial load for the Question Failures panel — fires when the modal
 *  opens (hx-trigger="load"). Shows the default "This Month" view so the
 *  operator sees data immediately without having to click a preset. */

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

function currentYyyymm(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const handler = define.handlers({
  async GET(ctx) {
    const yyyymm = currentYyyymm();
    let r: Resp;
    try {
      r = await apiFetch<Resp>(`/admin/question-failures?from=${yyyymm}&to=${yyyymm}`, ctx.req);
    } catch (e) {
      const html = renderToString(
        <div style="font-size:11px;color:var(--text-dim);padding:18px;text-align:center;">
          Failed to load: {String((e as Error).message ?? e)}
        </div>,
      );
      return new Response(html, { headers: { "content-type": "text/html" } });
    }
    const rows = r.rows ?? [];
    const fmt = (n: number) => n.toLocaleString();
    const fmtTime = (ms: number | null) =>
      ms ? new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
    const totalFailed = rows.reduce((s, x) => s + x.failed, 0);
    const totalFlippedPass = rows.reduce((s, x) => s + x.flippedToPass, 0);
    const totalFlippedFail = rows.reduce((s, x) => s + x.flippedToFail, 0);

    const html = renderToString(
      <div style="border:1px solid var(--border);border-radius:6px;padding:12px;background:var(--bg);">
        <div style="font-size:12px;font-weight:700;color:var(--text-bright);margin-bottom:8px;">
          Question Failures — This Month
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:12px;">
          <SummaryStat label="Questions" value={fmt(rows.length)} />
          <SummaryStat label="Total Failed" value={fmt(totalFailed)} color="var(--red)" />
          <SummaryStat label="Flipped → Pass" value={fmt(totalFlippedPass)} color="var(--green)" />
          <SummaryStat label="Flipped → Fail" value={fmt(totalFlippedFail)} color="var(--yellow)" />
        </div>
        {rows.length === 0 ? (
          <div style="text-align:center;color:var(--text-dim);font-size:12px;padding:18px;">
            No counter data for this month yet. Live audits finalizing will populate counters automatically.
          </div>
        ) : (
          <table class="data-table" style="width:100%;font-size:11px;">
            <thead>
              <tr style="text-align:left;color:var(--text-dim);font-size:10px;text-transform:uppercase;letter-spacing:1px;">
                <th style="padding:6px 8px;">Question</th>
                <th style="padding:6px 8px;">Config</th>
                <th style="padding:6px 8px;width:80px;">Failed</th>
                <th style="padding:6px 8px;width:120px;">Flipped → Pass</th>
                <th style="padding:6px 8px;width:120px;">Flipped → Fail</th>
                <th style="padding:6px 8px;width:130px;">Last Failed</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 200).map((row) => (
                <tr key={`${row.configKey}::${row.questionKey}`} style="border-top:1px solid var(--border);">
                  <td style="padding:6px 8px;color:var(--text-bright);">
                    {row.headerSample || row.questionKey}
                    {row.sampleFindingIds.length > 0 && (
                      <details style="margin-top:4px;">
                        <summary style="font-size:10px;color:var(--text-dim);cursor:pointer;">{row.sampleFindingIds.length} sample(s)</summary>
                        <div style="font-size:10px;color:var(--text-dim);margin-top:4px;display:flex;flex-direction:column;gap:2px;">
                          {row.sampleFindingIds.map((fid) => (
                            <a
                              key={fid}
                              href={`/audit/report?id=${encodeURIComponent(fid)}`}
                              target="_blank"
                              rel="noopener"
                              style="color:var(--blue);text-decoration:none;font-family:var(--mono);"
                            >{fid}</a>
                          ))}
                        </div>
                      </details>
                    )}
                  </td>
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
          <div style="margin-top:6px;font-size:10px;color:var(--text-dim);">Showing top 200 of {fmt(rows.length)}.</div>
        )}
        <div style="font-size:10px;color:var(--text-dim);margin-top:8px;">
          Read in {fmt(r.tookMs ?? 0)}ms · range {r.range?.from} → {r.range?.to}
        </div>
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
