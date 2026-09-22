/** POST: Remove a bypass / report-exclusion pattern, return updated list.
 *
 *  `kind` picks the list — see add-bypass.tsx for what each one means. Saves the
 *  WHOLE config so the two untouched lists aren't erased. */
import { define } from "../../../../../lib/define.ts";
import { apiFetch, apiPost } from "../../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

interface BypassCfg {
  patterns?: string[];
  departmentPatterns?: string[];
  reportExcludeDepartments?: string[];
}

const LISTS = {
  office: { field: "patterns", target: "#ob-bypass-list", empty: "No bypass patterns" },
  department: { field: "departmentPatterns", target: "#ob-deptbypass-list", empty: "No bypass patterns" },
  report: { field: "reportExcludeDepartments", target: "#ob-reportexclude-list", empty: "Nothing excluded from reporting" },
} as const;

type Kind = keyof typeof LISTS;

function kindOf(raw: unknown): Kind {
  const k = String(raw ?? "");
  return k === "department" || k === "report" ? k : "office";
}

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const pattern = (form.get("pattern") as string)?.trim();
    const kind = kindOf(form.get("kind"));
    const { field, target, empty } = LISTS[kind];

    let cfg: BypassCfg = {};
    try { cfg = await apiFetch<BypassCfg>("/admin/office-bypass", ctx.req); } catch {}
    const next: BypassCfg = {
      patterns: [...(cfg.patterns ?? [])],
      departmentPatterns: [...(cfg.departmentPatterns ?? [])],
      reportExcludeDepartments: [...(cfg.reportExcludeDepartments ?? [])],
    };

    if (pattern) {
      next[field] = next[field]!.filter((p) => p !== pattern);
      try { await apiPost("/admin/office-bypass", ctx.req, next); } catch {}
    }

    const list = next[field]!;
    const html = renderToString(
      <>{list.length === 0 ? (
        <div style="color:var(--text-dim);font-size:11px;padding:8px;">{empty}</div>
      ) : list.map(p => (
        <div key={p} class="item-row">
          <span>{p}</span>
          <button class="item-remove" hx-post="/api/admin/modal/offices/remove-bypass" hx-vals={JSON.stringify({ pattern: p, kind })} hx-target={target} hx-swap="innerHTML">&times;</button>
        </div>
      ))}</>
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
