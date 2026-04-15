/** POST: Remove a bypass pattern, return updated list. */
import { define } from "../../../../../lib/define.ts";
import { apiFetch, apiPost } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const pattern = (form.get("pattern") as string)?.trim();

    let patterns: string[] = [];
    try { const d = await apiFetch<{ patterns?: string[] }>("/admin/office-bypass", ctx.req); patterns = d.patterns ?? []; } catch {}
    if (pattern) {
      patterns = patterns.filter(p => p !== pattern);
      try { await apiPost("/admin/office-bypass", ctx.req, { patterns }); } catch {}
    }

    const html = renderToString(
      <>{patterns.length === 0 ? (
        <div style="color:var(--text-dim);font-size:11px;padding:8px;">No bypass patterns</div>
      ) : patterns.map(p => (
        <div key={p} class="item-row">
          <span>{p}</span>
          <button class="item-remove" hx-post="/api/admin/modal/offices/remove-bypass" hx-vals={JSON.stringify({ pattern: p })} hx-target="#ob-bypass-list" hx-swap="innerHTML">&times;</button>
        </div>
      ))}</>
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
