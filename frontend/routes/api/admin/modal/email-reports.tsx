/** Modal content: Email reports list. */
import { define } from "../../../../lib/define.ts";
import { apiFetch } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

export const handler = define.handlers({
  async GET(ctx) {
    let configs: any[] = [];
    try { const d = await apiFetch<{ configs: any[] }>("/admin/email-reports", ctx.req); configs = d.configs ?? []; } catch {}
    const html = renderToString(
      <div>
        <table class="data-table">
          <thead><tr><th>Name</th><th>Recipients</th><th>Schedule</th><th>Status</th></tr></thead>
          <tbody>
            {configs.length === 0 ? <tr class="empty-row"><td colSpan={4}>No email reports configured</td></tr> : configs.map((c, i) => (
              <tr key={i}><td style="font-weight:600;color:var(--text-bright);">{c.name ?? `Report ${i + 1}`}</td><td class="mono" style="font-size:10px;">{c.recipients?.join(", ") ?? "\u2014"}</td><td>{c.schedule ?? "\u2014"}</td><td><span class={`pill pill-${c.enabled !== false ? "green" : "red"}`}>{c.enabled !== false ? "Active" : "Off"}</span></td></tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
