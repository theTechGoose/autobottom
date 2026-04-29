/** GET: render the Import CSV inline panel. */
import { define } from "../../../../lib/define.ts";
import { renderToString } from "preact-render-to-string";

export const handler = define.handlers({
  GET(_ctx) {
    const html = renderToString(
      <div class="card" style="margin-bottom:14px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <div>
            <div class="tbl-title" style="margin-bottom:2px;">Import CSV</div>
            <div style="font-size:11px;color:var(--text-dim);">
              Upload a CSV with at least <code>name</code> and <code>text</code> columns. Optional: <code>autoYesExp</code>, <code>egregious</code>, <code>weight</code>, <code>temperature</code>.
            </div>
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
          hx-post="/api/qlab/configs/import-csv"
          hx-target="#qlab-action-msg"
          hx-swap="innerHTML"
          hx-encoding="multipart/form-data"
          style="display:flex;flex-direction:column;gap:10px;"
        >
          <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;">
            <div style="flex:1;min-width:200px;">
              <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.8px;">Config Name</label>
              <input class="sf-input" type="text" name="name" placeholder="e.g. WYN - New Orleans, LA" required style="width:100%;font-size:12px;" />
            </div>
            <div style="min-width:140px;">
              <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.8px;">Type</label>
              <select class="sf-input" name="type" style="width:100%;font-size:12px;">
                <option value="internal">Internal (date-leg)</option>
                <option value="partner">Partner (package)</option>
              </select>
            </div>
            <div style="min-width:140px;">
              <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.8px;">If Name Exists</label>
              <select class="sf-input" name="dupeMode" style="width:100%;font-size:12px;">
                <option value="skip">Skip</option>
                <option value="overwrite">Overwrite</option>
                <option value="rename">Rename (suffix)</option>
              </select>
            </div>
          </div>

          <div>
            <label style="display:block;font-size:10px;color:var(--text-dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.8px;">CSV File</label>
            <input class="sf-input" type="file" name="file" accept=".csv,text/csv" style="width:100%;font-size:12px;" />
          </div>

          <details style="font-size:11px;color:var(--text-dim);">
            <summary style="cursor:pointer;">Or paste CSV content directly</summary>
            <textarea
              name="csv"
              placeholder="name,text,autoYesExp,egregious,weight,temperature&#10;Greeting,Did the agent greet the guest?,,,5,0.8"
              style="margin-top:6px;width:100%;min-height:140px;font-family:var(--mono);font-size:11px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:8px;"
            ></textarea>
          </details>

          <div style="display:flex;gap:8px;align-items:center;">
            <button type="submit" class="sf-btn primary" style="font-size:11px;">Import</button>
            <span style="font-size:11px;color:var(--text-dim);">Importing creates a new config and bulk-creates its questions in one shot.</span>
          </div>
        </form>

        <div id="qlab-action-msg" style="margin-top:10px;font-size:11px;color:var(--text-dim);"></div>
      </div>,
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
