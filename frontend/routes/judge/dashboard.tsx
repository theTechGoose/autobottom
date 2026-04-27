/** Judge dashboard — appeal stats, leaderboard, overturn breakdown. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { StatCard } from "../../components/StatCard.tsx";
import { DonutChart } from "../../components/DonutChart.tsx";
import { LeaderboardCard, type LeaderboardEntry } from "../../components/LeaderboardCard.tsx";
import { apiFetch } from "../../lib/api.ts";

export default define.page(async function JudgeDashboard(ctx) {
  const user = ctx.state.user!;
  let stats = { pending: 0, decided: 0 };
  let leaderboard: LeaderboardEntry[] = [];
  try { stats = await apiFetch<typeof stats>("/judge/api/dashboard", ctx.req); }
  catch (e) { console.error("Judge dashboard error:", e); }
  try { leaderboard = (await apiFetch<{ entries?: LeaderboardEntry[] }>("/gamification/api/leaderboard", ctx.req)).entries ?? []; }
  catch (e) { console.error("Leaderboard error:", e); }

  return (
    <Layout title="Judge Dashboard" section="judge" user={user} pathname={new URL(ctx.req.url).pathname}>
      <div class="page-header"><h1>Judge Dashboard</h1><p class="page-sub">Appeal stats and judge performance</p></div>

      <div id="judge-stats" hx-get="/api/judge/stats" hx-trigger="every 10s" hx-swap="innerHTML">
        <div class="stat-grid">
          <StatCard label="Appeals Pending" value={stats.pending} color="purple" />
          <StatCard label="Decided" value={stats.decided} color="green" />
          <StatCard label="Total" value={stats.pending + stats.decided} color="blue" />
        </div>
      </div>

      <div class="charts">
        <LeaderboardCard entries={leaderboard} accent="#14b8a6" />
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
