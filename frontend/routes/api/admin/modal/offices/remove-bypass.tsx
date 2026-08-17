/** POST: Remove a bypass pattern, return updated list.
 *
 *  `kind=office` (default) is the PARTNER list, `kind=department` the INTERNAL
 *  one. Saves the WHOLE config so the untouched list isn't erased — see
 *  add-bypass.tsx. */
import { define } from "../../../../../lib/define.ts";
import { apiFetch, apiPost } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

interface BypassCfg { patterns?: string[]; departmentPatterns?: string[] }

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const pattern = (form.get("pattern") as string)?.trim();
    const isDept = (form.get("kind") as string) === "department";

    let cfg: BypassCfg = {};
    try { cfg = await apiFetch<BypassCfg>("/admin/office-bypass", ctx.req); } catch {}
    let patterns = [...(cfg.patterns ?? [])];
    let departmentPatterns = [...(cfg.departmentPatterns ?? [])];

    if (pattern) {
      if (isDept) departmentPatterns = departmentPatterns.filter(p => p !== pattern);
      else patterns = patterns.filter(p => p !== pattern);
      try { await apiPost("/admin/office-bypass", ctx.req, { patterns, departmentPatterns }); } catch {}
    }

    const list = isDept ? departmentPatterns : patterns;
    const target = isDept ? "#ob-deptbypass-list" : "#ob-bypass-list";
    const html = renderToString(
      <>{list.length === 0 ? (
        <div style="color:var(--text-dim);font-size:11px;padding:8px;">No bypass patterns</div>
      ) : list.map(p => (
        <div key={p} class="item-row">
          <span>{p}</span>
          <button class="item-remove" hx-post="/api/admin/modal/offices/remove-bypass" hx-vals={JSON.stringify({ pattern: p, kind: isDept ? "department" : "office" })} hx-target={target} hx-swap="innerHTML">&times;</button>
        </div>
      ))}</>
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
