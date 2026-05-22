/** Apply Persisted Parallelism — POST handler. Calls the backend's
 *  /admin/apply-default-parallelism, which loops every queue and pushes the
 *  Firestore-persisted parallelism (or default) back to QStash. Renders per-
 *  queue status inline. Same code path the boot sequence uses. */

import { define } from "../../../../../lib/define.ts";
import { apiFetch } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

interface ApplyResult {
  queueName: string;
  parallelism: number;
  source: "default" | "persisted";
  ok: boolean;
  error?: string;
}

interface Resp {
  ok?: boolean;
  results?: ApplyResult[];
  tookMs?: number;
  error?: string;
}

export const handler = define.handlers({
  async POST(ctx) {
    let r: Resp;
    try {
      r = await apiFetch<Resp>("/admin/apply-default-parallelism", ctx.req, { method: "POST" });
    } catch (e) {
      const html = renderToString(
        <div class="error-text" style="font-size:11px;padding:10px;border:1px solid var(--red);border-radius:6px;">
          Apply failed: {String((e as Error).message ?? e)}
        </div>,
      );
      return new Response(html, { headers: { "content-type": "text/html" } });
    }

    if (!r.results) {
      const html = renderToString(
        <div class="error-text" style="font-size:11px;padding:10px;border:1px solid var(--red);border-radius:6px;">
          Backend rejected: {r.error ?? "unknown"}
        </div>,
      );
      return new Response(html, { headers: { "content-type": "text/html" } });
    }

    const allOk = r.ok === true;
    const html = renderToString(
      <div style="border:1px solid var(--border);border-radius:6px;padding:12px;background:var(--bg);">
        <div style={`font-size:12px;font-weight:700;margin-bottom:10px;color:${allOk ? "var(--green)" : "var(--yellow)"};`}>
          {allOk ? "✓" : "⚠"} Apply persisted parallelism — {r.tookMs ?? 0}ms
        </div>
        <table class="data-table" style="width:100%;font-size:11px;">
          <thead>
            <tr style="text-align:left;color:var(--text-dim);font-size:10px;text-transform:uppercase;letter-spacing:1px;">
              <th style="padding:6px 8px;">Queue</th>
              <th style="padding:6px 8px;width:90px;">Parallelism</th>
              <th style="padding:6px 8px;width:90px;">Source</th>
              <th style="padding:6px 8px;width:60px;">Status</th>
            </tr>
          </thead>
          <tbody>
            {(r.results ?? []).map((row) => (
              <tr key={row.queueName} style="border-top:1px solid var(--border);">
                <td style="padding:6px 8px;font-family:var(--mono);">{row.queueName}</td>
                <td style="padding:6px 8px;font-weight:600;">{row.parallelism}</td>
                <td style="padding:6px 8px;color:var(--text-dim);">{row.source}</td>
                <td style={`padding:6px 8px;font-weight:600;color:${row.ok ? "var(--green)" : "var(--red)"};`}>
                  {row.ok ? "✓" : `✗ ${row.error ?? "error"}`}
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
