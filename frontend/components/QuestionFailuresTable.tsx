/** Shared Question Failures summary stats + table. Rendered by the modal
 *  fragment (routes/api/admin/modal/reports/question-failures*) and the
 *  full-page report (routes/admin/question-failures.tsx) so the table lives in
 *  one place. Pure presentational Preact. */

export interface QfRow {
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

const fmt = (n: number) => n.toLocaleString();
const fmtTime = (ms: number | null) =>
  ms ? new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

function SummaryStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style="border:1px solid var(--border);border-radius:6px;padding:10px;background:var(--bg-2);">
      <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">{label}</div>
      <div style={`font-size:18px;font-weight:700;color:${color ?? "var(--text-bright)"};`}>{value}</div>
    </div>
  );
}

export function QuestionFailuresStatsAndTable(
  { rows, tookMs, rangeFrom, rangeTo, rowCap = 200, emptyHint }: {
    rows: QfRow[];
    tookMs?: number;
    rangeFrom?: string;
    rangeTo?: string;
    rowCap?: number;
    emptyHint?: string;
  },
) {
  const totalFailed = rows.reduce((s, x) => s + x.failed, 0);
  const totalFlippedPass = rows.reduce((s, x) => s + x.flippedToPass, 0);
  const totalFlippedFail = rows.reduce((s, x) => s + x.flippedToFail, 0);

  return (
    <>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:12px;">
        <SummaryStat label="Questions" value={fmt(rows.length)} />
        <SummaryStat label="Total Failed" value={fmt(totalFailed)} color="var(--red)" />
        <SummaryStat label="Flipped → Pass" value={fmt(totalFlippedPass)} color="var(--green)" />
        <SummaryStat label="Flipped → Fail" value={fmt(totalFlippedFail)} color="var(--yellow)" />
      </div>
      {rows.length === 0 ? (
        <div style="text-align:center;color:var(--text-dim);font-size:12px;padding:18px;">
          {emptyHint ?? "No counter data in this range. Live audits finalizing will populate counters automatically."}
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
            {rows.slice(0, rowCap).map((row) => (
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
      {rows.length > rowCap && (
        <div style="margin-top:6px;font-size:10px;color:var(--text-dim);">
          Showing top {fmt(rowCap)} of {fmt(rows.length)} — tighten the range or set a config filter to narrow further.
        </div>
      )}
      <div style="font-size:10px;color:var(--text-dim);margin-top:8px;">
        Read in {fmt(tookMs ?? 0)}ms · range {rangeFrom} → {rangeTo}
      </div>
    </>
  );
}
