/** HTMX fragment: inventory of prod KV (counts per type/org). */
import { define } from "../../../../lib/define.ts";
import { apiFetch } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import type { VNode } from "preact";

interface InventoryResponse {
  ok: boolean;
  error?: string;
  rows?: Array<{ org: string; type: string; count: number; chunkedCount: number }>;
  totalSimple?: number;
  totalChunked?: number;
  partial?: boolean;
  scanned?: number;
  skipTypes?: string[];
}

export const handler = define.handlers({
  async GET(ctx) {
    let data: InventoryResponse;
    try {
      data = await apiFetch<InventoryResponse>("/admin/migration/inventory", ctx.req);
    } catch (e) {
      return html(<div class="error-text">Inventory failed: {String(e)}</div>);
    }
    if (!data.ok) {
      return html(<div class="error-text">Inventory error: {data.error ?? "unknown"}</div>);
    }
    const rows = data.rows ?? [];
    const skip = new Set(data.skipTypes ?? []);
    return html(
      <div>
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;">
          Found <b>{data.totalSimple ?? 0}</b> simple keys + <b>{data.totalChunked ?? 0}</b> chunked groups across <b>{rows.length}</b> (org, type) pairs. Scanned <b>{(data.scanned ?? 0).toLocaleString()}</b> keys.
        </div>
        {data.partial && (
          <div style="font-size:11px;color:var(--orange);margin-bottom:8px;padding:6px 10px;border:1px solid var(--orange);border-radius:4px;">
            ⚠️ Partial result — request budget elapsed before reaching end of DB. Click again to continue, or use a Dry Run for full inventory.
          </div>
        )}
        <table style="width:100%;border-collapse:collapse;font-size:11px;">
          <thead>
            <tr style="text-align:left;color:var(--text-dim);border-bottom:1px solid var(--border);">
              <th style="padding:4px 6px;">Type</th>
              <th style="padding:4px 6px;">Org</th>
              <th style="padding:4px 6px;text-align:right;">Simple</th>
              <th style="padding:4px 6px;text-align:right;">Chunked</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr style="border-bottom:1px solid var(--border-soft);">
                <td style="padding:4px 6px;font-family:monospace;color:var(--text-bright);">
                  {r.type}
                  {skip.has(r.type) && <span style="color:var(--text-dim);margin-left:6px;font-size:10px;">(SKIP)</span>}
                </td>
                <td style="padding:4px 6px;font-family:monospace;color:var(--text-dim);">{r.org || <i>global</i>}</td>
                <td style="padding:4px 6px;text-align:right;">{r.count}</td>
                <td style="padding:4px 6px;text-align:right;">{r.chunkedCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
  },
});

function html(el: VNode): Response {
  return new Response(renderToString(el), { headers: { "content-type": "text/html" } });
}
