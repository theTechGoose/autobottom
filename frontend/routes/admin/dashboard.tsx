/** Admin dashboard — full production layout with all sections. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { apiFetch } from "../../lib/api.ts";
import { StatGrid } from "../../components/StatGrid.tsx";
import { DonutChart } from "../../components/DonutChart.tsx";
import { DashboardTables, computeLogsBase, type ActiveItem, type ErrorItem, type CompletedItem } from "../../components/DashboardTables.tsx";
import { TokenUsagePanel, type TokenData } from "../../components/TokenUsagePanel.tsx";
import { ReviewQueuePanel, type ReviewStatsShape } from "../../components/ReviewQueuePanel.tsx";
import PipelineActivityChart from "../../islands/PipelineActivityChart.tsx";

interface PipelineStats { inPipe?: number; active?: ActiveItem[]; completed24h?: number; completedCount?: number; errors24h?: number; errors?: ErrorItem[]; retries24h?: number; retries?: unknown[]; completedTs?: number[]; errorsTs?: number[]; retriesTs?: number[]; paused?: boolean; }
interface DashboardData { pipeline: PipelineStats; review: ReviewStatsShape; recentCompleted: CompletedItem[]; }

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
  const logsBase = computeLogsBase(ctx.req.url);

  return (
    <Layout title="Dashboard" section="admin" user={user}>
      {/* ===== STAT CARDS — auto-refresh every 10s ===== */}
      <div id="stats-section" hx-get="/api/admin/stats" hx-trigger="every 10s" hx-swap="innerHTML">
        <StatGrid p={p} />
      </div>

      {/* ===== CHARTS ROW ===== */}
      <div class="charts">
        <div class="chart-panel">
          <div class="chart-title">Pipeline Activity (24h)</div>
          <PipelineActivityChart
            completedTs={p.completedTs ?? []}
            errorsTs={p.errorsTs ?? []}
            retriesTs={p.retriesTs ?? []}
          />
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
        <div class="panel" id="review-queue-panel" hx-get="/api/admin/dashboard/review" hx-trigger="every 10s" hx-swap="innerHTML">
          <ReviewQueuePanel r={r} />
        </div>
        <div class="panel">
          <div class="panel-title">Token Usage (1h)</div>
          <div id="token-usage" hx-get="/api/admin/dashboard/tokens" hx-trigger="every 10s" hx-swap="innerHTML">
            <TokenUsagePanel tokens={tokens} />
          </div>
        </div>
      </div>

      {/* ===== FIND AUDIT — native form, opens /audit/report?id=X in new tab ===== */}
      <div class="card" style="margin-top:16px;padding:14px 18px;">
        <div class="tbl-title">Find Audit</div>
        <form method="GET" action="/audit/report" target="_blank" style="display:flex;gap:10px;align-items:center;">
          <input type="text" name="id" placeholder="Finding ID..." required style="font-family:var(--mono);font-size:13px;flex:1;padding:10px 14px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text-bright);" />
          <button class="btn btn-primary" type="submit" style="height:40px;">View Report</button>
          <button
            class="btn btn-danger"
            type="button"
            style="height:40px;"
            hx-post="/api/admin/find-audit/delete"
            hx-include="closest form"
            hx-target="#find-result"
            hx-swap="innerHTML"
            hx-confirm="Delete this finding?"
          >Delete</button>
        </form>
        <div id="find-result" style="margin-top:8px;font-size:11px;"></div>
      </div>

      {/* ===== FIND BY QB RECORD ===== */}
      <div class="card" style="margin-top:12px;padding:14px 18px;">
        <div class="tbl-title">Find by QB Record</div>
        <form
          style="display:flex;gap:10px;align-items:flex-end;"
          hx-get="/api/admin/find-by-record"
          hx-target="#find-record-result"
          hx-swap="innerHTML"
          hx-trigger="submit"
        >
          <div class="form-group" style="margin-bottom:0;flex:1;">
            <input type="text" name="recordId" placeholder="QB Record ID..." style="font-family:var(--mono);font-size:13px;" />
          </div>
          <button class="btn btn-primary" type="submit" style="height:40px;">Search</button>
        </form>
        <div id="find-record-result" style="margin-top:8px;"></div>
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

      {/* ===== DASHBOARD TABLES (Active Audits / Recent Errors / Recently Completed)
             — auto-refresh every 10s. Action buttons (Resume/Terminate/Clear/etc.) are
             inline with each table's title, NOT in a separate Queue Management panel. */}
      <div id="dashboard-tables" hx-get="/api/admin/dashboard/refresh" hx-trigger="every 10s, refresh" hx-swap="innerHTML">
        <DashboardTables recent={recentList} active={activeList} errors={errorList} logsBase={logsBase} paused={p.paused} />
      </div>
      {/* ===== CONFIG MODALS — opened from sidebar, content loaded via HTMX ===== */}
      {[
        { id: "qlab-modal", title: "Question Lab", sub: "Assign configs to destinations and offices", endpoint: "/api/admin/modal/qlab", className: "qlab-modal", noHeader: true },
        { id: "users-modal", title: "Users", sub: "Manage user accounts and roles", endpoint: "/api/admin/modal/users", className: "um-modal", noHeader: true },
        { id: "webhook-modal", title: "Webhook Configuration", sub: "Configure outbound webhooks for pipeline events", endpoint: "/api/admin/modal/webhook", noHeader: true },
        { id: "email-templates-modal", title: "Email Templates", sub: "Manage email notification templates", endpoint: "/api/admin/modal/email-templates", className: "et-modal", noHeader: true },
        // Chargebacks moved to /admin/chargebacks page route — its ChargebacksToolbar
        // island can't hydrate inside a modal HTMX swap (Gotcha #1).
        { id: "maintenance-modal", title: "Data Maintenance", sub: "Purge, backfill, deduplicate, and clean up data", endpoint: "/api/admin/modal/maintenance", noHeader: true },
        { id: "bad-words-modal", title: "Bad Words", sub: "Configure profanity scanning for transcripts", endpoint: "/api/admin/modal/bad-words", className: "bw-modal", noHeader: true },
        { id: "offices-modal", title: "Offices", sub: "Manage known offices and bypass patterns", endpoint: "/api/admin/modal/offices", noHeader: true },
        { id: "pipeline-modal", title: "Pipeline Settings", sub: "Control concurrency and failure recovery", endpoint: "/api/admin/modal/pipeline", className: "pipeline-modal", noHeader: true },
        // Bulk Audit moved to /admin/bulk-audit page route — same hydration reason.
        { id: "devtools-modal", title: "Dev Tools", sub: "Seed test users, wipe KV", endpoint: "/api/admin/modal/devtools", noHeader: true },
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
