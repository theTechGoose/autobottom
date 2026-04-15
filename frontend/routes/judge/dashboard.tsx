/** Judge dashboard — appeal stats, leaderboard, overturn breakdown. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { StatCard } from "../../components/StatCard.tsx";
import { DonutChart } from "../../components/DonutChart.tsx";
import { apiFetch } from "../../lib/api.ts";

export default define.page(async function JudgeDashboard(ctx) {
  const user = ctx.state.user!;
  let stats = { pending: 0, decided: 0 };
  try { stats = await apiFetch<typeof stats>("/judge/api/dashboard", ctx.req); }
  catch (e) { console.error("Judge dashboard error:", e); }

  return (
    <Layout title="Judge Dashboard" section="judge" user={user}>
      <div class="page-header"><h1>Judge Dashboard</h1><p class="page-sub">Appeal stats and judge performance</p></div>

      <div class="stat-grid">
        <StatCard label="Appeals Pending" value={stats.pending} color="purple" />
        <StatCard label="Decided" value={stats.decided} color="green" />
        <StatCard label="Total" value={stats.pending + stats.decided} color="blue" />
      </div>

      <div class="charts">
        <div class="panel">
          <div class="panel-title">Judge Leaderboard</div>
          <div class="tbl">
            <table class="data-table">
              <thead><tr><th>Judge</th><th>Decisions</th><th>Uphold Rate</th><th>Avg Speed</th></tr></thead>
              <tbody>
                <tr class="empty-row"><td colSpan={4}>Leaderboard data loads from judge activity tracking</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <DonutChart
          title="Appeal Progress"
          segments={[
            { label: "Pending", value: stats.pending, color: "var(--yellow)" },
            { label: "Decided", value: stats.decided, color: "var(--green)" },
          ]}
        />
      </div>

      <div class="panel">
        <div class="panel-title">Badges</div>
        <p style="color:var(--text-muted);font-size:13px;">Badge showcase — earned badges appear here as you judge appeals</p>
      </div>
    </Layout>
  );
});
