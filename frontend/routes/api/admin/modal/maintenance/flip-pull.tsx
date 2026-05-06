/** HTMX fragment: pull unreviewed audits matching filters; render selectable
 *  table + execute form. */
import { define } from "../../../../../lib/define.ts";
import { apiFetch } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import type { VNode } from "preact";

interface UnreviewedItem {
  findingId: string;
  recordId?: string;
  voName?: string;
  owner?: string;
  department?: string;
  shift?: string;
  score?: number;
  isPackage?: boolean;
  ts?: number;
}

interface UnreviewedResp {
  items?: UnreviewedItem[];
  total?: number;
  error?: string;
}

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const params = new URLSearchParams();
    for (const k of ["since", "until", "type", "department", "shift", "scoreMin", "scoreMax"]) {
      const v = url.searchParams.get(k);
      if (v) params.set(k, v);
    }
    let r: UnreviewedResp;
    try {
      r = await apiFetch<UnreviewedResp>(`/admin/unreviewed-audits?${params}`, ctx.req);
    } catch (e) {
      return html(<div class="error-text">Pull failed: {String(e)}</div>);
    }
    if (r.error) return html(<div class="error-text">{r.error}</div>);
    const items = r.items ?? [];
    if (items.length === 0) {
      return html(<div style="font-size:11px;color:var(--text-dim);padding:8px;">No unreviewed audits match the filters.</div>);
    }
    return html(<FlipResultTable items={items} total={r.total ?? items.length} />);
  },
});

function FlipResultTable({ items, total }: { items: UnreviewedItem[]; total: number }) {
  return (
    <div>
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:6px;">{total} unreviewed audit(s) found{items.length < total ? ` — showing first ${items.length}` : ""}.</div>
      <form hx-post="/api/admin/modal/maintenance/flip-exec" hx-target="#flip-results" hx-swap="innerHTML" hx-confirm="Flip the checked audits to 100%? This cannot be undone.">
        <div style="max-height:320px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;">
          <table style="width:100%;border-collapse:collapse;font-size:11px;">
            <thead>
              <tr style="position:sticky;top:0;background:var(--bg-raised);border-bottom:1px solid var(--border);text-align:left;color:var(--text-dim);text-transform:uppercase;font-size:10px;">
                <th style="padding:6px 8px;width:30px;"></th>
                <th style="padding:6px 8px;">Finding</th>
                <th style="padding:6px 8px;">Record</th>
                <th style="padding:6px 8px;">Department</th>
                <th style="padding:6px 8px;">Team Member</th>
                <th style="padding:6px 8px;text-align:right;">Score</th>
                <th style="padding:6px 8px;">Date</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr style="border-bottom:1px solid var(--border-soft);">
                  <td style="padding:5px 8px;"><input type="checkbox" name="findingId" value={i.findingId} /></td>
                  <td style="padding:5px 8px;font-family:monospace;">
                    <a href={`/audit/report?id=${i.findingId}`} target="_blank" style="color:var(--blue);text-decoration:none;">{i.findingId.slice(0, 16)}</a>
                  </td>
                  <td style="padding:5px 8px;color:var(--text-dim);">{i.recordId ?? "—"}</td>
                  <td style="padding:5px 8px;color:var(--text-dim);">{i.department ?? "—"}</td>
                  <td style="padding:5px 8px;">{i.voName ?? i.owner ?? "—"}</td>
                  <td style={`padding:5px 8px;text-align:right;font-weight:600;color:${(i.score ?? 0) >= 80 ? "var(--green)" : "var(--red)"};`}>
                    {i.score != null ? `${i.score}%` : "—"}
                  </td>
                  <td style="padding:5px 8px;font-size:10px;color:var(--text-dim);">{i.ts ? new Date(i.ts).toLocaleDateString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;">
          <button type="submit" name="mode" value="all" class="sf-btn ghost" style="padding:6px 14px;font-size:11px;">Flip All {items.length}</button>
          <button type="submit" name="mode" value="selected" class="sf-btn danger" style="padding:6px 14px;font-size:11px;">Flip Selected to 100%</button>
        </div>
      </form>
    </div>
  );
}

function html(el: VNode): Response {
  return new Response(renderToString(el), { headers: { "content-type": "text/html" } });
}
