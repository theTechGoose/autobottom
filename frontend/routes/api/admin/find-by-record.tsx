/** GET: list audits for a given QB Record ID. Renders a tiny HTML drawer
 *  fragment for the dashboard's "Find by QB Record" form so results land
 *  inline instead of redirecting to /admin/audits. Dedup-hidden findings are
 *  shown flagged "duplicate" with a separate "Restore" button (admin) that
 *  un-hides + re-indexes that one finding. */
import { define } from "../../../lib/define.ts";
import { apiFetch } from "../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import type { ComponentChildren } from "preact";

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
  hidden?: boolean;
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

function wrap(node: ComponentChildren): Response {
  return new Response(
    renderToString(<div id="fbr-results">{node}</div>),
    { headers: { "content-type": "text/html" } },
  );
}

/** Fetch + render the results fragment for a record ID. Shared by the search
 *  GET handler and the restore POST route so a restore re-renders in place. */
export async function renderFindByRecord(req: Request, recordId: string): Promise<Response> {
  if (!recordId) {
    return wrap(<div style="font-size:11px;color:var(--text-dim);padding:6px 0;">Enter a record ID and click Search.</div>);
  }

  let audits: AuditEntry[] = [];
  try {
    const data = await apiFetch<{ audits?: AuditEntry[]; error?: string }>(
      `/admin/audits-by-record?recordId=${encodeURIComponent(recordId)}`,
      req,
    );
    if (data.error) throw new Error(data.error);
    audits = data.audits ?? [];
  } catch (e) {
    return wrap(<div style="font-size:11px;color:var(--red);padding:6px 0;">Lookup failed: {(e as Error).message}</div>);
  }

  if (audits.length === 0) {
    return wrap(
      <div style="padding:12px;color:var(--text-dim);font-size:13px;border:1px dashed var(--border);border-radius:6px;background:var(--bg);">
        No audits found for record ID <code style="font-family:var(--mono);color:var(--text);">{recordId}</code>.
      </div>,
    );
  }

  return wrap(
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
                {a.hidden
                  ? <span class="pill" style="margin-left:4px;background:var(--bg);color:var(--text-dim);border:1px solid var(--border);">duplicate</span>
                  : null}
              </td>
              <td style="padding:6px 10px;color:var(--text);">{a.voName ?? "—"}</td>
              <td style="padding:6px 10px;color:var(--text-dim);">{a.department ?? "—"}</td>
              <td style="padding:6px 10px;color:var(--text-dim);font-size:11px;">{fmtTs(a.completedAt)}</td>
              <td style="padding:6px 10px;text-align:right;white-space:nowrap;">
                {a.hidden
                  ? (
                    <button
                      type="button"
                      class="sf-btn"
                      style="font-size:10px;margin-right:6px;border:1px solid var(--yellow);color:var(--yellow);"
                      title="This audit was hidden as a duplicate. Restore it (un-hide + re-index) so it shows in record search."
                      hx-post="/api/admin/restore-finding"
                      hx-vals={JSON.stringify({ findingId: a.findingId, recordId })}
                      hx-target="#fbr-results"
                      hx-swap="outerHTML"
                      hx-confirm={`Restore ${a.findingId.slice(0, 14)}… — confirm this audit is NOT a duplicate?`}
                    >Restore</button>
                  )
                  : null}
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
}

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const recordId = (url.searchParams.get("recordId") ?? "").trim();
    return await renderFindByRecord(ctx.req, recordId);
  },
});
