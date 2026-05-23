/** Question Failures table fragment — POSTed from the preset bar / custom
 *  range form in /api/admin/modal/reports. Translates the chosen range to
 *  YYYYMM bounds and renders the result table inline.
 *
 *  Data is stored monthly per (configKey, questionKey, yyyymm). Sub-monthly
 *  windows get rounded up to the containing month; date-pickers snap to
 *  YYYYMM in the UI label. */

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

function shiftMonths(yyyymm: string, delta: number): string {
  const y = Number(yyyymm.slice(0, 4));
  const m = Number(yyyymm.slice(4, 6));
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}${String(nm).padStart(2, "0")}`;
}

function dateToYyyymm(dateStr: string): string | null {
  if (!dateStr) return null;
  const m = dateStr.match(/^(\d{4})-(\d{2})-/);
  if (!m) return null;
  return `${m[1]}${m[2]}`;
}

interface Resolved { from: string; to: string; label: string }

function resolveRange(preset: string, customFrom: string, customTo: string): Resolved {
  const now = currentYyyymm();
  switch (preset) {
    case "this-month": return { from: now, to: now, label: "This Month" };
    case "last-month": {
      const prev = shiftMonths(now, -1);
      return { from: prev, to: prev, label: "Last Month" };
    }
    case "last-3": return { from: shiftMonths(now, -2), to: now, label: "Last 3 Months" };
    case "last-6": return { from: shiftMonths(now, -5), to: now, label: "Last 6 Months" };
    case "all-time": return { from: "000000", to: now, label: "All Time" };
    case "custom": {
      const from = dateToYyyymm(customFrom);
      const to = dateToYyyymm(customTo);
      if (from && to) return { from, to, label: `${from} → ${to}` };
      if (from) return { from, to: now, label: `${from} → now` };
      if (to) return { from: "000000", to, label: `epoch → ${to}` };
      return { from: now, to: now, label: "This Month (no custom range)" };
    }
    default: return { from: now, to: now, label: "This Month" };
  }
}

async function renderTable(req: Request, preset: string, customFrom: string, customTo: string, configKey: string): Promise<string> {
  const { from, to, label } = resolveRange(preset, customFrom, customTo);
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
  const fmt = (n: number) => n.toLocaleString();
  const fmtTime = (ms: number | null) =>
    ms ? new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
  const totalFailed = rows.reduce((s, x) => s + x.failed, 0);
  const totalFlippedPass = rows.reduce((s, x) => s + x.flippedToPass, 0);
  const totalFlippedFail = rows.reduce((s, x) => s + x.flippedToFail, 0);

  return renderToString(
    <div style="border:1px solid var(--border);border-radius:6px;padding:12px;background:var(--bg);">
      <div style="font-size:12px;font-weight:700;color:var(--text-bright);margin-bottom:8px;">
        Question Failures — {label}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:12px;">
        <SummaryStat label="Questions" value={fmt(rows.length)} />
        <SummaryStat label="Total Failed" value={fmt(totalFailed)} color="var(--red)" />
        <SummaryStat label="Flipped → Pass" value={fmt(totalFlippedPass)} color="var(--green)" />
        <SummaryStat label="Flipped → Fail" value={fmt(totalFlippedFail)} color="var(--yellow)" />
      </div>
      {rows.length === 0 ? (
        <div style="text-align:center;color:var(--text-dim);font-size:12px;padding:18px;">
          No counter data in this range. If you expect data here, check Data Maintenance → Question Failures → Backfill.
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
        <div style="margin-top:6px;font-size:10px;color:var(--text-dim);">
          Showing top 200 of {fmt(rows.length)} — tighten the range or set a config filter to narrow further.
        </div>
      )}
      <div style="font-size:10px;color:var(--text-dim);margin-top:8px;">
        Read in {fmt(r.tookMs ?? 0)}ms · range {r.range?.from} → {r.range?.to}
      </div>
    </div>,
  );
}

function SummaryStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style="border:1px solid var(--border);border-radius:6px;padding:10px;background:var(--bg-2);">
      <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">{label}</div>
      <div style={`font-size:18px;font-weight:700;color:${color ?? "var(--text-bright)"};`}>{value}</div>
    </div>
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
