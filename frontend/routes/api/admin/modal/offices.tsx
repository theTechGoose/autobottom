/** Modal content: Offices — 2 tabs (Offices / Bypass) matching production. */
import { define } from "../../../../lib/define.ts";
import { apiFetch } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const tab = url.searchParams.get("tab") ?? "offices";

    let depts: string[] = [];
    let patterns: string[] = [];
    try { const d = await apiFetch<{ departments?: string[] }>("/admin/audit-dimensions", ctx.req); depts = d.departments ?? []; } catch {}
    try { const d = await apiFetch<{ patterns?: string[] }>("/admin/office-bypass", ctx.req); patterns = d.patterns ?? []; } catch {}

    const html = renderToString(
      <div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
          <div class="modal-title" style="margin-bottom:0;">Offices</div>
          <div style="display:flex;gap:4px;">
            <button
              class={`sf-btn ghost um-tab ${tab === "offices" ? "active" : ""}`}
              hx-get="/api/admin/modal/offices?tab=offices"
              hx-target="#offices-modal-content"
              hx-swap="innerHTML"
            >Offices</button>
            <button
              class={`sf-btn ghost um-tab ${tab === "bypass" ? "active" : ""}`}
              hx-get="/api/admin/modal/offices?tab=bypass"
              hx-target="#offices-modal-content"
              hx-swap="innerHTML"
            >Bypass</button>
          </div>
        </div>
        <div class="modal-sub">Manage known offices and configure which ones skip review and audit emails</div>

        {tab === "offices" ? (
          <div>
            <div style="display:flex;gap:6px;margin-bottom:12px;">
              <input id="ob-dept-input" class="sf-input" type="text" name="dept" placeholder="Add office name (e.g. JAY777)" style="flex:1;font-size:12px;" />
              <button class="sf-btn primary" style="font-size:11px;padding:8px 14px;" hx-post="/api/admin/modal/offices/add-dept" hx-include="#ob-dept-input" hx-target="#ob-dept-list" hx-swap="innerHTML">Add</button>
            </div>
            <div id="ob-dept-list" style="display:flex;flex-wrap:wrap;gap:6px;min-height:40px;max-height:260px;overflow-y:auto;padding:4px 0;">
              {depts.length === 0 ? (
                <div style="color:var(--text-dim);font-size:11px;padding:8px;">No offices added</div>
              ) : depts.map(d => (
                <span key={d} class="tag-chip blue">
                  {d}
                  <button hx-post="/api/admin/modal/offices/remove-dept" hx-vals={JSON.stringify({ dept: d })} hx-target="#ob-dept-list" hx-swap="innerHTML" hx-confirm={`Remove ${d}?`}>&times;</button>
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <div class="modal-sub" style="margin-bottom:10px;">Offices matching these patterns skip the review queue and audit emails. Case-insensitive substring match.</div>
            <div style="display:flex;gap:6px;margin-bottom:12px;">
              <input id="ob-bypass-input" class="sf-input" type="text" name="pattern" placeholder="e.g. JAY" style="flex:1;font-size:12px;" />
              <button class="sf-btn primary" style="font-size:11px;padding:8px 14px;" hx-post="/api/admin/modal/offices/add-bypass" hx-include="#ob-bypass-input" hx-target="#ob-bypass-list" hx-swap="innerHTML">Add</button>
            </div>
            <div id="ob-bypass-list" style="display:flex;flex-direction:column;gap:6px;min-height:40px;max-height:260px;overflow-y:auto;">
              {patterns.length === 0 ? (
                <div style="color:var(--text-dim);font-size:11px;padding:8px;">No bypass patterns</div>
              ) : patterns.map(p => (
                <div key={p} class="item-row">
                  <span>{p}</span>
                  <button class="item-remove" hx-post="/api/admin/modal/offices/remove-bypass" hx-vals={JSON.stringify({ pattern: p })} hx-target="#ob-bypass-list" hx-swap="innerHTML">&times;</button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div class="modal-actions" style="margin-top:12px;">
          <button class="sf-btn secondary" data-close-modal="offices-modal">Close</button>
        </div>
      </div>
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
