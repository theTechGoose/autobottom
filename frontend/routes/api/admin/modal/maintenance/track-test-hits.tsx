/** TEMPORARY email-tracking spike — GET handler. Reads the recorded sends +
 *  pixel/click hits from /admin/track-test/hits and renders them grouped by
 *  send, newest first. The key columns: hit KIND (pixel|click) and Δ-since-send
 *  (a pixel firing seconds after send with no human = machine prefetch).
 *  Remove with the rest of the track-test feature. */

import { define } from "../../../../../lib/define.ts";
import { apiFetch } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

interface Hit { tid: string; kind: "pixel" | "click"; hitTs: number; msSinceSend: number; ua: string; ip: string }
interface Result { tid: string; toEmail: string; label: string; sentAt: number; hits: Hit[] }
interface Resp { results?: Result[] }

function humanizeMs(ms: number): string {
  if (ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m}m`;
  const h = Math.round(m / 60);
  return `${h}h`;
}

function fmtTime(ts: number): string {
  // Compact local-ish HH:MM:SS; the backend stores epoch ms.
  return new Date(ts).toISOString().slice(11, 19) + "Z";
}

export const handler = define.handlers({
  async GET(ctx) {
    let r: Resp;
    try {
      r = await apiFetch<Resp>("/admin/track-test/hits", ctx.req);
    } catch (e) {
      const html = renderToString(
        <div class="error-text" style="font-size:11px;padding:10px;border:1px solid var(--red);border-radius:6px;">
          Load failed: {String((e as Error).message ?? e)}
        </div>,
      );
      return new Response(html, { headers: { "content-type": "text/html" } });
    }

    const results = r.results ?? [];
    if (results.length === 0) {
      const html = renderToString(
        <div style="font-size:11px;color:var(--text-dim);padding:10px;border:1px dashed var(--border);border-radius:6px;">
          No test sends yet. Send one above, then refresh.
        </div>,
      );
      return new Response(html, { headers: { "content-type": "text/html" } });
    }

    const html = renderToString(
      <div style="display:flex;flex-direction:column;gap:12px;">
        {results.map((res) => (
          <div style="border:1px solid var(--border);border-radius:6px;padding:10px 12px;background:var(--bg);">
            <div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:8px;">
              <div style="font-size:12px;color:var(--text-bright);">
                <strong>{res.label}</strong> → {res.toEmail}
              </div>
              <div style="font-size:10px;color:var(--text-dim);font-family:var(--mono);">
                sent {fmtTime(res.sentAt)} · {res.hits.length} hit{res.hits.length === 1 ? "" : "s"}
              </div>
            </div>
            {res.hits.length === 0 ? (
              <div style="font-size:11px;color:var(--text-dim);">no hits yet</div>
            ) : (
              <table class="data-table" style="width:100%;font-size:11px;">
                <thead>
                  <tr style="text-align:left;color:var(--text-dim);font-size:10px;text-transform:uppercase;letter-spacing:1px;">
                    <th style="padding:4px 8px;width:60px;">Kind</th>
                    <th style="padding:4px 8px;width:90px;">Δ since send</th>
                    <th style="padding:4px 8px;width:120px;">IP</th>
                    <th style="padding:4px 8px;">User-Agent</th>
                  </tr>
                </thead>
                <tbody>
                  {res.hits.map((h) => (
                    <tr>
                      <td style={`padding:4px 8px;font-weight:700;color:${h.kind === "click" ? "var(--green)" : "var(--cyan)"};`}>{h.kind}</td>
                      <td style="padding:4px 8px;font-family:var(--mono);">{humanizeMs(h.msSinceSend)}</td>
                      <td style="padding:4px 8px;font-family:var(--mono);">{h.ip}</td>
                      <td style="padding:4px 8px;font-family:var(--mono);font-size:10px;word-break:break-all;">{h.ua}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>,
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
