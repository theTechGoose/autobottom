/** Modal content: Data Maintenance — tabbed UI. Top button row picks a tab,
 *  HTMX swaps in just that tab's panel below.
 *
 *  All tabs route through this single GET handler with ?tab=<key>; the
 *  default is "backfill". Each click re-fetches and swaps #maint-shell so
 *  the active tab styling stays in sync without inline JS. */
import { define } from "../../../../lib/define.ts";
import { renderToString } from "preact-render-to-string";
import type { VNode } from "preact";

type TabKey = "backfill" | "wire" | "dedupe" | "purge" | "flip" | "migration";

const TABS: Array<{ key: TabKey; label: string; danger?: boolean }> = [
  { key: "backfill", label: "Backfill Scores" },
  { key: "wire", label: "Wire Cleanup" },
  { key: "dedupe", label: "Deduplicate" },
  { key: "purge", label: "Purge Old Audits", danger: true },
  { key: "flip", label: "Bulk Flip" },
  { key: "migration", label: "Migration" },
];

export const handler = define.handlers({
  GET(ctx) {
    const tab = (new URL(ctx.req.url).searchParams.get("tab") ?? "backfill") as TabKey;
    const active = TABS.find((t) => t.key === tab) ? tab : "backfill";

    const html = renderToString(
      <div id="maint-shell">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
          <div>
            <div class="modal-title">Data Maintenance</div>
            <div class="modal-sub">Pick a tool to run</div>
          </div>
          <button data-close-modal="maintenance-modal" style="background:none;border:none;color:var(--text-dim);font-size:20px;cursor:pointer;padding:0 4px;line-height:1;">&times;</button>
        </div>

        <TabBar active={active} />

        <div style="margin-top:14px;">
          {active === "backfill" && <BackfillPanel />}
          {active === "wire" && <WirePanel />}
          {active === "dedupe" && <DedupePanel />}
          {active === "purge" && <PurgePanel />}
          {active === "flip" && <BulkFlipPanel />}
          {active === "migration" && <MigrationPanel />}
        </div>

        <div id="maint-msg" style="margin-top:12px;"></div>
      </div>,
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});

// ── Tab strip ────────────────────────────────────────────────────────────────

function TabBar({ active }: { active: TabKey }) {
  return (
    <div style="display:flex;gap:6px;flex-wrap:wrap;border-bottom:1px solid var(--border);padding-bottom:8px;">
      {TABS.map((t) => {
        const isActive = t.key === active;
        const color = isActive
          ? (t.danger ? "var(--red)" : "var(--blue)")
          : "var(--text-dim)";
        const bg = isActive ? "var(--bg)" : "transparent";
        const border = isActive
          ? `1px solid ${t.danger ? "var(--red)" : "var(--blue)"}`
          : "1px solid var(--border)";
        return (
          <button
            type="button"
            class="sf-btn ghost"
            style={`padding:6px 12px;font-size:11px;font-weight:600;color:${color};background:${bg};border:${border};border-radius:4px;`}
            hx-get={`/api/admin/modal/maintenance?tab=${t.key}`}
            hx-target="#maint-shell"
            hx-swap="outerHTML"
          >{t.label}</button>
        );
      })}
    </div>
  );
}

// ── Tab panels ──────────────────────────────────────────────────────────────

function PanelCard(props: { title: string; subtitle?: string; danger?: boolean; children: VNode | VNode[] }) {
  const accent = props.danger ? "var(--red)" : "var(--text-bright)";
  return (
    <div style="border:1px solid var(--border);border-radius:6px;padding:14px;background:var(--bg);">
      <div style={`font-size:13px;font-weight:700;color:${accent};margin-bottom:4px;`}>{props.title}</div>
      {props.subtitle && <div style="font-size:11px;color:var(--text-dim);margin-bottom:12px;">{props.subtitle}</div>}
      {props.children}
    </div>
  );
}

function BackfillPanel() {
  return (
    <PanelCard title="Backfill Scores" subtitle="Recalculate scores for findings missing score data. Paginated — re-run until done.">
      <button
        class="sf-btn primary"
        style="padding:8px 14px;"
        hx-post="/api/admin/config-save"
        hx-vals='{"endpoint":"/admin/backfill-stale-scores"}'
        hx-target="#maint-msg"
        hx-swap="innerHTML"
        hx-confirm="Backfill stale scores for findings missing score data?"
      >Run Backfill</button>
    </PanelCard>
  );
}

function WirePanel() {
  return (
    <PanelCard title="Wire Cleanup" subtitle="Remove wire deductions from offices that match the bypass-config patterns.">
      <button
        class="sf-btn primary"
        style="padding:8px 14px;"
        hx-post="/api/admin/config-save"
        hx-vals='{"endpoint":"/admin/purge-bypassed-wire-deductions"}'
        hx-target="#maint-msg"
        hx-swap="innerHTML"
        hx-confirm="Remove wire deductions from bypassed offices?"
      >Run Cleanup</button>
    </PanelCard>
  );
}

function DedupePanel() {
  return (
    <PanelCard title="Deduplicate Findings" subtitle="Scan a date range for duplicate findings. Dry-run by default — check Execute to actually delete.">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
        <div class="sf"><label class="sf-label">From</label><input type="date" name="since" class="sf-input" id="dedupe-since" /></div>
        <div class="sf"><label class="sf-label">To</label><input type="date" name="until" class="sf-input" id="dedupe-until" /></div>
      </div>
      <div style="display:flex;align-items:center;gap:14px;">
        <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-dim);"><input type="checkbox" name="execute" value="true" /> Execute (default: dry-run)</label>
        <button
          class="sf-btn primary"
          style="padding:8px 16px;"
          hx-post="/api/admin/config-save"
          hx-vals='{"endpoint":"/admin/deduplicate-findings"}'
          hx-include="#dedupe-since,#dedupe-until,[name='execute']"
          hx-target="#maint-msg"
          hx-swap="innerHTML"
          hx-confirm="Scan this range for duplicate findings?"
        >Run</button>
      </div>
    </PanelCard>
  );
}

function PurgePanel() {
  return (
    <PanelCard danger title="Purge Old Audits" subtitle="Permanently delete all audit data within a date range. This cannot be undone.">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
        <div class="sf"><label class="sf-label">From</label><input type="date" name="since" class="sf-input" id="maint-since" /></div>
        <div class="sf"><label class="sf-label">Before</label><input type="date" name="before" class="sf-input" id="maint-before" /></div>
      </div>
      <button
        class="sf-btn danger"
        style="padding:8px 16px;"
        hx-post="/api/admin/config-save"
        hx-vals='{"endpoint":"/admin/purge-old-audits"}'
        hx-include="#maint-since,#maint-before"
        hx-target="#maint-msg"
        hx-swap="innerHTML"
        hx-confirm="PERMANENTLY delete all audit data in this range? This cannot be undone."
      >Purge</button>
    </PanelCard>
  );
}

function BulkFlipPanel() {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  return (
    <PanelCard title="Bulk Flip" subtitle="Pull unreviewed audits matching your filters and flip all answers to Yes (100% score). This removes them from the review queue.">
      <form
        hx-get="/api/admin/modal/maintenance/flip-pull"
        hx-target="#flip-results"
        hx-swap="innerHTML"
      >
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:8px;">
          <div class="sf"><label class="sf-label">From</label><input type="date" name="since" class="sf-input" value={weekAgo} /></div>
          <div class="sf"><label class="sf-label">To</label><input type="date" name="until" class="sf-input" value={today} /></div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px;">
          <div class="sf">
            <label class="sf-label">Type</label>
            <select name="type" class="sf-input">
              <option value="all">All Types</option>
              <option value="date-leg">Internal</option>
              <option value="package">Partner</option>
            </select>
          </div>
          <div class="sf"><label class="sf-label">Department</label><input type="text" name="department" class="sf-input" placeholder="any" /></div>
          <div class="sf"><label class="sf-label">Shift</label><input type="text" name="shift" class="sf-input" placeholder="any" /></div>
        </div>
        <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;">
          <div class="sf"><label class="sf-label">Min %</label><input type="number" name="scoreMin" class="sf-input" value="0" min="0" max="100" style="width:80px;" /></div>
          <div class="sf"><label class="sf-label">Max %</label><input type="number" name="scoreMax" class="sf-input" value="99" min="0" max="100" style="width:80px;" /></div>
          <button type="submit" class="sf-btn primary" style="padding:8px 16px;">Pull Unreviewed</button>
        </div>
      </form>
      <div id="flip-results" style="margin-top:12px;"></div>
    </PanelCard>
  );
}

function MigrationPanel() {
  return (
    <div style="display:flex;flex-direction:column;gap:12px;">
      <PanelCard title="Configuration" subtitle="Read prod KV via PROD_EXPORT_BASE_URL + KV_EXPORT_SECRET env vars (HTTP export endpoint on main); write Firestore. Idempotent — re-run safely.">
        <div style="display:flex;align-items:center;gap:10px;">
          <button class="sf-btn ghost" style="padding:6px 12px;font-size:11px;" hx-get="/api/admin/migration/config-check" hx-target="#mig-config" hx-swap="innerHTML" hx-trigger="click, load">Check Config</button>
          <div id="mig-config" style="flex:1;"></div>
        </div>
      </PanelCard>

      <PanelCard title="1. Inventory" subtitle="Scan prod KV and count entries per (org, type).">
        <button class="sf-btn ghost" style="padding:6px 12px;font-size:11px;margin-bottom:8px;" hx-get="/api/admin/migration/inventory" hx-target="#mig-inventory" hx-swap="innerHTML">Scan Prod KV</button>
        <div id="mig-inventory" style="max-height:220px;overflow:auto;"></div>
      </PanelCard>

      <PanelCard title="⚡ Fast Migration (index-driven)" subtitle="Walks audit-done-idx with server-side date filter, queues finding + transcript + audit-job per indexed findingId. Skips the full TypedStore walk. ~30 sec per day. Hard cap of 5000 findings per run — chunk by day or narrower if you hit it. Doesn't migrate batch-answers / populated-questions / configs — run a normal scan periodically for those.">
        <form hx-post="/api/admin/migration/run" hx-target="#mig-runs" hx-swap="afterbegin" hx-encoding="multipart/form-data">
          <input type="hidden" name="mode" value="index-driven" />
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
            <div class="sf"><label class="sf-label">From</label><input type="date" name="since" class="sf-input" required /></div>
            <div class="sf"><label class="sf-label">To</label><input type="date" name="until" class="sf-input" required /></div>
          </div>
          <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
            <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-dim);"><input type="checkbox" name="dryRun" /> Dry run (no writes)</label>
            <button type="submit" class="sf-btn primary" style="padding:6px 14px;font-size:11px;" hx-confirm="Start fast migration?">⚡ Run Fast</button>
          </div>
        </form>
      </PanelCard>

      <PanelCard title="🔍 Find Orphan Findings" subtitle="Lists findings present in __audit-finding__ but lacking an audit-done-idx entry. These would be skipped by Fast Migration — usually failed or in-progress audits.">
        <button class="sf-btn ghost" style="padding:6px 12px;font-size:11px;margin-bottom:8px;" hx-post="/api/admin/migration/orphan-check" hx-target="#mig-orphans" hx-swap="innerHTML" hx-confirm="Walk audit-finding + audit-done-idx? Takes ~1-2 min on a large DB.">Find Orphans</button>
        <div id="mig-orphans" style="max-height:220px;overflow:auto;font-size:11px;"></div>
      </PanelCard>

      <PanelCard title="🛡️ Verify & Repair (Full)" subtitle="Walks every prod KV key, compares to Firestore, writes any missing/different values inline. Cutover-grade guarantee: when a re-run reports repaired=0 + errors=[], the migration is bit-identical to prod. Estimated 25-50 min for a healthy migration; resumable + cancellable; survives isolate restarts.">
        <form hx-post="/api/admin/migration/run" hx-target="#mig-runs" hx-swap="afterbegin" hx-encoding="multipart/form-data">
          <input type="hidden" name="mode" value="verify-repair" />
          <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
            <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-dim);"><input type="checkbox" name="deepCompare" /> Deep compare every bucket (1-3h, paranoid mode)</label>
            <button type="submit" class="sf-btn primary" style="padding:6px 14px;font-size:11px;" hx-confirm="Start full verify-and-repair pass?">🛡️ Run Verify</button>
          </div>
        </form>
      </PanelCard>

      <PanelCard title="2. Run Migration" subtitle="Date-range filter is applied only to types with a known timestamp field (audit-finding, completed-audit-stat, etc.). Other types are migrated whole. Each /status poll advances the job ~30s — survives isolate restarts.">
        <form hx-post="/api/admin/migration/run" hx-target="#mig-runs" hx-swap="afterbegin" hx-encoding="multipart/form-data">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
            <div class="sf"><label class="sf-label">From</label><input type="date" name="since" class="sf-input" /></div>
            <div class="sf"><label class="sf-label">To</label><input type="date" name="until" class="sf-input" /></div>
          </div>
          <div class="sf" style="margin-bottom:8px;"><label class="sf-label">Types (comma-separated, blank = all)</label><input type="text" name="types" class="sf-input" placeholder="audit-finding,audit-transcript,user,org" /></div>
          <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
            <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-dim);"><input type="checkbox" name="dryRun" /> Dry run (no writes)</label>
            <button type="submit" class="sf-btn primary" style="padding:6px 14px;font-size:11px;" hx-confirm="Start migration with these options?">Run</button>
            <div style="flex:1;"></div>
            <button
              type="button"
              class="sf-btn ghost"
              style="padding:6px 14px;font-size:11px;color:var(--red);border-color:var(--red);"
              hx-post="/api/admin/migration/kill-all"
              hx-target="#mig-killall"
              hx-swap="innerHTML"
              hx-confirm="KILL ALL running migration jobs? This force-cancels every job currently in progress."
            >🛑 Kill All</button>
          </div>
        </form>
        <div id="mig-killall" style="margin-top:6px;font-size:11px;"></div>
        {/* Persistent job history — auto-loads last 24h on panel-open and
            self-refreshes every 30s to surface newly-completed jobs. Newly
            kicked jobs prepend via `hx-swap="afterbegin"` from the Run forms. */}
        <div
          id="mig-runs"
          hx-get="/api/admin/migration/runs"
          hx-trigger="load"
          hx-swap="outerHTML"
          style="display:flex;flex-direction:column;gap:10px;margin-top:10px;"
        >
          <div style="padding:8px;color:var(--text-dim);font-size:11px;text-align:center;">loading recent jobs…</div>
        </div>
      </PanelCard>

      <PanelCard title="3. Cutover Snapshot + Delta" subtitle="Capture a versionstamp before pointing prod traffic at Firestore; afterward, run delta to migrate any KV writes that landed during the switch.">
        <button class="sf-btn ghost" style="padding:6px 12px;font-size:11px;" hx-post="/api/admin/migration/snapshot" hx-target="#mig-snap" hx-swap="innerHTML" hx-confirm="Capture cutover snapshot now?">Snapshot Now</button>
        <div id="mig-snap" style="margin:8px 0;"></div>
        <form hx-post="/api/admin/migration/run" hx-target="#mig-runs" hx-swap="afterbegin">
          <div style="display:flex;gap:8px;align-items:flex-end;">
            <div class="sf" style="flex:1;"><label class="sf-label">Since versionstamp</label><input type="text" name="sinceVersionstamp" class="sf-input" placeholder="paste from snapshot above" /></div>
            <button type="submit" class="sf-btn ghost" style="padding:6px 14px;font-size:11px;" hx-confirm="Migrate delta since this versionstamp?">Run Delta</button>
          </div>
        </form>
      </PanelCard>

      <PanelCard title="4. Verify" subtitle="Reservoir-sample N keys from prod KV; for each, read the same value from Firestore and compare.">
        <form hx-post="/api/admin/migration/verify" hx-target="#mig-verify" hx-swap="innerHTML">
          <div style="display:flex;gap:8px;align-items:flex-end;">
            <div class="sf"><label class="sf-label">Sample size</label><input type="number" name="sample" class="sf-input" value="50" min="1" max="1000" /></div>
            <button type="submit" class="sf-btn ghost" style="padding:6px 14px;font-size:11px;">Verify</button>
          </div>
        </form>
        <div id="mig-verify" style="margin-top:8px;"></div>
      </PanelCard>
    </div>
  );
}
