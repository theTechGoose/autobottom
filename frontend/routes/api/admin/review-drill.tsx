/** HTMX fragment — review queue drill-down showing individual pending items. */
import { define } from "../../../lib/define.ts";
import { apiFetch } from "../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

export const handler = define.handlers({
  async GET(ctx) {
    try {
      const data = await apiFetch<{ audits: { findingId: string; recordId?: string; score?: number; type?: string }[] }>(
        "/admin/unreviewed-audits", ctx.req,
      );
      const audits = data.audits ?? [];
      const html = renderToString(
        <div class="tbl" style="margin-top:10px;">
          <table class="data-table">
            <thead><tr><th>Finding</th><th>Record</th><th>Type</th><th>Score</th></tr></thead>
            <tbody>
              {audits.length === 0 ? (
                <tr class="empty-row"><td colSpan={4}>No pending items</td></tr>
              ) : audits.map((a) => (
                <tr key={a.findingId}>
                  <td class="mono">{a.findingId?.slice(0, 8)}</td>
                  <td class="mono">{a.recordId ?? "\u2014"}</td>
                  <td>{a.type ? <span class={`pill ${a.type === "internal" ? "pill-blue" : "pill-purple"}`}>{a.type}</span> : "\u2014"}</td>
                  <td>{a.score != null ? <span class={`pill pill-${a.score >= 90 ? "green" : a.score >= 70 ? "yellow" : "red"}`}>{a.score}%</span> : "\u2014"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      return new Response(html, { headers: { "content-type": "text/html" } });
    } catch {
      return new Response(`<div style="color:var(--text-dim);padding:10px;font-size:12px;">Failed to load</div>`, {
        headers: { "content-type": "text/html" },
      });
    }
  },
});
