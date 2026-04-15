/** Admin dashboard — full production layout with all sections. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { apiFetch } from "../../lib/api.ts";
import { StatCard } from "../../components/StatCard.tsx";
import { DonutChart } from "../../components/DonutChart.tsx";
import { timeAgo, scoreColor } from "../../lib/format.ts";

interface ActiveItem { findingId: string; recordId?: string; step: string; ts: number; }
interface ErrorItem { findingId: string; step: string; error: string; ts: number; }
interface CompletedItem { findingId: string; recordId?: string; score?: number; completedAt: number; startedAt?: number; type?: string; }
interface PipelineStats { inPipe?: number; active?: ActiveItem[]; completed24h?: number; completedCount?: number; errors24h?: number; errors?: ErrorItem[]; retries24h?: number; retries?: unknown[]; }
interface ReviewStats { pending?: number; decided?: number; pendingAuditCount?: number; }
interface DashboardData { pipeline: PipelineStats; review: ReviewStats; recentCompleted: CompletedItem[]; }
interface TokenData { total_tokens: number; prompt_tokens: number; completion_tokens: number; calls: number; by_function: Record<string, { total_tokens: number; calls: number }>; }

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
      <div class="page-header"><h1>Dashboard</h1><p class="page-sub">Pipeline overview and configuration</p></div>

      {/* ===== STAT CARDS — auto-refresh every 30s ===== */}
      <div id="stats-section" hx-get="/api/admin/stats" hx-trigger="every 30s" hx-swap="innerHTML">
        <div class="stat-grid">
          <StatCard label="In Pipeline" value={p.inPipe ?? 0} color="yellow" />
          <StatCard label="Active" value={activeList.length} color="blue" sub={activeList.slice(0, 3).map(a => `${a.step}: ${a.findingId?.slice(0, 6)}`).join(", ") || "none"} />
          <StatCard label="Completed (24h)" value={completed} color="green" />
          <StatCard label="Errors (24h)" value={p.errors24h ?? errorList.length} color="red" sub={errorList.length ? `${errorList.length} unique` : "Clean"} />
          <StatCard label="Retries (24h)" value={p.retries24h ?? 0} color="yellow" />
        </div>
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
          <div style="font-size:20px;font-weight:700;color:var(--text-bright);margin-bottom:8px;font-variant-numeric:tabular-nums;">
            {tokens.total_tokens.toLocaleString()} <small style="font-size:11px;color:var(--text-dim);font-weight:400;">tokens ({tokens.calls.toLocaleString()} calls)</small>
          </div>
          <div style="display:flex;flex-direction:column;gap:3px;max-height:140px;overflow-y:auto;">
            {Object.entries(tokens.by_function).sort(([,a],[,b]) => b.total_tokens - a.total_tokens).map(([fn, d]) => (
              <div key={fn} style="display:flex;justify-content:space-between;align-items:center;padding:3px 7px;background:var(--bg);border-radius:4px;font-size:10px;">
                <span style="color:var(--text-muted);font-family:var(--mono);">{fn}</span>
                <span><span style="color:var(--text);font-weight:600;font-variant-numeric:tabular-nums;">{d.total_tokens.toLocaleString()}</span> <span style="color:var(--text-dim);font-size:9px;margin-left:5px;">{d.calls} calls</span></span>
              </div>
            ))}
            {Object.keys(tokens.by_function).length === 0 && <div style="color:var(--text-dim);font-size:11px;padding:10px;">No token usage</div>}
          </div>
        </div>
      </div>

      {/* ===== FIND AUDIT ===== */}
      <div class="card" style="margin-top:16px;padding:14px 18px;">
        <div class="tbl-title">Find Audit</div>
        <div style="display:flex;gap:10px;align-items:flex-end;">
          <div class="form-group" style="margin-bottom:0;flex:1;">
            <input type="text" id="find-finding-id" placeholder="Finding ID..." style="font-family:var(--mono);font-size:13px;" />
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
            <input type="text" id="test-rid" placeholder="Record ID..." style="font-family:var(--mono);font-size:13px;" />
          </div>
          <select id="test-type" style="height:40px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text-bright);padding:0 14px;font-size:13px;">
            <option value="internal">Internal (Date Leg)</option>
            <option value="partner">Partner (Package)</option>
          </select>
          <button class="btn btn-primary" style="height:40px;" hx-post="/api/admin/test-audit" hx-include="#test-rid, #test-type" hx-target="#test-result" hx-swap="innerHTML">Start Audit</button>
        </div>
        <div id="test-result" style="margin-top:8px;"></div>
      </div>

      {/* ===== RECENTLY COMPLETED ===== */}
      <div class="tbl" style="margin-top:16px;">
        <div class="tbl-title">Recently Completed</div>
        <table class="data-table">
          <thead><tr><th>Finding</th><th>QB Record</th><th>Type</th><th>Score</th><th>Started</th><th>Completed</th><th>Duration</th></tr></thead>
          <tbody>
            {recentList.length === 0 ? (
              <tr class="empty-row"><td colSpan={7}>No recent audits</td></tr>
            ) : recentList.map((a) => {
              const dur = a.startedAt && a.completedAt ? Math.round((a.completedAt - a.startedAt) / 1000) : null;
              return (
                <tr key={a.findingId}>
                  <td class="mono">{a.findingId?.slice(0, 8)}</td>
                  <td class="mono">{a.recordId ?? "\u2014"}</td>
                  <td>{a.type ? <span class={`pill ${a.type === "internal" ? "pill-blue" : "pill-purple"}`}>{a.type}</span> : "\u2014"}</td>
                  <td>{a.score != null ? <span class={`pill pill-${scoreColor(a.score)}`}>{a.score}%</span> : "\u2014"}</td>
                  <td class="time-ago">{a.startedAt ? timeAgo(a.startedAt) : "\u2014"}</td>
                  <td class="time-ago">{timeAgo(a.completedAt)}</td>
                  <td class="mono" style="color:var(--yellow);">{dur != null ? `${dur}s` : "\u2014"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ===== ACTIVE PIPELINE ===== */}
      {activeList.length > 0 && (
        <div class="tbl">
          <div class="tbl-title">Active Pipeline ({activeList.length})</div>
          <table class="data-table">
            <thead><tr><th>Finding</th><th>QB Record</th><th>Step</th><th>Started</th><th>Duration</th></tr></thead>
            <tbody>
              {activeList.map((a) => {
                const dur = a.ts ? Math.round((Date.now() - a.ts) / 1000) : null;
                return (
                  <tr key={a.findingId}>
                    <td class="mono">{a.findingId?.slice(0, 8)}</td>
                    <td class="mono">{a.recordId ?? "\u2014"}</td>
                    <td><span class="step-badge">{a.step}</span></td>
                    <td class="time-ago">{timeAgo(a.ts)}</td>
                    <td class="mono" style="color:var(--yellow);">{dur != null ? `${dur}s` : "\u2014"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ===== ERRORS ===== */}
      {errorList.length > 0 && (
        <div class="tbl">
          <div class="tbl-title">Errors ({errorList.length})</div>
          <table class="data-table">
            <thead><tr><th>Finding</th><th>Step</th><th>Error</th><th>When</th><th>Action</th></tr></thead>
            <tbody>
              {errorList.map((e) => (
                <tr key={e.findingId}>
                  <td class="mono">{e.findingId?.slice(0, 8)}</td>
                  <td><span class="step-badge">{e.step}</span></td>
                  <td class="error-msg">{e.error}</td>
                  <td class="time-ago">{timeAgo(e.ts)}</td>
                  <td><button class="btn btn-ghost" style="padding:3px 8px;font-size:10px;" hx-get={`/api/admin/retry?findingId=${e.findingId}&step=${e.step}`} hx-swap="none">Retry</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
    </Layout>
  );
});
