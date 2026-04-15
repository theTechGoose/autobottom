/** Modal content: Email templates list. */
import { define } from "../../../../lib/define.ts";
import { apiFetch } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

export const handler = define.handlers({
  async GET(ctx) {
    let templates: any[] = [];
    try { const d = await apiFetch<{ templates: any[] }>("/admin/email-templates", ctx.req); templates = d.templates ?? []; } catch {}
    const html = renderToString(
      <div>
        <table class="data-table">
          <thead><tr><th>Name</th><th>Subject</th></tr></thead>
          <tbody>
            {templates.length === 0 ? <tr class="empty-row"><td colSpan={2}>No templates</td></tr> : templates.map((t, i) => (
              <tr key={i}><td style="font-weight:600;color:var(--text-bright);">{t.name ?? `Template ${i + 1}`}</td><td>{t.subject ?? "\u2014"}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
