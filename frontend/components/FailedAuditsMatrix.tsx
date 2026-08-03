/** Failed Audits presentational tables — the department x question matrix and
 *  the ranked by-question list. Pure SSR Preact so the page route stays thin
 *  (mirrors QuestionFailuresTable.tsx). */

export interface MatrixData {
  departments: string[];
  questions: string[]; // questionKeys, already capped + sorted by total
  cells: Record<string, Record<string, number>>;
  rowTotals: Record<string, number>;
  colTotals: Record<string, number>;
  grandTotal: number;
  truncatedQuestions: number;
  headerByKey: Record<string, string>;
}

export interface QuestionCount { header: string; questionKey: string; count: number }
import { questionLabel, shortQuestionLabel } from "@core/business/question-labels/mod.ts";

const TH = "text-align:right;padding:6px 8px;color:var(--text-dim);font-size:10px;text-transform:uppercase;letter-spacing:0.5px;";
const TD = "text-align:right;padding:6px 8px;font-variant-numeric:tabular-nums;";

/** Heat tint: deeper red for higher counts relative to the matrix max. */
function cellStyle(count: number, max: number): string {
  if (!count) return `${TD}color:var(--text-dim);`;
  const intensity = max > 0 ? Math.min(1, count / max) : 0;
  const alpha = (0.08 + intensity * 0.35).toFixed(2);
  return `${TD}color:var(--text-bright);background:rgba(248,81,73,${alpha});`;
}

export function MatrixTable({ matrix }: { matrix: MatrixData }) {
  if (matrix.grandTotal === 0) {
    return (
      <div style="padding:24px;text-align:center;color:var(--text-dim);font-size:12px;">
        No failures match the current filters.
      </div>
    );
  }
  let max = 0;
  for (const qk of matrix.questions) {
    for (const dep of matrix.departments) {
      const c = matrix.cells[qk]?.[dep] ?? 0;
      if (c > max) max = c;
    }
  }
  return (
    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead>
          <tr>
            <th style="text-align:left;padding:6px 12px;color:var(--text-dim);font-size:10px;text-transform:uppercase;letter-spacing:0.5px;position:sticky;left:0;background:var(--bg);">Question \ Department</th>
            {matrix.departments.map((d) => (
              <th key={d} style={TH}>{d}</th>
            ))}
            <th style={`${TH}color:var(--text-bright);`}>Total</th>
          </tr>
        </thead>
        <tbody>
          {matrix.questions.map((qk) => (
            <tr key={qk} style="border-top:1px solid var(--border);">
              <td style="text-align:left;padding:6px 12px;color:var(--text-bright);position:sticky;left:0;background:var(--bg);">{shortQuestionLabel(matrix.headerByKey[qk] ?? qk)}</td>
              {matrix.departments.map((d) => {
                const c = matrix.cells[qk]?.[d] ?? 0;
                return <td key={d} style={cellStyle(c, max)}>{c || "—"}</td>;
              })}
              <td style={`${TD}font-weight:700;color:var(--text-bright);`}>{matrix.rowTotals[qk] ?? 0}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style="border-top:2px solid var(--border);">
            <td style="text-align:left;padding:6px 12px;color:var(--text-dim);font-weight:700;position:sticky;left:0;background:var(--bg);">Total</td>
            {matrix.departments.map((d) => (
              <td key={d} style={`${TD}font-weight:700;color:var(--text-dim);`}>{matrix.colTotals[d] ?? 0}</td>
            ))}
            <td style={`${TD}font-weight:800;color:var(--red);`}>{matrix.grandTotal}</td>
          </tr>
        </tfoot>
      </table>
      {matrix.truncatedQuestions > 0 && (
        <div style="padding:8px 12px;font-size:11px;color:var(--text-dim);">
          Showing the top {matrix.questions.length} questions by failures. {matrix.truncatedQuestions} more not shown, narrow the filters to see them.
        </div>
      )}
    </div>
  );
}

export function ByQuestionTable({ rows, total }: { rows: QuestionCount[]; total: number }) {
  if (rows.length === 0) {
    return (
      <div style="padding:24px;text-align:center;color:var(--text-dim);font-size:12px;">
        No failures match the current filters.
      </div>
    );
  }
  const top = rows[0]?.count || 1;
  return (
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead>
        <tr>
          <th style="text-align:left;padding:6px 12px;color:var(--text-dim);font-size:10px;text-transform:uppercase;letter-spacing:0.5px;">#</th>
          <th style="text-align:left;padding:6px 8px;color:var(--text-dim);font-size:10px;text-transform:uppercase;letter-spacing:0.5px;">Question</th>
          <th style={TH}>Failures</th>
          <th style="text-align:left;padding:6px 12px;color:var(--text-dim);font-size:10px;text-transform:uppercase;letter-spacing:0.5px;width:40%;">Share</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.questionKey} style="border-top:1px solid var(--border);font-variant-numeric:tabular-nums;">
            <td style="padding:6px 12px;color:var(--text-dim);">{i + 1}</td>
            <td style="padding:6px 8px;color:var(--text-bright);">{shortQuestionLabel(r.header)}</td>
            <td style={`${TD}font-weight:700;`}>{r.count.toLocaleString()}</td>
            <td style="padding:6px 12px;">
              <div style="height:8px;border-radius:4px;background:var(--bg-raised);overflow:hidden;">
                <div style={`height:100%;width:${Math.round((r.count / top) * 100)}%;background:var(--red);`}></div>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr style="border-top:2px solid var(--border);">
          <td></td>
          <td style="padding:6px 8px;color:var(--text-dim);">Total failures</td>
          <td style={`${TD}font-weight:800;color:var(--red);`}>{total.toLocaleString()}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>
  );
}
