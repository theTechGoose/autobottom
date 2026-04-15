/** Judge dashboard — appeal stats, leaderboard. */
import { define } from "../../lib/define.ts";
import { Layout } from "../../components/Layout.tsx";
import { StatCard } from "../../components/StatCard.tsx";
import { apiFetch } from "../../lib/api.ts";

export default define.page(async function JudgeDashboard(ctx) {
  const user = ctx.state.user!;
  let stats = { pending: 0, decided: 0 };
  try { stats = await apiFetch<typeof stats>("/judge/api/dashboard", ctx.req); }
  catch (e) { console.error("Failed to load judge dashboard:", e); }

  return (
    <Layout title="Judge Dashboard" section="judge" user={user}>
      <div class="page-header"><h1>Judge Dashboard</h1><p class="page-sub">Appeal stats and performance</p></div>
      <div class="stat-grid">
        <StatCard label="Appeals Pending" value={stats.pending} color="purple" />
        <StatCard label="Decided" value={stats.decided} color="green" />
      </div>
      <div class="panels">
        <div class="panel"><div class="panel-title">Leaderboard</div><p style="color:var(--text-muted);font-size:13px;">Leaderboard data coming soon</p></div>
        <div class="panel"><div class="panel-title">Badges</div><p style="color:var(--text-muted);font-size:13px;">Badge showcase coming soon</p></div>
      </div>
    </Layout>
  );
});
