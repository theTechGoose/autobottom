/** Modal content: Data Maintenance — operations with descriptions matching production. */
import { define } from "../../../../lib/define.ts";
import { renderToString } from "preact-render-to-string";

export const handler = define.handlers({
  GET() {
    const html = renderToString(
      <div>
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px;">
          <div>
            <div class="modal-title">Data Maintenance</div>
            <div class="modal-sub">Purge, backfill, deduplicate, and clean up data</div>
          </div>
          <button data-close-modal="maintenance-modal" style="background:none;border:none;color:var(--text-dim);font-size:20px;cursor:pointer;padding:0 4px;line-height:1;">&times;</button>
        </div>

        <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px;">
          <button class="sf-btn ghost" style="justify-content:flex-start;padding:10px 14px;" hx-post="/api/admin/config-save" hx-vals='{"endpoint":"/admin/backfill-stale-scores"}' hx-target="#maint-msg" hx-swap="innerHTML" hx-confirm="Backfill stale scores? This recalculates scores for findings missing score data.">
            Backfill Scores
          </button>
          <button class="sf-btn ghost" style="justify-content:flex-start;padding:10px 14px;" hx-post="/api/admin/config-save" hx-vals='{"endpoint":"/admin/deduplicate-findings"}' hx-target="#maint-msg" hx-swap="innerHTML" hx-confirm="Scan for and remove duplicate findings?">
            Deduplicate Findings
          </button>
          <button class="sf-btn ghost" style="justify-content:flex-start;padding:10px 14px;" hx-post="/api/admin/config-save" hx-vals='{"endpoint":"/admin/purge-bypassed-wire-deductions"}' hx-target="#maint-msg" hx-swap="innerHTML" hx-confirm="Remove wire deductions from bypassed offices?">
            Wire Cleanup
          </button>
        </div>

        <div style="border-top:1px solid var(--border);padding-top:16px;">
          <div style="font-size:13px;font-weight:700;color:var(--red);margin-bottom:8px;">Purge Old Audits</div>
          <div style="font-size:11px;color:var(--text-dim);margin-bottom:12px;">Permanently delete all audit data within a date range. This cannot be undone.</div>
          <div style="display:flex;gap:10px;align-items:flex-end;">
            <div class="sf"><label class="sf-label">From</label><input type="date" class="sf-input" id="maint-from" /></div>
            <div class="sf"><label class="sf-label">To</label><input type="date" class="sf-input" id="maint-to" /></div>
            <button class="sf-btn danger" style="padding:8px 16px;" hx-post="/api/admin/config-save" hx-vals='{"endpoint":"/admin/purge-old-audits"}' hx-include="#maint-from, #maint-to" hx-target="#maint-msg" hx-swap="innerHTML" hx-confirm="PERMANENTLY delete all audit data in this range? This cannot be undone.">Purge</button>
          </div>
        </div>

        <div id="maint-msg" style="margin-top:12px;"></div>
      </div>
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
