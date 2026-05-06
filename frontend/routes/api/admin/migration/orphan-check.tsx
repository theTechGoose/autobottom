/** HTMX fragment: list findings without audit-done-idx entries.
 *  Diagnostic for the index-driven migration path. */
import { define } from "../../../../lib/define.ts";
import { apiPost } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import type { VNode } from "preact";

interface OrphanResponse {
  ok: boolean;
  error?: string;
  orphans?: Array<{ org: string; findingId: string }>;
  totalFindings?: number;
  totalIndexed?: number;
  cappedAt?: number | null;
}

export const handler = define.handlers({
  async POST(ctx) {
    let r: OrphanResponse;
    try {
      r = await apiPost<OrphanResponse>("/admin/migration/orphan-check", ctx.req, {});
    } catch (e) {
      return html(<div class="error-text">orphan-check failed: {String(e)}</div>);
    }
    if (!r.ok) return html(<div class="error-text">{r.error ?? "unknown"}</div>);

    const orphans = r.orphans ?? [];
    const totalFindings = r.totalFindings ?? 0;
    const totalIndexed = r.totalIndexed ?? 0;
    const cappedAt = r.cappedAt;

    return html(
      <div>
        <div style="margin-bottom:8px;color:var(--text-dim);">
          Total findings in prod: <b>{totalFindings.toLocaleString()}</b> ·
          {" "}With audit-done-idx entry: <b>{totalIndexed.toLocaleString()}</b> ·
          {" "}<b style={`color:${orphans.length > 0 ? "var(--orange)" : "var(--green)"};`}>{orphans.length} orphan{orphans.length === 1 ? "" : "s"}</b>
          {cappedAt !== null && cappedAt !== undefined && (
            <span style="color:var(--orange);"> (capped at {cappedAt})</span>
          )}
        </div>
        {orphans.length === 0 ? (
          <div style="color:var(--green);">✓ No orphan findings — every finding has an audit-done-idx entry.</div>
        ) : (
          <table style="width:100%;border-collapse:collapse;font-family:monospace;">
            <thead>
              <tr style="text-align:left;color:var(--text-dim);border-bottom:1px solid var(--border);">
                <th style="padding:4px 6px;">Org</th>
                <th style="padding:4px 6px;">Finding ID</th>
              </tr>
            </thead>
            <tbody>
              {orphans.map((o) => (
                <tr style="border-bottom:1px solid var(--border-soft);">
                  <td style="padding:4px 6px;color:var(--text-dim);">{o.org}</td>
                  <td style="padding:4px 6px;color:var(--text-bright);">{o.findingId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>,
    );
  },
});

function html(el: VNode): Response {
  return new Response(renderToString(el), { headers: { "content-type": "text/html" } });
}
