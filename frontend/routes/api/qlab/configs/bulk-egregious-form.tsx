/** GET: render the Mark Bulk Egregious inline panel. Loads the unique
 *  question-name list from the backend so the dropdown is populated. */
import { define } from "../../../../lib/define.ts";
import { apiFetch } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

interface QuestionNamesResponse { names?: string[] }

export const handler = define.handlers({
  async GET(ctx) {
    let names: string[] = [];
    try {
      const d = await apiFetch<QuestionNamesResponse>("/api/qlab/question-names", ctx.req);
      names = (d.names ?? []).slice().sort((a, b) => a.localeCompare(b));
    } catch {}

    const html = renderToString(
      <div class="card" style="margin-bottom:14px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <div>
            <div class="tbl-title" style="margin-bottom:2px;">Mark Bulk Egregious</div>
            <div style="font-size:11px;color:var(--text-dim);">Flip the egregious flag on every question with a given name across all configs.</div>
          </div>
          <button
            type="button"
            class="sf-btn ghost"
            style="font-size:10px;"
            hx-get="/api/qlab/configs/cancel"
            hx-target="#qlab-action-panel"
            hx-swap="innerHTML"
          >Close</button>
        </div>
        <form
          hx-post="/api/qlab/configs/bulk-egregious"
          hx-target="#qlab-action-msg"
          hx-swap="innerHTML"
          style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;"
        >
          <div style="flex:1;min-width:240px;">
            <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.8px;">Question Name</label>
            <select class="sf-input" name="name" required style="width:100%;font-size:12px;">
              <option value="">— Pick a question —</option>
              {names.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <button type="submit" class="sf-btn danger" name="egregious" value="true" style="font-size:11px;">Mark Egregious</button>
          <button type="submit" class="sf-btn" name="egregious" value="false" style="font-size:11px;">Unmark</button>
        </form>
        <div id="qlab-action-msg" style="margin-top:10px;font-size:11px;color:var(--text-dim);"></div>
      </div>,
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
