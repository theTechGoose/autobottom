/** Admin dashboard — pipeline stats, review queue, recent audits, queue management. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { apiFetch } from "../../lib/api.ts";
import { StatCard } from "../../components/StatCard.tsx";
import { timeAgo, scoreColor } from "../../lib/format.ts";

interface PipelineStats {
  inPipe?: number;
  active?: { findingId: string; step: string; ts: number }[];
  completed24h?: number;
  errors24h?: number;
  errors?: { findingId: string; step: string; error: string; ts: number }[];
  retries24h?: number;
}

interface ReviewStats {
  pending?: number;
  decided?: number;
  pendingAuditCount?: number;
}

interface DashboardData {
  pipeline: PipelineStats;
  review: ReviewStats;
  recentCompleted: { findingId: string; recordId: string; score: number; completedAt: number; type: string }[];
}

export default define.page(async function AdminDashboard(ctx) {
  const user = ctx.state.user!;

  let data: DashboardData = { pipeline: {}, review: {}, recentCompleted: [] };
  try {
    data = await apiFetch<DashboardData>("/admin/dashboard/data", ctx.req);
  } catch (e) {
    console.error("Failed to load dashboard data:", e);
  }

  const p = data.pipeline;
  const r = data.review;

  return (
    <Layout title="Dashboard" section="admin" user={user}>
      <div class="page-header">
        <h1>Dashboard</h1>
        <p class="page-sub">Pipeline overview and configuration</p>
      </div>

      {/* Stat cards — auto-refresh every 10s */}
      <div id="stats-section" hx-get="/api/admin/stats" hx-trigger="every 10s" hx-swap="innerHTML">
        <div class="stat-grid">
          <StatCard label="In Pipe" value={p.inPipe ?? 0} color="blue" sub={`${p.active?.length ?? 0} active`} />
          <StatCard label="Completed 24h" value={p.completed24h ?? 0} color="green" />
          <StatCard label="Errors 24h" value={p.errors24h ?? 0} color="red" sub={p.errors24h ? `${p.errors?.length ?? 0} unique` : "Clean"} />
          <StatCard label="Retries 24h" value={p.retries24h ?? 0} color="yellow" />
          <StatCard label="Review Pending" value={r.pending ?? 0} color="purple" sub={`${r.pendingAuditCount ?? 0} audits`} />
          <StatCard label="Decided" value={r.decided ?? 0} color="green" />
        </div>
      </div>

      {/* Active pipeline */}
      {(p.active?.length ?? 0) > 0 && (
        <div class="tbl">
          <div class="tbl-title">Active Pipeline ({p.active?.length ?? 0})</div>
          <table class="data-table">
            <thead><tr><th>Finding</th><th>Step</th><th>Age</th></tr></thead>
            <tbody>
              {p.active?.map((a) => (
                <tr key={a.findingId}>
                  <td class="mono">{a.findingId.slice(0, 8)}</td>
                  <td><span class="step-badge">{a.step}</span></td>
                  <td class="time-ago">{timeAgo(a.ts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Errors */}
      {(p.errors?.length ?? 0) > 0 && (
        <div class="tbl">
          <div class="tbl-title">Errors ({p.errors?.length ?? 0})</div>
          <table class="data-table">
            <thead><tr><th>Finding</th><th>Step</th><th>Error</th><th>Time</th><th>Action</th></tr></thead>
            <tbody>
              {p.errors?.map((e) => (
                <tr key={e.findingId}>
                  <td class="mono">{e.findingId.slice(0, 8)}</td>
                  <td><span class="step-badge">{e.step}</span></td>
                  <td class="error-msg">{e.error}</td>
                  <td class="time-ago">{timeAgo(e.ts)}</td>
                  <td>
                    <button class="btn btn-ghost" style="padding:4px 10px;font-size:11px;" hx-get={`/api/admin/retry?findingId=${e.findingId}&step=${e.step}`} hx-swap="none">Retry</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Recent completed */}
      <div class="tbl">
        <div class="tbl-title">Recent Completed</div>
        <table class="data-table">
          <thead><tr><th>Finding</th><th>Record</th><th>Type</th><th>Score</th><th>Completed</th></tr></thead>
          <tbody>
            {data.recentCompleted.length === 0 ? (
              <tr class="empty-row"><td colSpan={5}>No recent audits</td></tr>
            ) : data.recentCompleted.map((a) => (
              <tr key={a.findingId}>
                <td class="mono">{a.findingId.slice(0, 8)}</td>
                <td class="mono">{a.recordId}</td>
                <td><span class={`pill ${a.type === "internal" ? "pill-blue" : "pill-purple"}`}>{a.type}</span></td>
                <td><ScorePill score={a.score} /></td>
                <td class="time-ago">{timeAgo(a.completedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Queue management */}
      <div class="panels" style="margin-top: 16px;">
        <div class="panel">
          <div class="panel-title">Queue Management</div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button class="btn btn-ghost" hx-post="/api/admin/queue-action" hx-vals='{"action":"pause"}' hx-swap="none">Pause Queues</button>
            <button class="btn btn-ghost" hx-post="/api/admin/queue-action" hx-vals='{"action":"resume"}' hx-swap="none">Resume Queues</button>
            <button class="btn btn-danger" hx-post="/api/admin/queue-action" hx-vals='{"action":"clear-review"}' hx-swap="none" hx-confirm="Clear the review queue?">Clear Review</button>
            <button class="btn btn-danger" hx-post="/api/admin/queue-action" hx-vals='{"action":"clear-errors"}' hx-swap="none" hx-confirm="Clear all errors?">Clear Errors</button>
            <button class="btn btn-danger" hx-post="/api/admin/queue-action" hx-vals='{"action":"terminate-all"}' hx-swap="none" hx-confirm="Terminate ALL in-pipe findings?">Terminate All</button>
          </div>
        </div>
        <div class="panel">
          <div class="panel-title">Review Queue</div>
          <div class="rq-row">
            <div class="rq-stat pending"><div class="rv">{r.pending ?? 0}</div><div class="rl">Pending</div></div>
            <div class="rq-div"></div>
            <div class="rq-stat decided"><div class="rv">{r.decided ?? 0}</div><div class="rl">Decided</div></div>
          </div>
        </div>
      </div>
    </Layout>
  );
});

function ScorePill({ score }: { score: number }) {
  return <span class={`pill pill-${scoreColor(score)}`}>{score}%</span>;
}
