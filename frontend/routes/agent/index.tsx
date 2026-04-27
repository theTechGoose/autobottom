/** Agent dashboard — personal audit results, stats, weekly trend. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { StatCard } from "../../components/StatCard.tsx";
import { apiFetch } from "../../lib/api.ts";
import { timeAgo } from "../../lib/format.ts";

interface WeeklyTrendDay { date: string; avgScore: number; count: number; }
interface AgentDashboard {
  totalAudits?: number;
  avgScore?: number;
  perfectCount?: number;
  recentAudits?: { findingId: string; recordId: string; score: number; completedAt: number; type: string }[];
  weeklyTrend?: WeeklyTrendDay[];
}

export default define.page(async function AgentDashboard(ctx) {
  const user = ctx.state.user!;

  let data: AgentDashboard = {};
  try {
    const raw = await apiFetch<{ message: string } & AgentDashboard>("/agent/api/dashboard", ctx.req);
    data = raw;
  } catch (e) { console.error("Agent dashboard error:", e); }

  const audits = data.recentAudits ?? [];
  const weeklyTrend = data.weeklyTrend ?? [];
  const trendHasData = weeklyTrend.some((d) => d.count > 0);

  return (
    <Layout title="My Dashboard" section="agent" user={user}>
      <div class="page-header"><h1>My Dashboard</h1><p class="page-sub">Your personal audit performance</p></div>

      <div id="agent-stats" hx-get="/api/agent/stats" hx-trigger="every 10s" hx-swap="innerHTML">
        <div class="stat-grid">
          <StatCard label="Total Audits" value={data.totalAudits ?? 0} color="blue" />
          <StatCard label="Avg Score" value={data.avgScore != null ? `${data.avgScore}%` : "\u2014"} color={data.avgScore && data.avgScore >= 90 ? "green" : data.avgScore && data.avgScore >= 70 ? "yellow" : "blue"} />
          <StatCard label="Perfect Scores" value={data.perfectCount ?? 0} color="green" />
        </div>
      </div>

      {trendHasData && (
        <div class="card" style="margin-bottom:16px;">
          <div class="tbl-title">Weekly Trend</div>
          <div class="trend-bars">
            {weeklyTrend.map((day) => (
              <div key={day.date} class="trend-bar-wrap">
                <div
                  class="trend-bar"
                  style={`height:${Math.max(day.avgScore, 5)}%;background:${day.count === 0 ? "var(--border)" : day.avgScore >= 90 ? "var(--green)" : day.avgScore >= 70 ? "var(--yellow)" : "var(--red)"}`}
                ></div>
                <div class="trend-label">{day.count === 0 ? "\u2014" : `${day.avgScore}%`}</div>
                <div class="trend-label" style="color:var(--text-dim);font-size:10px;">{day.date.slice(5)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent audits */}
      <div class="tbl">
        <div class="tbl-title">Recent Audits</div>
        <table class="data-table">
          <thead><tr><th>Finding</th><th>Record</th><th>Type</th><th>Score</th><th>Completed</th></tr></thead>
          <tbody>
            {audits.length === 0 ? (
              <tr class="empty-row"><td colSpan={5}>No audits yet — check back after your first call is processed</td></tr>
            ) : audits.map((a) => (
              <tr key={a.findingId}>
                <td class="mono">{a.findingId?.slice(0, 8)}</td>
                <td class="mono">{a.recordId}</td>
                <td><span class={`pill ${a.type === "internal" ? "pill-blue" : "pill-purple"}`}>{a.type}</span></td>
                <td><span class={`pill pill-${a.score >= 90 ? "green" : a.score >= 70 ? "yellow" : "red"}`}>{a.score}%</span></td>
                <td class="time-ago">{timeAgo(a.completedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
});

