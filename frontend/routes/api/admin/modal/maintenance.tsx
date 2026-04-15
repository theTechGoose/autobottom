/** Modal content: Data Maintenance — 5 tabs. */
import { define } from "../../../../lib/define.ts";
import { renderToString } from "preact-render-to-string";

export const handler = define.handlers({
  GET() {
    const html = renderToString(
      <div>
        <div style="display:flex;gap:4px;margin-bottom:16px;flex-wrap:wrap;">
          <button class="btn btn-danger" style="padding:5px 12px;font-size:11px;">Purge Data</button>
          <button class="btn btn-ghost" style="padding:5px 12px;font-size:11px;" hx-post="/api/admin/config-save" hx-vals='{"endpoint":"/admin/backfill-stale-scores"}' hx-target="#maint-msg" hx-swap="innerHTML" hx-confirm="Backfill stale scores?">Backfill Scores</button>
          <button class="btn btn-ghost" style="padding:5px 12px;font-size:11px;" hx-post="/api/admin/config-save" hx-vals='{"endpoint":"/admin/deduplicate-findings"}' hx-target="#maint-msg" hx-swap="innerHTML" hx-confirm="Deduplicate findings?">Deduplicate</button>
          <button class="btn btn-ghost" style="padding:5px 12px;font-size:11px;" hx-post="/api/admin/config-save" hx-vals='{"endpoint":"/admin/purge-bypassed-wire-deductions"}' hx-target="#maint-msg" hx-swap="innerHTML" hx-confirm="Remove wire deductions from bypassed offices?">Wire Cleanup</button>
        </div>
        <div class="modal-sub">Select an operation above. Destructive operations will ask for confirmation.</div>
        <div style="display:flex;gap:10px;align-items:flex-end;margin-top:12px;">
          <div><label class="sf-label">From</label><input type="date" class="sf-input" id="maint-from" /></div>
          <div><label class="sf-label">To</label><input type="date" class="sf-input" id="maint-to" /></div>
          <button class="btn btn-danger" style="padding:6px 14px;font-size:11px;" hx-post="/api/admin/config-save" hx-vals='{"endpoint":"/admin/purge-old-audits"}' hx-include="#maint-from, #maint-to" hx-target="#maint-msg" hx-swap="innerHTML" hx-confirm="PERMANENTLY delete all audit data in this range?">Purge</button>
        </div>
        <div id="maint-msg" style="margin-top:12px;"></div>
      </div>
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
