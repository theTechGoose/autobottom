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
          <button class="sf-btn ghost" style="justify-content:flex-start;padding:10px 14px;" hx-post="/api/admin/config-save" hx-vals='{"endpoint":"/admin/purge-bypassed-wire-deductions"}' hx-target="#maint-msg" hx-swap="innerHTML" hx-confirm="Remove wire deductions from bypassed offices?">
            Wire Cleanup
          </button>
        </div>

        <div style="border-top:1px solid var(--border);padding-top:16px;margin-bottom:16px;">
          <div style="font-size:13px;font-weight:700;color:var(--text-bright);margin-bottom:8px;">Deduplicate Findings</div>
          <div style="font-size:11px;color:var(--text-dim);margin-bottom:12px;">Scan a date range and remove duplicate findings. Dry-run by default.</div>
          <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;">
            <div class="sf"><label class="sf-label">Since (ms)</label><input type="number" name="since" class="sf-input" id="dedupe-since" placeholder="0" /></div>
            <div class="sf"><label class="sf-label">Until (ms)</label><input type="number" name="until" class="sf-input" id="dedupe-until" placeholder="9999999999999" /></div>
            <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-dim);"><input type="checkbox" name="execute" value="true" /> Execute (default: dry-run)</label>
            <button class="sf-btn ghost" style="padding:8px 16px;" hx-post="/api/admin/config-save" hx-vals='{"endpoint":"/admin/deduplicate-findings"}' hx-include="#dedupe-since,#dedupe-until,[name='execute']" hx-target="#maint-msg" hx-swap="innerHTML" hx-confirm="Scan this range for duplicate findings?">Run</button>
          </div>
        </div>

        <div style="border-top:1px solid var(--border);padding-top:16px;">
          <div style="font-size:13px;font-weight:700;color:var(--red);margin-bottom:8px;">Purge Old Audits</div>
          <div style="font-size:11px;color:var(--text-dim);margin-bottom:12px;">Permanently delete all audit data within a date range. This cannot be undone.</div>
          <div style="display:flex;gap:10px;align-items:flex-end;">
            <div class="sf"><label class="sf-label">Since (ms)</label><input type="number" name="since" class="sf-input" id="maint-since" placeholder="0" /></div>
            <div class="sf"><label class="sf-label">Before (ms)</label><input type="number" name="before" class="sf-input" id="maint-before" placeholder="required" /></div>
            <button class="sf-btn danger" style="padding:8px 16px;" hx-post="/api/admin/config-save" hx-vals='{"endpoint":"/admin/purge-old-audits"}' hx-include="#maint-since,#maint-before" hx-target="#maint-msg" hx-swap="innerHTML" hx-confirm="PERMANENTLY delete all audit data in this range? This cannot be undone.">Purge</button>
          </div>
        </div>

        <div id="maint-msg" style="margin-top:12px;"></div>

        <div style="border-top:2px solid var(--border);margin-top:24px;padding-top:16px;">
          <div style="font-size:14px;font-weight:700;color:var(--blue);margin-bottom:4px;">KV → Firestore Migration</div>
          <div style="font-size:11px;color:var(--text-dim);margin-bottom:12px;">Read prod KV (via PROD_KV_URL + KV_ACCESS_TOKEN env vars), write Firestore. Idempotent — re-run safely.</div>

          <div style="margin-bottom:14px;">
            <div style="display:flex;align-items:center;gap:10px;">
              <button class="sf-btn ghost" style="padding:6px 12px;font-size:11px;" hx-get="/api/admin/migration/config-check" hx-target="#mig-config" hx-swap="innerHTML" hx-trigger="click, load">Check Config</button>
              <div id="mig-config" style="flex:1;"></div>
            </div>
          </div>

          <div style="margin-bottom:14px;">
            <div style="font-size:12px;font-weight:700;color:var(--text-bright);margin-bottom:6px;">1. Inventory</div>
            <button class="sf-btn ghost" style="padding:6px 12px;font-size:11px;margin-bottom:8px;" hx-get="/api/admin/migration/inventory" hx-target="#mig-inventory" hx-swap="innerHTML">Scan Prod KV</button>
            <div id="mig-inventory" style="max-height:240px;overflow:auto;"></div>
          </div>

          <div style="margin-bottom:14px;">
            <div style="font-size:12px;font-weight:700;color:var(--text-bright);margin-bottom:6px;">2. Run Migration</div>
            <form hx-post="/api/admin/migration/run" hx-target="#mig-runs" hx-swap="afterbegin" hx-encoding="multipart/form-data">
              <div style="display:grid;grid-template-columns:repeat(2, 1fr);gap:8px;margin-bottom:8px;">
                <div class="sf"><label class="sf-label">Since (ms timestamp, optional)</label><input type="number" name="since" class="sf-input" placeholder="e.g. 1735689600000" /></div>
                <div class="sf"><label class="sf-label">Until (ms timestamp, optional)</label><input type="number" name="until" class="sf-input" placeholder="leave blank for no upper bound" /></div>
              </div>
              <div class="sf" style="margin-bottom:8px;"><label class="sf-label">Types (comma-separated, blank = all)</label><input type="text" name="types" class="sf-input" placeholder="audit-finding,audit-transcript,user,org" /></div>
              <div style="display:flex;align-items:center;gap:14px;">
                <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-dim);"><input type="checkbox" name="dryRun" /> Dry run (no writes)</label>
                <button type="submit" class="sf-btn primary" style="padding:6px 14px;font-size:11px;" hx-confirm="Start migration with these options?">Run</button>
              </div>
            </form>
          </div>

          <div id="mig-runs" style="display:flex;flex-direction:column;gap:10px;margin-bottom:14px;"></div>

          <div style="margin-bottom:14px;">
            <div style="font-size:12px;font-weight:700;color:var(--text-bright);margin-bottom:6px;">3. Cutover Snapshot + Delta</div>
            <div style="font-size:10px;color:var(--text-dim);margin-bottom:6px;">Capture before pointing prod traffic at Firestore; after cutover, run delta to migrate any KV writes that landed during the switch.</div>
            <button class="sf-btn ghost" style="padding:6px 12px;font-size:11px;" hx-post="/api/admin/migration/snapshot" hx-target="#mig-snap" hx-swap="innerHTML" hx-confirm="Capture cutover snapshot now?">Snapshot Now</button>
            <div id="mig-snap" style="margin-top:8px;"></div>
            <form hx-post="/api/admin/migration/run" hx-target="#mig-runs" hx-swap="afterbegin" style="margin-top:10px;">
              <div style="display:flex;gap:8px;align-items:flex-end;">
                <div class="sf" style="flex:1;"><label class="sf-label">Since versionstamp</label><input type="text" name="sinceVersionstamp" class="sf-input" placeholder="paste from snapshot above" /></div>
                <button type="submit" class="sf-btn ghost" style="padding:6px 14px;font-size:11px;" hx-confirm="Migrate delta since this versionstamp?">Run Delta</button>
              </div>
            </form>
          </div>

          <div>
            <div style="font-size:12px;font-weight:700;color:var(--text-bright);margin-bottom:6px;">4. Verify</div>
            <form hx-post="/api/admin/migration/verify" hx-target="#mig-verify" hx-swap="innerHTML">
              <div style="display:flex;gap:8px;align-items:flex-end;">
                <div class="sf"><label class="sf-label">Sample size</label><input type="number" name="sample" class="sf-input" value="50" min="1" max="1000" /></div>
                <button type="submit" class="sf-btn ghost" style="padding:6px 14px;font-size:11px;">Verify</button>
              </div>
            </form>
            <div id="mig-verify" style="margin-top:8px;"></div>
          </div>
        </div>
      </div>
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
