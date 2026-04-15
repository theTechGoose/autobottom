/** POST: Add an office department, return updated chip list. */
import { define } from "../../../../../lib/define.ts";
import { apiFetch, apiPost } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const dept = (form.get("dept") as string)?.trim();
    if (dept) {
      try { await apiPost("/admin/audit-dimensions/add", ctx.req, { department: dept }); } catch {}
    }
    let depts: string[] = [];
    try { const d = await apiFetch<{ departments?: string[] }>("/admin/audit-dimensions", ctx.req); depts = d.departments ?? []; } catch {}
    const html = renderToString(
      <>{depts.length === 0 ? (
        <div style="color:var(--text-dim);font-size:11px;padding:8px;">No offices added</div>
      ) : depts.map(d => (
        <span key={d} class="tag-chip blue">
          {d}
          <button hx-post="/api/admin/modal/offices/remove-dept" hx-vals={JSON.stringify({ dept: d })} hx-target="#ob-dept-list" hx-swap="innerHTML" hx-confirm={`Remove ${d}?`}>&times;</button>
        </span>
      ))}</>
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
