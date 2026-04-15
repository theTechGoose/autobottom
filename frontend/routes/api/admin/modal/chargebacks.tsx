/** Modal content: Chargebacks & Omissions / Wire Deductions — full-screen matching production. */
import { define } from "../../../../lib/define.ts";
import { renderToString } from "preact-render-to-string";

export const handler = define.handlers({
  GET(ctx) {
    const url = new URL(ctx.req.url);
    const tab = url.searchParams.get("tab") ?? "cb";
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

    const html = renderToString(
      <div style="display:flex;flex-direction:column;height:100%;">
        {/* Tab bar */}
        <div style="display:flex;align-items:center;gap:0;padding:0 24px;border-bottom:1px solid var(--border);flex-shrink:0;background:var(--bg-surface);">
          <button
            class={tab === "cb" ? "" : ""}
            style={`font-size:11px;font-weight:600;padding:12px 16px;border:none;background:none;cursor:pointer;color:${tab === "cb" ? "var(--blue)" : "var(--text-dim)"};border-bottom:2px solid ${tab === "cb" ? "var(--blue)" : "transparent"};margin-bottom:-1px;`}
            hx-get="/api/admin/modal/chargebacks?tab=cb"
            hx-target="#chargebacks-modal-content"
            hx-swap="innerHTML"
          >Chargebacks &amp; Omissions</button>
          <button
            style={`font-size:11px;font-weight:600;padding:12px 16px;border:none;background:none;cursor:pointer;color:${tab === "wire" ? "var(--blue)" : "var(--text-dim)"};border-bottom:2px solid ${tab === "wire" ? "var(--blue)" : "transparent"};margin-bottom:-1px;`}
            hx-get="/api/admin/modal/chargebacks?tab=wire"
            hx-target="#chargebacks-modal-content"
            hx-swap="innerHTML"
          >Wire Deductions</button>
        </div>

        {/* Controls */}
        <div style="display:flex;align-items:center;gap:10px;padding:12px 24px;border-bottom:1px solid var(--border);flex-shrink:0;">
          <label style="font-size:11px;color:var(--text-dim);font-weight:600;">From</label>
          <input type="date" id="cb-date-from" class="sf-input" style="font-size:11px;padding:5px 8px;width:auto;cursor:pointer;" value={weekAgo} />
          <label style="font-size:11px;color:var(--text-dim);font-weight:600;">To</label>
          <input type="date" id="cb-date-to" class="sf-input" style="font-size:11px;padding:5px 8px;width:auto;cursor:pointer;" value={today} />
          <button
            class="sf-btn primary"
            style="font-size:11px;"
            hx-get={`/api/admin/modal/chargebacks/data?tab=${tab}`}
            hx-include="#cb-date-from, #cb-date-to"
            hx-target="#cb-body"
            hx-swap="innerHTML"
          >Pull Report</button>
          <select id="cb-format" class="sf-input" style="font-size:11px;padding:5px 8px;width:70px;">
            <option value="csv">CSV</option>
            <option value="xlsx">XLSX</option>
          </select>
          <button class="sf-btn ghost" style="font-size:11px;" disabled>Download</button>
          <button class="sf-btn ghost" style="font-size:11px;" disabled>Post to Sheet</button>
          <button class="sf-btn ghost" style="font-size:11px;margin-left:auto;" data-close-modal="chargebacks-modal">Close</button>
        </div>

        {/* Body */}
        <div id="cb-body" style="flex:1;overflow-y:auto;padding:20px 24px;">
          <div style="color:var(--text-dim);font-size:12px;text-align:center;padding:60px 0;">Select a date range and pull the report.</div>
        </div>
      </div>
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
