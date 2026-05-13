/** Modal content: Data Maintenance — tabbed UI. Top button row picks a tab,
 *  HTMX swaps in just that tab's panel below.
 *
 *  All tabs route through this single GET handler with ?tab=<key>; the
 *  default is "backfill". Each click re-fetches and swaps #maint-shell so
 *  the active tab styling stays in sync without inline JS. */
import { define } from "../../../../lib/define.ts";
import { renderToString } from "preact-render-to-string";
import type { VNode } from "preact";

type TabKey = "backfill" | "wire" | "dedupe" | "purge" | "flip" | "cleanup" | "index-tests" | "migration";

const TABS: Array<{ key: TabKey; label: string; danger?: boolean }> = [
  { key: "backfill", label: "Backfill Scores" },
  { key: "wire", label: "Wire Cleanup" },
  { key: "dedupe", label: "Deduplicate" },
  { key: "purge", label: "Purge Old Audits", danger: true },
  { key: "flip", label: "Bulk Flip" },
  { key: "cleanup", label: "Cleanup" },
  { key: "index-tests", label: "Index Tests" },
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
          {active === "cleanup" && <CleanupPanel />}
          {active === "index-tests" && <IndexTestsPanel />}
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
  // Posts to /api/admin/dedup-start, which kicks off the job on the
  // backend, returns a jobId immediately, and swaps in a self-polling
  // progress fragment that updates #maint-msg every 2s until done. The
  // dedup itself runs fire-and-forget in the background lane — the HTTP
  // request no longer hangs for 5-10 minutes with zero feedback.
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
          hx-post="/api/admin/dedup-start"
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
      {/* Reconcile sweep — finalizes any pending findings whose live score
          is already 100. Cleans up drift from pencil-flips that reached
          100% but never had review-pending / review-active entries
          drained. No score changes, no answer mutations. Safe to re-run. */}
      <div style="border:1px solid var(--border);border-radius:6px;padding:10px 12px;background:var(--bg-2);margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:12px;">
        <div style="font-size:11px;color:var(--text-dim);flex:1;">
          <strong style="color:var(--text-bright);">Sweep already-100% pending.</strong> One-shot cleanup for audits stuck at 100% with orphan queue entries. No flips, no data changes — just finalizes what was already finalized in spirit.
        </div>
        <button
          class="sf-btn ghost"
          style="padding:6px 14px;font-size:11px;white-space:nowrap;"
          hx-post="/api/admin/config-save"
          hx-vals='{"endpoint":"/admin/reconcile-perfect-pending"}'
          hx-target="#reconcile-msg"
          hx-swap="innerHTML"
          hx-confirm="Sweep all pending findings whose live score is already 100? Finalizes them without changing any scores."
        >Sweep finalized</button>
      </div>
      <div id="reconcile-msg" style="margin-bottom:14px;"></div>

      {/* Loading-state styles for the Pull Unreviewed button. HTMX toggles
          the `htmx-request` class on the form/button automatically while a
          request is in flight; we swap the label and visually disable
          interaction via CSS. hx-disabled-elt also disables the button
          attribute so a second submit can't queue. */}
      <style dangerouslySetInnerHTML={{ __html: `
        .pull-btn .pull-loading { display: none; }
        .pull-btn.htmx-request .pull-label { display: none; }
        .pull-btn.htmx-request .pull-loading { display: inline; }
        .pull-btn.htmx-request, .pull-btn:disabled { opacity: 0.7; cursor: wait; }
      `}} />
      <form
        hx-get="/api/admin/modal/maintenance/flip-pull"
        hx-target="#flip-results"
        hx-swap="innerHTML"
        hx-disabled-elt="find button[type='submit']"
        hx-indicator="find button[type='submit']"
        // submit = normal Pull Unreviewed button click
        // flip-complete from:body = re-fire after a chunked-flip run finishes
        //   so the table refreshes to show whatever's left. The flip-tick
        //   endpoint sends `HX-Trigger: flip-complete` on its final response.
        hx-trigger="submit, flip-complete from:body"
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
          <button type="submit" class="sf-btn primary pull-btn" style="padding:8px 16px;min-width:140px;">
            <span class="pull-label">Pull Unreviewed</span>
            <span class="pull-loading">Pulling…</span>
          </button>
        </div>
      </form>
      <div id="flip-results" style="margin-top:12px;"></div>
    </PanelCard>
  );
}

function CleanupPanel() {
  return (
    <div style="display:flex;flex-direction:column;gap:12px;">
      {/* Reuse the htmx-request loading-state pattern from the Pull Unreviewed
          button. HTMX adds .htmx-request to the indicator element while a
          request is in flight; we toggle .cl-label / .cl-loading via CSS so
          the operator sees "Sweeping…" instead of a frozen button. */}
      <style dangerouslySetInnerHTML={{ __html: `
        .cl-btn .cl-loading { display: none; }
        .cl-btn.htmx-request .cl-label { display: none; }
        .cl-btn.htmx-request .cl-loading { display: inline; }
        .cl-btn.htmx-request, .cl-btn:disabled { opacity: 0.7; cursor: wait; }
      `}} />

      <PanelCard
        title="Reset finding by ID"
        subtitle="Drain ALL derived state for a single finding (completed-audit-stat, audit-done-idx, review-pending/active/decided/done, chargeback + wire-deduction rows) and re-publish step-init so the same findingId re-enters the audit pipeline from the start. Use this when the auto-sweep misses an orphan or when you need to force a specific audit to re-run cleanly."
      >
        <form
          hx-post="/api/admin/config-save"
          hx-target="#cleanup-msg"
          hx-swap="innerHTML"
          hx-confirm="Drain derived state for this finding and re-publish step-init?"
          hx-disabled-elt="find button[type='submit']"
          hx-indicator="find button[type='submit']"
          style="display:flex;gap:8px;align-items:flex-end;"
        >
          <input type="hidden" name="endpoint" value="/admin/reset-finding" />
          <div class="sf" style="flex:1;">
            <label class="sf-label">Finding ID</label>
            <input type="text" name="findingId" class="sf-input" placeholder="e.g. lTBHVQh9hTVdWAWr6t1Qn" required />
          </div>
          <button type="submit" class="sf-btn primary cl-btn" style="padding:8px 16px;min-width:160px;">
            <span class="cl-label">Reset + Re-run</span>
            <span class="cl-loading">Resetting…</span>
          </button>
        </form>
      </PanelCard>

      <PanelCard
        title="Re-trigger drained audits by date"
        subtitle="Two ways to scan. (a) Leave the textarea EMPTY and pick a date range — Firestore field-filter query on audit-finding.startedAt returns only docs in that window (server-side index, fast). (b) Paste a specific fid list and pick a date range — same per-fid status + startedAt check, limited to your list (use this to retry chunked findings the field filter would miss). Either path lands in a confirmation card; nothing fires until you click Re-trigger."
      >
        <form
          hx-post="/api/admin/modal/maintenance/retrigger-scan"
          hx-target="#cleanup-msg"
          hx-swap="innerHTML"
          hx-disabled-elt="find button[type='submit']"
          hx-indicator="find button[type='submit']"
        >
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
            <div class="sf"><label class="sf-label">Started since</label><input type="date" name="since" class="sf-input" value={new Date().toISOString().slice(0, 10)} /></div>
            <div class="sf"><label class="sf-label">Started until</label><input type="date" name="until" class="sf-input" value={new Date().toISOString().slice(0, 10)} /></div>
          </div>
          <div class="sf" style="margin-bottom:10px;">
            <label class="sf-label">Finding IDs — OPTIONAL (one per line, or comma/space separated). Leave empty to scan every audit-finding doc.</label>
            <textarea
              name="fids"
              class="sf-input"
              rows={5}
              style="font-family:var(--mono);font-size:11px;resize:vertical;"
              placeholder="Optional. Paste from the Sweep result's 'Show drained finding IDs' to limit the scan to those — or leave empty to scan all."
            />
          </div>
          <button type="submit" class="sf-btn primary cl-btn" style="padding:8px 16px;min-width:160px;">
            <span class="cl-label">Scan candidates</span>
            <span class="cl-loading">Starting…</span>
          </button>
        </form>
      </PanelCard>

      <PanelCard
        title="Sweep orphaned 'Recently Completed'"
        subtitle="Scans completed-audit-stat rows against each finding doc. Any row whose finding is missing OR not in 'finished' status OR has empty answeredQuestions is drained: completed-audit-stat, audit-done-idx, review-pending/active/decided/done, audit-pending counter, locks, chargeback + wire-deduction rows. The finding doc itself is untouched so any in-flight re-audit can still complete. Scoped by date when you provide a window (uses the server-side ts index — near-instant); leave both blank to scan every stat row (slow on large stores)."
      >
        <form
          hx-post="/api/admin/modal/maintenance/sweep-start"
          hx-target="#cleanup-msg"
          hx-swap="innerHTML"
          hx-disabled-elt="find button[type='submit']"
          hx-indicator="find button[type='submit']"
          hx-confirm="Sweep 'Recently Completed' rows whose finding isn't actually finished? Cleans derived state without touching the finding doc."
        >
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
            <div class="sf"><label class="sf-label">ts since (optional)</label><input type="date" name="since" class="sf-input" /></div>
            <div class="sf"><label class="sf-label">ts until (optional)</label><input type="date" name="until" class="sf-input" /></div>
          </div>
          <button
            type="submit"
            class="sf-btn primary cl-btn"
            style="padding:8px 16px;min-width:160px;"
          >
            <span class="cl-label">Run Sweep</span>
            <span class="cl-loading">Starting…</span>
          </button>
        </form>
      </PanelCard>
      <div id="cleanup-msg"></div>
    </div>
  );
}

// ── Index Tests tab ──────────────────────────────────────────────────────────
//
// One-off rollout tool. Each card fires a tiny listStoredByCompletedAt query
// (limit=1) for a (type, fieldName) pair we want to use in production. If the
// underlying Firestore composite index `(_org, _type, <fieldName>, __name__)`
// exists, returns ✓ with row count + timing. If missing, Firestore returns
// FAILED_PRECONDITION with a console URL — we surface that URL so the
// operator can one-click create the index in the Firebase console.
//
// Walk all cards in order during the index-rollout branch deploy. When every
// card is ✓, swap the production callsites (see plan file) and merge to main.
// After merge, remove this tab in a follow-up commit.
const INDEX_TESTS: Array<{ name: string; title: string; usedBy: string }> = [
  {
    name: "review-active-claimedAt",
    title: "review-active by claimedAt",
    usedBy: "claimNextItem expiry sweep — fires on every reviewer claim (A1, biggest win)",
  },
  {
    name: "review-pending-completedAt",
    title: "review-pending by completedAt",
    usedBy: "getPendingReviewFindings — Bulk Flip Pull narrowing (A2)",
  },
  {
    name: "review-active-completedAt",
    title: "review-active by completedAt",
    usedBy: "getPendingReviewFindings — Bulk Flip Pull narrowing (A2)",
  },
  {
    name: "completed-audit-stat-ts",
    title: "completed-audit-stat by ts",
    usedBy: "backfillReviewScores (B1) + purgeOldAudits (B2) + sweep date window (B3)",
  },
  {
    name: "chargeback-entry-ts",
    title: "chargeback-entry by ts",
    usedBy: "purgeOldAudits (B2)",
  },
  {
    name: "wire-deduction-entry-ts",
    title: "wire-deduction-entry by ts",
    usedBy: "purgeOldAudits (B2)",
  },
  {
    name: "audit-finding-startedAt",
    title: "audit-finding by startedAt",
    usedBy: "Re-trigger empty-paste path — already shipped on main; included here as a known-working baseline",
  },
];

function IndexTestsPanel() {
  return (
    <div style="display:flex;flex-direction:column;gap:10px;">
      <div style="font-size:11px;color:var(--text-dim);padding:8px 12px;border:1px solid var(--border);border-radius:4px;background:var(--bg);">
        <strong style="color:var(--text-bright);">One-off rollout tool.</strong> Two buttons per card:
        <div style="margin-top:4px;"><strong style="color:var(--text-bright);">Run</strong> — 1-row probe. Green ✓ = composite index exists. Yellow ⚠️ with a URL = index missing; click it, Confirm in Firebase console, wait for index build (minutes-to-hours), re-click.</div>
        <div style="margin-top:4px;"><strong style="color:var(--text-bright);">Compare</strong> — runs the indexed query AND a brute-force scan on the same 30-day window. Delta = 0 + missing-field = 0 confirms the production swap is behavior-equivalent. Delta &gt; 0 OR missing-field &gt; 0 means docs would be silently excluded — backfill or fallback needed before swapping that callsite.</div>
        <div style="margin-top:4px;">When every card is ✓ Run AND ✓ Compare (or skipped for known reasons), the production swaps in the plan file are safe to land.</div>
      </div>
      {INDEX_TESTS.map((t) => <IndexTestCard {...t} />)}
    </div>
  );
}

function IndexTestCard({ name, title, usedBy }: { name: string; title: string; usedBy: string }) {
  return (
    <div style="border:1px solid var(--border);border-radius:4px;padding:10px 12px;background:var(--bg);">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:6px;">
        <div style="flex:1;">
          <div style="font-size:12px;font-weight:600;color:var(--text-bright);font-family:var(--mono);">{title}</div>
          <div style="font-size:11px;color:var(--text-dim);margin-top:2px;">{usedBy}</div>
        </div>
        <div style="display:flex;gap:6px;">
          <button
            class="sf-btn ghost"
            style="padding:6px 14px;font-size:11px;white-space:nowrap;"
            hx-post={`/api/admin/modal/maintenance/index-test?name=${name}`}
            hx-target={`#index-test-${name}`}
            hx-swap="innerHTML"
            title="1-row probe: does the composite index exist?"
          >Run</button>
          <button
            class="sf-btn ghost"
            style="padding:6px 14px;font-size:11px;white-space:nowrap;"
            hx-post={`/api/admin/modal/maintenance/index-test-compare?name=${name}`}
            hx-target={`#index-test-${name}`}
            hx-swap="innerHTML"
            hx-confirm="Comparing indexed vs brute-force scan on a 30-day window. Brute-force pulls full bodies — slow on large stores. Continue?"
            title="Compare: indexed count vs brute-force scan. Surfaces silent-exclusion gaps before landing a swap."
          >Compare</button>
        </div>
      </div>
      <div id={`index-test-${name}`}></div>
    </div>
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

      <PanelCard title="🩺 Migration Health Check" subtitle="One-shot health report. Lists running jobs, samples each bucket against Firestore, returns per-bucket status (healthy / missing-data / mismatched-data). Skips no types — covers chunked too. ~60-90s synchronous.">
        <button class="sf-btn primary" style="padding:8px 18px;font-size:12px;font-weight:700;" hx-post="/api/admin/migration/health-check" hx-target="#mig-health" hx-swap="innerHTML">🩺 Run Health Check</button>
        <div id="mig-health" style="margin-top:10px;"></div>
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
