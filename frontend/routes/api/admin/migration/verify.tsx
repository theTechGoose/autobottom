/** HTMX fragment: sample-compare prod KV vs Firestore. */
import { define } from "../../../../lib/define.ts";
import { apiPost } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";
import type { VNode } from "preact";

interface Report {
  sampled: number;
  matched: number;
  missing: number;
  mismatched: number;
  examples: Array<{ key: string; status: "match" | "missing" | "mismatch"; note?: string }>;
}
interface VerifyResp { ok: boolean; report?: Report; error?: string; }

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData().catch(() => null);
    const sample = form ? Number(form.get("sample") ?? "50") : 50;
    let r: VerifyResp;
    try {
      r = await apiPost<VerifyResp>("/admin/migration/verify", ctx.req, { sample });
    } catch (e) {
      return html(<div class="error-text">verify failed: {String(e)}</div>);
    }
    if (!r.ok || !r.report) return html(<div class="error-text">{r.error ?? "verify failed"}</div>);
    const rep = r.report;
    const allMatch = rep.missing === 0 && rep.mismatched === 0;
    return html(
      <div style={`border:1px solid ${allMatch ? "var(--green)" : "var(--red)"};border-radius:6px;padding:10px;background:var(--bg);`}>
        <div style={`font-size:12px;font-weight:700;color:${allMatch ? "var(--green)" : "var(--red)"};margin-bottom:6px;`}>
          {allMatch ? "ALL MATCH" : "DRIFT DETECTED"}
        </div>
        <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:8px;font-size:11px;margin-bottom:8px;">
          <div><div style="color:var(--text-dim);text-transform:uppercase;font-size:10px;">Sampled</div><div style="font-size:14px;font-weight:700;">{rep.sampled}</div></div>
          <div><div style="color:var(--text-dim);text-transform:uppercase;font-size:10px;">Matched</div><div style="font-size:14px;font-weight:700;color:var(--green);">{rep.matched}</div></div>
          <div><div style="color:var(--text-dim);text-transform:uppercase;font-size:10px;">Missing</div><div style={`font-size:14px;font-weight:700;color:${rep.missing > 0 ? "var(--red)" : "var(--text-dim)"};`}>{rep.missing}</div></div>
          <div><div style="color:var(--text-dim);text-transform:uppercase;font-size:10px;">Mismatched</div><div style={`font-size:14px;font-weight:700;color:${rep.mismatched > 0 ? "var(--red)" : "var(--text-dim)"};`}>{rep.mismatched}</div></div>
        </div>
        {rep.examples.length > 0 && (
          <details>
            <summary style="font-size:11px;cursor:pointer;color:var(--text-dim);">{rep.examples.length} examples</summary>
            <ul style="font-family:monospace;font-size:10px;color:var(--text-dim);margin:4px 0 0 14px;">
              {rep.examples.map((e) => (
                <li>
                  <span style={`color:${e.status === "missing" ? "var(--red)" : e.status === "mismatch" ? "var(--orange,#f97316)" : "var(--green)"};`}>{e.status}</span>
                  {" "}{e.key}{e.note ? ` — ${e.note}` : ""}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>,
    );
  },
});

function html(el: VNode): Response {
  return new Response(renderToString(el), { headers: { "content-type": "text/html" } });
}
