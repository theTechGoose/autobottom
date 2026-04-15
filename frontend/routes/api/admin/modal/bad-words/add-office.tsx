/** POST: Add office pattern to bad words config, return updated list. */
import { define } from "../../../../../lib/define.ts";
import { apiFetch, apiPost } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const pattern = (form.get("pattern") as string)?.trim();

    let config: Record<string, unknown> = {};
    try { config = await apiFetch("/admin/bad-word-config", ctx.req); } catch {}
    const patterns = (config.officePatterns as string[]) ?? [];
    if (pattern && !patterns.includes(pattern)) {
      patterns.push(pattern);
      config.officePatterns = patterns;
      try { await apiPost("/admin/bad-word-config", ctx.req, config); } catch {}
    }

    const html = renderToString(
      <>{patterns.length === 0 ? (
        <div style="color:var(--text-dim);font-size:11px;padding:8px;">No office patterns</div>
      ) : patterns.map(p => (
        <div key={p} class="item-row">
          <span>{p}</span>
          <button class="item-remove" hx-post="/api/admin/modal/bad-words/remove-office" hx-vals={JSON.stringify({ pattern: p })} hx-target="#bw-office-list" hx-swap="innerHTML">&times;</button>
        </div>
      ))}</>
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
