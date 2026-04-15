/** Modal content: Chargebacks & Omissions with date pickers + tabs. */
import { define } from "../../../../lib/define.ts";
import { renderToString } from "preact-render-to-string";

export const handler = define.handlers({
  GET() {
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const html = renderToString(
      <div>
        <div style="display:flex;gap:6px;margin-bottom:16px;">
          <button class="btn btn-primary" style="padding:5px 14px;font-size:11px;border-bottom:2px solid var(--blue);" id="cb-tab-cb">Chargebacks & Omissions</button>
          <button class="btn btn-ghost" style="padding:5px 14px;font-size:11px;" id="cb-tab-wire">Wire Deductions</button>
        </div>
        <div style="display:flex;gap:10px;align-items:flex-end;margin-bottom:16px;">
          <div><label class="sf-label">From</label><input type="date" id="cb-from" value={weekAgo} class="sf-input" /></div>
          <div><label class="sf-label">To</label><input type="date" id="cb-to" value={today} class="sf-input" /></div>
          <button class="btn btn-primary" style="padding:6px 16px;font-size:12px;" hx-get="/api/admin/modal/chargebacks-data" hx-include="#cb-from, #cb-to" hx-target="#cb-results" hx-swap="innerHTML">Pull Report</button>
          <select class="sf-input" style="width:80px;"><option>CSV</option><option>XLSX</option></select>
          <button class="btn btn-ghost" style="padding:6px 14px;font-size:11px;">Download</button>
          <button class="btn btn-ghost" style="padding:6px 14px;font-size:11px;" hx-post="/api/admin/queue-action" hx-vals='{"action":"post-to-sheet"}' hx-swap="none">Post to Sheet</button>
        </div>
        <div id="cb-results" style="color:var(--text-dim);font-size:12px;padding:20px;text-align:center;">Select a date range and pull the report.</div>
      </div>
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
