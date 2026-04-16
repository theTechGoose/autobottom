/** Admin dashboard — full production layout with all sections. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { apiFetch } from "../../lib/api.ts";
import { StatGrid } from "../../components/StatGrid.tsx";
import { DonutChart } from "../../components/DonutChart.tsx";
import { DashboardTables, type ActiveItem, type ErrorItem, type CompletedItem } from "../../components/DashboardTables.tsx";
import { TokenUsagePanel, type TokenData } from "../../components/TokenUsagePanel.tsx";
import ModalController from "../../islands/ModalController.tsx";

interface PipelineStats { inPipe?: number; active?: ActiveItem[]; completed24h?: number; completedCount?: number; errors24h?: number; errors?: ErrorItem[]; retries24h?: number; retries?: unknown[]; }
interface ReviewStats { pending?: number; decided?: number; pendingAuditCount?: number; }
interface DashboardData { pipeline: PipelineStats; review: ReviewStats; recentCompleted: CompletedItem[]; }

export default define.page(async function AdminDashboard(ctx) {
  const user = ctx.state.user!;
  let data: DashboardData = { pipeline: {}, review: {}, recentCompleted: [] };
  let tokens: TokenData = { total_tokens: 0, prompt_tokens: 0, completion_tokens: 0, calls: 0, by_function: {} };

  try { data = await apiFetch<DashboardData>("/admin/dashboard/data", ctx.req); } catch (e) { console.error("Dashboard data error:", e); }
  try { tokens = await apiFetch<TokenData>("/admin/token-usage", ctx.req); } catch (e) { console.error("Token usage error:", e); }

  const p = data.pipeline;
  const r = data.review;
  const completed = p.completed24h ?? p.completedCount ?? 0;
  const activeList = p.active ?? [];
  const errorList = p.errors ?? [];
  const recentList = data.recentCompleted ?? [];

  return (
    <Layout title="Dashboard" section="admin" user={user}>
      <ModalController />

      {/* ===== STAT CARDS — auto-refresh every 10s ===== */}
      <div id="stats-section" hx-get="/api/admin/stats" hx-trigger="every 10s" hx-swap="innerHTML">
        <StatGrid p={p} />
      </div>

      {/* ===== CHARTS ROW ===== */}
      <div class="charts">
        <div class="chart-panel">
          <div class="chart-title">Pipeline Activity (24h)</div>
          <div style="text-align:center;color:var(--text-dim);padding:20px 0;font-size:12px;">
            {completed > 0 ? `${completed} completed` : "No activity"}{errorList.length > 0 ? ` · ${errorList.length} errors` : ""}
          </div>
        </div>
        <DonutChart
          title="Review Progress"
          segments={[
            { label: "Pending", value: r.pending ?? 0, color: "var(--yellow)" },
            { label: "Decided", value: r.decided ?? 0, color: "var(--green)" },
          ]}
        />
      </div>

      {/* ===== REVIEW QUEUE + TOKEN USAGE ===== */}
      <div class="panels">
        <div class="panel">
          <div class="panel-title" style="display:flex;justify-content:space-between;align-items:center;">
            <span>Review Queue</span>
            <button class="btn btn-danger" style="padding:3px 10px;font-size:10px;" hx-post="/api/admin/queue-action" hx-vals='{"action":"clear-review"}' hx-swap="none" hx-confirm="Clear the review queue?">Clear Queue</button>
          </div>
          <table class="data-table" style="margin-top:10px;">
            <thead><tr><th></th><th>Pending</th><th>Decided</th></tr></thead>
            <tbody>
              <tr style="cursor:pointer;" hx-get="/api/admin/review-drill?type=internal" hx-target="#review-drill" hx-swap="innerHTML"><td style="font-weight:600;color:var(--text-bright);">Internal</td><td class="mono" style="color:var(--yellow);">{r.pending ?? 0}</td><td class="mono" style="color:var(--green);">{r.decided ?? 0}</td></tr>
              <tr style="cursor:pointer;" hx-get="/api/admin/review-drill?type=partner" hx-target="#review-drill" hx-swap="innerHTML"><td style="font-weight:600;color:var(--text-bright);">Partner</td><td class="mono" style="color:var(--yellow);">0</td><td class="mono" style="color:var(--green);">0</td></tr>
            </tbody>
          </table>
          <div id="review-drill"></div>
        </div>
        <div class="panel">
          <div class="panel-title">Token Usage (1h)</div>
          <div id="token-usage" hx-get="/api/admin/dashboard/tokens" hx-trigger="every 10s" hx-swap="innerHTML">
            <TokenUsagePanel tokens={tokens} />
          </div>
        </div>
      </div>

      {/* ===== FIND AUDIT ===== */}
      <div class="card" style="margin-top:16px;padding:14px 18px;">
        <div class="tbl-title">Find Audit</div>
        <div style="display:flex;gap:10px;align-items:flex-end;">
          <div class="form-group" style="margin-bottom:0;flex:1;">
            <input type="text" id="find-finding-id" name="find-finding-id" placeholder="Finding ID..." style="font-family:var(--mono);font-size:13px;" />
          </div>
          <button class="btn btn-primary" style="height:40px;" hx-get="/api/admin/find-audit" hx-include="#find-finding-id" hx-target="#find-result" hx-swap="innerHTML">View Report</button>
          <button class="btn btn-danger" style="height:40px;" hx-get="/api/admin/find-audit" hx-include="#find-finding-id" hx-vals='{"action":"delete"}' hx-target="#find-result" hx-swap="innerHTML" hx-confirm="Delete this finding?">Delete</button>
        </div>
        <div id="find-result" style="margin-top:8px;"></div>
      </div>

      {/* ===== FIND BY QB RECORD ===== */}
      <div class="card" style="margin-top:12px;padding:14px 18px;">
        <div class="tbl-title">Find by QB Record</div>
        <form style="display:flex;gap:10px;align-items:flex-end;" method="GET" action="/admin/audits">
          <div class="form-group" style="margin-bottom:0;flex:1;">
            <input type="text" name="recordId" placeholder="QB Record ID..." style="font-family:var(--mono);font-size:13px;" />
          </div>
          <button class="btn btn-primary" type="submit" style="height:40px;">Search</button>
        </form>
      </div>

      {/* ===== TEST BY RID ===== */}
      <div class="card" style="margin-top:12px;padding:14px 18px;">
        <div class="tbl-title">Test Audit by RID</div>
        <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;">
          <div class="form-group" style="margin-bottom:0;flex:1;min-width:200px;">
            <input type="text" id="test-rid" name="test-rid" placeholder="Record ID..." style="font-family:var(--mono);font-size:13px;" />
          </div>
          <select id="test-type" name="test-type" style="height:40px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text-bright);padding:0 14px;font-size:13px;">
            <option value="internal">Internal (Date Leg)</option>
            <option value="partner">Partner (Package)</option>
          </select>
          <button class="btn btn-primary" style="height:40px;" hx-post="/api/admin/test-audit" hx-include="#test-rid, #test-type" hx-target="#test-result" hx-swap="innerHTML">Start Audit</button>
        </div>
        <div id="test-result" style="margin-top:8px;"></div>
      </div>

      {/* ===== DASHBOARD TABLES — auto-refresh every 10s ===== */}
      <div id="dashboard-tables" hx-get="/api/admin/dashboard/refresh" hx-trigger="every 10s" hx-swap="innerHTML">
        <DashboardTables recent={recentList} active={activeList} errors={errorList} />
      </div>

      {/* ===== QUEUE MANAGEMENT ===== */}
      <div class="panel" style="margin-top:16px;">
        <div class="panel-title">Queue Management</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-ghost" hx-post="/api/admin/queue-action" hx-vals='{"action":"pause"}' hx-swap="none">Pause Queues</button>
          <button class="btn btn-ghost" hx-post="/api/admin/queue-action" hx-vals='{"action":"resume"}' hx-swap="none">Resume Queues</button>
          <button class="btn btn-danger" hx-post="/api/admin/queue-action" hx-vals='{"action":"terminate-all"}' hx-swap="none" hx-confirm="Terminate ALL in-pipe findings?">Terminate All</button>
          <button class="btn btn-danger" hx-post="/api/admin/queue-action" hx-vals='{"action":"clear-errors"}' hx-swap="none" hx-confirm="Clear all errors?">Clear Errors</button>
        </div>
      </div>
      {/* ===== CONFIG MODALS — opened from sidebar, content loaded via HTMX ===== */}
      {[
        { id: "users-modal", title: "Users", sub: "Manage user accounts and roles", endpoint: "/api/admin/modal/users", className: "um-modal", noHeader: true },
        { id: "webhook-modal", title: "Webhook Configuration", sub: "Configure outbound webhooks for pipeline events", endpoint: "/api/admin/modal/webhook", noHeader: true },
        { id: "email-reports-modal", title: "Email Reports", sub: "Scheduled email report configurations", endpoint: "/api/admin/modal/email-reports", className: "er-modal", noHeader: true },
        { id: "email-templates-modal", title: "Email Templates", sub: "Manage email notification templates", endpoint: "/api/admin/modal/email-templates", className: "et-modal", noHeader: true },
        { id: "chargebacks-modal", title: "Chargebacks & Omissions", sub: "Review chargeback data and wire deductions", endpoint: "/api/admin/modal/chargebacks", className: "cb-modal", noHeader: true },
        { id: "maintenance-modal", title: "Data Maintenance", sub: "Purge, backfill, deduplicate, and clean up data", endpoint: "/api/admin/modal/maintenance", noHeader: true },
        { id: "bad-words-modal", title: "Bad Words", sub: "Configure profanity scanning for transcripts", endpoint: "/api/admin/modal/bad-words", className: "bw-modal", noHeader: true },
        { id: "offices-modal", title: "Offices", sub: "Manage known offices and bypass patterns", endpoint: "/api/admin/modal/offices", noHeader: true },
        { id: "pipeline-modal", title: "Pipeline Settings", sub: "Control concurrency and failure recovery", endpoint: "/api/admin/modal/pipeline", className: "pipeline-modal", noHeader: true },
        { id: "bonus-points-modal", title: "Bonus Points", sub: "Configure bonus point awards", endpoint: "/api/admin/modal/bonus-points" },
        { id: "impersonate-modal", title: "Impersonate User", sub: "View the app as another user", endpoint: "/api/admin/modal/impersonate" },
      ].map((m) => (
        <div key={m.id} id={m.id} class="modal-overlay">
          <div class={`modal ${m.className ?? ""}`}>
            {!m.noHeader && (
              <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                <div><div class="modal-title">{m.title}</div><div class="modal-sub">{m.sub}</div></div>
                <button data-close-modal={m.id} style="background:none;border:none;color:var(--text-dim);font-size:20px;cursor:pointer;padding:0 4px;line-height:1;">&times;</button>
              </div>
            )}
            <div id={`${m.id}-content`} hx-get={m.endpoint} hx-trigger="modal-open" hx-swap="innerHTML">
              <div style="color:var(--text-dim);font-size:12px;padding:20px;text-align:center;">Loading...</div>
            </div>
          </div>
        </div>
      ))}
    </Layout>
  );
});
