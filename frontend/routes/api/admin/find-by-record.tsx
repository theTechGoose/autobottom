/** GET: list audits for a given QB Record ID. Renders a tiny HTML drawer
 *  fragment for the dashboard's "Find by QB Record" form so results land
 *  inline instead of redirecting to /admin/audits. */
import { define } from "../../../lib/define.ts";
import { apiFetch } from "../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

interface AuditEntry {
  findingId: string;
  recordId?: string;
  voName?: string;
  department?: string;
  score: number;
  completed: boolean;
  reason?: string;
  completedAt?: number;
  doneAt?: number;
}

function fmtScore(n: number): string {
  if (n == null) return "—";
  return `${n}%`;
}

function scoreColor(n: number): string {
  if (n >= 100) return "var(--green)";
  if (n >= 80) return "var(--blue)";
  if (n >= 60) return "var(--yellow)";
  return "var(--red)";
}

function fmtTs(ts: number | undefined): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString("en-US", {
      timeZone: "America/New_York",
      month: "numeric", day: "numeric", year: "2-digit",
      hour: "numeric", minute: "2-digit",
    });
  } catch { return "—"; }
}

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const recordId = (url.searchParams.get("recordId") ?? "").trim();
    if (!recordId) {
      return new Response(
        renderToString(<div style="font-size:11px;color:var(--text-dim);padding:6px 0;">Enter a record ID and click Search.</div>),
        { headers: { "content-type": "text/html" } },
      );
    }

    let audits: AuditEntry[] = [];
    try {
      const data = await apiFetch<{ audits?: AuditEntry[]; error?: string }>(
        `/admin/audits-by-record?recordId=${encodeURIComponent(recordId)}`,
        ctx.req,
      );
      if (data.error) throw new Error(data.error);
      audits = data.audits ?? [];
    } catch (e) {
      return new Response(
        renderToString(<div style="font-size:11px;color:var(--red);padding:6px 0;">Lookup failed: {(e as Error).message}</div>),
        { headers: { "content-type": "text/html" } },
      );
    }

    if (audits.length === 0) {
      return new Response(
        renderToString(<div style="font-size:11px;color:var(--text-dim);padding:6px 0;">No audits found for record {recordId}.</div>),
        { headers: { "content-type": "text/html" } },
      );
    }

    const html = renderToString(
      <div style="margin-top:6px;">
        <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px;">
          {audits.length} audit{audits.length === 1 ? "" : "s"} for record {recordId}
        </div>
        <table class="data-table" style="width:100%;font-size:12px;">
          <thead>
            <tr style="text-align:left;color:var(--text-dim);font-size:10px;text-transform:uppercase;letter-spacing:1px;">
              <th style="padding:6px 10px;">Finding</th>
              <th style="padding:6px 10px;">Score</th>
              <th style="padding:6px 10px;">Status</th>
              <th style="padding:6px 10px;">Team Member</th>
              <th style="padding:6px 10px;">Department</th>
              <th style="padding:6px 10px;">Completed</th>
              <th style="padding:6px 10px;text-align:right;">Action</th>
            </tr>
          </thead>
          <tbody>
            {audits.map((a) => (
              <tr key={a.findingId} style="border-top:1px solid var(--border);">
                <td style="padding:6px 10px;font-family:var(--mono);font-size:11px;color:var(--text-muted);">{a.findingId.slice(0, 14)}…</td>
                <td style="padding:6px 10px;">
                  <span style={`font-weight:700;color:${scoreColor(a.score)};`}>{fmtScore(a.score)}</span>
                </td>
                <td style="padding:6px 10px;">
                  {a.completed
                    ? <span class="pill pill-green">{a.reason ?? "complete"}</span>
                    : <span class="pill pill-yellow">in review</span>}
                </td>
                <td style="padding:6px 10px;color:var(--text);">{a.voName ?? "—"}</td>
                <td style="padding:6px 10px;color:var(--text-dim);">{a.department ?? "—"}</td>
                <td style="padding:6px 10px;color:var(--text-dim);font-size:11px;">{fmtTs(a.completedAt)}</td>
                <td style="padding:6px 10px;text-align:right;">
                  <a
                    href={`/audit/report?id=${encodeURIComponent(a.findingId)}`}
                    target="_blank"
                    rel="noopener"
                    class="sf-btn primary"
                    style="font-size:10px;text-decoration:none;"
                  >Open ↗</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
