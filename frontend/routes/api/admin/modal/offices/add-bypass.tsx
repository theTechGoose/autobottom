/** POST: Add a bypass pattern, return updated list.
 *
 *  `kind=office` (default) bypasses PARTNER audits by OfficeName; `kind=department`
 *  bypasses INTERNAL audits by Activating Office. They are separate QuickBase
 *  fields, so they get separate lists — one list against both silently bypassed
 *  whichever side collided on a name.
 *
 *  Saves the WHOLE config, not just the edited list: /admin/office-bypass writes
 *  the doc wholesale, so posting one field would erase the other. */
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

    const list = isDept ? departmentPatterns : patterns;
    if (pattern && !list.includes(pattern)) {
      list.push(pattern);
      if (isDept) departmentPatterns = list; else patterns = list;
      try { await apiPost("/admin/office-bypass", ctx.req, { patterns, departmentPatterns }); } catch {}
    }

    const removeUrl = "/api/admin/modal/offices/remove-bypass";
    const target = isDept ? "#ob-deptbypass-list" : "#ob-bypass-list";
    const html = renderToString(
      <>{list.length === 0 ? (
        <div style="color:var(--text-dim);font-size:11px;padding:8px;">No bypass patterns</div>
      ) : list.map(p => (
        <div key={p} class="item-row">
          <span>{p}</span>
          <button class="item-remove" hx-post={removeUrl} hx-vals={JSON.stringify({ pattern: p, kind: isDept ? "department" : "office" })} hx-target={target} hx-swap="innerHTML">&times;</button>
        </div>
      ))}</>
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
