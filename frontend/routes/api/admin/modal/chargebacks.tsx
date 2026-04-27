/** Modal content: Chargebacks & Omissions / Wire Deductions.
 *  ChargebacksToolbar island owns the tab state, Pull Report, Download
 *  (CSV/XLSX), and Post-to-Sheet behaviour. It renders tab buttons into
 *  #cb-tabs and the data table into #cb-body. Tab switching is purely
 *  client-side — no server round-trip. */
import { define } from "../../../../lib/define.ts";
import { renderToString } from "preact-render-to-string";
import ChargebacksToolbar from "../../../../islands/ChargebacksToolbar.tsx";

export const handler = define.handlers({
  GET() {
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

    const html = renderToString(
      <div style="display:flex;flex-direction:column;height:100%;">
        {/* Tab bar — buttons rendered into here by the island via portal-effect */}
        <div id="cb-tabs" style="display:flex;align-items:center;gap:0;padding:0 24px;border-bottom:1px solid var(--border);flex-shrink:0;background:var(--bg-surface);" />

        {/* Controls — island owns Pull/Download/Post */}
        <div style="display:flex;align-items:center;gap:10px;padding:12px 24px;border-bottom:1px solid var(--border);flex-shrink:0;flex-wrap:wrap;">
          <label style="font-size:11px;color:var(--text-dim);font-weight:600;">From</label>
          <input type="date" id="cb-date-from" class="sf-input" style="font-size:11px;padding:5px 8px;width:auto;cursor:pointer;" value={weekAgo} />
          <label style="font-size:11px;color:var(--text-dim);font-weight:600;">To</label>
          <input type="date" id="cb-date-to" class="sf-input" style="font-size:11px;padding:5px 8px;width:auto;cursor:pointer;" value={today} />
          <ChargebacksToolbar initialTab="cb" />
          <button class="sf-btn ghost" style="font-size:11px;margin-left:auto;" data-close-modal="chargebacks-modal">Close</button>
        </div>

        {/* Body — island renders into this */}
        <div id="cb-body" style="flex:1;overflow-y:auto;padding:20px 24px;">
          <div style="color:var(--text-dim);font-size:12px;text-align:center;padding:60px 0;">Select a date range and pull the report.</div>
        </div>
      </div>
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
